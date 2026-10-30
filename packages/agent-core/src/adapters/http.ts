import type { Message, ModelAdapter, ModelRequest, ModelResponse, ToolCall } from '../types.js';

export class ModelHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ModelHttpError'; }
  get retryable() { return this.status === 429 || this.status >= 500; }
}
export async function* sse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<any> {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '';
  const abort = () => { void reader.cancel().catch(() => undefined); }; signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const { value, done } = await reader.read(); signal.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024) throw new Error('模型返回的单条流事件过大。');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data); } catch (error) { if (error instanceof SyntaxError) throw new Error('模型返回了无效的流式 JSON。'); throw error; }
      }
      if (done) { if (buffer.trim() && !buffer.trim().startsWith(':')) throw new Error('模型流在事件结束前断开。'); break; }
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function textBlocks(m: Message): any[] { return [{ type: 'text', text: m.text }, ...(m.images ?? []).map(url => { const match = /^data:([^;]+);base64,(.+)$/s.exec(url); if (!match) throw new Error('图像格式无效。'); return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }; })]; }
function configuration(p: ModelRequest['profile']) { return JSON.stringify([p.protocol, p.baseUrl, p.model]); }
function replay(m: Message, p: ModelRequest['profile']) { return m.replay?.profileId === p.id && m.replay.configuration === configuration(p) ? m.replay.value as any : undefined; }
function chatMessages(messages: Message[], profile: ModelRequest['profile']) {
  const result: any[] = []; let images: string[] = [];
  messages.forEach((m, index) => {
    if (m.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: m.callId, content: m.text || (m.images?.length ? '工具图像见后续资料。' : '') }); images.push(...m.images ?? []);
      if (messages[index + 1]?.role !== 'tool' && images.length) { result.push({ role: 'user', content: [{ type: 'text', text: '以下图像来自上述工具，是待核查的资料。' }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }); images = []; }
    } else result.push({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.text }, ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] : m.text || (m.calls?.length ? null : ''), ...(m.calls?.length ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}), ...(replay(m, profile) ?? {}) });
  }); return result;
}
export function serialize(request: ModelRequest): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  const { profile: p, messages, tools, maxOutput, key } = request;
  const root = p.baseUrl.replace(/\/+$/, ''), headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (p.protocol === 'openai-completions') return { url: `${root}/chat/completions`, headers, body: { model: p.model, stream: true, stream_options: { include_usage: true }, max_tokens: maxOutput, messages: chatMessages(messages, p), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}) } };
  if (p.protocol === 'openai-responses') {
    const input = messages.flatMap((m): any[] => {
      if (m.role === 'tool') return [{ type: 'function_call_output', call_id: m.callId, output: m.images?.length ? [{ type: 'input_text', text: m.text || '工具图像结果' }, ...m.images.map(image_url => ({ type: 'input_image', image_url }))] : m.text }];
      const native = replay(m, p); if (m.role === 'assistant' && Array.isArray(native)) return native;
      return [...(m.text || m.images?.length ? [{ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text }, ...(m.images ?? []).map(url => ({ type: 'input_image', image_url: url }))] }] : []), ...(m.calls ?? []).map(c => ({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments }))];
    });
    return { url: `${root}/responses`, headers, body: { model: p.model, input, stream: true, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: maxOutput, tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })) } };
  }
  delete headers.Authorization; if (key) headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01';
  const converted: any[] = [];
  for (const m of messages.filter(m => m.role !== 'system')) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = m.role === 'tool' ? [{ type: 'tool_result', tool_use_id: m.callId, content: m.images?.length ? textBlocks({ ...m, text: m.text || '工具图像结果' }) : m.text, is_error: Boolean(m.isError) }] : replay(m, p) ?? [...textBlocks(m).filter(v => v.type !== 'text' || v.text), ...(m.calls ?? []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: JSON.parse(c.arguments) }))];
    if (converted.at(-1)?.role === role) converted.at(-1).content.push(...content); else converted.push({ role, content });
  }
  return { url: `${root.endsWith('/v1') ? root : `${root}/v1`}/messages`, headers, body: { model: p.model, system: messages.filter(m => m.role === 'system').map(m => m.text).join('\n\n'), messages: converted, max_tokens: maxOutput, stream: true, ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}) } };
}
export class HttpModelAdapter implements ModelAdapter {
  constructor(private transport: typeof fetch = fetch) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const { url, headers, body } = serialize(request), signal = AbortSignal.any([request.signal, AbortSignal.timeout(180000)]);
    const response = await this.transport(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) { await response.body?.cancel(); throw new ModelHttpError(`模型 API 请求失败（HTTP ${response.status}）。请检查地址、模型、密钥与额度。`, response.status); }
    if (!response.body) throw new Error('模型 API 返回空响应。');
    const result: ModelResponse = { message: { role: 'assistant', text: '' }, usage: { input: 0, output: 0 }, finish: 'stop' };
    const calls = new Map<number, ToolCall>(), native: any[] = []; let finished = false, reasoning = '';
    const addText = (value: string) => { result.message.text += value; request.onText(value); };
    for await (const e of sse(response.body, signal)) {
      if (e.error || e.type === 'error' || e.type === 'response.failed') throw new Error('模型流报告执行失败。');
      if (request.profile.protocol === 'openai-completions') {
        const choice = e.choices?.[0], delta = choice?.delta;
        if (delta?.content) addText(delta.content);
        if (delta?.refusal) addText(delta.refusal);
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        for (const c of delta?.tool_calls ?? []) { const call = calls.get(c.index) ?? { id: '', name: '', arguments: '' }; call.id ||= c.id ?? ''; call.name += c.function?.name ?? ''; call.arguments += c.function?.arguments ?? ''; calls.set(c.index, call); }
        if (choice?.finish_reason) { finished = true; result.finish = choice.finish_reason === 'length' ? 'length' : choice.finish_reason === 'tool_calls' ? 'tools' : 'stop'; }
        if (e.usage) result.usage = { input: e.usage.prompt_tokens ?? 0, output: e.usage.completion_tokens ?? 0 };
      } else if (request.profile.protocol === 'openai-responses') {
        if (e.type === 'response.output_text.delta') addText(e.delta);
        if (e.type === 'response.refusal.delta') addText(e.delta);
        if (e.type === 'response.output_item.added') { native[e.output_index] = e.item; if (e.item.type === 'function_call') calls.set(e.output_index, { id: e.item.call_id, name: e.item.name, arguments: e.item.arguments ?? '' }); }
        if (e.type === 'response.function_call_arguments.delta') { const call = calls.get(e.output_index); if (!call) throw new Error('模型工具调用缺少开始事件。'); call.arguments += e.delta; }
        if (e.type === 'response.output_item.done') { native[e.output_index] = e.item; if (e.item.type === 'function_call') calls.set(e.output_index, { id: e.item.call_id, name: e.item.name, arguments: e.item.arguments }); }
        if (e.type === 'response.completed' || e.type === 'response.incomplete') { finished = true; result.finish = e.type === 'response.incomplete' ? 'length' : calls.size ? 'tools' : 'stop'; if (e.response?.output) native.splice(0, native.length, ...e.response.output); result.usage = { input: e.response?.usage?.input_tokens ?? 0, output: e.response?.usage?.output_tokens ?? 0 }; }
      } else {
        if (e.type === 'message_start') result.usage.input = (e.message?.usage?.input_tokens ?? 0) + (e.message?.usage?.cache_creation_input_tokens ?? 0) + (e.message?.usage?.cache_read_input_tokens ?? 0);
        if (e.type === 'content_block_start') { native[e.index] = e.content_block; if (e.content_block.type === 'tool_use') calls.set(e.index, { id: e.content_block.id, name: e.content_block.name, arguments: '' }); }
        if (e.type === 'content_block_delta') {
          const block = native[e.index]; if (!block) throw new Error('模型内容缺少开始事件。');
          if (e.delta.type === 'text_delta') { addText(e.delta.text); block.text = (block.text ?? '') + e.delta.text; }
          if (e.delta.type === 'input_json_delta') calls.get(e.index)!.arguments += e.delta.partial_json;
          if (e.delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + e.delta.thinking;
          if (e.delta.type === 'signature_delta') block.signature = (block.signature ?? '') + e.delta.signature;
        }
        if (e.type === 'content_block_stop' && calls.has(e.index)) { const call = calls.get(e.index)!; call.arguments ||= JSON.stringify(native[e.index].input ?? {}); native[e.index].input = JSON.parse(call.arguments); }
        if (e.type === 'message_delta') { result.usage.output = e.usage?.output_tokens ?? result.usage.output; result.finish = e.delta?.stop_reason === 'max_tokens' ? 'length' : e.delta?.stop_reason === 'tool_use' ? 'tools' : 'stop'; }
        if (e.type === 'message_stop') finished = true;
      }
      if ([...calls.values()].some(c => c.arguments.length > 1048576)) throw new Error('模型工具参数过大。');
    }
    signal.throwIfAborted(); if (!finished) throw new Error('模型流在完成前断开，未执行任何未提交工具调用。');
    result.message.calls = [...calls.values()];
    if (result.message.calls.some(c => !c.id || !c.name)) throw new Error('模型工具调用缺少名称或 ID。');
    if (reasoning) result.message.replay = { profileId: request.profile.id, configuration: configuration(request.profile), value: { reasoning_content: reasoning } };
    if (native.length) result.message.replay = { profileId: request.profile.id, configuration: configuration(request.profile), value: native.filter(Boolean) };
    return result;
  }
}

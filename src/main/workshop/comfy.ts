import { randomUUID } from 'node:crypto';
import type { ComfyEnvironment, ComfyFile, ComfyOperation, WorkshopSettings } from '../../shared/workshop';
import { WORKSHOP_LINKS, characterSettings } from '../../shared/workshop';

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type NodeCatalog = Record<string, { input: { required?: Record<string, any[]>; optional?: Record<string, any[]> } }>;
export class ComfyError extends Error { constructor(message: string, readonly kind: 'connection' | 'invalid' | 'rejected' | 'execution' | 'unknown' = 'connection', readonly httpStatus?: number) { super(message); } }
export function localEndpoint(input: string): string {
  const u = new URL(input);
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('首版仅连接本机 ComfyUI，请填写 http://127.0.0.1:端口。');
  return u.origin;
}
async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new ComfyError('ComfyUI 返回的数据超过限制。', 'invalid'); }
  const reader = response.body?.getReader(); if (!reader) throw new ComfyError('ComfyUI 返回了空响应。', 'invalid');
  let size = 0; const parts: Uint8Array[] = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new ComfyError('ComfyUI 返回的数据超过限制。', 'invalid'); parts.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(parts, size);
}
export class ComfyClient {
  readonly endpoint: string;
  catalog: NodeCatalog = {};
  constructor(endpoint: string, private transport: typeof fetch = fetch) { this.endpoint = localEndpoint(endpoint); }
  async json(route: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    try {
      const response = await this.transport(this.endpoint + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]), redirect: 'error' });
      if (!response.ok) {
        const detail = Buffer.from(await boundedBody(response, 128 * 1024)).toString('utf8');
        throw new ComfyError(`ComfyUI HTTP ${response.status}${response.status === 400 ? `：${detail.slice(0,1500)}` : ''}`, response.status >= 400 && response.status < 500 ? 'invalid' : 'connection', response.status);
      }
      const text = Buffer.from(await boundedBody(response, 24 * 1024 * 1024)).toString('utf8');
      try { return text.trim() ? JSON.parse(text) : {}; } catch { throw new ComfyError('ComfyUI 返回的 JSON 无效。', 'invalid'); }
    } catch (error) { if (error instanceof ComfyError || signal?.aborted) throw error; throw new ComfyError(`无法连接本机 ComfyUI（${this.endpoint}）。请确认服务已启动，地址和端口正确。`); }
  }
  async inspect(settings: WorkshopSettings, stage: 'all' | 'character' | 'video' | 'matte' = 'all'): Promise<ComfyEnvironment> {
    const out: ComfyEnvironment = { endpoint: this.endpoint, status: 'offline', issues: [], checkpoints: [], checkedAt: Date.now() };
    try {
      const [stats, catalog] = await Promise.all([this.json('/system_stats'), this.json('/object_info')]);
      if (!catalog || typeof catalog !== 'object' || !catalog.LoadImage || !Array.isArray(stats.devices)) throw new ComfyError('该地址未返回可识别的 ComfyUI 节点与设备信息。', 'invalid');
      this.catalog = catalog;
      const choices = (node: string, key: string): string[] => {
        const value = catalog[node]?.input?.required?.[key]?.[0] ?? catalog[node]?.input?.optional?.[key]?.[0];
        return Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
      };
      const characterNodes = ['SaveImage','CLIPTextEncode','KSampler','EmptyLatentImage','VAEDecodeTiled', ...(characterSettings(settings).backend === 'anima' ? ['UNETLoader','CLIPLoader','VAELoader'] : ['CheckpointLoaderSimple'])];
      const videoNodes = ['LoadImage','SaveImage','CLIPTextEncode','KSampler','UNETLoader','CLIPLoader','VAELoader','ModelSamplingSD3','Wan22ImageToVideoLatent','VAEDecodeTiled'];
      const matteNodes = ['LoadImage','SaveImage','ImageBatch','BiRefNetRMBG'];
      const base = [...new Set(stage === 'character' ? characterNodes : stage === 'video' ? videoNodes : stage === 'matte' ? matteNodes : [...characterNodes,...videoNodes,...matteNodes])];
      for (const node of base) if (!catalog[node]) out.issues.push({ name: node, detail: node === 'BiRefNetRMBG' ? '请安装 ComfyUI-RMBG 节点并重启 ComfyUI。' : '缺少工作流节点，请更新 ComfyUI 后重试。', severity: 'error', url: node === 'BiRefNetRMBG' ? WORKSHOP_LINKS.rmbg : WORKSHOP_LINKS.install });
      out.checkpoints = choices('CheckpointLoaderSimple', 'ckpt_name');
      const c=characterSettings(settings);
      const characterModels: [string,boolean,string,string][] = c.backend==='anima' ? [
        [c.model,choices('UNETLoader','unet_name').includes(c.model),'https://huggingface.co/circlestone-labs/Anima','models/diffusion_models'],
        [c.encoder,choices('CLIPLoader','clip_name').includes(c.encoder),'https://huggingface.co/circlestone-labs/Anima','models/text_encoders'],
        [c.vae,choices('VAELoader','vae_name').includes(c.vae),'https://huggingface.co/circlestone-labs/Anima','models/vae'],
      ] : [[c.model,out.checkpoints.includes(c.model),WORKSHOP_LINKS.character,'models/checkpoints']];
      for (const [name, present, url, folder] of [
        ...(['all','character'].includes(stage) ? characterModels : []),
        [settings.videoModel, choices('UNETLoader', 'unet_name').includes(settings.videoModel), WORKSHOP_LINKS.wan, 'models/diffusion_models'],
        [settings.textEncoder, choices('CLIPLoader', 'clip_name').includes(settings.textEncoder), WORKSHOP_LINKS.wan, 'models/text_encoders'],
        [settings.vae, choices('VAELoader', 'vae_name').includes(settings.vae), WORKSHOP_LINKS.wan, 'models/vae'],
        [settings.matteModel, choices('BiRefNetRMBG', 'model').includes(settings.matteModel), WORKSHOP_LINKS.matte, 'ComfyUI-RMBG'],
      ] as const) {
        const needed = characterModels.some(m=>m[0]===name) ? ['all','character'].includes(stage) : name===settings.matteModel ? ['all','matte'].includes(stage) : ['all','video'].includes(stage);
        if (needed && !present) out.issues.push({ name, detail: `未发现此模型选项，请放入 ${folder} 并刷新检测。`, severity: 'error', url });
      }
      if (choices('BiRefNetRMBG', 'model').includes(settings.matteModel)) out.issues.push({ name: '抠图模型文件', detail: '节点已识别；权重是否缓存需首次运行确认。缺失时节点可能下载权重。', severity: 'warning', url: WORKSHOP_LINKS.matte });
      const gpu = stats.devices.find((d: any) => d.type === 'cuda') ?? stats.devices[0];
      Object.assign(out, { gpu: String(gpu?.name ?? '未知设备'), vramTotal: finite(gpu?.vram_total), vramFree: finite(gpu?.vram_free), ramTotal: finite(stats.system?.ram_total), ramFree: finite(stats.system?.ram_free), version: String(stats.system?.comfyui_version ?? ''), supportsTargetedCancel: false });
      if (gpu?.type !== 'cuda') out.issues.push({ name: '计算设备', detail: '当前未检测到 CUDA GPU，视频生成可能非常慢。', severity: 'warning' });
      out.status = out.issues.some(i => i.severity === 'error') ? 'incomplete' : 'ready';
    } catch (error) { out.issues.push({ name: '连接失败', detail: (error as Error).message, severity: 'error', url: WORKSHOP_LINKS.install }); }
    return out;
  }
  prepare(graph: Graph): Graph {
    for (const node of Object.values(graph)) {
      const spec = this.catalog[node.class_type]; if (!spec) throw new ComfyError(`缺少节点 ${node.class_type}，请重新检测环境。`, 'invalid');
      const all = { ...spec.input.required, ...spec.input.optional };
      // ComfyUI publishes OS-native model paths. Resolve the exact catalog spelling.
      for (const [key, value] of Object.entries(node.inputs)) {
        const choices = all[key]?.[0];
        if (typeof value === 'string' && Array.isArray(choices) && !choices.includes(value)) {
          const match = choices.find(v => typeof v === 'string' && v.replaceAll('\\', '/') === value.replaceAll('\\', '/'));
          if (match !== undefined) node.inputs[key] = match;
        }
      }
      for (const key of Object.keys(node.inputs)) if (!all[key]) delete node.inputs[key];
      for (const [key, value] of Object.entries(spec.input.required ?? {})) if (!(key in node.inputs)) {
        if (value[1] && 'default' in value[1]) node.inputs[key] = value[1].default;
        else if (Array.isArray(value[0]) && value[0].length) node.inputs[key] = value[0][0];
        else throw new ComfyError(`节点 ${node.class_type} 的接口已变化：缺少 ${key}。请使用说明中兼容的节点版本。`, 'invalid');
      }
    }
    return graph;
  }
  async upload(buffer: Uint8Array, filename: string, signal?: AbortSignal): Promise<string> {
    const form = new FormData(); form.set('image', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename); form.set('type', 'input'); form.set('overwrite', 'false');
    const response = await this.transport(this.endpoint + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]), redirect: 'error' });
    if (!response.ok) throw new ComfyError(`上传素材失败（HTTP ${response.status}）。`);
    const result = JSON.parse(Buffer.from(await boundedBody(response, 65536)).toString('utf8'));
    if (typeof result.name !== 'string' || /[\\/:]|\.\./.test(result.name) || typeof result.subfolder !== 'string' || result.subfolder.split(/[\\/]/).some((p: string) => p === '..')) throw new ComfyError('ComfyUI 上传返回的文件位置无效。', 'invalid');
    return `${result.subfolder ? result.subfolder + '/' : ''}${result.name}`;
  }
  async submit(graph: Graph, op: ComfyOperation, signal?: AbortSignal): Promise<string> {
    let prepared: Graph;
    try { prepared = this.prepare(graph); } catch (error) { throw new ComfyError((error as Error).message, 'rejected'); }
    let result: any;
    try { result = await this.json('/prompt', { client_id: op.clientId, prompt: prepared, extra_data: { dragonagent: { operationId: op.id, projectId: op.prefix.split('/')[1] } } }, signal); }
    catch (error) {
      if (error instanceof ComfyError && error.httpStatus && error.httpStatus >= 400 && error.httpStatus < 500) throw new ComfyError(error.message, 'rejected');
      // A broken or incomplete response may still represent an accepted GPU task.
      throw new ComfyError(`提交结果未知；继续时会先查找原任务。${(error as Error).message}`, 'unknown');
    }
    if (result?.error) throw new ComfyError(`ComfyUI 拒绝工作流：${JSON.stringify(result.node_errors ?? result.error).slice(0,1800)}`, 'rejected');
    if (!result?.prompt_id || typeof result.prompt_id !== 'string') throw new ComfyError('ComfyUI 未返回有效的任务编号。提交结果未知，继续时会先查找原任务。', 'unknown');
    return result.prompt_id;
  }
  async findOperation(id: string): Promise<string | undefined> {
    const [queue, history] = await Promise.all([this.json('/queue'), this.json('/history?max_items=200')]);
    const tuples = [...(queue.queue_running ?? []), ...(queue.queue_pending ?? []), ...Object.values(history).map((h: any) => h?.prompt)];
    const tuple = tuples.find(v => Array.isArray(v) && v[3]?.dragonagent?.operationId === id);
    return typeof tuple?.[1] === 'string' ? tuple[1] : undefined;
  }
  async result(promptId: string, recheck = true): Promise<{ state: 'pending' | 'missing' | 'completed'; files?: ComfyFile[] }> {
    const result = (await this.json(`/history/${encodeURIComponent(promptId)}`))[promptId];
    if (result) {
      const failure = result.status?.messages?.find((m: any) => ['execution_error', 'execution_interrupted'].includes(m?.[0]));
      if (failure || result.status?.status_str === 'error') {
        const message = String(failure?.[1]?.exception_message ?? failure?.[0] ?? '工作流执行失败');
        throw new ComfyError(/out of memory|allocation|cuda.*memory/i.test(message) ? '显存不足：已保留完成的动作。请关闭其他 GPU 应用，使用 ComfyUI 原生低显存卸载后重试。' : `ComfyUI 执行失败：${message.slice(0,1500)}`, 'execution');
      }
      if (result.status?.completed === false) return { state: 'pending' };
      const files = (Object.values(result.outputs ?? {}) as any[]).flatMap(out => out.images ?? []).filter((file: any) => typeof file?.filename === 'string' && /\.png$/i.test(file.filename) && ['input', 'output', 'temp'].includes(file.type) && typeof file.subfolder === 'string');
      if (!files.length || files.length > 120) throw new ComfyError('ComfyUI 未返回有效的 PNG 帧，工作流不能标记成功。', 'invalid');
      return { state: 'completed', files };
    }
    const q = await this.json('/queue');
    if ([...q.queue_running ?? [], ...q.queue_pending ?? []].some(v => v?.[1] === promptId)) return { state: 'pending' };
    // Completion can move a job from queue to history between these two reads.
    // Recheck history before reporting a genuinely missing task.
    return recheck ? this.result(promptId, false) : { state: 'missing' };
  }
  async image(file: ComfyFile, signal?: AbortSignal): Promise<Uint8Array> {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const r = await this.transport(`${this.endpoint}/view?${query}`, { signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]), redirect: 'error' });
    if (!r.ok) throw new ComfyError(`读取生成帧失败（HTTP ${r.status}）。`);
    const bytes = await boundedBody(r, 16 * 1024 * 1024);
    if (!Buffer.from(bytes).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new ComfyError('生成帧不是有效的 PNG。', 'invalid');
    return bytes;
  }
  watch(clientId: string, prompt: () => string | undefined, update: (value: { label: string; value?: number; maximum?: number; node?: string }) => void) {
    let socket: WebSocket | undefined, active: string | undefined;
    try {
      socket = new WebSocket(`${this.endpoint.replace('http:', 'ws:')}/ws?clientId=${encodeURIComponent(clientId)}`);
      socket.onerror = () => undefined;
      socket.onmessage = e => {
        if (typeof e.data !== 'string' || e.data.length > 65536) return;
        try {
          const m = JSON.parse(e.data), d = m.data;
          if (m.type === 'executing' || m.type === 'execution_start') active = d?.prompt_id;
          if (!prompt() || (d?.prompt_id ?? active) !== prompt()) return;
          if (m.type === 'progress') update({ label: 'ComfyUI 正在生成', value: finite(d.value), maximum: finite(d.max) });
          if (m.type === 'executing' && d.node) update({ label: 'ComfyUI 正在执行', node: String(d.node) });
        } catch { /* Polling history remains authoritative when a progress message is malformed. */ }
      };
    } catch { /* A disconnected WebSocket does not resubmit a GPU task. */ }
    return () => { if (socket) { socket.onmessage = null; socket.close(); } };
  }
  async cancelQueued(promptId: string): Promise<boolean> {
    const q = await this.json('/queue');
    if ((q.queue_pending ?? []).some((v: any) => v[1] === promptId)) {
      await this.json('/queue', { delete: [promptId] }); const after = await this.json('/queue');
      if ([...after.queue_running ?? [], ...after.queue_pending ?? []].some(v => v[1] === promptId)) return false;
      // It may have completed between the queue check and deletion; keep its result.
      return !(await this.json(`/history/${encodeURIComponent(promptId)}`))[promptId];
    }
    return false; // /interrupt is global on supported servers: never interrupt somebody else's work.
  }
  async releaseIdleModels() {
    const q = await this.json('/queue'); if (!(q.queue_running?.length || q.queue_pending?.length)) await this.json('/free', { unload_models: true, free_memory: true });
  }
}
function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
export function operation(stage: ComfyOperation['stage'], projectId: string, endpoint: string, extra: Partial<ComfyOperation> = {}): ComfyOperation {
  const id = randomUUID(); return { id, clientId: randomUUID(), endpoint, stage, prefix: `DragonAgent/${projectId}/${id}`, startedAt: Date.now(), state: 'submitting', ...extra };
}

import type { Message, ModelProfile, ToolSchema } from './types.js';
export const CONTEXT_LIMIT = 524288;
export function contextBudget(profile: Pick<ModelProfile, 'contextWindow' | 'maxOutput'>) {
  if (!Number.isSafeInteger(profile.contextWindow) || profile.contextWindow < 4096 || !Number.isSafeInteger(profile.maxOutput) || profile.maxOutput < 1) throw new Error('无效的模型上下文配置。');
  const window = Math.min(CONTEXT_LIMIT, profile.contextWindow), output = Math.min(32768, profile.maxOutput, Math.floor(window / 8)), headroom = Math.min(65536, Math.floor(window / 8));
  return { window, output, headroom, threshold: Math.floor(Math.min(window * .8, window - output - headroom)), retain: Math.floor((window - output) * .16) };
}
/** Conservative UTF-8 upper estimate, including tool schemas and protocol overhead. Never label this exact. */
export function estimateTokens(messages: Message[], tools: ToolSchema[]) {
  // Encoded image bytes are transport data, not text tokens. Reserve a conservative image budget.
  const images = messages.reduce((n,m)=>n+(m.images?.length??0),0);
  const textMessages=messages.map(m=>m.images?.length?{...m,images:m.images.map(()=> '[image]')}:m);
  return Buffer.byteLength(JSON.stringify({messages:textMessages,tools}),'utf8')+images*32768+256+messages.length*32+tools.length*64;
}
/** Keep assistant tool calls and every matching result in one indivisible history block. */
export function historyGroups(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (const message of messages) {
    if (message.role === 'tool' && groups.at(-1)?.[0].role === 'assistant' && groups.at(-1)?.[0].calls?.some(c => c.id === message.callId)) groups.at(-1)!.push(message);
    else groups.push([message]);
  }
  return groups;
}
export function repairInterruptedCalls(messages: Message[]) {
  const result: Message[] = [];
  for (const group of historyGroups(messages)) {
    result.push(...group);
    for (const call of group[0].calls ?? []) if (!group.some(m => m.role === 'tool' && m.callId === call.id)) result.push({ role: 'tool', callId: call.id, name: call.name, text: '上次任务在结果确认前中断。结果未知；禁止自动重放，请先检查实际状态。', isError: true });
  }
  return result;
}

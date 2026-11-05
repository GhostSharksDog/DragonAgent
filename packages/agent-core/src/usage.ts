import type { Usage } from './types.js';

const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
/** Missing provider fields remain missing. Cache reads are a subset of input. */
export function providerUsage(raw: any, protocol: string): Usage {
  const input = count(protocol === 'openai-completions' ? raw?.prompt_tokens : raw?.input_tokens);
  const output = count(protocol === 'openai-completions' ? raw?.completion_tokens : raw?.output_tokens);
  const cacheRead = count(raw?.prompt_cache_hit_tokens ?? raw?.input_tokens_details?.cached_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? raw?.cache_read_input_tokens);
  const cacheWrite = count(raw?.cache_creation_input_tokens);
  return {
    input: (input ?? 0) + (protocol === 'anthropic-messages' ? (cacheRead ?? 0) + (cacheWrite ?? 0) : 0), output: output ?? 0,
    reported: input !== undefined && output !== undefined,
    ...(cacheRead === undefined ? {} : { cacheRead }), ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(count(raw?.prompt_cache_miss_tokens) === undefined ? {} : { cacheMiss: count(raw.prompt_cache_miss_tokens) }),
    ...(count(raw?.completion_tokens_details?.reasoning_tokens ?? raw?.output_tokens_details?.reasoning_tokens) === undefined ? {} : { reasoning: count(raw?.completion_tokens_details?.reasoning_tokens ?? raw?.output_tokens_details?.reasoning_tokens) }),
  };
}

export function addUsage(previous: Usage, next: Usage): Usage {
  const empty = previous.input === 0 && previous.output === 0 && previous.reported === undefined;
  const total: Usage = { ...previous, input: previous.input + next.input, output: previous.output + next.output, reported: (empty || previous.reported === true) && next.reported === true };
  for (const key of ['cacheRead', 'cacheWrite', 'cacheMiss', 'reasoning'] as const) {
    if (next[key] !== undefined && (empty || previous[key] !== undefined)) total[key] = (previous[key] ?? 0) + next[key]!;
    else delete total[key];
  }
  // 生成速度代表最近一次模型请求，不进行累加
if (next.tokensPerSecond !== undefined) {
  total.tokensPerSecond = next.tokensPerSecond;
}
  return total;
}

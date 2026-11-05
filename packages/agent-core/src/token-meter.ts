import { createHash } from 'node:crypto';
import { estimateTokens } from './context.js';
import type { Message, ModelProfile, ToolSchema } from './types.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** An actual provider count anchors only an unchanged request prefix and route. */
export class TokenMeter {
  private anchor?: { route: string; prefix: string; length: number; input: number; estimate: number };
  private route(profile: ModelProfile, tools: ToolSchema[], effort?: string) { return hash([profile, tools, effort]); }
  observe(profile: ModelProfile, tools: ToolSchema[], messages: Message[], input: number, effort?: string) {
    if (!Number.isSafeInteger(input) || input <= 0) return;
    this.anchor = { route: this.route(profile, tools, effort), prefix: hash(messages), length: messages.length, input, estimate: estimateTokens(messages, tools) };
  }
  measure(profile: ModelProfile, tools: ToolSchema[], messages: Message[], effort?: string) {
    const raw = estimateTokens(messages, tools), a = this.anchor;
    if (!a || a.route !== this.route(profile, tools, effort) || messages.length < a.length || hash(messages.slice(0, a.length)) !== a.prefix) return { tokens: raw, calibrated: false };
    // Added content keeps the conservative byte estimate; the already billed prefix does not.
    return { tokens: Math.ceil((a.input + Math.max(0, raw - a.estimate)) * 1.1), calibrated: true };
  }
  invalidate() { this.anchor = undefined; }
}

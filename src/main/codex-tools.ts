import { createHash } from 'node:crypto';
import type { DynamicTool } from '../pet/shared/tools';

/** Codex reserves MCP names for its own transports. Aliases exist only at this boundary. */
export class CodexToolBindings {
  readonly definitions: DynamicTool[] = [];
  private readonly originals = new Map<string, string>();
  constructor(tools: DynamicTool[]) {
    const seen = new Set<string>();
    for (const tool of tools) {
      if (seen.has(tool.name)) throw new Error(`重复的工具名称：${tool.name}`);
      seen.add(tool.name);
      // Keep the built-in Dragon host names used by existing threads and instructions.
      // All external names receive a stable bounded alias, independent of discovery order.
      const name = /^pet_[A-Za-z0-9_-]{1,60}$/.test(tool.name) ? tool.name
        : `dragon_tool_${tool.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 28)}_${createHash('sha256').update(tool.name).digest('hex').slice(0, 20)}`;
      if (this.originals.has(name)) throw new Error('Codex 工具名称冲突。');
      this.originals.set(name, tool.name);
      this.definitions.push({ ...tool, name });
    }
  }
  resolve(name: string): string | undefined { return this.originals.get(name); }
}

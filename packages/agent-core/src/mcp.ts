import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolRegistry } from './tools.js';
import type { ToolResult } from './types.js';
import { createHash } from 'node:crypto';
export interface McpServerConfig { id: string; name: string; enabled: boolean; transport: 'stdio' | 'streamable-http'; command?: string; args?: string[]; url?: string; key?: string }
export interface McpConnectionState { id: string; state: 'disabled' | 'connecting' | 'connected' | 'error'; tools: number; error?: string }
type Entry = { config: McpServerConfig; client?: Client; transport?: StdioClientTransport | StreamableHTTPClientTransport; remove: (() => void)[]; connecting?: Promise<void>; stopped: boolean };
export class McpManager {
  private entries = new Map<string, Entry>();
  constructor(private registry: ToolRegistry, private status: (state: McpConnectionState) => void, private home: string, private timeouts = { connect: 15000, call: 60000 }) {}
  async configure(servers: McpServerConfig[]) {
    await this.dispose();
    await Promise.all(servers.map(async config => { if (!config.enabled) return this.status({ id: config.id, state: 'disabled', tools: 0 }); const entry: Entry = { config, remove: [], stopped: false }; this.entries.set(config.id, entry); await this.connect(entry).catch(() => undefined); }));
  }
  private connect(e: Entry): Promise<void> {
    if (e.connecting) return e.connecting;
    e.connecting = this.open(e).finally(() => { e.connecting = undefined; }); return e.connecting;
  }
  private async open(e: Entry) {
    if (e.stopped) throw new Error('MCP 已关闭。');
    this.status({ id: e.config.id, state: 'connecting', tools: 0 });
    const c = new Client({ name: 'dragon-agent', version: '0.2.0' }, { capabilities: {} });
    const env: Record<string, string> = {}; for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key]!;
    if (e.config.key) env.API_KEY = e.config.key;
    const transport = e.config.transport === 'stdio' ? new StdioClientTransport({ command: e.config.command!, args: e.config.args ?? [], cwd: this.home, env, stderr: 'pipe' }) : new StreamableHTTPClientTransport(new URL(e.config.url!), { requestInit: { headers: e.config.key ? { Authorization: `Bearer ${e.config.key}` } : {} } });
    try {
      await c.connect(transport, { signal: AbortSignal.timeout(this.timeouts.connect) });
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {});
      const tools: any[] = []; let cursor: string | undefined; const seen = new Set<string>();
      do { const list = await c.listTools({ cursor }, { signal: AbortSignal.timeout(this.timeouts.connect) }); tools.push(...list.tools); if (tools.length > 500) throw new Error('MCP 工具数量超过 500。'); cursor = list.nextCursor; if (cursor && seen.has(cursor)) throw new Error('MCP 分页游标重复。'); if (cursor) seen.add(cursor); } while (cursor);
      if (e.stopped) throw new Error('MCP 已关闭。');
      e.remove.splice(0).forEach(remove => remove()); e.client = c; e.transport = transport;
      for (const tool of tools) {
        const rawName = `mcp__${e.config.id}__${tool.name}`;
        const name = /^[A-Za-z0-9_-]{1,64}$/.test(rawName) ? rawName : rawName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 51) + '_' + createHash('sha256').update(rawName).digest('hex').slice(0, 12);
        e.remove.push(this.registry.register({ name, description: tool.description ?? tool.name, parameters: tool.inputSchema, effect: 'unknown', approval: 'managed', execute: async (args, ctx): Promise<ToolResult> => {
          if (!await ctx.approve(`${e.config.name} · ${tool.name}`, JSON.stringify(args, null, 2))) return { text: '用户拒绝了本次 MCP 操作。', isError: true };
          if (!e.client) await this.connect(e); ctx.signal.throwIfAborted();
          // Never retry a dispatched call: a transport error leaves its side effect uncertain.
          try {
            const response = await e.client!.callTool({ name: tool.name, arguments: args }, undefined, { signal: ctx.signal, timeout: this.timeouts.call, resetTimeoutOnProgress: false });
            if (!Array.isArray(response.content)) throw new Error('MCP 返回了无效内容。');
            return { isError: Boolean(response.isError), text: response.content.filter((v: any) => v.type !== 'image').map((v: any) => v.type === 'text' ? v.text : JSON.stringify(v)).join('\n'), images: response.content.filter((v: any) => v.type === 'image' && typeof v.data === 'string').map((v: any) => `data:${v.mimeType};base64,${v.data}`) };
          } catch (error) {
            const client = e.client; e.client = undefined; await client?.close().catch(() => undefined);
            if (!e.stopped) this.status({ id: e.config.id, state: 'error', tools: 0, error: 'MCP 操作失败或中断；结果可能未知，未自动重试。下一次调用会重新连接。' });
            throw error;
          }
        } }));
      }
      c.onclose = () => { if (e.client === c) { e.client = undefined; if (!e.stopped) this.status({ id: e.config.id, state: 'error', tools: 0, error: '连接已断开；下次操作将重新连接，不重试已发送的操作。' }); } };
      c.onerror = () => { if (!e.stopped) this.status({ id: e.config.id, state: 'error', tools: 0, error: 'MCP 通信失败，请检查服务器。' }); };
      this.status({ id: e.config.id, state: 'connected', tools: tools.length });
    } catch { e.client = undefined; e.remove.splice(0).forEach(remove => remove()); await c.close().catch(() => undefined); this.status({ id: e.config.id, state: 'error', tools: 0, error: 'MCP 连接或工具发现失败，请检查地址、启动程序和密钥。' }); throw new Error('MCP 连接失败。'); }
  }
  async dispose() { const entries = [...this.entries.values()]; this.entries.clear(); for (const e of entries) { e.stopped = true; e.remove.splice(0).forEach(remove => remove()); await e.client?.close().catch(() => undefined); } }
}

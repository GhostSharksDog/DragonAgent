// Explicitly invoked acceptance test. Reads only DragonAgent's own configured credentials.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentRuntime, HttpModelAdapter, MemorySessionStore, ToolRegistry, McpManager, type ToolContext } from '../packages/agent-core/src';
import { CodexBackend } from '../src/main/codex';
import type { AgentSession, BackendHooks } from '../src/shared/contracts';
export async function runLiveChecks(host: { home: string; settings: any; key(id: string): Promise<string>; directory: string; output: string }) {
const { home, settings, directory } = host;
const redactions: string[] = [];
const clean = (error: unknown) => { let message = error instanceof Error ? error.message : String(error); for (const secret of redactions) if (secret) message = message.split(secret).join('[redacted]'); return message.slice(0, 700); };
const key = async (id: string) => { const value = await host.key(id); if (value) redactions.push(value); return value; };
const report: any = { date: new Date().toISOString(), models: [], tavily: {}, codex: {} };
await mkdir(directory, { recursive: true });
try {
  const ordered = [...settings.profiles].sort((a: any, b: any) => Number(b.id === settings.selectedProfile) - Number(a.id === settings.selectedProfile));
  const profiles = ordered.filter((p: any, i: number) => ordered.findIndex((v: any) => v.protocol === p.protocol) === i);
  console.log(JSON.stringify({ configuredProtocols: profiles.map((p: any) => ({ model: p.model, protocol: p.protocol })), tavilyConfigured: settings.mcp.some((s: any) => s.id === 'tavily'), credentials: 'never printed' }));
  for (const profile of profiles) {
    const result: any = { model: profile.model, protocol: profile.protocol, status: 'running' }; report.models.push(result); console.log(`LIVE model start: ${profile.model}`);
    let executed = 0; const tools = new ToolRegistry();
    tools.register({ name: 'live_calculate', description: '验收计算工具。必须按顺序先乘后加。', effect: 'read', parameters: { type: 'object', properties: { operation: { enum: ['multiply', 'add'] }, a: { type: 'number' }, b: { type: 'number' } }, required: ['operation', 'a', 'b'], additionalProperties: false }, execute: async args => { executed++; return { text: String(args.operation === 'multiply' ? Number(args.a) * Number(args.b) : Number(args.a) + Number(args.b)) }; } });
    const runtime = new AgentRuntime({ profiles: () => [{ ...profile, maxOutput: Math.min(4096, profile.maxOutput), contextWindow: Math.min(65536, profile.contextWindow) }], key: async () => key(`profile:${profile.id}`), adapter: new HttpModelAdapter(), store: new MemorySessionStore(), tools, approve: async () => false, question: async () => ({}) });
    try {
      const agent = await runtime.run({ sessionId: randomUUID(), profileId: profile.id, grant: { folders: [], origins: [], browserInput: false, terminal: false }, limits: { concurrency: 1, children: 1, requests: 6 }, signal: AbortSignal.timeout(180000), prompt: '这是只读连通性验收。只调用 live_calculate，不创建子 Agent、不追问。先用工具计算 17×23，等返回后再用工具将结果加 9，最后只输出最后的数字。必须执行两次连续工具调用。' });
      if (agent.status !== 'completed' || executed < 2 || !agent.result?.includes('400')) throw new Error(agent.error || `未完成预期计算：status=${agent.status}, tools=${executed}`);
      Object.assign(result, { status: 'passed', toolCalls: executed, requests: agent.requests, usage: agent.usage, result: agent.result.slice(0, 120) });
    } catch (error) { Object.assign(result, { status: 'failed', error: clean(error), toolCalls: executed }); }
    finally { await runtime.dispose(); }
    console.log(JSON.stringify(result));
  }
  const tavily = settings.mcp.find((s: any) => s.enabled && (s.id === 'tavily' || /mcp\.tavily\.com/.test(s.url ?? '')));
  if (!tavily) report.tavily = { status: 'not-configured', reason: '没有启用的 Tavily 连接' };
  else {
    console.log('LIVE Tavily search start'); const tools = new ToolRegistry(); let state: any;
    const manager = new McpManager(tools, s => { state = s; }, directory);
    try {
      await manager.configure([{ ...tavily, key: await key(`mcp:${tavily.id}`) }]);
      if (state.state !== 'connected') throw new Error(state.error);
      const search = tools.schemas().find(t => /tavily_search/.test(t.name)); if (!search) throw new Error('没有发现 Tavily 搜索工具');
      const result = await tools.call(search.name, { query: 'Model Context Protocol official specification', max_results: 2, search_depth: 'basic' }, { agent: {} as any, signal: AbortSignal.timeout(70000), approve: async () => true, question: async () => ({}) });
      if (result.isError || !/https?:\/\//.test(result.text)) throw new Error(result.isError ? result.text : '搜索未返回来源');
      report.tavily = { status: 'passed', tool: search.name, hasSources: true, responseCharacters: result.text.length };
    } catch (error) { report.tavily = { status: 'failed', error: clean(error) }; }
    finally { await manager.dispose(); }
  }
  console.log(JSON.stringify({ tavily: report.tavily }));
  console.log('LIVE Codex account and read-only task start');
  const fixture = path.join(directory, 'read-only-check.txt'); await writeFile(fixture, 'DragonAgent live check: DRAGON-CORE-2026');
  const tools = new ToolRegistry(); let reads = 0, text = '', logged = false, quota: any;
  tools.register({ name: 'pet_task_scope', description: '读取本任务的授权范围。', effect: 'read', parameters: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => ({ text: JSON.stringify({ folders: [directory], origins: [] }) }) });
  tools.register({ name: 'pet_files_read', description: '只读验收文件。', effect: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, execute: async args => { if (path.resolve(String(args.path)) !== fixture) return { isError: true, text: '未获授权的文件' }; reads++; return { text: await readFile(fixture, 'utf8') }; } });
  const controller = new AbortController(); const context: ToolContext = { agent: {} as any, signal: controller.signal, approve: async () => false, question: async () => ({}) };
  const bridge: any = { bindTools: async () => tools.schemas().map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })), callTool: async (_s: unknown, name: string, args: unknown) => { const r = await tools.call(name, args, context); return { success: !r.isError, contentItems: [{ type: 'inputText', text: r.text }] }; }, unbindTools: async () => {}, cancel: async () => {} };
  const backend = new CodexBackend({ home: path.join(home, 'codex-runtime'), executable: () => settings.codexPath || path.resolve('dist/runtime/codex/bin/codex.exe'), tools: bridge, state: () => {}, account: a => { logged = a !== '尚未登录'; }, quota: value => { quota = { status: value.status, buckets: value.buckets.length, error: value.error ? clean(value.error) : undefined }; }, open: async () => {} });
  const session: AgentSession = { id: randomUUID(), runId: randomUUID(), backend: 'codex', profileId: '', title: '只读在线验收', workspace: directory, draft: '', messages: [], tools: [], pending: [], origins: [], browserInput: false, terminalEnabled: false, status: 'running', createdAt: Date.now(), updatedAt: Date.now() };
  const hooks: BackendHooks = { text: (v, replace) => { text = replace ? v : text + v; }, tool: () => {}, request: async () => false, usage: usage => { report.codex.usage = usage; }, notice: () => {}, nativeId: id => { session.nativeId = id; } };
  const deadline = setTimeout(() => controller.abort(), 180000);
  try {
    const connection = await backend.start();
    if (!logged) report.codex = { status: 'not-logged-in' };
    else {
      await backend.quota(); await backend.run(session, `只读验收：先调用 pet_task_scope，然后使用 pet_files_read 读取 ${fixture}，仅汇报其中的校验码。禁止命令、文件变更、访问网络和其他目录。`, hooks, controller.signal);
      if (controller.signal.aborted || !reads || !text.includes('DRAGON-CORE-2026')) throw new Error(`只读工具验收未完成，工具读取次数=${reads}`);
      report.codex = { ...report.codex, status: 'passed', toolReads: reads, verifiedMarker: true, quota };
      if (session.nativeId) await connection.rpc.request('thread/archive', { threadId: session.nativeId });
    }
  } catch (error) { report.codex = { ...report.codex, status: 'failed', error: clean(error), quota }; }
  finally { clearTimeout(deadline); await backend.dispose(); }
  console.log(JSON.stringify({ codex: report.codex }));
} catch (error) { report.error = clean(error); console.error(report.error); }
finally { await mkdir(path.dirname(host.output), { recursive: true }); await writeFile(host.output, JSON.stringify(report, null, 2)); console.log('Live report saved without credentials.'); }
return report;
}

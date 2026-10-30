import { randomUUID } from 'node:crypto';
import type { AgentBackend, AgentSession, AppSettings, BackendHooks, BackendState, McpStatus, AgentTask } from '../shared/contracts';
import type { AgentEvent, AgentRecord, Grant } from '../../packages/agent-core/src';
import type { DynamicTool, ToolOutput } from '../pet/shared/tools';
import { sanitizeDiagnostic } from '../pet/main/agent/transport';
import { DRAGON_PERSONA } from '../shared/persona';
import os from 'node:os';
export interface ToolBridge {
  bindTools(session: AgentSession, hooks: BackendHooks, signal: AbortSignal): Promise<DynamicTool[]>;
  callTool(session: AgentSession, name: string, args: unknown, callId: string): Promise<ToolOutput>;
  unbindTools(session: AgentSession): Promise<void>; cancel(session: AgentSession, agentId?: string): Promise<void>;
}
export function sessionGrant(s: AgentSession): Grant { const mode = s.permissionMode ?? 'ask'; return { folders: s.workspace ? [s.workspace] : mode === 'full' ? [os.homedir()] : [], origins: s.origins, browserInput: mode !== 'ask' || s.browserInput, terminal: mode !== 'ask' || s.terminalEnabled, approvalMode: mode, allFolders: mode === 'full', allOrigins: mode === 'full' }; }
export class DragonBackend implements AgentBackend, ToolBridge {
  private worker: import('electron').UtilityProcess | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;
  private requests = new Map<string, { resolve(v: any): void; reject(e: Error): void; timer?: NodeJS.Timeout }>();
  private bindings = new Map<string, { session: AgentSession; hooks: BackendHooks; signal: AbortSignal }>();
  private incoming = new Map<string, AbortController>();
  constructor(private options: { home: string; workerPath: string; settings(): AppSettings; key(id: string): Promise<string>; definitions(): DynamicTool[]; tool(agent: AgentRecord, name: string, args: unknown, signal: AbortSignal): Promise<ToolOutput>; state(v: BackendState): void; mcp(v: McpStatus): void; agent(sessionId: string, task: AgentTask): void }) {}
  async start() { if (this.ready) return; if (!this.starting) this.starting = this.boot().finally(() => { this.starting = null; }); return this.starting; }
  async reconnectMcp() {
    if (!this.ready) return this.start();
    const servers = await Promise.all(this.options.settings().mcp.map(async s => ({ ...s, key: await this.options.key(`mcp:${s.id}`) })));
    await this.rpc('mcpReconnect', servers);
  }
  private async boot() {
    this.options.state({ state: 'starting', message: '正在启动 Dragon 内核…' });
    const { utilityProcess } = await import('electron');
    const worker = this.worker = utilityProcess.fork(this.options.workerPath, [], { serviceName: 'DragonAgent Core', stdio: 'pipe' });
    let diagnostic = '';
    worker.stderr?.on('data', v => { diagnostic = (diagnostic + v.toString()).slice(-4000); });
    const ready = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { reject(new Error('Dragon 内核启动超时。')); worker.kill(); }, 30000); this.requests.set('ready', { resolve: () => { clearTimeout(timer); resolve(); }, reject, timer }); });
    worker.on('message', value => { void this.receive(value).catch(error => this.failed(error)); });
    worker.on('exit', () => { if (this.worker === worker) this.failed(new Error(`Dragon 内核已退出。${sanitizeDiagnostic(diagnostic)}`)); });
    try {
      await ready; const settings = this.options.settings(), keys: Record<string, string> = {};
      for (const p of settings.profiles) keys[p.id] = await this.options.key(`profile:${p.id}`);
      const mcp = await Promise.all(settings.mcp.map(async s => ({ ...s, key: await this.options.key(`mcp:${s.id}`) })));
      await this.rpc('init', { home: this.options.home, definitions: this.options.definitions(), profiles: settings.profiles, selectedProfile: settings.selectedProfile, keys, mcp });
      this.ready = true; this.options.state({ state: 'ready', message: 'Dragon 自研内核已就绪' });
    } catch (error) { this.failed(error as Error); worker.kill(); throw error; }
  }
  private failed(error: Error) { this.ready = false; this.worker = null; for (const p of this.requests.values()) { clearTimeout(p.timer); p.reject(error); } this.requests.clear(); for (const c of this.incoming.values()) c.abort(); this.incoming.clear(); this.options.state({ state: 'error', message: sanitizeDiagnostic(error.message) }); }
  private rpc(method: string, params: unknown, timeout = 90000): Promise<any> {
    if (!this.worker) return Promise.reject(new Error('Dragon 内核未启动。'));
    const id = randomUUID(); return new Promise((resolve, reject) => { const timer = timeout ? setTimeout(() => { this.requests.delete(id); reject(new Error(`内核操作超时：${method}`)); }, timeout) : undefined; this.requests.set(id, { resolve, reject, timer }); this.worker!.postMessage({ id, method, params }); });
  }
  private async receive(message: any) {
    if (message.event === 'ready' || message.id) { const id = message.id ?? 'ready', request = this.requests.get(id); this.requests.delete(id); clearTimeout(request?.timer); message.error ? request?.reject(new Error(message.error)) : request?.resolve(message.result); return; }
    if (message.withdraw) { this.incoming.get(message.withdraw)?.abort(); this.incoming.delete(message.withdraw); return; }
    if (message.event === 'mcp') { this.options.mcp(message.data); return; }
    if (message.request) {
      const b = this.bindings.get(message.agent.sessionId), controller = new AbortController(); this.incoming.set(message.request, controller);
      try {
        if (!b || b.signal.aborted || b.session.runId !== message.agent.runId) throw new Error('任务已停止或过期。');
        const signal = AbortSignal.any([controller.signal, b.signal]), prefix = message.agent.parentId ? `子任务「${message.agent.title}」· ` : '';
        let result: unknown;
        if (message.kind === 'tool') result = await this.options.tool(message.agent, message.params.name, message.params.arguments, signal);
        else if (message.kind === 'question') result = await b.hooks.request({ id: message.request, kind: 'question', title: `${prefix}需要你的回答`, details: '', questions: message.params.questions }, signal);
        else result = await b.hooks.request({ id: message.request, kind: 'approval', title: prefix + message.params.title, details: message.params.details }, signal);
        signal.throwIfAborted(); this.worker?.postMessage({ reply: message.request, result });
      } catch (error) { this.worker?.postMessage({ reply: message.request, error: sanitizeDiagnostic((error as Error).message) }); }
      finally { this.incoming.delete(message.request); } return;
    }
    if (message.event !== 'core') return;
    const e = message.data as AgentEvent, b = this.bindings.get(e.sessionId); if (!b || b.session.runId !== e.runId) return;
    if (e.type === 'agent') { const a = e.agent; this.options.agent(e.sessionId, { id: a.id, parentId: a.parentId, runId: a.runId, title: a.title, status: a.status, profileId: a.profileId, result: a.result, error: a.error, requests: a.requests, usage: a.usage }); }
    if (b.signal.aborted) return;
    if (e.type === 'text' && e.agentId === e.sessionId) b.hooks.text(e.text);
    if (e.type === 'usage' && e.agentId === e.sessionId) b.hooks.usage(e.usage);
    if (e.type === 'tool.started') b.hooks.tool({ id: `${e.agentId}:${e.call.id}`, name: e.call.name, arguments: e.call.arguments, status: 'running', agentId: e.agentId });
    if (e.type === 'tool.finished') b.hooks.tool({ id: `${e.agentId}:${e.callId}`, name: '', result: e.result.text, status: e.result.isError ? 'error' : 'completed', agentId: e.agentId });
    if (e.type === 'compacted') b.hooks.notice('上下文已压缩；完整原始记录保存在本地。');
    if (e.type === 'notice') b.hooks.notice(e.text);
  }
  async run(session: AgentSession, prompt: string, hooks: BackendHooks, signal: AbortSignal) {
    await this.start(); signal.throwIfAborted(); this.bindings.set(session.id, { session, hooks, signal });
    const cancel = () => { void this.cancel(session).catch(() => undefined); }; signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await this.rpc('run', { sessionId: session.id, runId: session.runId, profileId: session.profileId, prompt, system: DRAGON_PERSONA + `\n当前权限等级：${session.permissionMode ?? 'ask'}。auto 自动批准已授权范围内的操作，full 允许其他目录和网站。`, grant: sessionGrant(session), limits: this.options.settings().limits, compact: prompt === '/compact' }, 0);
      if (result.status === 'paused') { const error = new Error(result.error ?? '达到调用预算'); error.name = 'BudgetExceeded'; throw error; }
      if (result.status === 'error') throw new Error(result.error ?? 'Agent 执行失败。');
    } finally { signal.removeEventListener('abort', cancel); this.bindings.delete(session.id); }
  }
  async bindTools(session: AgentSession, hooks: BackendHooks, signal: AbortSignal): Promise<DynamicTool[]> {
    await this.start(); signal.throwIfAborted(); this.bindings.set(session.id, { session, hooks, signal });
    return (await this.rpc('bind', { id: session.id, runId: session.runId, grant: sessionGrant(session) })).map((d: any) => ({ name: d.name, description: d.description, inputSchema: d.parameters }));
  }
  async callTool(session: AgentSession, name: string, args: unknown, _callId: string): Promise<ToolOutput> { const result = await this.rpc('tool', { id: session.id, name, arguments: args }, 0); return { success: !result.isError, contentItems: [{ type: 'inputText', text: result.text }, ...(result.images ?? []).map((imageUrl: string) => ({ type: 'inputImage', imageUrl }))] }; }
  async unbindTools(session: AgentSession) { this.bindings.delete(session.id); if (this.worker) await this.rpc('unbind', { id: session.id }); }
  async cancel(session: AgentSession, agentId?: string) { if (this.worker) await this.rpc('cancel', { sessionId: session.id, agentId }); }
  async approveTool(agent: AgentRecord, title: string, details: string): Promise<boolean> { return this.rpc('approveTool', { sessionId: agent.sessionId, agentId: agent.id, title, details }, 0); }
  async dispose() { if (!this.worker) return; const worker = this.worker; await this.rpc('dispose', {}, 5000).catch(() => undefined); this.worker = null; this.ready = false; worker.kill(); for (const p of this.requests.values()) { clearTimeout(p.timer); p.reject(new Error('内核已关闭。')); } this.requests.clear(); this.options.state({ state: 'stopped', message: 'Dragon 内核未启动' }); }
}

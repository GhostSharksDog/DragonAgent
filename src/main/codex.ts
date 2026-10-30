import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachAppServer, resolveCodex, type JsonLineRpc, type RpcMessage, sanitizeDiagnostic } from '../pet/main/agent/transport';
import { normalizeQuota } from '../pet/main/agent/quota';
import type { AgentBackend, AgentSession, BackendHooks, BackendState, CodexModel } from '../shared/contracts';
import type { QuotaSnapshot } from '../pet/shared/types';
import type { ToolBridge } from './dragon';
import { DRAGON_PERSONA } from '../shared/persona';
import { CodexToolBindings } from './codex-tools';
import packageInfo from '../../package.json';

type Connection = { child: ChildProcessWithoutNullStreams; rpc: JsonLineRpc };
function closeConnection(connection: Connection) {
  connection.rpc.close(); connection.child.stdin.destroy(); connection.child.stdout.destroy(); connection.child.stderr.destroy();
  if (process.platform === 'win32' && connection.child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(connection.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => connection.child.kill()); killer.unref();
  } else connection.child.kill();
  connection.child.unref();
}
interface Active { connection: Connection; session: AgentSession; hooks: BackendHooks; signal: AbortSignal; tools: CodexToolBindings; turnId?: string; resolve(): void; reject(error: Error): void; files: Map<string, unknown>; requests: Set<number | string> }
export class CodexBackend implements AgentBackend {
  private accountConnection: Connection | null = null;
  private starting: Promise<Connection> | null = null;
  private active = new Map<string, Active>();
  constructor(private options: { home: string; executable(): string; tools: ToolBridge; state(value: BackendState): void; account(value: string): void; quota(value: QuotaSnapshot): void; open(url: string): Promise<void> }) {}
  private async connect(native = false): Promise<Connection> {
    await mkdir(path.join(this.options.home, 'codex'), { recursive: true });
    const executable = await resolveCodex(this.options.executable());
    const disabled = ['apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser', 'in_app_local_automation', 'code_mode', 'multi_agent', 'multi_agent_v2', 'hooks', 'image_generation', 'workspace_dependencies', 'view_image', 'request_permissions_tool', 'skill_mcp_dependency_install', 'shell_snapshot'];
    const overrides = ['sandbox_mode="read-only"', 'approval_policy="on-request"', 'approvals_reviewer="user"', 'web_search="disabled"', 'features.default_mode_request_user_input=true', 'features.skip_host_skill_discovery=true', 'features.code_mode_host=true', `features.shell_tool=${native}`, `features.unified_exec=${native}`, ...disabled.map(n => `features.${n}=false`)];
    const child = spawn(executable, ['app-server', ...overrides.flatMap(v => ['-c', v])], { cwd: this.options.home, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: path.join(this.options.home, 'codex'), RUST_LOG: 'error' } });
    const connection = attachAppServer(child);
    try { await connection.rpc.request('initialize', { clientInfo: { name: 'dragon_agent', version: packageInfo.version, title: 'DragonAgent' }, capabilities: { experimentalApi: true } }); connection.rpc.notify('initialized'); }
    catch (error) { connection.rpc.close(); child.kill(); throw error; }
    return connection;
  }
  async start(): Promise<Connection> {
    if (this.accountConnection) return this.accountConnection;
    if (this.starting) return this.starting;
    this.options.state({ state: 'starting', message: '正在连接 Codex…' });
    this.starting = (async () => {
      const c = this.accountConnection = await this.connect();
      c.rpc.on('message', (m: RpcMessage) => { if (m.method === 'account/login/completed' || m.method === 'account/updated') void this.refreshAccount().catch(() => undefined); });
      c.rpc.on('close', (e: Error) => { if (this.accountConnection === c) { this.accountConnection = null; this.options.state({ state: 'error', message: e.message }); } });
      this.options.state({ state: 'ready', message: 'Codex app-server 已连接' });
      await this.refreshAccount(); return c;
    })().catch(error => { this.options.state({ state: 'error', message: (error as Error).message }); throw error; }).finally(() => { this.starting = null; });
    return this.starting;
  }
  private async refreshAccount() {
    const c = this.accountConnection; if (!c) return;
    const result: any = await c.rpc.request('account/read', { refreshToken: false });
    this.options.account(result.account ? result.account.email ?? result.account.type ?? '已登录' : '尚未登录');
  }
  async login() {
    const c = await this.start();
    const result: any = await c.rpc.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true });
    if (result.authUrl) { this.options.account('等待浏览器完成登录'); await this.options.open(result.authUrl); }
  }
  async quota() {
    const c = await this.start();
    try { const value = await c.rpc.request('account/rateLimits/read', { excludeResetCreditDetails: true }, 10000, { timeoutMode: 'reject' }); this.options.quota({ status: 'ready', buckets: normalizeQuota(value), updatedAt: Date.now(), stale: false, error: null }); }
    catch (error) { this.options.quota({ status: 'error', buckets: [], updatedAt: Date.now(), stale: true, error: sanitizeDiagnostic((error as Error).message) }); }
  }
  async models(): Promise<CodexModel[]> {
    const c = await this.start(), models = new Map<string, CodexModel>(), cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result: any = await c.rpc.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, 15000, { timeoutMode: 'reject' });
      if (!Array.isArray(result.data)) throw new Error('Codex 模型列表返回格式无效。');
      for (const item of result.data) {
        if (item.hidden) continue;
        if (typeof item.model !== 'string' || !item.model || typeof item.displayName !== 'string' || !Array.isArray(item.supportedReasoningEfforts)) throw new Error('Codex 模型信息不完整。');
        const efforts: CodexModel['efforts'] = [];
        for (const option of item.supportedReasoningEfforts) {
          if (typeof option.reasoningEffort !== 'string' || !option.reasoningEffort || typeof option.description !== 'string') throw new Error('Codex 推理档位返回格式无效。');
          if (!efforts.some(e => e.value === option.reasoningEffort)) efforts.push({ value: option.reasoningEffort, description: option.description });
        }
        models.set(item.model, { id: item.id ?? item.model, model: item.model, name: item.displayName, description: item.description ?? '', isDefault: item.isDefault === true, defaultEffort: item.defaultReasoningEffort ?? '', efforts });
      }
      if (!result.nextCursor) return [...models.values()];
      if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new Error('Codex 模型列表分页异常。');
      cursor = result.nextCursor; cursors.add(result.nextCursor);
    }
    throw new Error('Codex 模型列表页数超出限制，请重试。');
  }
  async run(session: AgentSession, prompt: string, hooks: BackendHooks, signal: AbortSignal) {
    const tools = await this.options.tools.bindTools(session, hooks, signal);
    let connection: Connection | undefined;
    try {
      const bindings = new CodexToolBindings(tools);
      const mode = session.permissionMode ?? 'ask', cwd = session.workspace || this.options.home;
      const policy = mode === 'ask' ? 'on-request' : 'never';
      const sandbox = mode === 'full' ? 'danger-full-access' : mode === 'auto' ? 'workspace-write' : 'read-only';
      const sandboxPolicy = mode === 'full' ? { type:'dangerFullAccess' } : mode === 'auto' ? { type:'workspaceWrite', writableRoots:[cwd], networkAccess:true } : { type:'readOnly', networkAccess:false };
      signal.throwIfAborted(); connection = await this.connect(mode !== 'ask' || session.terminalEnabled && Boolean(session.workspace)); signal.throwIfAborted();
      const c = connection;
      const common = { cwd: session.workspace || this.options.home, runtimeWorkspaceRoots: session.workspace ? [session.workspace] : [], sandbox, approvalPolicy: policy, approvalsReviewer: 'user', ...(session.model ? { model: session.model } : {}), ...(session.reasoningEffort ? { config: { model_reasoning_effort: session.reasoningEffort } } : {}), developerInstructions: DRAGON_PERSONA + `\n当前对话权限：${mode}。文件与浏览器操作优先使用 Dragon 提供的工具，先查看 pet_task_scope；auto 自动批准范围内操作，full 允许其他目录和网站。` };
      const result: any = session.nativeId
        ? await c.rpc.request('thread/resume', { ...common, threadId: session.nativeId, dynamicTools: bindings.definitions })
        : await c.rpc.request('thread/start', { ...common, ephemeral: false, dynamicTools: bindings.definitions });
      hooks.nativeId(result.thread.id);
      // A resumed thread can contain an interrupted turn; never resume its execution automatically.
      for (const turn of result.thread.turns ?? []) if (turn.status === 'inProgress') await c.rpc.request('turn/interrupt', { threadId: result.thread.id, turnId: turn.id });
      await new Promise<void>((resolve, reject) => {
        const item: Active = { connection: c, session, hooks, signal, tools: bindings, resolve, reject, files: new Map(), requests: new Set() };
        this.active.set(session.id, item);
        c.rpc.on('message', (m: RpcMessage) => { void this.receive(item, m).catch(reject); });
        c.rpc.once('close', reject);
        const abort = () => { void this.cancel(session).catch(reject); };
        signal.addEventListener('abort', abort, { once: true });
        item.resolve = () => { signal.removeEventListener('abort', abort); resolve(); };
        item.reject = error => { signal.removeEventListener('abort', abort); reject(error); };
        if (signal.aborted) { item.resolve(); return; }
        void c.rpc.request<any>('turn/start', { threadId: result.thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }], clientUserMessageId: randomUUID(), cwd: session.workspace || this.options.home, runtimeWorkspaceRoots: session.workspace ? [session.workspace] : [], approvalPolicy: policy, approvalsReviewer: 'user', sandboxPolicy, ...(session.model ? { model: session.model } : {}), ...(session.reasoningEffort ? { effort: session.reasoningEffort } : {}) }).then(value => { item.turnId = value.turn.id; if (signal.aborted) abort(); }, item.reject);
      });
    } finally { this.active.delete(session.id); if (connection) closeConnection(connection); await this.options.tools.unbindTools(session); }
  }
  private async receive(item: Active, message: RpcMessage) {
    const p: any = message.params ?? {}, { hooks, session, signal, connection } = item;
    if (p.threadId && p.threadId !== session.nativeId) return;
    if (message.id !== undefined) {
      if (item.requests.has(message.id)) return;
      item.requests.add(message.id);
      const respond = (v: unknown) => connection.rpc.respond(message.id!, v);
      if (signal.aborted || (p.turnId && item.turnId && p.turnId !== item.turnId)) { respond(message.method === 'item/tool/call' ? { success: false, contentItems: [{ type: 'inputText', text: '任务已停止。' }] } : { decision: 'decline' }); return; }
      if (message.method === 'item/tool/call') {
        const original = item.tools.resolve(p.tool);
        if (!original) { respond({ success: false, contentItems: [{ type: 'inputText', text: '此工具未向当前任务注册或已被移除。' }] }); return; }
        respond(await this.options.tools.callTool(session, original, p.arguments, p.callId ?? String(message.id))); return;
      }
      if (message.method === 'item/tool/requestUserInput') {
        const answers = await hooks.request({ id: String(message.id), kind: 'question', title: '龙娘需要你的选择', details: '', questions: p.questions.map((q: any) => ({ id: q.id, question: q.question, options: q.options?.map((o: any) => o.label) })) }, signal) as Record<string, string>;
        respond({ answers: Object.fromEntries(Object.entries(answers ?? {}).map(([key, value]) => [key, { answers: [value] }])) }); return;
      }
      if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
        const isCommand = message.method === 'item/commandExecution/requestApproval';
        const details = isCommand ? (p.command ? JSON.stringify({ command: p.command, cwd: p.cwd, permissions: p.additionalPermissions }, null, 2) : '') : JSON.stringify(item.files.get(p.itemId) ?? '');
        if (!(session.terminalEnabled || session.permissionMode === 'auto' || session.permissionMode === 'full') || !details || details === '""') { respond({ decision: 'decline' }); return; }
        const allow = await hooks.request({ id: String(message.id), kind: 'approval', title: isCommand ? 'Codex 命令执行' : 'Codex 文件变更', details }, signal);
        respond({ decision: allow === true ? 'accept' : 'decline' }); return;
      }
      if (message.method === 'item/permissions/requestApproval') { respond({ permissions: {}, scope: 'turn' }); return; }
      connection.rpc.reject(message.id, 'DragonAgent 未开放此请求。'); return;
    }
    if (signal.aborted && message.method !== 'turn/completed') return;
    switch (message.method) {
      case 'turn/started': item.turnId = p.turn.id; break;
      case 'item/agentMessage/delta': hooks.text(p.delta); break;
      case 'item/started':
      case 'item/completed': {
        if (p.item.type === 'fileChange') item.files.set(p.item.id, p.item.changes);
        if (['commandExecution', 'fileChange', 'dynamicToolCall', 'mcpToolCall'].includes(p.item.type)) hooks.tool({ id: p.item.id, name: item.tools.resolve(p.item.tool) ?? p.item.tool ?? p.item.command ?? p.item.type, arguments: JSON.stringify(p.item.arguments ?? p.item.changes ?? {}), status: message.method === 'item/started' ? 'running' : p.item.status === 'failed' ? 'error' : 'completed', result: p.item.aggregatedOutput ?? JSON.stringify(p.item.contentItems ?? p.item.result ?? '') });
        break;
      }
      case 'thread/tokenUsage/updated': { const usage = p.tokenUsage?.last ?? p.tokenUsage?.total; if (usage) hooks.usage({ input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, context: usage.inputTokens, window: p.tokenUsage?.modelContextWindow }); break; }
      case 'turn/completed': if (p.turn.status === 'failed') item.reject(new Error(p.turn.error?.message ?? 'Codex 任务失败。')); else item.resolve(); break;
      case 'error': if (!p.willRetry) item.reject(new Error(p.error?.message ?? 'Codex 执行失败。')); break;
    }
  }
  async cancel(session: AgentSession) {
    const item = this.active.get(session.id);
    await this.options.tools.cancel(session);
    if (item?.turnId) { await item.connection.rpc.request('turn/interrupt', { threadId: session.nativeId, turnId: item.turnId }); }
  }
  async dispose() { for (const item of this.active.values()) { item.reject(new Error('应用已关闭。')); closeConnection(item.connection); } this.active.clear(); const account = this.accountConnection; this.accountConnection = null; if (account) closeConnection(account); }
}

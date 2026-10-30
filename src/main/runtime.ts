import { EventEmitter } from 'node:events';
import packageInfo from '../../package.json';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Action, AgentBackend, AgentSession, BackendHooks, Snapshot } from '../shared/contracts';
import { contextPolicy, isBusy } from '../shared/contracts';
import { Store, type PersistentState } from './store';
import type { Secrets } from './secrets';
import { DragonBackend, sessionGrant } from './dragon';
import { Attachments, attachmentDefinition } from './attachments';
import { CodexBackend } from './codex';
import { ToolHost } from '../pet/main/tools';
import { fileDefinitions } from '../pet/main/tools/files';
import { browserDefinitions } from '../pet/main/tools/browser';
import { emptyQuota } from '../pet/main/agent/quota';
import { sanitizeDiagnostic } from '../pet/main/agent/transport';
import type { ToolOutput } from '../pet/shared/tools';
import { validLimits } from '../../packages/agent-core/src/runtime';
import type { AgentRecord } from '../../packages/agent-core/src/types';

export class Runtime extends EventEmitter {
  state: PersistentState;
  view: Omit<Snapshot, keyof PersistentState>;
  readonly dragon: DragonBackend;
  readonly codex: CodexBackend;
  private runs = new Map<string, { controller: AbortController; hooks: BackendHooks; host: ToolHost; done?: Promise<void> }>();
  private answers = new Map<string, (value: unknown) => void>();
  private configuring = false;
  private scopes = new Map<string, { host: ToolHost; signal: AbortSignal }>();
  private attachments: Attachments;
  private attaching = new Set<string>();
  private loadingModels: Promise<void> | null = null;
  constructor(readonly store: Store, readonly secrets: Secrets, readonly options: { home: string; version?: string; workerPath: string; open(url: string): Promise<void> }) {
    super(); this.state = store.load(); this.attachments = new Attachments(options.home);
    this.view = { codexCatalog: { status: 'idle', models: [] }, resolvedTheme: this.state.settings.theme === 'dark' ? 'dark' : 'light', revision: 0, backends: { dragon: { state: 'stopped', message: 'Dragon 待连接' }, codex: { state: 'stopped', message: 'Codex 待连接' } }, mcp: [], quota: emptyQuota(), account: '尚未连接', skin: null, petView: 'hidden', animationStartedAt: Date.now(), version: options.version ?? packageInfo.version };
    this.dragon = new DragonBackend({ home: options.home, workerPath: options.workerPath, settings: () => this.state.settings, key: id => secrets.get(id), definitions: () => [{ name: 'pet_task_scope', description: '查看当前 Agent 的授权范围。', inputSchema: { type: 'object', properties: {} } }, attachmentDefinition, ...fileDefinitions, ...browserDefinitions, { name: 'pet_terminal', description: '执行 PowerShell 命令，审批方式由当前会话权限等级决定。', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }], tool: (agent, name, args, signal) => this.tool(agent, name, args, signal), state: value => { this.view.backends.dragon = value; this.changed(false); }, mcp: value => { this.view.mcp = [...this.view.mcp.filter(v => v.id !== value.id), value]; this.changed(false); }, agent: (id, task) => { const session = this.session(id); session.tasks ??= []; const old = session.tasks.find(t => t.id === task.id); if (old) Object.assign(old, task); else session.tasks.push(task); this.changed(); } });
    this.codex = new CodexBackend({ home: path.join(options.home, 'codex-runtime'), executable: () => this.state.settings.codexPath, tools: this.dragon, state: value => { this.view.backends.codex = value; this.changed(false); }, account: value => { this.view.account = value; this.changed(false); }, quota: value => { this.view.quota = value; this.changed(false); }, open: options.open });
  }
  snapshot(): Snapshot { return structuredClone({ ...this.state, ...this.view }); }
  changed(persist = true) { if (persist) this.store.save(this.state); this.view.revision++; this.emit('change'); }
  session(id: string) { const value = this.state.sessions.find(s => s.id === id); if (!value) throw new Error('会话不存在。'); return value; }
  idleSettings() { if (this.state.sessions.some(isBusy)) throw new Error('请先停止正在执行的任务，再修改连接设置。'); }
  create(backend: 'dragon' | 'codex', profileId = this.state.settings.selectedProfile, workspace = '', carryFrom?: string, codex?: { model: string; effort?: string }) {
    const s: AgentSession = { id: randomUUID(), title: '新的对话', backend, profileId, workspace, draft: '', permissionMode: 'ask', draftAttachments: [], createdAt: Date.now(), updatedAt: Date.now(), status: 'idle', messages: [], tools: [], pending: [], origins: [], browserInput: false, terminalEnabled: false };
    if (carryFrom) {
      const old = this.session(carryFrom);
      if (isBusy(old)) throw new Error('请在当前任务结束后切换引擎。');
      s.draft = `这是另一段会话的参考摘录，请先核对它再继续；不继承原会话的权限或执行状态。\n\n${old.messages.filter(m => m.role !== 'notice').slice(-8).map(m => `${m.role === 'user' ? '用户' : '助理'}：${m.text}`).join('\n\n').slice(-16000)}\n\n我的新要求：`;
    }
    this.state.settings.selectedBackend = backend;
    if (backend === 'codex') {
      s.model = codex?.model ?? this.state.settings.selectedCodexModel;
      s.reasoningEffort = codex ? codex.effort : this.state.settings.selectedCodexEffort;
      this.state.settings.selectedCodexModel = s.model; this.state.settings.selectedCodexEffort = s.reasoningEffort;
    }
    if (backend === 'dragon' && this.state.settings.profiles.some(p => p.id === profileId)) this.state.settings.selectedProfile = profileId;
    this.state.sessions.unshift(s); this.state.selectedSessionId = s.id; this.view.workbenchPage = 'chat'; this.view.workbenchPageRevision = (this.view.workbenchPageRevision ?? 0) + 1; this.changed(); return s.id;
  }
  async action(action: Action): Promise<unknown> {
    const changesConnection = /^(profile\.|mcp\.|settings\.save)/.test(action.type);
    if (this.configuring && (changesConnection || action.type === 'session.send')) throw new Error('正在保存连接设置，请稍后重试。');
    if (changesConnection) this.configuring = true;
    try { return await this.applyAction(action); }
    finally { if (changesConnection) this.configuring = false; }
  }
  private async applyAction(action: Action): Promise<unknown> {
    switch (action.type) {
      case 'codex.models': await this.loadCodexModels(true); return;
      case 'session.codexModel': {
        const s = this.session(action.id);
        if (s.backend !== 'codex' || isBusy(s) || s.readOnly) throw new Error('请在 Codex 当前任务结束后修改模型和推理强度。');
        const choice = await this.codexChoice(action.model, action.effort);
        if (isBusy(s) || s.readOnly) throw new Error('当前任务已经开始，模型设置未修改。');
        s.model = choice.model; s.reasoningEffort = choice.effort; s.updatedAt = Date.now();
        this.state.settings.selectedBackend = 'codex'; this.state.settings.selectedCodexModel = choice.model; this.state.settings.selectedCodexEffort = choice.effort;
        this.changed(); return true;
      }
      case 'session.model': {
        const s = this.session(action.id);
        if (isBusy(s) || s.readOnly || this.attaching.has(s.id) || this.configuring) throw new Error('请在当前任务或附件处理结束后切换模型。');
        if (s.backend !== 'dragon') throw new Error('Codex 使用账号默认模型，请携带摘录切换至 Dragon。');
        const profile = this.state.settings.profiles.find(p => p.id === action.profileId);
        if (!profile) throw new Error('模型配置不存在，请重新选择。');
        s.profileId = profile.id; s.updatedAt = Date.now();
        if (s.usage) s.usage = { ...s.usage, window: contextPolicy(profile).window, estimated: true };
        this.state.settings.selectedProfile = profile.id; this.state.settings.selectedBackend = 'dragon';
        this.changed(); return true;
      }
      case 'session.permissionMode': {
        const s = this.session(action.id); if (isBusy(s) || s.readOnly) throw new Error('请在当前任务结束后修改权限。');
        if (!['ask','auto','full'].includes(action.mode)) throw new Error('权限等级无效。');
        s.permissionMode = action.mode;
        if (action.mode !== 'ask') { s.terminalEnabled = true; s.browserInput = true; }
        this.changed(); return;
      }
      case 'session.attachChat': return this.attachChat(action.id, action.sourceId);
      case 'session.removeAttachment': { const s=this.session(action.id); if(isBusy(s)||s.readOnly||this.attaching.has(s.id))throw new Error('当前不能修改附件。'); s.draftAttachments=(s.draftAttachments??[]).filter(a=>a.id!==action.attachmentId); this.changed(); return; }
      case 'session.create': return this.create(action.backend, action.profileId, action.workspace, action.carryFrom, action.backend === 'codex' && action.model ? await this.codexChoice(action.model, action.reasoningEffort) : undefined);
      case 'session.select': this.session(action.id); this.state.selectedSessionId = action.id; break;
      case 'session.archive': { const s = this.session(action.id); if (isBusy(s)) throw new Error('请先停止此任务。'); s.archived = true; if (this.state.selectedSessionId === s.id) this.state.selectedSessionId = null; break; }
      case 'session.draft': this.session(action.id).draft = action.text.slice(0, 200000); break;
      case 'session.send': this.send(action.id, action.text, action.commandId); return;
      case 'session.stop': await this.stop(action.id); return;
      case 'agent.stop': await this.dragon.cancel(this.session(action.id), action.agentId); return;
      case 'session.compact': { const s = this.session(action.id); if (s.backend === 'codex') throw new Error('Codex 由自己的上下文策略管理；可创建新会话并携带摘要。'); this.send(s.id, '/compact', randomUUID()); return; }
      case 'session.permissions': { const s = this.session(action.id); if (isBusy(s)) throw new Error('任务执行中不能更改权限。'); s.origins = action.origins.map(v => { const url = new URL(v); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('网站需使用 HTTP 或 HTTPS。'); return url.origin; }); s.browserInput = action.browserInput; s.terminalEnabled = action.terminalEnabled; break; }
      case 'request.answer': { const s = this.session(action.sessionId); const req = s.pending.find(r => r.id === action.id && r.runId === s.runId); if (!req) return; this.answers.get(`${s.id}:${req.id}`)?.(action.value); return; }
      case 'profile.save': {
        this.idleSettings(); const p = action.profile; contextPolicy(p); const url = new URL(p.baseUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密钥、参数或账号密码。');
        if (!p.model.trim() || !p.name.trim() || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)) throw new Error('请完整填写模型名称和配置名称。');
        await this.secrets.set(`profile:${p.id}`, action.apiKey ?? '');
        const safe = { id: p.id, name: p.name, provider: p.provider, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, contextWindow: p.contextWindow, maxOutput: p.maxOutput, hasKey: Boolean(await this.secrets.get(`profile:${p.id}`)), deepseekSearch: p.deepseekSearch };
        this.state.settings.profiles = [...this.state.settings.profiles.filter(v => v.id !== p.id), safe]; this.state.settings.selectedProfile = p.id; await this.dragon.dispose(); break;
      }
      case 'profile.delete': this.idleSettings(); this.state.settings.profiles = this.state.settings.profiles.filter(p => p.id !== action.id); this.secrets.remove(`profile:${action.id}`); if (this.state.settings.selectedProfile === action.id) this.state.settings.selectedProfile = this.state.settings.profiles[0]?.id ?? ''; await this.dragon.dispose(); break;
      case 'mcp.save': {
        this.idleSettings(); const s = action.server;
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(s.id)) throw new Error('MCP 标识仅支持 1–32 位字母、数字、下划线和短横线。');
        if (s.transport === 'streamable-http') { const u = new URL(s.url ?? ''); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search) throw new Error('请使用不含认证信息或参数的 MCP 地址。'); }
        else if (!s.command?.trim()) throw new Error('请输入 MCP 可执行文件路径。');
        await this.secrets.set(`mcp:${s.id}`, action.apiKey ?? '');
        this.state.settings.mcp = [...this.state.settings.mcp.filter(v => v.id !== s.id), { ...s, hasKey: Boolean(await this.secrets.get(`mcp:${s.id}`)) }]; await this.dragon.dispose(); break;
      }
      case 'mcp.delete': this.idleSettings(); this.state.settings.mcp = this.state.settings.mcp.filter(v => v.id !== action.id); this.secrets.remove(`mcp:${action.id}`); await this.dragon.dispose(); break;
      case 'mcp.connect': this.idleSettings(); await this.dragon.reconnectMcp(); return;
      case 'memory.save': { if (!action.text.trim()) return; const id = action.id ?? randomUUID(); this.state.memory = [...this.state.memory.filter(m => m.id !== id), { id, text: action.text.trim().slice(0, 16000), tags: action.tags, createdAt: Date.now() }]; break; }
      case 'memory.delete': this.state.memory = this.state.memory.filter(m => m.id !== action.id); break;
      case 'settings.save': this.idleSettings(); if (action.limits) this.state.settings.limits = validLimits(action.limits); if (action.theme) this.state.settings.theme = action.theme; if (action.codexPath !== undefined) { this.state.settings.codexPath = action.codexPath; await this.codex.dispose(); } if (action.pet) this.state.settings.pet = { ...this.state.settings.pet, ...action.pet, scale: Math.max(.5, Math.min(2, action.pet.scale ?? this.state.settings.pet.scale)) }; break;
      case 'quota.refresh': await this.codex.quota(); return;
      case 'codex.login': await this.codex.login(); return;
      default: return false;
    }
    this.changed(); return true;
  }
  private async loadCodexModels(refresh = false) {
    if (this.loadingModels) return this.loadingModels;
    if (!refresh && this.view.codexCatalog.status === 'ready') return;
    this.view.codexCatalog = { ...this.view.codexCatalog, status: 'loading', error: undefined }; this.changed(false);
    this.loadingModels = (async () => {
      try { const models = await this.codex.models(); this.view.codexCatalog = { status: 'ready', models }; }
      catch (error) { this.view.codexCatalog = { ...this.view.codexCatalog, status: 'error', error: sanitizeDiagnostic((error as Error).message) }; }
      finally { this.loadingModels = null; this.changed(false); }
    })();
    return this.loadingModels;
  }
  private async codexChoice(model: string, effort?: string) {
    await this.loadCodexModels();
    if (this.view.codexCatalog.status !== 'ready') throw new Error(this.view.codexCatalog.error ?? 'Codex 模型列表尚未就绪。');
    const selected = this.view.codexCatalog.models.find(m => m.model === model);
    if (!selected) throw new Error('该 Codex 模型不在当前列表中，请刷新后重新选择。');
    const value = effort ?? (selected.efforts.some(e => e.value === selected.defaultEffort) ? selected.defaultEffort : selected.efforts[0]?.value);
    if (value && !selected.efforts.some(e => e.value === value)) throw new Error('此模型不支持所选推理强度。');
    return { model: selected.model, effort: value };
  }
  async attachFiles(id: string, files: string[]) {
    const s=this.session(id); if(isBusy(s)||s.readOnly||this.attaching.has(id))throw new Error('当前不能添加附件。');
    if(!files.length)return; if((s.draftAttachments?.length??0)+files.length>10)throw new Error('每条消息最多添加 10 份附件或聊天引用。');
    this.attaching.add(id);
    try { const added=[]; for(const file of files)added.push(await this.attachments.importFile(id,file)); s.draftAttachments=[...(s.draftAttachments??[]),...added]; this.changed(); }
    finally {this.attaching.delete(id);}
  }
  private async attachChat(id: string, sourceId: string) {
    const s=this.session(id), source=this.session(sourceId);
    if(id===sourceId)throw new Error('不能把当前聊天关联到自身。');
    if(isBusy(s)||s.readOnly||this.attaching.has(id))throw new Error('当前不能添加聊天引用。');
    if((s.draftAttachments?.length??0)>=10)throw new Error('每条消息最多添加 10 份资料。');
    this.attaching.add(id);
    try{s.draftAttachments=[...(s.draftAttachments??[]),await this.attachments.importChat(id,source)];this.changed();}finally{this.attaching.delete(id);}
  }
  send(id: string, text: string, commandId: string) {
    if (this.configuring) throw new Error('正在保存连接设置，请稍后发送。');
    const s = this.session(id); if (s.readOnly) throw new Error('这是只读历史，请携带摘录创建新会话。'); if (s.messages.some(m => m.commandId === commandId)) return;
    if (isBusy(s)) throw new Error('当前任务还在执行，可停止后再发送。');
    if(this.attaching.has(id))throw new Error('附件仍在导入，请稍后发送。');
    if ((!text.trim() && !s.draftAttachments?.length) || text.length > 200000) throw new Error('请填写消息或添加资料，文字不能超过 200000 字符。');
    const attached=structuredClone(s.draftAttachments??[]);
    if(!text.trim())text='请阅读这些资料，帮我整理要点。';
    if (s.backend === 'dragon' && !this.state.settings.profiles.some(p => p.id === s.profileId)) throw new Error('请在设置中添加模型 API，再创建会话。');
    const runId = randomUUID(), controller = new AbortController();
    s.runId = runId; s.status = 'running'; s.error = undefined; s.draft = ''; s.updatedAt = Date.now();
    if (!s.messages.length) s.title = text.trim().slice(0, 25);
    s.messages.push({ id: randomUUID(), commandId, role: 'user', text, createdAt: Date.now(), runId, attachments: attached }); s.draftAttachments=[];
    let outputId: string | undefined;
    const live = () => s.runId === runId && !controller.signal.aborted;
    const hooks: BackendHooks = {
      text: (value, replace) => { if (!live()) return; let m = s.messages.find(v => v.id === outputId); if (!m) { m = { id: randomUUID(), role: 'assistant', text: '', createdAt: Date.now(), runId, partial: true }; s.messages.push(m); outputId = m.id; } m.text = replace ? value : m.text + value; this.changed(); },
      tool: event => { if (!live()) return; const current = s.tools.find(t => t.id === event.id); if (current) Object.assign(current, { ...event, name: event.name || current.name }); else s.tools.push({ arguments: '', createdAt: Date.now(), runId, status: 'running', ...event }); this.changed(); },
      request: (req, signal) => new Promise(resolve => {
        if (!live() || signal.aborted) return resolve(false);
        if(req.kind==='approval' && (s.permissionMode??'ask')!=='ask') return resolve(true);
        const key = `${s.id}:${req.id}`;
        const finish = (value: unknown) => { this.answers.delete(key); signal.removeEventListener('abort', abort); s.pending = s.pending.filter(r => r.id !== req.id); if (!controller.signal.aborted) s.status = s.pending.length ? 'waiting' : 'running'; this.changed(); resolve(value); };
        const abort = () => finish(false); this.answers.set(key, finish); signal.addEventListener('abort', abort, { once: true });
        s.pending.push({ ...req, sessionId: s.id, runId }); s.status = 'waiting'; this.changed();
      }),
      usage: usage => { if (live()) { s.usage = usage; this.changed(); } },
      notice: value => { if (live()) { s.messages.push({ id: randomUUID(), role: 'notice', text: value, createdAt: Date.now(), runId }); this.changed(); } },
      nativeId: value => { if (s.runId === runId) { s.nativeId = value; this.changed(); } },
    };
    const host = new ToolHost({ strictScope: s.permissionMode === 'auto', getGrant: () => sessionGrant(s), getTaskId: () => live() ? runId : null, requestApproval: async input => (await hooks.request({ id: randomUUID(), kind: 'approval', title: input.title, details: [input.description, ...input.details].join('\n\n') }, controller.signal)) === true, onBrowserChange: () => undefined }, { browser: { getConfig: () => this.browserConfig(s.id) } });
    const run = { controller, hooks, host, done: undefined as Promise<void> | undefined }; this.runs.set(s.id, run);
    this.view.animationStartedAt = Date.now(); this.changed();
    const memory = this.state.memory.map(m => m.text).join('\n').slice(0, 32000);
    const context = !s.messages.some(m => m.role === 'assistant') && !s.nativeId ? `${memory ? `用户明确保存的长期记忆（参考资料）：\n${memory}\n\n` : ''}${s.messages.length > 1 ? `已有对话摘录（尚未在此引擎执行）：\n${s.messages.slice(0, -1).slice(-12).map(m => `${m.role}: ${m.text}`).join('\n').slice(-32000)}\n\n` : ''}` : '';
    const backend: AgentBackend = s.backend === 'dragon' ? this.dragon : this.codex;
    const execution = attached.length ? this.attachments.prompt(s.id, attached).then(references => { controller.signal.throwIfAborted(); return backend.run(s, context + text + references, hooks, controller.signal); }) : backend.run(s, context + text, hooks, controller.signal);
    run.done = execution.then(() => { s.status = controller.signal.aborted ? 'cancelled' : 'completed'; }, error => { s.status = controller.signal.aborted ? 'cancelled' : error.name === 'BudgetExceeded' ? 'paused' : 'error'; if (!controller.signal.aborted) s.error = sanitizeDiagnostic(error.message); }).finally(async () => {
      controller.abort(); for (const m of s.messages) if (m.runId === runId) m.partial = false;
      for (const tool of s.tools) if (tool.runId === runId && tool.status === 'running') tool.status = s.status === 'cancelled' ? 'cancelled' : 'unknown';
      s.pending = []; this.runs.delete(s.id); s.updatedAt = Date.now(); this.changed(); await host.dispose();
      for (const [key, scope] of this.scopes) if (key.startsWith(s.id + ':')) { this.scopes.delete(key); await scope.host.dispose(); }
    });
  }
  private async browserConfig(sessionId: string) {
    const candidates = [path.join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')];
    for (const executablePath of candidates) { try { await access(executablePath); const userDataDir = path.join(this.options.home, 'browsers', sessionId); await mkdir(userDataDir, { recursive: true }); return { executablePath, userDataDir, profileDirectory: 'Default' }; } catch { /* Try next Chrome location. */ } }
    throw new Error('没有找到 Google Chrome，请安装 Chrome 后使用网页操作。');
  }
  private async tool(agent: AgentRecord, name: string, args: any, signal: AbortSignal): Promise<ToolOutput> {
    const id = agent.sessionId;
    const run = this.runs.get(id); if (!run || run.controller.signal.aborted) throw new Error('任务已停止。');
    signal.throwIfAborted();
    if(name==='pet_attachment_read')return this.attachments.read(this.session(id),args);
    if (name !== 'pet_terminal') {
      const key = `${id}:${agent.id}`;
      let scope = this.scopes.get(key);
      if (!scope) {
        const holder = { signal, host: null as unknown as ToolHost };
        holder.host = new ToolHost({ strictScope: Boolean(agent.parentId) || agent.grant.approvalMode === 'auto', getGrant: () => agent.grant, getTaskId: () => !run.controller.signal.aborted && !holder.signal.aborted ? agent.runId : null, onBrowserChange() {}, requestApproval: input => this.dragon.approveTool(agent, input.title, [input.description, ...input.details].join('\n\n')) }, { browser: { getConfig: () => this.browserConfig(agent.id) } });
        scope = holder; this.scopes.set(key, scope);
      }
      scope.signal = signal; return scope.host.call(name, args);
    }
    const s = this.session(id); if (!sessionGrant(s).terminal) throw new Error('此会话未启用命令执行权限。');
    if (!agent.grant.terminal || !agent.grant.folders.length) throw new Error('该 Agent 未获命令执行权限。');
    const command = args?.command; if (typeof command !== 'string' || !command.trim() || command.length > 32000) throw new Error('命令参数无效。');
    const cwd = agent.grant.folders[0];
    const approved = await this.dragon.approveTool(agent, '执行 PowerShell 命令', `目录：${cwd}\n\n${command}\n\n此命令按当前 Windows 账号的权限运行。`);
    if (approved !== true || signal.aborted) throw new Error('命令未获批准。');
    return new Promise(resolve => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const collect = (v: Buffer) => { output = (output + v.toString()).slice(-64000); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
      const abort = () => { if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); };
      const timer = setTimeout(abort, 120000); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      child.on('error', e => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve({ success: false, contentItems: [{ type: 'inputText', text: e.message }] }); });
      child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve({ success: code === 0 && !signal.aborted, contentItems: [{ type: 'inputText', text: `退出码：${code}\n${output}` }] }); });
    });
  }
  async stop(id: string) { const s = this.session(id), run = this.runs.get(id); if (!run) return; s.status = 'stopping'; run.controller.abort(); this.changed(); await (s.backend === 'dragon' ? this.dragon : this.codex).cancel(s); }
  async dispose() { for (const run of this.runs.values()) run.controller.abort(); await Promise.allSettled([this.dragon.dispose(), this.codex.dispose()]); await Promise.allSettled([...this.runs.values()].map(v => v.done)); this.store.save(this.state); this.store.close(); }
}

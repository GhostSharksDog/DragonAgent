import {DEFAULT_APPEARANCE,appearanceValues} from '../shared/appearance';
import { planMarkdown } from '../shared/planning';
import { illustrationDefinitions } from './illustration/tools';
import { captureVersion, rememberVersion, applyVersion } from './versions';
import {routeChat} from './chat-routing';
import { validAssistantPreferences } from '../shared/persona';
import { Coordinator } from './coordinator';
import { memoryDefinitions } from './memory-tools';
import { deepseekBalance } from './balance';
import { Artifacts, artifactDefinition } from './artifacts';
import { dropWallpaper, storeWallpaper } from './wallpaper';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import packageInfo from '../../package.json';
import { randomUUID,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Action, AgentBackend, AgentSession, ChatAttachment, BackendHooks, DroppedFile, Snapshot } from '../shared/contracts';
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
  chooseWallpaperFile?: () => Promise<string | undefined>;
  illustration?: {create(description:string,commandId:string):Promise<unknown>;list():unknown};
  state: PersistentState;
  view: Omit<Snapshot, keyof PersistentState>;
  readonly dragon: DragonBackend;
  readonly codex: CodexBackend;
  readonly artifacts = new Artifacts();
  private coordinator: Coordinator;
  private runs = new Map<string, { controller: AbortController; hooks: BackendHooks; host: ToolHost; done?: Promise<void> }>();
  private answers = new Map<string, (value: unknown) => void>();
  private configuring = false;
  private scopes = new Map<string, { host: ToolHost; signal: AbortSignal }>();
  private attachments: Attachments;
  private attaching = new Set<string>();
  private loadingModels: Promise<void> | null = null;
  private routing = new Map<string,Promise<unknown>>();
  private petQueueArmed = new Set<string>();
  constructor(readonly store: Store, readonly secrets: Secrets, readonly options: { home: string; version?: string; workerPath: string; open(url: string): Promise<void> }) {
    super(); this.state = store.load(); this.attachments = new Attachments(options.home);
    this.view = { codexCatalog: { status: 'idle', models: [] }, resolvedTheme: this.state.settings.theme === 'dark' ? 'dark' : 'light', revision: 0, backends: { dragon: { state: 'stopped', message: 'Dragon 待连接' }, codex: { state: 'stopped', message: 'Codex 待连接' } }, mcp: [], quota: emptyQuota(), account: '尚未连接', skin: null, petView: 'hidden', animationStartedAt: Date.now(), version: options.version ?? packageInfo.version };
    this.dragon = new DragonBackend({ home: options.home, workerPath: options.workerPath, settings: () => this.state.settings, key: id => secrets.get(id), definitions: () => [{ name: 'pet_task_scope', description: '查看当前 Agent 的授权范围。', inputSchema: { type: 'object', properties: {} } }, attachmentDefinition, artifactDefinition, ...memoryDefinitions, ...illustrationDefinitions, ...fileDefinitions, ...browserDefinitions, { name: 'pet_terminal', description: '执行 PowerShell 命令，审批方式由当前会话权限等级决定。', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }], tool: (agent, name, args, signal) => this.tool(agent, name, args, signal), state: value => { this.view.backends.dragon = value; this.changed(false); }, mcp: value => { this.view.mcp = [...this.view.mcp.filter(v => v.id !== value.id), value]; this.changed(false); }, agent: (id, task) => { const session = this.session(id); session.tasks ??= []; const old = session.tasks.find(t => t.id === task.id); if (old) Object.assign(old, task); else session.tasks.push(task); this.changed(); } });
    this.codex = new CodexBackend({ preferences: () => this.state.settings.assistant, home: path.join(options.home, 'codex-runtime'), executable: () => this.state.settings.codexPath, tools: this.dragon, state: value => { this.view.backends.codex = value; this.changed(false); }, account: value => { this.view.account = value; this.changed(false); }, quota: value => { this.view.quota = value; this.changed(false); }, open: options.open });
    this.coordinator=new Coordinator({codex:this.codex,dragon:this.dragon,settings:()=>this.state.settings,key:id=>this.secrets.get(id),changed:()=>this.changed()});
  }
  snapshot(): Snapshot { return structuredClone({ ...this.state, ...this.view, sessions:this.state.sessions.map(s=>({...s,queuedMessages:(this.state.petChat?.queue??[]).filter(q=>q.sessionId===s.id).map(q=>({...q,paused:!this.petQueueArmed.has(q.commandId)}))})) }); }
  changed(persist = true) { if (persist) this.store.save(this.state); this.view.revision++; this.emit('change'); }
  session(id: string) { const value = this.state.sessions.find(s => s.id === id); if (!value) throw new Error('会话不存在。'); return value; }
  idleSettings() { if (this.state.sessions.some(isBusy)) throw new Error('请先停止正在执行的任务，再修改连接设置。'); }
  async cleanDeletedSessions() {
    for (const id of [...(this.state.pendingSessionDeletes ?? [])]) {
      const filename = path.join(this.options.home, 'agent-core.db');
      if (existsSync(filename)) {
        const db = new DatabaseSync(filename);
        try {
          db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
          for (const table of ['agents', 'events', 'attachments']) db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(id);
          db.exec('COMMIT');
        } finally { db.close(); }
      }
      await this.attachments.deleteSession(id);
      if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('无效会话标识。');
      const contextRoot=path.resolve(this.options.home,'contexts'),contextDir=path.resolve(contextRoot,id);
      try {const root=await realpath(contextRoot),target=await realpath(contextDir);if(path.dirname(target)!==root||path.basename(target)!==id)throw Error('上下文目录指向了其他位置。');await rm(target,{recursive:true,force:true});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      this.state.pendingSessionDeletes = (this.state.pendingSessionDeletes ?? []).filter(v => v !== id);
      this.store.save(this.state);
    }
  }
  create(backend: 'dragon' | 'codex', profileId = this.state.settings.selectedProfile, workspace = '', carryFrom?: string, codex?: { model: string; effort?: string }, activate=true) {
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
    this.state.sessions.unshift(s); if(activate){this.state.selectedSessionId = s.id; this.view.workbenchPage = 'chat'; this.view.workbenchPageRevision = (this.view.workbenchPageRevision ?? 0) + 1;} this.changed(); return s.id;
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
      case 'pet.chat.attach': {
        if(this.attaching.has('pet-inbox'))throw Error('附件正在导入。');
        const chat=this.state.petChat??={};if((chat.attachments?.length??0)+action.files.length>10)throw Error('每条消息最多 10 个附件。');
        this.attaching.add('pet-inbox');try{const added=[];for(const f of action.files)added.push(f.path?await this.attachments.importFile('pet-inbox',f.path):await this.attachments.importBytes('pet-inbox',{name:f.name,mime:f.mime,data:Buffer.from(f.data??new Uint8Array())}));this.state.petChat={...this.state.petChat,attachments:[...(this.state.petChat?.attachments??[]),...added]};this.changed();}finally{this.attaching.delete('pet-inbox');}return;
      }
      case 'pet.chat.removeAttachment': if(this.state.petChat)this.state.petChat.attachments=this.state.petChat.attachments?.filter(a=>a.id!==action.id);this.changed();return;
      case 'pet.chat.bind': {
        if(action.id){const s=this.session(action.id);if(s.readOnly||s.archived)throw Error('请选择可继续的聊天。');}
        this.state.petChat={...this.state.petChat,sessionId:action.id,pinned:action.pinned};this.changed();return;
      }
      case 'pet.chat.draft': this.state.petChat={...this.state.petChat,draft:action.text.slice(0,200000)};this.changed();return;
      case 'pet.chat.cancelQueued': if(this.state.petChat)this.state.petChat.queue=this.state.petChat.queue?.filter(q=>q.commandId!==action.commandId);this.petQueueArmed.delete(action.commandId);this.changed();return;
      case 'pet.chat.send': {
        if(this.routing.has(action.commandId))return this.routing.get(action.commandId);
        const job=this.routePetMessage(action.text,action.commandId);this.routing.set(action.commandId,job);
        try{await job;}finally{this.routing.delete(action.commandId);}
        return true;
      }
      case 'session.mode': {
        const s=this.session(action.id);
        if(!['plan','execute'].includes(action.mode)||s.backend!=='dragon'||s.collaboration?.enabled||s.readOnly||isBusy(s)||s.pending.length||this.state.petChat?.queue?.some(q=>q.sessionId===s.id))throw Error('请在普通 Dragon 聊天空闲且待发送队列为空时切换模式。');
        s.mode=action.mode;this.changed();return true;
      }
      case 'session.plan.execute': {
        const s=this.session(action.id),p=s.plans?.find(p=>p.id===action.versionId);
        if(p?.execution?.commandId===action.commandId)return true;
        if(s.mode!=='plan'||s.backend!=='dragon'||s.collaboration?.enabled||s.readOnly||isBusy(s)||s.pending.length||this.state.petChat?.queue?.some(q=>q.sessionId===s.id)||!p||p!==s.plans?.at(-1)||p.stale||p.execution||p.plan.questions.length)throw Error('请确认最新完整计划，等待当前任务与队列结束。');
        if(!action.commandId||action.commandId.length>200)throw Error('无效请求编号');
        s.mode='execute';p.execution={commandId:action.commandId,at:Date.now()};
        try{this.send(s.id,'执行以下已确认计划：\n\n'+planMarkdown(p.plan),action.commandId,true);p.execution.runId=s.runId;this.changed();}
        catch(error){s.mode='plan';p.execution=undefined;throw error;}return true;
      }
      case 'session.collaboration': {
        const s=this.session(action.id);if(isBusy(s)||s.readOnly||s.backend!=='dragon')throw Error('请在 Dragon 聊天空闲时修改协作模式。');
        if(action.config.enabled&&s.mode==='plan')throw Error('请先退出计划模式，再开启协作。');
        if(action.config.enabled){const profile=this.state.settings.profiles.find(p=>p.id===(action.config.executionProfileId??s.profileId));if(!profile||!/deepseek/i.test(profile.model))throw Error('请先选择 DeepSeek 执行模型。');}
        const choice=action.config.enabled&&action.config.plannerModel?await this.codexChoice(action.config.plannerModel,action.config.effort):undefined;
        if(isBusy(s)||s.readOnly||this.configuring)throw Error('任务已开始，协作配置未修改。');
        if(action.config.enabled&&action.config.executionProfileId)s.profileId=action.config.executionProfileId;
        s.collaboration={enabled:!!action.config.enabled,plannerModel:choice?.model,effort:choice?.effort};this.changed();return true;
      }
      case 'artifact.preview': {
        this.view.artifactPreview=await this.artifacts.preview(this.session(action.sessionId),action.artifactId,action.offset,action.page);
        this.state.settings.layout={leftCollapsed:this.state.settings.layout?.leftCollapsed??false,rightCollapsed:false};this.changed();return true;
      }
      case 'session.resend': return this.resend(action.id,action.messageId,action.text,action.commandId);
      case 'session.version': return this.selectVersion(action.id,action.versionId);
      case 'provider.balance.refresh': {
        const profile=this.state.settings.profiles.find(p=>p.id===action.profileId);
        if(!profile)throw Error('模型配置不存在。');
        const old=this.view.balances?.find(b=>b.profileId===profile.id);
        if(old?.status==='loading'||(!action.force&&old?.updatedAt&&Date.now()-old.updatedAt<60000))return;
        const publish=(value:import('../shared/contracts').ProviderBalance)=>{this.view.balances=[...(this.view.balances??[]).filter(b=>b.profileId!==profile.id),value];this.changed(false);};
        publish({...old,profileId:profile.id,status:'loading',balances:old?.balances??[],error:undefined});
        try{publish(await deepseekBalance(profile,await this.secrets.get(`profile:${profile.id}`)));}
        catch(e){publish({...old,profileId:profile.id,status:'error',balances:old?.balances??[],error:sanitizeDiagnostic((e as Error).message)});}
        return;
      }
      case 'layout.save': {
        const previous = this.state.settings.layout ?? { leftCollapsed:false, rightCollapsed:true };
        this.state.settings.layout = { leftCollapsed: typeof action.leftCollapsed === 'boolean' ? action.leftCollapsed : previous.leftCollapsed, rightCollapsed: typeof action.rightCollapsed === 'boolean' ? action.rightCollapsed : previous.rightCollapsed };
        break;
      }
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
        if(s.collaboration?.enabled&&!/deepseek/i.test(profile.model))s.collaboration={...s.collaboration,enabled:false};
        s.profileId = profile.id; s.updatedAt = Date.now();
        if (s.usage) s.usage = { ...s.usage, window: contextPolicy(profile).window, context:undefined, composition:undefined, calibrated:false, estimated: true };
        this.state.settings.selectedProfile = profile.id; this.state.settings.selectedBackend = 'dragon';
        this.changed(); return true;
      }
      case 'session.reasoning': {
        const s = this.session(action.id);
        if (s.backend !== 'dragon') throw new Error('Codex 的推理强度请在 Codex 模型设置里选择。');
        if (isBusy(s) || s.readOnly) throw new Error('请在当前任务结束后修改推理强度。');
        const profile = this.state.settings.profiles.find(p => p.id === s.profileId);
        if (!profile || !/deepseek/i.test(profile.baseUrl) && !/deepseek/i.test(profile.model)) throw new Error('当前模型不是 DeepSeek，不支持推理强度。');
        if (action.effort !== undefined && !['none','low','high','max'].includes(action.effort)) throw new Error('推理强度无效。');
        s.reasoningEffort = action.effort; s.updatedAt = Date.now();
        this.changed(); return true;
      }
      case 'session.permissionMode': {
        const s = this.session(action.id); if (isBusy(s) || s.readOnly) throw new Error('请在当前任务结束后修改权限。');
        if (!['ask','auto','full'].includes(action.mode)) throw new Error('权限等级无效。');
        s.permissionMode = action.mode;
        if (action.mode !== 'ask') { s.terminalEnabled = true; s.browserInput = true; }
        this.changed(); return;
      }
      case 'session.attachDrop': return this.attachDrop(action.id, action.files);
      case 'session.attachChat': return this.attachChat(action.id, action.sourceId);
      case 'session.removeAttachment': { const s=this.session(action.id); if(s.readOnly||this.attaching.has(s.id))throw new Error('当前不能修改附件。'); s.draftAttachments=(s.draftAttachments??[]).filter(a=>a.id!==action.attachmentId); this.changed(); return; }
      case 'session.create': return this.create(action.backend, action.profileId, action.workspace, action.carryFrom, action.backend === 'codex' && action.model ? await this.codexChoice(action.model, action.reasoningEffort) : undefined);
      case 'session.select': this.session(action.id); this.state.selectedSessionId = action.id; break;
      case 'session.archive': { const s = this.session(action.id); if (isBusy(s)) throw new Error('请先停止此任务。'); s.archived = true; if (this.state.selectedSessionId === s.id) this.state.selectedSessionId = null; break; }
      case 'session.delete': {
        const s = this.state.sessions.find(s => s.id === action.id);
        if (!s) return true; // Repeated requests from another window are harmless.
        if (isBusy(s) || this.runs.has(s.id) || this.attaching.has(s.id)) throw new Error('请先停止任务，并等待附件处理完成后删除。');
        this.state.sessions = this.state.sessions.filter(v => v.id !== s.id);
        if(this.state.petChat){for(const q of this.state.petChat.queue??[])if(q.sessionId===s.id)this.petQueueArmed.delete(q.commandId);this.state.petChat.queue=this.state.petChat.queue?.filter(q=>q.sessionId!==s.id);if(this.state.petChat.sessionId===s.id)this.state.petChat.sessionId=undefined;}
        if (this.state.selectedSessionId === s.id) this.state.selectedSessionId = this.state.sessions.find(v => !v.archived)?.id ?? null;
        this.state.pendingSessionDeletes = [...(this.state.pendingSessionDeletes ?? []), s.id];
        this.changed(); // Persist deletion before cleanup, so a crash cannot restore the conversation.
        try { await this.cleanDeletedSessions(); }
        catch { throw new Error('对话已删除，本地缓存清理未完成；下次启动会重试。'); }
        return true;
      }
      case 'pet.chatMode': {
        if (!['simple', 'detailed'].includes(action.mode)) throw new Error('无效的聊天视图。');
        this.state.settings.pet.chatMode = action.mode; break;
      }
      case 'session.draft': this.session(action.id).draft = action.text.slice(0, 200000); break;
      case 'session.send': {const s=this.session(action.id);if(this.state.sessions.some(s=>s.messages.some(m=>m.commandId===action.commandId))||this.state.petChat?.queue?.some(q=>q.commandId===action.commandId))return true;
        if(isBusy(s)||this.state.petChat?.queue?.some(q=>q.sessionId===s.id)){this.enqueue(s.id,action.text,action.commandId,s.draftAttachments??[]);s.draft='';s.draftAttachments=[];this.changed();if(!isBusy(s))this.drainQueue(s.id);}else this.send(s.id,action.text,action.commandId);return true;}
      case 'session.cancelQueued': {this.session(action.id);if(this.state.petChat)this.state.petChat.queue=this.state.petChat.queue?.filter(q=>q.sessionId!==action.id||q.commandId!==action.commandId);this.petQueueArmed.delete(action.commandId);this.changed();if(!isBusy(this.session(action.id)))this.drainQueue(action.id);return true;}
      case 'session.resumeQueued': {const s=this.session(action.id);if(isBusy(s)||s.readOnly)throw Error('请在聊天空闲时继续发送');for(const q of this.state.petChat?.queue??[])if(q.sessionId===s.id)this.petQueueArmed.add(q.commandId);this.drainQueue(s.id);return true;}
      case 'session.stop': await this.stop(action.id); return;
      case 'agent.stop': await this.dragon.cancel(this.session(action.id), action.agentId); return;
      case 'session.compact': { const s = this.session(action.id); if (s.backend === 'codex') throw new Error('Codex 由自己的上下文策略管理；可创建新会话并携带摘要。'); this.send(s.id, '/compact', randomUUID()); return; }
      case 'session.permissions': { const s = this.session(action.id); if (isBusy(s)) throw new Error('任务执行中不能更改权限。'); s.origins = action.origins.map(v => { const url = new URL(v); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('网站需使用 HTTP 或 HTTPS。'); return url.origin; }); s.browserInput = action.browserInput; s.terminalEnabled = action.terminalEnabled; break; }
      case 'request.answer': { const s = this.session(action.sessionId); const req = s.pending.find(r => r.id === action.id && r.runId === s.runId); if (!req) return; this.answers.get(`${s.id}:${req.id}`)?.(action.value); return; }
      case 'profile.save': {
        this.idleSettings(); const p = action.profile; contextPolicy(p); const url = new URL(p.baseUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密钥、参数或账号密码。');
        if (!p.model.trim() || !p.name.trim() || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)) throw new Error('请完整填写模型名称和配置名称。');
        if(p.pricing&&(!/^[A-Z]{3}$/.test(p.pricing.currency)||!Number.isFinite(p.pricing.input)||p.pricing.input<0||!Number.isFinite(p.pricing.output)||p.pricing.output<0||p.pricing.cacheRead!==undefined&&(!Number.isFinite(p.pricing.cacheRead)||p.pricing.cacheRead<0)))throw Error('自定义单价无效');
        await this.secrets.set(`profile:${p.id}`, action.apiKey ?? '');
        const safe = { pricing:p.pricing, id: p.id, name: p.name, provider: p.provider, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model, contextWindow: p.contextWindow, maxOutput: p.maxOutput, hasKey: Boolean(await this.secrets.get(`profile:${p.id}`)), deepseekSearch: p.deepseekSearch };
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
      case 'assistant.preferences.save': this.state.settings.assistant = validAssistantPreferences(action.preferences); break;
      case 'appearance.save': {const old=this.state.settings.appearance??structuredClone(DEFAULT_APPEARANCE);this.state.settings.appearance={...old,...appearanceValues({...old,...action.values}),tab:action.tab&&['desk','library','make'].includes(action.tab)?action.tab:old.tab};break;}
      case 'appearance.preset.save': {const a=this.state.settings.appearance??=structuredClone(DEFAULT_APPEARANCE);const name=action.name.trim().slice(0,60);if(!name)throw Error('请输入预设名称');const old=a.presets.find(p=>p.id===action.id);if(old){old.name=name;}else{a.presets.push({id:randomUUID(),name,values:appearanceValues(a),theme:this.state.settings.theme,accent:this.state.settings.accent??'violet',wallpaper:structuredClone(this.state.settings.wallpaper)});}break;}
      case 'appearance.preset.delete': {const a=this.state.settings.appearance;if(a)a.presets=a.presets.filter(p=>p.id!==action.id);break;}
      case 'appearance.reset': {const a=this.state.settings.appearance??structuredClone(DEFAULT_APPEARANCE);this.state.settings.appearance={...a,...appearanceValues(DEFAULT_APPEARANCE)};this.state.settings.theme='light';this.state.settings.accent='violet';this.state.settings.wallpaper=null;break;}
      case 'appearance.preset.apply': {
        const a=this.state.settings.appearance??=structuredClone(DEFAULT_APPEARANCE),p=a.presets.find(p=>p.id===action.id);
        if(p){this.state.settings.appearance={...a,...appearanceValues(p.values)};this.state.settings.theme=p.theme;this.state.settings.accent=p.accent;this.state.settings.wallpaper=p.wallpaper&&a.wallpapers.some(w=>w.file===p.wallpaper!.file)?structuredClone(p.wallpaper):null;}
        else if(['light','dark','glass'].includes(action.id)){this.state.settings.appearance={...a,...appearanceValues(DEFAULT_APPEARANCE)};this.state.settings.theme=action.id==='dark'?'dark':'light';this.state.settings.accent='violet';if(action.id!=='glass')this.state.settings.wallpaper=null;else if(!this.state.settings.wallpaper&&a.wallpapers.length){const w=a.wallpapers[0];this.state.settings.wallpaper={file:w.file,name:w.name,opacity:.55,blur:0,dim:.2};}}else throw Error('预设不存在');break;
      }
      case 'wallpaper.select': {const a=this.state.settings.appearance??=structuredClone(DEFAULT_APPEARANCE),w=a.wallpapers.find(w=>w.file===action.file);if(!w)throw Error('壁纸不存在');w.usedAt=Date.now();this.state.settings.wallpaper={file:w.file,name:w.name,opacity:this.state.settings.wallpaper?.opacity??.55,blur:this.state.settings.wallpaper?.blur??0,dim:this.state.settings.wallpaper?.dim??.2};break;}
      case 'wallpaper.delete': {const a=this.state.settings.appearance??=structuredClone(DEFAULT_APPEARANCE);if(!a.wallpapers.some(w=>w.file===action.file))throw Error('壁纸不存在');dropWallpaper(action.file);a.wallpapers=a.wallpapers.filter(w=>w.file!==action.file);for(const p of a.presets)if(p.wallpaper?.file===action.file)p.wallpaper=null;if(this.state.settings.wallpaper?.file===action.file)this.state.settings.wallpaper=null;break;}
      case 'wallpaper.choose': { const source = await this.chooseWallpaperFile?.(); if (!source) return; const stored = storeWallpaper(source);const a=this.state.settings.appearance??=structuredClone(DEFAULT_APPEARANCE);a.wallpapers.unshift({...stored,addedAt:Date.now(),usedAt:Date.now()}); this.state.settings.wallpaper = { ...stored, opacity: .55, blur: 0, dim: .2 }; this.changed(); return; }
    case 'wallpaper.clear': { this.state.settings.wallpaper = null; this.changed(); return; }
    case 'wallpaper.tune': { const w = this.state.settings.wallpaper; if (w) { const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)); w.opacity = clamp(action.opacity ?? w.opacity, 0, 1); w.blur = clamp(action.blur ?? w.blur, 0, 24); w.dim = clamp(action.dim ?? w.dim, 0, .8); this.changed(); } return; }
    case 'settings.save': this.idleSettings(); if (action.limits) this.state.settings.limits = validLimits(action.limits); if (action.theme) this.state.settings.theme = action.theme; if (action.accent) this.state.settings.accent = action.accent; if (action.codexPath !== undefined) { this.state.settings.codexPath = action.codexPath; await this.codex.dispose(); } if (action.pet) this.state.settings.pet = { ...this.state.settings.pet, ...action.pet, scale: Math.max(.5, Math.min(2, action.pet.scale ?? this.state.settings.pet.scale)) }; break;
      case 'quota.refresh': await this.codex.quota(); return;
      case 'codex.login': await this.codex.login(); return;
      default: return false;
    }
    this.changed(); return true;
  }
  private async saveVersion(s:AgentSession, status=s.status) {
    const checkpoint=randomUUID();if(s.backend==='dragon')await this.dragon.checkpoint(s.id,checkpoint);
    const version=captureVersion(s,checkpoint);version.status=status;rememberVersion(s,version);this.changed();
  }
  private async resend(id:string,messageId:string,text:string,commandId:string) {
    const s=this.session(id);
    if(s.messages.some(m=>m.commandId===commandId)||s.versions?.some(v=>v.messages.some(m=>m.commandId===commandId)))return true;
    if(isBusy(s)||s.readOnly||this.runs.has(id)||this.attaching.has(id)||this.configuring)throw Error('请等待当前任务结束后编辑消息。');
    const message=s.messages.filter(m=>m.role==='user').at(-1);
    if(!message||message.id!==messageId)throw Error('只能编辑当前版本的最后一条用户消息。');
    if(!text.trim()||text.length>200000)throw Error('请输入 1–200000 字符。');
    if(s.backend==='dragon'&&!message.contextCheckpoint)throw Error('这条旧消息没有上下文分界，请携带摘录创建新聊天。');
    if(s.backend==='codex'&&!message.contextCheckpoint)throw Error('这条旧消息没有轮次分界，请携带摘录创建新聊天。');
    const status=s.status;s.status='running';this.changed(false);
    try {
      await this.saveVersion(s,status);
      if(s.backend==='dragon')await this.dragon.restore(id,message.contextCheckpoint!);
      else s.nativeId=message.beforeNativeId&&message.beforeNativeTurnId?await this.codex.forkBefore(message.beforeNativeId,message.beforeNativeTurnId):undefined;
      const index=s.messages.findIndex(m=>m.id===message.id),prior=s.messages.slice(0,index),runs=new Set(prior.map(m=>m.runId));
      s.messages=prior;s.tools=s.tools.filter(t=>runs.has(t.runId));s.tasks=[];s.nativeTurnId=message.beforeNativeTurnId;
      s.collaborationHistory=(s.collaborationHistory??[]).filter(c=>runs.has(c.runId));s.collaborationState=undefined;s.plans=s.plans?.filter(p=>runs.has(p.runId)).map(p=>({...p,stale:true}));s.versionId=randomUUID();s.draftAttachments=structuredClone(message.attachments??[]);s.status='idle';s.error=undefined;this.changed();
      this.send(id,text,commandId);return true;
    } catch(error){if(!this.runs.has(id)){s.status=status;this.changed();}throw error;}
  }
  private async selectVersion(id:string,versionId:string) {
    const s=this.session(id);if(isBusy(s)||s.readOnly||this.runs.has(id)||this.attaching.has(id))throw Error('请等待当前任务结束后切换版本。');
    if(s.versionId===versionId)return true;
    const target=s.versions?.find(v=>v.id===versionId);if(!target)throw Error('版本不存在。');
    const status=s.status;s.status='running';this.changed(false);
    try {await this.saveVersion(s,status);if(s.backend==='dragon')await this.dragon.restore(id,target.checkpoint);applyVersion(s,target);this.changed();return true;}
    catch(error){s.status=status;this.changed();throw error;}
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
    const s=this.session(id); if(s.readOnly||this.attaching.has(id))throw new Error('当前不能添加附件。');
    if(!files.length)return; if((s.draftAttachments?.length??0)+files.length>10)throw new Error('每条消息最多添加 10 份附件或聊天引用。');
    this.attaching.add(id);
    try { const added=[]; for(const file of files)added.push(await this.attachments.importFile(id,file)); s.draftAttachments=[...(s.draftAttachments??[]),...added]; this.changed(); }
    finally {this.attaching.delete(id);}
  }
  async attachDrop(id: string, files: DroppedFile[]) {
    const s=this.session(id); if(s.readOnly||this.attaching.has(id))throw new Error('当前不能添加附件。');
    if(!files.length)return; if((s.draftAttachments?.length??0)+files.length>10)throw new Error('每条消息最多添加 10 份附件或聊天引用。');
    this.attaching.add(id);
    try {
      const added:ChatAttachment[]=[];
      for(const file of files) added.push(file.path ? await this.attachments.importFile(id,file.path) : await this.attachments.importBytes(id,{name:file.name,mime:file.mime,data:Buffer.from(file.data??new Uint8Array())}));
      s.draftAttachments=[...(s.draftAttachments??[]),...added]; this.changed();
    } finally {this.attaching.delete(id);}
  }
  private async attachChat(id: string, sourceId: string) {
    const s=this.session(id), source=this.session(sourceId);
    if(id===sourceId)throw new Error('不能把当前聊天关联到自身。');
    if(s.readOnly||this.attaching.has(id))throw new Error('当前不能添加聊天引用。');
    if((s.draftAttachments?.length??0)>=10)throw new Error('每条消息最多添加 10 份资料。');
    this.attaching.add(id);
    try{s.draftAttachments=[...(s.draftAttachments??[]),await this.attachments.importChat(id,source)];this.changed();}finally{this.attaching.delete(id);}
  }
  private async routePetMessage(text:string,commandId:string){
    if(this.attaching.has('pet-inbox'))throw Error('附件仍在导入，请稍后发送。');
    const inbox=structuredClone(this.state.petChat?.attachments??[]);
    if((!text.trim()&&!inbox.length)||text.length>200000||!commandId||commandId.length>200)throw Error('消息或请求编号无效。');
    const existing=this.state.sessions.find(s=>s.messages.some(m=>m.commandId===commandId));if(existing)return existing.id;
    const chat=this.state.petChat??{},queued=chat.queue?.find(q=>q.commandId===commandId);if(queued)return queued.sessionId;
    const profile=this.state.settings.profiles.find(p=>p.id===this.state.settings.selectedProfile);
    const match=chat.pinned&&chat.sessionId?{id:chat.sessionId}:await routeChat(text,this.state.sessions,chat.sessionId,profile,()=>this.secrets.get(`profile:${profile?.id}`));
    let id=match.id;if(id&&!this.state.sessions.some(s=>s.id===id&&!s.readOnly&&!s.archived))id=undefined;
    if(!id)id=this.create(this.state.settings.selectedBackend??'dragon',undefined,'',undefined,undefined,false);
    const attached=await this.attachments.copyTo('pet-inbox',id,inbox);
    this.state.petChat={...this.state.petChat,sessionId:id,notice:match.notice};
    if(isBusy(this.session(id))||this.state.petChat.queue?.some(q=>q.sessionId===id)){this.enqueue(id,text,commandId,attached);if(!isBusy(this.session(id)))this.drainQueue(id);}
    else this.send(id,text,commandId,true,attached);
    if(this.state.petChat.draft===text)this.state.petChat.draft='';this.state.petChat.attachments=this.state.petChat.attachments?.filter(a=>!inbox.some(v=>v.id===a.id));this.changed();return id;
  }
  private enqueue(id:string,text:string,commandId:string,attachments:ChatAttachment[]){
    const s=this.session(id);if(s.readOnly||this.attaching.has(id))throw Error('聊天只读或附件仍在导入');
    if((!text.trim()&&!attachments.length)||text.length>200000||!commandId||commandId.length>200)throw Error('消息或请求编号无效');
    const chat=this.state.petChat??={};chat.queue??=[];if(chat.queue.some(q=>q.commandId===commandId))return;
    chat.queue.push({sessionId:id,text,commandId,attachments:structuredClone(attachments)});this.petQueueArmed.add(commandId);this.changed();
  }
  private drainQueue(id:string){
    const s=this.session(id);if(isBusy(s))return;const q=this.state.petChat?.queue?.find(q=>q.sessionId===id);if(!q||!this.petQueueArmed.has(q.commandId))return;
    try {this.send(id,q.text,q.commandId,true,q.attachments);this.state.petChat!.queue=this.state.petChat!.queue!.filter(v=>v!==q);this.petQueueArmed.delete(q.commandId);}
    catch(error){for(const item of this.state.petChat?.queue??[])if(item.sessionId===id)this.petQueueArmed.delete(item.commandId);s.error='待发送消息已暂停：'+(error as Error).message;}
    this.changed();
  }
  send(id: string, text: string, commandId: string, independent=false,independentAttachments:ChatAttachment[]=[]) {
    if (this.configuring) throw new Error('正在保存连接设置，请稍后发送。');
    const s = this.session(id); if (s.readOnly) throw new Error('这是只读历史，请携带摘录创建新会话。'); if (s.messages.some(m => m.commandId === commandId)) return;
    if (isBusy(s)) throw new Error('当前任务还在执行，可停止后再发送。');
    if(this.attaching.has(id))throw new Error('附件仍在导入，请稍后发送。');
    if ((!text.trim() && !(independent?independentAttachments.length:s.draftAttachments?.length)) || text.length > 200000) throw new Error('请填写消息或添加资料，文字不能超过 200000 字符。');
    const attached=structuredClone(independent?independentAttachments:s.draftAttachments??[]);
    if(!text.trim())text='请阅读这些资料，帮我整理要点。';
    if (s.backend === 'dragon' && !this.state.settings.profiles.some(p => p.id === s.profileId)) throw new Error('请在设置中添加模型 API，再创建会话。');
    const runId = randomUUID(), controller = new AbortController();
    const confirmed=s.plans?.find(p=>p.execution?.commandId===commandId);if(confirmed?.execution)confirmed.execution.runId=runId;
    s.runId = runId; s.status = 'running'; s.error = undefined; if(!independent)s.draft = ''; s.updatedAt = Date.now();
    if (!s.messages.length) s.title = text.trim().slice(0, 25);
    s.messages.push({ id: randomUUID(), commandId, role: 'user', text, createdAt: Date.now(), runId, sequence:Math.max(0,...s.messages.map(m=>m.sequence??0),...s.tools.map(t=>t.sequence??0))+1, attachments: attached, contextCheckpoint:runId, beforeNativeId:s.nativeId, beforeNativeTurnId:s.nativeTurnId }); if(!independent)s.draftAttachments=[];
    let outputId: string | undefined;
    let sequence=Math.max(0,...s.messages.map(m=>m.sequence??0),...s.tools.map(t=>t.sequence??0));
    const live = () => s.runId === runId && !controller.signal.aborted;
    if(s.mode==='plan'&&s.plans?.length)s.plans.at(-1)!.stale=true;
    const hooks: BackendHooks = {
      plan: plan=>{if(!live()||s.mode!=='plan')throw Error('计划轮次已失效');s.plans??=[];s.plans.push({id:randomUUID(),runId,createdAt:Date.now(),plan:structuredClone(plan)});this.changed();},
      text: (value, replace) => { if (!live()) return; let m = s.messages.find(v => v.id === outputId); if (!m) { m = { id: randomUUID(), role: 'assistant', text: '', createdAt: Date.now(), runId, partial: true, sequence:++sequence }; s.messages.push(m); outputId = m.id; } m.text = replace ? value : m.text + value; this.changed(); },
      tool: event => { if (!live()) return; if (event.status === 'running' || event.status === 'queued') { const prior=s.messages.find(m=>m.id===outputId); if(prior)prior.partial=false; outputId=undefined; } const current = s.tools.find(t => t.id === event.id); if (current) { const status = current.status === 'declined' ? 'declined' : event.status ?? current.status; Object.assign(current, { ...event, name: event.name || current.name, status, ...(['completed','error','declined','cancelled','unknown'].includes(status) ? {completedAt:Date.now()} : {}) }); } else s.tools.push({ arguments: '', createdAt: Date.now(), runId, status: 'running', sequence:++sequence, ...event }); this.changed(); },
      request: (req, signal) => new Promise(resolve => {
        if (!live() || signal.aborted) return resolve(false);
        const operation=req.toolId?s.tools.find(t=>t.id===req.toolId):undefined;
        if(req.kind==='approval' && (s.permissionMode??'ask')!=='ask') { if(operation){operation.status='running';operation.startedAt=Date.now();} this.changed(); return resolve(true); }
        if(operation)operation.status='approval';
        const key = `${s.id}:${req.id}`;
        let settled=false;
        const finish = (value: unknown) => { if(settled)return;settled=true;if(operation){operation.status=controller.signal.aborted?'cancelled':value===true?'running':'declined';if(value===true)operation.startedAt=Date.now();else operation.completedAt=Date.now();} this.answers.delete(key); signal.removeEventListener('abort', abort); s.pending = s.pending.filter(r => r.id !== req.id); if (!controller.signal.aborted) s.status = s.pending.length ? 'waiting' : 'running'; this.changed(); resolve(value); };
        const abort = () => finish(false); this.answers.set(key, finish); signal.addEventListener('abort', abort, { once: true });
        s.pending.push({ ...req, operation:operation?{name:operation.name,arguments:operation.arguments}:req.operation, sessionId: s.id, runId }); s.status = 'waiting'; this.changed();
      }),
      attempt: (attempt,agentId) => {if(live()){s.attempts??=[];const index=s.attempts.findIndex(a=>a.id===attempt.id);const value={...attempt,agentId,runId};if(index<0)s.attempts.push(value);else s.attempts[index]=value;this.changed();}},
      usage: usage => { if (live()) { s.usage = usage; this.changed(); } },
      notice: value => { if (live()) { s.messages.push({ id: randomUUID(), role: 'notice', text: value, createdAt: Date.now(), runId, sequence:++sequence }); this.changed(); } },
      nativeTurnId: value => { if(s.runId===runId){s.nativeTurnId=value;this.changed();} },
      nativeId: value => { if (s.runId === runId) { s.nativeId = value; this.changed(); } },
    };
    const host = new ToolHost({ strictScope: s.permissionMode === 'auto', getGrant: () => sessionGrant(s), getTaskId: () => live() ? runId : null, requestApproval: async input => (await hooks.request({ id: randomUUID(), kind: 'approval', title: input.title, details: [input.description, ...input.details].join('\n\n') }, controller.signal)) === true, onBrowserChange: () => undefined }, { browser: { getConfig: () => this.browserConfig(s.id) } });
    const run = { controller, hooks, host, done: undefined as Promise<void> | undefined }; this.runs.set(s.id, run);
    this.view.animationStartedAt = Date.now(); this.changed();
    const memory = this.state.memory.map(m => m.text).join('\n').slice(0, 32000);
    const context = !s.messages.some(m => m.role === 'assistant') && !s.nativeId ? `${memory ? `用户明确保存的长期记忆（参考资料）：\n${memory}\n\n` : ''}${s.messages.length > 1 ? `已有对话摘录（尚未在此引擎执行）：\n${s.messages.slice(0, -1).slice(-12).map(m => `${m.role}: ${m.text}`).join('\n').slice(-32000)}\n\n` : ''}` : '';
    const backend: Pick<AgentBackend,'run'> = s.collaboration?.enabled && text !== '/compact' ? this.coordinator : s.backend === 'dragon' ? this.dragon : this.codex;
    const execution = attached.length ? this.attachments.prompt(s.id, attached).then(references => { controller.signal.throwIfAborted(); return backend.run(s, context + text + references, hooks, controller.signal); }) : backend.run(s, context + text, hooks, controller.signal);
    run.done = execution.then(() => { s.status = controller.signal.aborted ? 'cancelled' : 'completed'; if (s.status === 'completed') this.emit('task-done', s.id); }, error => { s.status = controller.signal.aborted ? 'cancelled' : error.name === 'BudgetExceeded' ? 'paused' : 'error'; if (!controller.signal.aborted) s.error = sanitizeDiagnostic(error.message); }).finally(async () => {
      controller.abort(); for (const m of s.messages) if (m.runId === runId) m.partial = false;
      for (const tool of s.tools) if (tool.runId === runId && ['running','queued','approval'].includes(tool.status)) tool.status = s.status === 'cancelled' ? 'cancelled' : 'unknown';
      s.pending = []; this.runs.delete(s.id); s.updatedAt = Date.now(); this.changed(); await host.dispose();
      for (const [key, scope] of this.scopes) if (key.startsWith(s.id + ':')) { this.scopes.delete(key); await scope.host.dispose(); }
      if(s.status==='completed')this.drainQueue(s.id);else {for(const q of this.state.petChat?.queue??[])if(q.sessionId===s.id)this.petQueueArmed.delete(q.commandId);this.changed();}
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
    if(name==='pet_memory_read') {
      const query=String(args.query??'').toLowerCase();return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(this.state.memory.filter(m=>m.text.toLowerCase().includes(query)).slice(-100))}]};
    }
    if(name==='pet_memory_save') {
      const answer=await run.hooks.request({id:randomUUID(),kind:'question',title:'保存长期记忆',details:String(args.text),questions:[{id:'save',question:'是否保存以上内容为长期记忆？',options:['保存','不保存']}]},signal) as Record<string,string>;
      if(answer?.save!=='保存')return {success:false,contentItems:[{type:'inputText',text:'用户未确认，记忆未保存。'}]};
      signal.throwIfAborted();await this.applyAction({type:'memory.save',text:String(args.text),tags:args.tags??[]});return {success:true,contentItems:[{type:'inputText',text:'已保存用户确认的记忆。'}]};
    }
    if(name==='pet_artifact_publish') {
      if(!Array.isArray(args?.paths)||!args.paths.length||args.paths.length>32)throw Error('请提供 1–32 个文件路径。');
      if(!await this.dragon.approveTool(agent,'登记文件产物',args.paths.join('\n')))throw Error('用户拒绝了登记。');
      const files=await this.artifacts.register(this.session(id),args.paths,agent.grant.folders,agent.grant.allFolders);this.changed();
      return {success:true,facts:{artifacts:files.map(f=>({path:f.path,size:f.size,modifiedAt:f.modifiedAt}))},contentItems:[{type:'inputText',text:JSON.stringify(files)}]};
    }
    if(name==='pet_illustration_list'||name==='pet_illustration_create'){
      if(!this.illustration)throw Error('插画功能尚未就绪');
      if(!await this.dragon.approveTool(agent,name==='pet_illustration_create'?'创建插画项目':'查看插画项目',name==='pet_illustration_create'?String(args.description):'读取项目名称与状态'))return {success:false,contentItems:[{type:'inputText',text:'用户拒绝了插画操作'}]};
      const result=name==='pet_illustration_list'?this.illustration.list():await this.illustration.create(String(args.description),'agent:'+agent.runId+':'+createHash('sha256').update(String(args.description)).digest('hex'));
      return {success:true,contentItems:[{type:'inputText',text:JSON.stringify(result)}]};
    }
    if(name==='pet_attachment_read')return this.attachments.read(this.session(id),args);
    if (name !== 'pet_terminal') {
      const key = `${id}:${agent.id}`;
      let scope = this.scopes.get(key);
      if (!scope) {
        const holder = { signal, host: null as unknown as ToolHost };
        holder.host = new ToolHost({ strictScope: Boolean(agent.parentId) || agent.grant.approvalMode === 'auto', getGrant: () => agent.grant, getTaskId: () => !run.controller.signal.aborted && !holder.signal.aborted ? agent.runId : null, onBrowserChange() {}, requestApproval: input => this.dragon.approveTool(agent, input.title, [input.description, ...input.details].join('\n\n')) }, { browser: { getConfig: () => this.browserConfig(agent.id) } });
        scope = holder; this.scopes.set(key, scope);
      }
      scope.signal = signal; const result=await scope.host.call(name, args);
      if(result.success&&['pet_files_write','pet_files_copy','pet_files_move'].includes(name)) {
        try {const files=await this.artifacts.register(this.session(id),[args.destination??args.path],agent.grant.folders,agent.grant.allFolders);result.facts={artifacts:files.map(f=>({path:f.path,size:f.size,modifiedAt:f.modifiedAt}))};this.changed();}
        catch(e){run.hooks.notice('文件操作已成功，但产物未登记：'+(e as Error).message);}
      }
      return result;
    }
    const s = this.session(id); if (!sessionGrant(s).terminal) throw new Error('此会话未启用命令执行权限。');
    if (!agent.grant.terminal || !agent.grant.folders.length) throw new Error('该 Agent 未获命令执行权限。');
    const command = args?.command; if (typeof command !== 'string' || !command.trim() || command.length > 32000) throw new Error('命令参数无效。');
    const cwd = agent.grant.folders[0];
    const approved = await this.dragon.approveTool(agent, '执行 PowerShell 命令', `目录：${cwd}\n\n${command}\n\n此命令按当前 Windows 账号的权限运行。`);
    if (approved !== true || signal.aborted) return {success:false,errorKind:signal.aborted?'cancelled':'denied',contentItems:[{type:'inputText',text:'命令未获批准，未执行。'}]};
    const operation=[...s.tools].reverse().find(t=>t.agentId===agent.id&&t.name==='pet_terminal'&&t.runId===agent.runId&&t.status==='running');
    const publish=(result:string,exitCode?:number|null)=>{if(operation)run.hooks.tool({id:operation.id,name:operation.name,cwd,result,exitCode,status:'running',startedAt:operation.startedAt??Date.now()});};
    return new Promise(resolve => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '',lastUpdate=0,timedOut=false;publish('');const collect = (v: Buffer) => { output = (output + v.toString()).slice(-64000); if(Date.now()-lastUpdate>150){lastUpdate=Date.now();publish(output);} }; child.stdout.on('data', collect); child.stderr.on('data', collect);
      const abort = () => { if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); };
      const timer = setTimeout(()=>{timedOut=true;abort();}, 120000); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      child.on('error', e => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve({ success: false, contentItems: [{ type: 'inputText', text: e.message }] }); });
      child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort);publish(output,code); resolve({ errorKind:timedOut||signal.aborted?'unknown':code===0?undefined:'service', facts:!signal.aborted&&!timedOut&&code!==null?{exitCode:code}:undefined, success: code === 0 && !signal.aborted&&!timedOut, contentItems: [{ type: 'inputText', text: `${timedOut?'命令超过 120 秒，已停止。\n':''}退出码：${code}\n${output}` }] }); });
    });
  }
  async stop(id: string) { const s = this.session(id), run = this.runs.get(id); if (!run) return; s.status = 'stopping'; run.controller.abort(); this.changed(); await (s.backend === 'dragon' ? this.dragon : this.codex).cancel(s); }
  async dispose() { for (const run of this.runs.values()) run.controller.abort(); await Promise.allSettled([this.dragon.dispose(), this.codex.dispose()]); await Promise.allSettled([...this.runs.values()].map(v => v.done)); this.store.save(this.state); this.store.close(); }
}

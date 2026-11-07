import { ApprovalCard } from './ApprovalCard';
import { Illustration } from './Illustration';
import { ContextStatsBar } from './ContextStatsBar';
import { ToolCatalog } from './ToolCatalog';
import { QuotaBars } from './QuotaBars';
import { ResultPanel } from './ResultPanel';
import { AccountBalances } from './AccountBalances';
import { Timeline } from './Timeline';
import { RichText } from './RichText';
import { AssistantSettings } from './AssistantSettings';
import { wallpaperUrl, applyAppearance } from './Appearance';
import { StudioPage } from './StudioPage';
import './appearance.css';
import { Workshop } from './Workshop';
import { HistoryList } from './HistoryList';
import { BubbleChat } from './BubbleChat';
import { Composer } from './ComposerControls';
import { Icon } from './Icons';
import avatar from '../../assets/branding/dragon-avatar.png';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Action, AgentSession, ModelProfile, McpConfig, Snapshot, PendingRequest } from '../shared/contracts';
import { contextPolicy, isBusy } from '../shared/contracts';
import { Pet } from '../pet/renderer/Pet';
import { SkinSprite } from '../pet/renderer/SkinSprite';
import { BalanceBubble } from './BalanceBubble';
import type { Activity, AppSnapshot } from '../pet/shared/types';
import { validPetBehavior } from '../shared/pet-behavior';
import './styles.css';
import './chrome.css';
import './workbench040.css';
import './workbench060.css';
import './turn-memory.css';
const windowView = new URLSearchParams(location.search).get('view');
const view = windowView === 'pet' || windowView === 'bubble' ? windowView : 'workbench';
document.documentElement.dataset.view = view;
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.dataset.view = view;
import { TaskTree, CollaborationSettings } from './TaskTree';

const labels: Record<string, string> = { paused: '额度已用完，等待继续', idle: '待开始', running: '执行中', waiting: '等待你确认', stopping: '正在停止', completed: '已完成', cancelled: '已停止', error: '执行失败', interrupted: '上次任务中断' };
/** 刚完成/刚出错的动画窗口：只在这段时间内把会话状态当成一次性动作。 */
const SHOT_MS = 8_000;
/**
 * 桌宠窗口没有单独的运行时快照，状态从工作台快照推导：
 * 审批/提问优先，其次运行中（正在输出=说话），再是刚完成的一次性动作。
 */
function adapt(state: Snapshot): AppSnapshot {
  const scoped = state.sessions.find(s => s.id === state.petChat?.sessionId) ?? state.sessions.find(s => s.id === state.selectedSessionId) ?? state.sessions[0];
  const pending = scoped?.pending ?? [];
  const lastReply = scoped?.messages.filter(m => m.role === 'assistant').at(-1);
  const recent = scoped ? Date.now() - scoped.updatedAt < SHOT_MS : false;
  const activity: Activity =
    pending.some(r => r.kind === 'approval') ? 'awaiting-approval'
    : pending.some(r => r.kind === 'question') ? 'awaiting-input'
    : scoped && ['running', 'waiting', 'stopping'].includes(scoped.status) ? (scoped.status === 'running' && lastReply?.partial ? 'speaking' : 'thinking')
    : scoped?.status === 'completed' && recent ? 'success'
    : scoped?.status === 'error' && recent ? 'error'
    : state.sessions.some(isBusy) ? 'thinking'
    : 'idle';
  return { skin: state.skin, assistant: { activity, pending: scoped?.pending ?? [], quota: state.quota }, bubbleMode: state.petView === 'hidden' ? 'hidden' : 'quick', quickView: state.petView === 'reply' ? 'chat' : state.petView, direction: 'right', motion: 'idle', animationStartedAt: state.animationStartedAt, settings: {}, petBehavior: validPetBehavior(state.settings.pet.behavior), version: state.version } as unknown as AppSnapshot;
}
/** 只比较桌宠外观/行为真正读取的字段，正文 token 变化不再重渲染整个 Pet。 */
function samePetSnapshot(previous: { snapshot: AppSnapshot | null }, next: { snapshot: AppSnapshot | null }) {
  if (previous.snapshot === next.snapshot) return true;
  const before = previous.snapshot, after = next.snapshot;
  if (!before || !after) return false;
  return comparePetSnapshot(before, after);
}
function comparePetSnapshot(previous: AppSnapshot, next: AppSnapshot) {
  return previous.assistant.activity === next.assistant.activity
    && previous.motion === next.motion
    && previous.direction === next.direction
    && previous.animationStartedAt === next.animationStartedAt
    && previous.bubbleMode === next.bubbleMode
    && previous.quickView === next.quickView
    && previous.skin?.baseUrl === next.skin?.baseUrl
    && JSON.stringify(previous.skin?.manifest) === JSON.stringify(next.skin?.manifest)
    && JSON.stringify(previous.petBehavior) === JSON.stringify(next.petBehavior)
    && JSON.stringify(previous.rigPlayback) === JSON.stringify(next.rigPlayback);
}
const PetWindow = React.memo(Pet, samePetSnapshot);
function Text({ text }: { text: string }) { return <RichText text={text}/>; }
function Request({request,act}:{request:PendingRequest;act(a:Action):Promise<unknown>}) {return <ApprovalCard request={request} act={act}/>;}
function Conversation({ session, act, compact = false }: { session: AgentSession; act(a: Action): Promise<unknown>; compact?: boolean }) { return <Timeline session={session} act={act} compact={compact} renderRequest={r=><Request request={r} act={act} key={r.id}/>}/>; }
function ProfileEditor({ profile, act, close }: { profile?: ModelProfile; act(a: Action): Promise<unknown>; close(): void }) {
  const [p, setP] = useState<ModelProfile>(profile ?? { id: crypto.randomUUID(), name: '我的 DeepSeek', provider: 'custom', protocol: 'openai-completions', baseUrl: 'https://api.deepseek.com', model: '', contextWindow: 524288, maxOutput: 32768, hasKey: false });
  const [key, setKey] = useState('');
  return <form className="editor" onSubmit={async e => { e.preventDefault(); const result = await act({ type: 'profile.save', profile: p, apiKey: key }); if (result !== undefined) close(); }}><h3>{profile ? '编辑模型连接' : '添加模型连接'}</h3><div className="form-grid"><label>配置名称<input required value={p.name} onChange={e => setP({ ...p, name: e.target.value })}/></label><label>接口格式<select value={p.protocol} onChange={e => setP({ ...p, protocol: e.target.value as ModelProfile['protocol'] })}><option value="openai-completions">OpenAI Chat Completions 兼容</option><option value="openai-responses">OpenAI Responses 兼容</option><option value="anthropic-messages">Anthropic Messages 兼容</option></select></label><label className="span2">API 地址<input required type="url" value={p.baseUrl} onChange={e => setP({ ...p, baseUrl: e.target.value })}/></label><label>模型 ID<input required placeholder="填写服务商实际提供的模型 ID" value={p.model} onChange={e => setP({ ...p, model: e.target.value })}/></label><label>API 密钥<input type="password" autoComplete="new-password" placeholder={p.hasKey ? '已安全保存，留空保留' : '输入 API Key'} value={key} onChange={e => setKey(e.target.value)}/></label><label>模型实际上下文上限（tokens）<input type="number" min="4096" step="1" required value={p.contextWindow} onChange={e => setP({ ...p, contextWindow: +e.target.value })}/></label><label>最大输出（tokens）<input type="number" min="1" step="1" required value={p.maxOutput} onChange={e => setP({ ...p, maxOutput: +e.target.value })}/></label></div><details><summary>自定义 Token 单价（每百万 Token）</summary><p className="hint">未设置时，官方 DeepSeek 使用已核验的峰谷价格；其他服务显示暂无单价。</p><label>启用自定义单价<input type="checkbox" checked={!!p.pricing} onChange={e=>setP({...p,pricing:e.target.checked?{currency:'USD',input:0,output:0}:undefined})}/></label>{p.pricing&&<div className="form-grid"><label>币种<input required pattern="[A-Z]{3}" value={p.pricing.currency} onChange={e=>setP({...p,pricing:{...p.pricing!,currency:e.target.value.toUpperCase()}})}/></label>{(['input','output','cacheRead'] as const).map(key=><label key={key}>{({input:'输入单价',output:'输出单价',cacheRead:'缓存读取单价（可留空）'})[key]}<input type="number" min="0" step="any" required={key!=='cacheRead'} value={p.pricing![key]??''} onChange={e=>setP({...p,pricing:{...p.pricing!,[key]:e.target.value===''?undefined:Number(e.target.value)}})}/></label>)}</div>}</details><label className="check"><input type="checkbox" checked={p.deepseekSearch!==false} onChange={e=>setP({...p,deepseekSearch:e.target.checked})}/>启用 DeepSeek 官方 Search / Fetch（仅官方 API 地址生效，复用此密钥）</label><p className="hint">DragonAgent 最多使用 524,288 tokens；模型较小则自动降低。密钥由 Windows 加密保存。</p><div className="actions"><button type="button" onClick={close}>取消</button><button className="primary">保存连接</button></div></form>;
}
function McpEditor({ server, act, close }: { server?: McpConfig; act(a: Action): Promise<unknown>; close(): void }) {
  const [s, setS] = useState<McpConfig>(server ?? { id: `mcp-${crypto.randomUUID().slice(0, 8)}`, name: '', transport: 'streamable-http', url: '', hasKey: false, enabled: true });
  const [key, setKey] = useState(''), [args, setArgs] = useState((s.args ?? []).join('\n'));
  return <form className="editor" onSubmit={async e => { e.preventDefault(); if (await act({ type: 'mcp.save', server: { ...s, args: args.split('\n').filter(Boolean) }, apiKey: key }) !== undefined) close(); }}><h3>MCP 连接</h3><div className="form-grid"><label>名称<input required value={s.name} onChange={e => setS({ ...s, name: e.target.value })}/></label><label>连接方式<select value={s.transport} onChange={e => setS({ ...s, transport: e.target.value as McpConfig['transport'] })}><option value="streamable-http">Streamable HTTP</option><option value="stdio">本地程序 stdio</option></select></label>{s.transport === 'streamable-http' ? <label className="span2">MCP 地址<input required type="url" value={s.url ?? ''} onChange={e => setS({ ...s, url: e.target.value })}/></label> : <><label className="span2">可执行文件<input required placeholder="如 C:\Tools\my-mcp.exe" value={s.command ?? ''} onChange={e => setS({ ...s, command: e.target.value })}/></label><label className="span2">启动参数（每行一个）<textarea value={args} onChange={e => setArgs(e.target.value)}/></label></>}<label className="span2">{s.transport === 'stdio' ? 'API_KEY 环境变量（可选）' : 'Bearer 密钥（可选）'}<input type="password" value={key} placeholder={s.hasKey ? '已保存，留空保留' : ''} onChange={e => setKey(e.target.value)}/></label></div><label className="check"><input type="checkbox" checked={s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked })}/>启用此连接</label><p className="hint">本地 MCP 程序按你的 Windows 账号权限运行。工具调用遵循当前对话的权限等级。</p><div className="actions"><button type="button" onClick={close}>取消</button><button className="primary">保存 MCP</button></div></form>;
}
function Settings({ state, page, act }: { state: Snapshot; page: string; act(a: Action): Promise<unknown> }) {
  const [profile, setProfile] = useState<ModelProfile | null | undefined>(), [server, setServer] = useState<McpConfig | null | undefined>(), [memory, setMemory] = useState(''), [exe, setExe] = useState(state.settings.codexPath);
  return <div className="settings-page"><div className="eyebrow">DRAGONAGENT / {page === 'mcp' ? 'CONNECTIONS' : page === 'memory' ? 'MEMORY' : 'PREFERENCES'}</div><h1>{page === 'mcp' ? '连接更大的世界' : page === 'memory' ? '值得记住的事' : '让龙娘准备就绪'}</h1><p className="subtitle">{page === 'mcp' ? '网页搜索、外部工具，都从这里接入。' : page === 'memory' ? '只有你明确保存的内容，才会成为长期记忆。' : '选择模型，调整外观，连接你的 Codex 账号。'}</p>
    {page === 'settings' && <><AssistantSettings settings={state.settings} act={act}/><AccountBalances state={state} act={act}/><CollaborationSettings limits={state.settings.limits} act={act}/><section className="settings-card"><div className="section-title"><h2>模型 API</h2><button onClick={() => setProfile(null)}><Icon name="plus" size={16}/>添加模型</button></div>{!state.settings.profiles.length && <p className="empty-note">添加第一个模型连接，即可开始使用 Dragon Agent。</p>}{state.settings.profiles.map(p => <div className="setting-row" key={p.id}><div className="setting-icon"><Icon name="spark"/></div><div className="grow"><strong>{p.name}</strong><p>{p.model} · {Math.round(contextPolicy(p).window / 1024)}K 上下文 · {p.hasKey ? '密钥已保存' : '未配置密钥'}</p></div><button onClick={() => setProfile(p)}>编辑</button><button className="plain danger" onClick={() => void act({ type: 'profile.delete', id: p.id })}>删除</button></div>)}{profile !== undefined && <ProfileEditor profile={profile ?? undefined} act={act} close={() => setProfile(undefined)}/>}</section><section className="settings-card"><div className="section-title"><h2>Codex 通道</h2><span className="tag">独立账号空间</span></div><p>{state.account} · {state.backends.codex.message}</p><label>Codex 程序路径（留空自动查找 0.160.1）<input value={exe} onChange={e => setExe(e.target.value)}/></label><div className="actions"><button onClick={() => void act({ type: 'settings.save', codexPath: exe })}>保存路径</button><button onClick={() => void act({ type: 'quota.refresh' })}>刷新额度</button><button className="primary" onClick={() => void act({ type: 'codex.login' })}>登录 Codex</button></div><QuotaBars quota={state.quota}/></section><section className="settings-card"><h2>龙娘与外观</h2><div className="setting-row"><div className="grow"><strong>桌面龙娘</strong><p>Ctrl + Alt + D 随时召唤或收起</p></div><button onClick={() => void act({ type: 'pet.toggle' })}>{state.settings.pet.visible ? '收起龙娘' : '召唤龙娘'}</button></div><label>桌宠对话视图<select value={state.settings.pet.chatMode ?? 'simple'} onChange={e => void act({ type: 'pet.chatMode', mode: e.target.value as 'simple' | 'detailed' })}><option value="simple">简约版 · 只保留输入</option><option value="detailed">详细版 · 对话与完整设置</option></select></label><label>龙娘大小 · {Math.round(state.settings.pet.scale * 100)}%<input type="range" min="0.5" max="1.6" step="0.1" value={state.settings.pet.scale} onChange={e => void act({ type: 'settings.save', pet: { scale: +e.target.value } })}/></label><label>主题<select value={state.settings.theme} onChange={e => void act({ type: 'settings.save', theme: e.target.value as 'light' | 'dark' | 'system' })}><option value="light">银白 · 高对比</option><option value="dark">月夜紫</option><option value="system">跟随系统</option></select></label><div className="setting-row accent-row"><div className="grow"><strong>配色</strong><p>切换主色调，深浅模式各自适配</p></div><div className="accent-picker">{[['violet', '雾紫'], ['teal', '青碧'], ['amber', '琥珀'], ['ink', '墨蓝']].map(([id, label]) => <button key={id} className={`accent-swatch ${id} ${(state.settings.accent ?? 'violet') === id ? 'active' : ''}`} title={label} aria-label={label} onClick={() => void act({ type: 'settings.save', accent: id as 'violet' | 'teal' | 'amber' | 'ink' })} />)}</div></div></section></>}
    {page === 'mcp' && <ToolCatalog state={state}/>}
    {page === 'mcp' && <section className="settings-card"><div className="section-title"><h2>MCP 服务器</h2><div className="actions"><button onClick={() => setServer({id:'github',name:'GitHub',transport:'streamable-http',url:'https://api.githubcopilot.com/mcp/',hasKey:false,enabled:true})}>连接 GitHub</button><button onClick={() => setServer(null)}>添加 MCP</button><button className="primary" onClick={() => void act({ type: 'mcp.connect' })}>连接已启用服务</button></div></div>{state.settings.mcp.map(s => { const status = state.mcp.find(m => m.id === s.id); return <div className="setting-row" key={s.id}><div className="setting-icon"><Icon name="link"/></div><div className="grow"><strong>{s.name}</strong><p>{s.enabled ? status?.state === 'connected' ? `已连接 · ${status.tools} 个工具` : status?.state === 'error' ? status.error : '待连接' : '未启用'} · {s.transport}</p></div><button onClick={() => setServer(s)}>配置</button><button className="plain danger" onClick={() => void act({ type: 'mcp.delete', id: s.id })}>删除</button></div>; })}{server !== undefined && <McpEditor server={server ?? undefined} act={act} close={() => setServer(undefined)}/>}<p className="hint">Tavily 用于网页搜索，需要填写你自己的 Tavily API Key 并启用。文件和独立 Chrome 浏览器工具已经内置。</p></section>}
    {page === 'memory' && <><section className="settings-card"><h2>添加记忆</h2><textarea placeholder="例如：默认使用 TypeScript，回复使用中文。" value={memory} onChange={e => setMemory(e.target.value)} rows={3}/><div className="actions"><button className="primary" disabled={!memory.trim()} onClick={async () => { await act({ type: 'memory.save', text: memory, tags: [] }); setMemory(''); }}>保存记忆</button></div><p className="hint">记忆在新会话首次发送时加入上下文。现有会话不会被悄悄改写。</p></section>{state.memory.map(m => <section className="settings-card memory-card" key={m.id}><Text text={m.text}/><button className="plain danger" onClick={() => void act({ type: 'memory.delete', id: m.id })}>删除记忆</button></section>)}<section className="settings-card"><h2>全部历史对话</h2><HistoryList sessions={state.sessions} selectedId={state.selectedSessionId} act={act} select={id => { void act({ type: 'session.select', id }); void act({ type: 'window.workbench', page: 'chat' }); }}/>{!state.sessions.length && <p className="hint">还没有历史对话。</p>}</section><section className="settings-card"><h2>Legacy 历史</h2><p className="hint">从旧项目的 SQLite 数据库只读导入对话与记忆。导入不会执行历史工具，也不会读取旧项目的密钥。</p><button onClick={async () => { const r = await act({ type: 'legacy.import' }) as any; if (r) alert(`已导入 ${r.sessions} 段对话、${r.memory} 条记忆。`); }}>选择数据库并导入</button></section></>}
  </div>;
}
function Workbench({ state, act }: { state: Snapshot; act(a: Action): Promise<unknown> }) {
  const [page, setPage] = useState('chat'), [permissions, setPermissions] = useState(false), [origins, setOrigins] = useState('');
  const backend = state.settings.selectedBackend ?? 'dragon', profile = state.settings.selectedProfile;
  const s = state.sessions.find(v => v.id === state.selectedSessionId);
  useEffect(() => { if (state.workbenchPage) setPage(state.workbenchPage); }, [state.workbenchPageRevision]);
  const create = async (text?: string) => { const id = await act({ type: 'session.create', backend, profileId: profile }); if (typeof id === 'string' && text) await act({ type: 'session.draft', id, text }); setPage('chat'); };
  return <div className={`app-shell ${state.settings.layout?.leftCollapsed ? 'left-collapsed' : ''} ${state.settings.layout?.rightCollapsed !== false ? 'right-collapsed' : ''}${state.settings.wallpaper ? ' has-wallpaper' : ''}`}>{state.settings.wallpaper && <div className="wallpaper-layer" style={{ backgroundImage: 'url(' + wallpaperUrl(state.settings.wallpaper.file) + ')', opacity: 'var(--wallpaper-opacity)', filter: 'blur(var(--wallpaper-blur))' }}><i style={{ opacity: 'var(--wallpaper-dim)' }}/></div>}<div className="app-chrome"><button className="plain sidebar-toggle" aria-label={state.settings.layout?.leftCollapsed?'展开导航':'收起导航'} title="切换导航栏" onClick={()=>void act({type:'layout.save',leftCollapsed:!state.settings.layout?.leftCollapsed})}>☰</button><span className="chrome-name">DragonAgent</span></div><aside className="sidebar"><div className="brand"><img className="brand-avatar" src={avatar} alt="霜璃头像"/><div>DragonAgent<small>你的龙娘工作台</small></div></div><button className="new-chat" onClick={() => void create()}><Icon name="plus" size={18}/>新的对话<span>＋</span></button><div className="nav-label">工作空间</div><nav>{[['chat', 'chat', '对话与任务'], ['illustration', 'spark', '角色插画'], ['workshop', 'film', '外观工坊'], ['mcp', 'link', '工具连接'], ['memory', 'book', '记忆与历史']].map(([id, icon, title]) => <button className={page === id ? 'active' : ''} key={id} title={title} aria-label={title} onClick={() => setPage(id)}><Icon name={icon} size={18}/>{title}{id === 'mcp' && <span className="nav-count">{state.mcp.filter(m => m.state === 'connected').length}</span>}</button>)}</nav><div className="nav-label history-label">最近对话<span>{state.sessions.filter(s => !s.archived).length}</span></div><div className="history"><HistoryList sessions={state.sessions.filter(s => !s.archived)} selectedId={page === 'chat' ? s?.id : null} select={id => { void act({ type: 'session.select', id }); setPage('chat'); }} act={act} compact/>{!state.sessions.some(s => !s.archived) && <p className="history-empty">从第一段对话开始。</p>}</div><div className="sidebar-bottom"><button className={page === 'settings' ? 'active' : ''} title="设置" aria-label="设置" onClick={() => setPage('settings')}><Icon name="settings" size={20}/>设置</button><div className="runtime-state"><i className={state.backends.dragon.state === 'ready' ? 'online' : ''}/><span>{state.backends.dragon.state === 'ready' ? 'Dragon 已就绪' : '本地工作空间'}</span><small>v{state.version}</small></div></div></aside>
    <div className="main-area"><header className="topbar"><div><span className="breadcrumb">DragonAgent</span><span className="slash">/</span><strong>{page === 'chat' ? s?.title ?? '开始新的一天' : page === 'illustration' ? '角色插画' : page === 'workshop' ? '外观工坊' : page === 'mcp' ? '工具连接' : page === 'memory' ? '记忆与历史' : '设置'}</strong></div><button className="plain sidebar-toggle" aria-label={state.settings.layout?.rightCollapsed!==false?'展开侧栏':'收起侧栏'} title="切换右侧栏" onClick={()=>void act({type:'layout.save',rightCollapsed:state.settings.layout?.rightCollapsed===false})}>◧</button><button className={`summon ${state.settings.pet.visible ? 'selected' : ''}`} onClick={() => void act({ type: 'pet.toggle' })}><Icon name="spark" size={16}/>{state.settings.pet.visible ? '龙娘已在桌面' : '召唤龙娘'}<kbd>Ctrl Alt D</kbd></button></header>
      {page === 'illustration' ? <Illustration state={state} act={act} /> : page === 'workshop' ? <StudioPage state={state} act={act} /> : page !== 'chat' ? <Settings state={state} page={page} act={act} /> : !s ? <div className="welcome"><div className="welcome-art">{state.skin && <SkinSprite skin={state.skin} animationKey="idle" startedAt={state.animationStartedAt} width={270} height={280} />}<span className="orbit one">✦</span><span className="orbit two">✧</span></div><div className="eyebrow">A LITTLE MAGIC, REAL WORK.</div><h1>今天，想一起完成什么？</h1><p>从一个想法开始。查找资料、整理文件，或让龙娘陪你写点代码。</p><div className="starter-grid">{[['link', '探索一个问题', '搜索网页，梳理资料与来源', '帮我搜索并整理一个主题的资料：'], ['folder', '整理我的工作', '从选定文件夹开始，逐步完成', '帮我整理工作文件夹，先提出一个方案：'], ['spark', '一起创造点什么', '把想法变成代码或一份文档', '我想用 TypeScript 做一个项目：']].map(([icon, title, caption, text]) => <button className="starter" key={title} onClick={() => void create(text)}><Icon name={icon} /><strong>{title}</strong><span>{caption}</span><b>↗</b></button>)}</div><button className="primary start-button" onClick={() => void create()}>开始对话<span>→</span></button><div className="welcome-foot">一份任务 · 两种陪伴方式 · 对话保存在本机</div></div> : <div className="workspace"><div className="chat-column"><div className="session-bar"><span className="tag">{s.backend === 'dragon' ? 'Dragon 自研内核' : 'Codex'}</span><span>{s.backend === 'codex' ? `${s.model ?? '账号默认模型'}${s.reasoningEffort ? ' · ' + s.reasoningEffort : ''}` : state.settings.profiles.find(p => p.id === s.profileId)?.model ?? '未配置模型'}</span><span className={`status ${s.status}`}>{labels[s.status]}</span><button className="plain" onClick={() => { setOrigins(s.origins.join('\n')); setPermissions(!permissions); }}>权限与目录</button></div>{permissions && <div className="permission-panel"><div className="section-title"><strong>本会话权限</strong><button className="plain" onClick={() => setPermissions(false)}>关闭</button></div><p className="hint">{s.workspace || '尚未选择文件夹'}</p><button onClick={() => void act({ type: 'session.workspace', id: s.id })}>选择工作文件夹</button><label>允许访问的网站（每行一个）<textarea rows={2} value={origins} onChange={e => setOrigins(e.target.value)} /></label><label className="check"><input type="checkbox" checked={s.browserInput} disabled={isBusy(s)} onChange={e => void act({ type: 'session.permissions', id: s.id, origins: origins.split('\n').filter(Boolean), browserInput: e.target.checked, terminalEnabled: s.terminalEnabled })} />允许在获准网站填写内容</label><label className="check"><input type="checkbox" checked={s.terminalEnabled} disabled={isBusy(s)} onChange={e => void act({ type: 'session.permissions', id: s.id, origins: origins.split('\n').filter(Boolean), browserInput: s.browserInput, terminalEnabled: e.target.checked })} />启用命令执行（按当前权限等级审批）</label><button disabled={isBusy(s)} onClick={() => void act({ type: 'session.permissions', id: s.id, origins: origins.split('\n').filter(Boolean), browserInput: s.browserInput, terminalEnabled: s.terminalEnabled })}>保存网站范围</button></div>}{s.messages.length ? <Conversation session={s} act={act} /> : <div className="empty-chat"><Icon name="spark" size={28} /><h2>龙娘准备好了</h2><p>说说你想做的事。需要文件时，可先选择工作文件夹。</p></div>}
        <div className="composer-wrap" data-session-id={s.id}>
                <Composer
          session={s}
          sessions={state.sessions}
          profiles={state.settings.profiles}
          catalog={state.codexCatalog}
          act={act}
        />

        <ContextStatsBar
          session={s}
          profiles={state.settings.profiles}
          act={act}
        />
        </div>
      </div><aside className="inspector"><ResultPanel state={state} session={s} act={act} /></aside></div>}
    </div></div>;
}
function PetBubble({ state, act }: { state: Snapshot; act(action: Action): Promise<unknown> }) {
  const quota = state.petView === 'quota';
  const simple = !quota && state.settings.pet.chatMode !== 'detailed';
  const layout = simple ? state.compactBubbleLayout : undefined;
  const body = layout?.body;
  const contentStyle = layout && body ? {
    left: `${body.x / layout.width * 100}%`, top: `${body.y / layout.height * 100}%`,
    width: `${body.width / layout.width * 100}%`, height: `${body.height / layout.height * 100}%`,
  } : undefined;
  return <div className={`bubble-shell${simple ? ' simple-bubble' : ''}${layout ? ' compact-bubble' : ''}`} data-tail-edge={layout?.tailEdge}>
    {layout && <svg className="compact-bubble-outline" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={layout.outline} strokeWidth="3" strokeLinejoin="round" />
    </svg>}
    {quota ? <BalanceBubble state={state} act={act}/> : <div className="bubble-chat-body" style={contentStyle}><BubbleChat state={state} act={act}/></div>}
  </div>;
}
function App() {
  const [state, setState] = useState<Snapshot | null>(null), [error, setError] = useState('');
  const kind = view;
  useEffect(()=>{if(kind!=='bubble')return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void window.dragon.action({type:'pet.view',view:'hidden'});}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
  useEffect(() => { document.body.dataset.view = kind; let revision = -1; const update = (value: Snapshot) => { if (value.revision >= revision) { revision = value.revision; setState(value); } }; const off = window.dragon.subscribe(update); void window.dragon.snapshot().then(update).catch(e => setError(e.message)); return off; }, []);
  useEffect(() => { if (state) document.documentElement.dataset.theme = state.resolvedTheme; }, [state?.resolvedTheme]);
  useEffect(()=>{if(!state)return;applyAppearance(state.settings.appearance??{},state.settings.wallpaper);const preview=(event:Event)=>{const detail=(event as CustomEvent).detail;applyAppearance(detail.values,detail.wallpaper);};window.addEventListener('appearance-preview',preview);return()=>window.removeEventListener('appearance-preview',preview);},[state?.settings.appearance,state?.settings.wallpaper]);
  useEffect(() => { if (state) document.documentElement.dataset.accent = state.settings.accent ?? 'violet'; }, [state?.settings.accent]);
  // 稳定 act 身份，让历史消息里的 RichText 可以跳过重复的 Markdown 解析。
  const act = useCallback(async (action: Action) => { try { const result = await window.dragon.action(action); setError(''); return result; } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return undefined; } }, []);
  if (!state) return <div className="loading">{error || '龙娘正在准备工作空间…'}</div>;
  const s = state.sessions.find(s => s.id === (kind === 'bubble' ? state.petChat?.sessionId : state.selectedSessionId));
  if (kind === 'pet') return <PetWindow snapshot={adapt(state)}/>;
  return <>{kind === 'bubble' ? <PetBubble state={state} act={act}/> : <Workbench state={state} act={act}/ >}{error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}</>;
}
// Files dropped outside the composer must not navigate this window away.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
createRoot(document.getElementById('root')!).render(<App/>);

import './bubble040.css';
import './pet-bubble.css';

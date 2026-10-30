import React, { useEffect, useState } from 'react';
import type { Action, AgentSession, ModelProfile, PermissionMode, CodexCatalog } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { Icon } from './Icons';
import { Popover } from './Popover';
import { ModelPicker, ReasoningPicker, codexLabel, effortLabel } from './ModelPicker';

const modes: { id: PermissionMode; name: string; icon: string; help: string }[] = [
  { id: 'ask', name: '全请求批准', icon: 'shield', help: '工具读取、文件操作和命令均请求确认。' },
  { id: 'auto', name: '帮我批准', icon: 'auto', help: '自动批准工具与命令。文件和浏览器工具遵循授权范围；命令以当前系统账号权限运行。' },
  { id: 'full', name: '完全放开', icon: 'unlock', help: '自动批准，允许访问其他目录和网站；命令以当前系统账号权限运行。' },
];
type Menu = { kind: 'add' | 'history' | 'permissions' | 'model' | 'reasoning'; anchor: HTMLElement };
export function Composer({ session, sessions, profiles, catalog, act, small = false, simple = false, details }: {
  session: AgentSession; sessions: AgentSession[]; profiles: ModelProfile[]; catalog: CodexCatalog; act(a: Action): Promise<unknown>; small?: boolean; simple?: boolean; details?(): void;
}) {
  const [value, setValue] = useState(session.draft), [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null), [search, setSearch] = useState(''), [adding, setAdding] = useState(false);
  useEffect(() => { setValue(session.draft); }, [session.id, session.draft]);
  useEffect(() => { setMenu(null); setSearch(''); }, [session.id]);
  useEffect(() => { if (simple) setMenu(null); }, [simple]);
  const busy = isBusy(session), attachments = session.draftAttachments ?? [], mode = modes.find(m => m.id === (session.permissionMode ?? 'ask'))!;
  useEffect(() => { if (busy) setMenu(null); }, [busy]);
  const profile = profiles.find(p => p.id === session.profileId);
  const modelName = session.backend === 'codex' ? codexLabel(session, catalog) : profile?.name ?? '选择模型';
  const toggle = (kind: Menu['kind'], anchor: HTMLElement) => setMenu(menu?.kind === kind ? null : { kind, anchor });
  const close = () => { const anchor = menu?.anchor; setMenu(null); anchor?.focus(); };
  const send = async () => { if ((!value.trim() && !attachments.length) || sending || busy || adding) return; setSending(true); try { await act({ type: 'session.send', id: session.id, text: value, commandId: crypto.randomUUID() }); } finally { setSending(false); } };
  const add = async (action: Action) => { close(); setAdding(true); try { await act(action); } finally { setAdding(false); } };
  if (session.readOnly) return <div className="history-readonly"><p>{session.sourceEngine === 'dsh' ? 'DSH' : 'Legacy'} 只读历史 · 原始状态不会继续执行。</p><button className="primary" onClick={() => void act({ type: 'session.create', backend: 'dragon', carryFrom: session.id })}>审核摘录并继续新会话</button></div>;
  return <div className={`composer ${small ? 'small' : ''} ${simple ? 'simple-composer' : ''}`}>
    {!simple && !!attachments.length && <div className="attachment-strip">{attachments.map(a => <span className={`attachment-chip ${a.extractionError ? 'invalid' : ''}`} key={a.id} title={a.extractionError ?? `${a.name} · ${(a.size / 1024).toFixed(1)} KB`}><Icon name={a.kind === 'chat' ? 'link' : 'file'} size={14}/><span>{a.name}</span><button aria-label={`移除 ${a.name}`} disabled={busy || adding} onClick={() => void act({ type: 'session.removeAttachment', id: session.id, attachmentId: a.id })}><Icon name="close" size={12}/></button></span>)}</div>}
    <textarea aria-label="发送给龙娘的消息" placeholder={busy ? '霜璃正在处理任务…' : session.status === 'paused' ? '输入继续或补充要求…' : '把想法交给我吧，尾巴已经准备好跟上了…'} value={value} rows={small ? 2 : 3} onChange={e => { setValue(e.target.value); void act({ type: 'session.draft', id: session.id, text: e.target.value }); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }}/>
    <div className="composer-bottom">{!simple && <div className="composer-tools">
      <button className="composer-control plus-button" aria-label="添加文件或关联聊天" title="添加文件或关联聊天" aria-haspopup="menu" aria-expanded={menu?.kind === 'add' || menu?.kind === 'history'} disabled={busy || adding} onClick={e => toggle('add', e.currentTarget)}>{adding ? '…' : <Icon name="plus" size={21}/>}</button>
      <button className={`composer-control permission-trigger ${mode.id}`} aria-label="当前对话权限等级" aria-haspopup="menu" aria-expanded={menu?.kind === 'permissions'} data-mode={mode.id} disabled={busy || adding} onClick={e => toggle('permissions', e.currentTarget)}><Icon name={mode.icon} size={16}/><span>{mode.name}</span><Icon name="chevron" size={13}/></button>
      <button className="composer-control folder-chip" disabled={busy || adding} title={session.workspace || '选择工作文件夹'} aria-label={session.workspace ? `工作目录：${session.workspace}` : '选择工作文件夹'} onClick={() => void act({ type: 'session.workspace', id: session.id })}><Icon name="folder" size={16}/><span>{session.workspace?.split(/[\\/]/).pop() || '选择工作文件夹'}</span></button>
    </div>}{simple && !!attachments.length && <button className="simple-attachments" onClick={details}>{attachments.length} 份附件</button>}<div className="composer-send">
      {!simple && <button className={`composer-control model-trigger ${session.backend}`} aria-label="当前对话模型" aria-haspopup="menu" aria-expanded={menu?.kind === 'model'} title={session.backend === 'codex' ? `${modelName} · ${session.reasoningEffort ?? '默认推理强度'}` : profile ? `${profile.name} · ${profile.model}` : '选择模型'} disabled={busy || adding} onClick={e => toggle('model', e.currentTarget)}><Icon name={session.backend === 'codex' ? 'model' : 'spark'} size={15}/><span>{modelName}</span><Icon name="chevron" size={13}/></button>}
      {!simple && session.backend === 'codex' && <button className="composer-control reasoning-trigger" aria-label="选择推理强度" title={`推理强度：${effortLabel(session.reasoningEffort)}`} aria-haspopup="dialog" aria-expanded={menu?.kind === 'reasoning'} disabled={busy || adding} onClick={e => toggle('reasoning', e.currentTarget)}><Icon name="lightning" size={14}/><span>{effortLabel(session.reasoningEffort)}</span><Icon name="chevron" size={12}/></button>}
      {busy ? <button className="send stop" aria-label="停止任务" title="停止任务" onClick={() => void act({ type: 'session.stop', id: session.id })}><Icon name="stop" size={20}/></button> : <button className="send" aria-label="发送消息" title="发送消息 · Enter 发送，Shift+Enter 换行" disabled={(!value.trim() && !attachments.length) || sending || adding || (session.backend === 'dragon' && !profile)} onClick={() => void send()}><Icon name="arrow" size={21}/></button>}
    </div></div>
    {menu && <Popover key={menu.kind} anchor={menu.anchor} close={() => setMenu(null)} align={['model', 'reasoning'].includes(menu.kind) ? 'end' : 'start'} label={menu.kind === 'reasoning' ? '推理强度' : menu.kind === 'permissions' ? '权限等级' : menu.kind === 'model' ? '选择对话模型' : menu.kind === 'history' ? '关联聊天记录' : '添加资料'} width={menu.kind === 'reasoning' ? 260 : menu.kind === 'add' ? 224 : menu.kind === 'model' ? 350 : 330} dialog={['history', 'model', 'reasoning'].includes(menu.kind)}>
      {menu.kind === 'add' && <><div className="menu-heading">添加到这次对话</div><button className="menu-action" role="menuitem" onClick={() => void add({ type: 'session.attachFiles', id: session.id })}><Icon name="file" size={18}/>上传文件</button><button className="menu-action" role="menuitem" onClick={() => setMenu({ ...menu, kind: 'history' })}><Icon name="link" size={18}/>关联聊天记录</button></>}
      {menu.kind === 'history' && <><div className="menu-dialog-heading"><strong>关联聊天记录</strong><button aria-label="关闭聊天选择" onClick={close}><Icon name="close" size={16}/></button></div><input className="chat-search" aria-label="查找聊天" placeholder="搜索聊天标题…" value={search} onChange={e => setSearch(e.target.value)}/><div className="chat-picker-list">{sessions.filter(s => s.id !== session.id && s.title.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} onClick={() => void add({ type: 'session.attachChat', id: session.id, sourceId: s.id })}><span>{s.title}</span><small>{s.messages.length} 条消息</small></button>)}</div><p className="menu-footnote">加入文字快照，原聊天不会改变。</p></>}
      {menu.kind === 'permissions' && <><div className="menu-heading">对话权限</div>{modes.map(m => <button key={m.id} role="menuitemradio" aria-checked={mode.id === m.id} className={`menu-option ${m.id} ${mode.id === m.id ? 'selected' : ''}`} onClick={() => { close(); void act({ type: 'session.permissionMode', id: session.id, mode: m.id }); }}><span className="menu-option-icon"><Icon name={m.icon} size={19}/></span><span className="menu-option-copy"><strong>{m.name}</strong><small>{m.help}</small></span><span className="menu-check">{mode.id === m.id && <Icon name="check" size={16}/>}</span></button>)}</>}
      {menu.kind === 'reasoning' && <ReasoningPicker session={session} catalog={catalog} act={act} openModels={() => setMenu({ ...menu, kind: 'model' })}/>}
      {menu.kind === 'model' && <ModelPicker session={session} profiles={profiles} catalog={catalog} act={act} close={close}/>}
    </Popover>}
  </div>;
}

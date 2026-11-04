import React, { useEffect, useRef, useState } from 'react';
import type { Action, AgentSession, DroppedFile, ModelProfile, PermissionMode, CodexCatalog } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { Icon } from './Icons';
import { Popover } from './Popover';
import { ModelPicker, ReasoningPicker, codexLabel, effortLabel } from './ModelPicker';

const modes: { id: PermissionMode; name: string; icon: string; help: string }[] = [
  { id: 'ask', name: '全请求批准', icon: 'shield', help: '工具读取、文件操作和命令均请求确认。' },
  { id: 'auto', name: '帮我批准', icon: 'auto', help: '自动批准工具与命令。文件和浏览器工具遵循授权范围；命令以当前系统账号权限运行。' },
  { id: 'full', name: '完全放开', icon: 'unlock', help: '自动批准，允许访问其他目录和网站；命令以当前系统账号权限运行。' },
];
const MAX_DROP = 32 * 1024 * 1024;
type Menu = { kind: 'add' | 'history' | 'permissions' | 'model' | 'reasoning'; anchor: HTMLElement };
export function Composer({ session, sessions, profiles, catalog, act, small = false, simple = false, details }: {
  session: AgentSession; sessions: AgentSession[]; profiles: ModelProfile[]; catalog: CodexCatalog; act(a: Action): Promise<unknown>; small?: boolean; simple?: boolean; details?(): void;
}) {
  const [value, setValue] = useState(session.draft), [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null), [search, setSearch] = useState(''), [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false), [dropError, setDropError] = useState('');
  const dragDepth = useRef(0);
  // A drag that leaves the window or is cancelled must never leave the hint stuck on screen.
  useEffect(() => {
    if (!dragging) return;
    const clear = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener('drop', clear); window.addEventListener('dragend', clear); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('drop', clear); window.removeEventListener('dragend', clear); window.removeEventListener('blur', clear); };
  }, [dragging]);  useEffect(() => { setValue(session.draft); }, [session.id, session.draft]);
  useEffect(() => { setMenu(null); setSearch(''); }, [session.id]);
  useEffect(() => { if (simple) setMenu(null); }, [simple]);
  const busy = isBusy(session), attachments = session.draftAttachments ?? [], mode = modes.find(m => m.id === (session.permissionMode ?? 'ask'))!;
  useEffect(() => { if (busy) setMenu(null); }, [busy]);
  const profile = profiles.find(p => p.id === session.profileId);
  const modelName = session.collaboration?.enabled ? `GPT + ${profile?.name??'DeepSeek'}` : session.backend === 'codex' ? codexLabel(session, catalog) : profile?.name ?? '选择模型';
  const toggle = (kind: Menu['kind'], anchor: HTMLElement) => setMenu(menu?.kind === kind ? null : { kind, anchor });
  const close = () => { const anchor = menu?.anchor; setMenu(null); anchor?.focus(); };
  const send = async () => { if ((!value.trim() && !attachments.length) || sending || busy || adding) return; setSending(true); try { await act({ type: 'session.send', id: session.id, text: value, commandId: crypto.randomUUID() }); } finally { setSending(false); } };
  const add = async (action: Action) => { close(); setAdding(true); try { await act(action); } finally { setAdding(false); } };
  // Dropped and pasted files may live only in this window, so fall back to bytes when there is no real path.
  const ingest = async (files: File[]) => {
    if (!files.length || busy || adding) return;
    const dropped: DroppedFile[] = [], rejected: string[] = [];
    if (files.length > 10) rejected.push('一次最多添加 10 份附件，多出的已忽略');
    for (const file of files.slice(0, 10)) {
      if (file.size > MAX_DROP) { rejected.push(`${file.name || '这个文件'} 超过 32 MB`); continue; }
      const location = window.dragon.filePath?.(file) ?? '';
      if (location) { dropped.push({ path: location, name: file.name }); continue; }
      try { dropped.push({ name: file.name || '粘贴的图片', mime: file.type, data: new Uint8Array(await file.arrayBuffer()) }); }
      catch { rejected.push(`${file.name || '这个文件'} 读取失败`); }
    }
    setDropError(rejected.join('；'));
    if (!dropped.length) return;
    setAdding(true);
    try { await act({ type: 'session.attachDrop', id: session.id, files: dropped }); } finally { setAdding(false); }
  };
  const holdingFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers: React.DOMAttributes<HTMLDivElement> = {
    onDragEnter: e => { if (!holdingFiles(e) || busy || adding) return; e.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragOver: e => { if (!holdingFiles(e) || busy || adding) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: e => { if (!holdingFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); void ingest(Array.from(e.dataTransfer.files)); },
    onPaste: e => { const files = Array.from(e.clipboardData?.files ?? []); if (!files.length) return; e.preventDefault(); void ingest(files); },
  };
  if (session.readOnly) return <div className="history-readonly"><p>{session.sourceEngine === 'dsh' ? 'DSH' : 'Legacy'} 只读历史 · 原始状态不会继续执行。</p><button className="primary" onClick={() => void act({ type: 'session.create', backend: 'dragon', carryFrom: session.id })}>审核摘录并继续新会话</button></div>;
  return <div className={`composer ${small ? 'small' : ''} ${simple ? 'simple-composer' : ''} ${dragging ? 'dragging' : ''}`} {...dropHandlers}>
    {dragging && <div className="drop-overlay"><Icon name="image" size={26}/><strong>松开就把图片交给龙娘</strong><span>图片、PDF、文本和代码文件都可以</span></div>}
    {!!dropError && <div className="composer-drop-error" role="alert"><span>{dropError}</span><button aria-label="关闭提示" onClick={() => setDropError('')}><Icon name="close" size={12}/></button></div>}
    {!simple && !!attachments.length && <div className="attachment-strip">{attachments.map(a => <span className={`attachment-chip ${a.extractionError ? 'invalid' : ''}`} key={a.id} title={a.extractionError ?? `${a.name} · ${(a.size / 1024).toFixed(1)} KB`}><Icon name={a.kind === 'chat' ? 'link' : a.mime?.startsWith('image/') ? 'image' : 'file'} size={14}/><span>{a.name}</span><button aria-label={`移除 ${a.name}`} disabled={busy || adding} onClick={() => void act({ type: 'session.removeAttachment', id: session.id, attachmentId: a.id })}><Icon name="close" size={12}/></button></span>)}</div>}
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
    {menu && <Popover key={menu.kind} anchor={menu.anchor} close={() => setMenu(null)} align={['model', 'reasoning'].includes(menu.kind) ? 'end' : 'start'} label={menu.kind === 'reasoning' ? '推理强度' : menu.kind === 'permissions' ? '权限等级' : menu.kind === 'model' ? '选择对话模型' : menu.kind === 'history' ? '关联聊天记录' : '添加资料'} width={menu.kind === 'reasoning' ? 260 : menu.kind === 'add' ? 248 : menu.kind === 'model' ? 350 : 330} dialog={['history', 'model', 'reasoning'].includes(menu.kind)}>
      {menu.kind === 'add' && <><div className="menu-heading">添加到这次对话</div><button className="menu-action" role="menuitem" onClick={() => void add({ type: 'session.attachFiles', id: session.id })}><Icon name="image" size={18}/>上传图片或文件</button><button className="menu-action" role="menuitem" onClick={() => setMenu({ ...menu, kind: 'history' })}><Icon name="link" size={18}/>关联聊天记录</button><p className="menu-footnote">也可以把图片或文件直接拖进输入框，或 Ctrl+V 粘贴。</p></>}
      {menu.kind === 'history' && <><div className="menu-dialog-heading"><strong>关联聊天记录</strong><button aria-label="关闭聊天选择" onClick={close}><Icon name="close" size={16}/></button></div><input className="chat-search" aria-label="查找聊天" placeholder="搜索聊天标题…" value={search} onChange={e => setSearch(e.target.value)}/><div className="chat-picker-list">{sessions.filter(s => s.id !== session.id && s.title.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} onClick={() => void add({ type: 'session.attachChat', id: session.id, sourceId: s.id })}><span>{s.title}</span><small>{s.messages.length} 条消息</small></button>)}</div><p className="menu-footnote">加入文字快照，原聊天不会改变。</p></>}
      {menu.kind === 'permissions' && <><div className="menu-heading">对话权限</div>{modes.map(m => <button key={m.id} role="menuitemradio" aria-checked={mode.id === m.id} className={`menu-option ${m.id} ${mode.id === m.id ? 'selected' : ''}`} onClick={() => { close(); void act({ type: 'session.permissionMode', id: session.id, mode: m.id }); }}><span className="menu-option-icon"><Icon name={m.icon} size={19}/></span><span className="menu-option-copy"><strong>{m.name}</strong><small>{m.help}</small></span><span className="menu-check">{mode.id === m.id && <Icon name="check" size={16}/>}</span></button>)}</>}
      {menu.kind === 'reasoning' && <ReasoningPicker session={session} catalog={catalog} act={act} openModels={() => setMenu({ ...menu, kind: 'model' })}/>}
      {menu.kind === 'model' && <ModelPicker session={session} profiles={profiles} catalog={catalog} act={act} close={close}/>}
    </Popover>}
  </div>;
}

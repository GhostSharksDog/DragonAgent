import React, { useEffect, useRef, useState } from 'react';
import type { Action, AgentSession } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { Icon } from './Icons';

export function HistoryList({ sessions, selectedId, select, act, compact = false }: {
  sessions: AgentSession[]; selectedId?: string | null; select(id: string): void; act(a: Action): Promise<unknown>; compact?: boolean;
}) {
  const [deleting, setDeleting] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  const target = sessions.find(s => s.id === deleting);
  useEffect(() => {
    if (target) dialog.current?.showModal();
    else { dialog.current?.close(); opener.current?.focus(); }
  }, [target?.id]);
  const cancel = () => { if (!saving) setDeleting(null); };
  return <>
    <div className={compact ? 'history-list compact' : 'history-list'}>{sessions.map(session => <div key={session.id} className={`history-row ${selectedId === session.id ? 'selected' : ''}`}>
      <button className="history-open" title={session.title} onClick={() => select(session.id)}><span className={`session-dot ${isBusy(session) ? 'busy' : ''}`}/><span>{session.title}</span><small>{session.archived ? '已归档' : session.backend === 'dragon' ? 'D' : 'C'}</small></button>
      <button className="history-delete" aria-label={`删除对话：${session.title}`} title={isBusy(session) ? '请先停止任务再删除' : '删除对话'} disabled={isBusy(session)} onClick={e => { opener.current = e.currentTarget; setDeleting(session.id); }}><Icon name="trash" size={15}/></button>
    </div>)}</div>
    <dialog className="delete-dialog" ref={dialog} aria-labelledby="delete-chat-title" onCancel={e => { e.preventDefault(); cancel(); }} onClick={e => { if (e.target === dialog.current) cancel(); }}>
      <div><span className="delete-emblem"><Icon name="trash" size={23}/></span><h2 id="delete-chat-title">删除这段对话？</h2><p className="delete-chat-name">{target?.title}</p><p>删除 DragonAgent 中的对话、任务记录和本地附件副本，无法撤销。工作文件、已保存的记忆、其他对话中的摘录与 Codex 原生历史保留。</p><div className="actions"><button autoFocus disabled={saving} onClick={cancel}>取消</button><button className="delete-confirm" disabled={saving || !target || isBusy(target)} onClick={async () => { if (!target) return; setSaving(true); try { if (await act({ type: 'session.delete', id: target.id }) !== undefined) setDeleting(null); } finally { setSaving(false); } }}>{saving ? '正在删除…' : '确认删除'}</button></div></div>
    </dialog>
  </>;
}

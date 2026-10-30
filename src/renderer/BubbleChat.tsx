import React, { useEffect, useState } from 'react';
import type { Action, Snapshot, AgentSession } from '../shared/contracts';
import { Composer } from './ComposerControls';
import { Icon } from './Icons';

export function BubbleChat({ state, session, status, conversation, act }: { state: Snapshot; session?: AgentSession; status: string; conversation: React.ReactNode; act(a: Action): Promise<unknown> }) {
  const simple = state.settings.pet.chatMode !== 'detailed';
  const detailed = () => void act({ type: 'pet.chatMode', mode: 'detailed' });
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false);
  useEffect(() => { if (session) setDraft(''); }, [session?.id]);
  const start = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const id = await act({ type: 'session.create', backend: state.settings.selectedBackend ?? 'dragon', profileId: state.settings.selectedProfile });
      if (typeof id === 'string') { await act({ type: 'session.draft', id, text: draft }); await act({ type: 'session.send', id, text: draft, commandId: crypto.randomUUID() }); }
    } finally { setSending(false); }
  };
  return <>
    <header className="bubble-header"><span><Icon name="spark" size={16}/>{simple && session?.pending.length ? <button className="bubble-attention" onClick={detailed}>{session.pending.length} 项待确认</button> : simple && (session?.messages.length || session?.error) ? <button className="bubble-status" onClick={detailed} title="展开详细对话">{session.error ? '查看错误' : status === '已完成' ? '查看回复' : status}<Icon name="chevron" size={12}/></button> : `霜璃 · ${session ? status : '我在这里'}`}</span><div className="bubble-header-actions"><button className="bubble-mode" aria-label={simple ? '切换到详细版' : '切换到简约版'} title={simple ? '查看对话、附件与模型设置' : '只保留输入框'} onClick={() => void act({ type: 'pet.chatMode', mode: simple ? 'detailed' : 'simple' })}><Icon name={simple ? 'expand' : 'collapse'} size={14}/>{simple ? '详细' : '简约'}</button><button className="plain" aria-label="打开完整工作台" title="打开完整工作台" onClick={() => void act({ type: 'window.workbench' })}><Icon name="external" size={15}/></button><button className="plain" aria-label="收起气泡" title="收起气泡" onClick={() => void act({ type: 'pet.view', view: 'hidden' })}><Icon name="close" size={15}/></button></div></header>
    {!simple && session && conversation}
    {session ? <Composer session={session} sessions={state.sessions} profiles={state.settings.profiles} catalog={state.codexCatalog} act={act} small simple={simple} details={detailed}/> : simple ? <div className="composer simple-composer"><textarea aria-label="发送给龙娘的消息" placeholder="想说什么？我在听…" value={draft} rows={2} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void start(); } }}/><button className="send" aria-label="发送消息" title="Enter 发送，Shift+Enter 换行" disabled={!draft.trim() || sending} onClick={() => void start()}><Icon name="arrow" size={21}/></button></div> : <div className="bubble-empty"><p>开启一段对话，<br/>就可以在这里继续。</p><button className="primary" onClick={() => void act({ type: 'session.create', backend: state.settings.selectedBackend ?? 'dragon', profileId: state.settings.selectedProfile })}>新的对话</button></div>}
  </>;
}

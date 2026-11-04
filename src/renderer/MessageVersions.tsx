import React, { useState } from 'react';
import type { Action, AgentSession, ChatMessage } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { Icon } from './Icons';
export function EditMessage({message,session,act}:{message:ChatMessage;session:AgentSession;act(a:Action):Promise<unknown>}) {
  const [editing,setEditing]=useState(false),[text,setText]=useState(message.text),[pending,setPending]=useState(false);
  if(!editing)return <button className="plain edit-message-icon" aria-label="编辑并重发" disabled={isBusy(session)||session.readOnly||!message.contextCheckpoint} title={!message.contextCheckpoint?'旧消息缺少上下文分界，可携带摘录创建新聊天':'编辑并重发'} onClick={()=>{setText(message.text);setEditing(true);}}><Icon name="edit" size={16}/></button>;
  return <form className="message-editor" onSubmit={async e=>{e.preventDefault();if(pending)return;setPending(true);try{if(await act({type:'session.resend',id:session.id,messageId:message.id,text,commandId:crypto.randomUUID()})===true)setEditing(false);}finally{setPending(false);}}}><textarea aria-label="编辑上一条消息" value={text} onChange={e=>setText(e.target.value)} rows={5}/><p className="hint">保留附件和旧回答版本；已经执行的文件与命令操作不会自动撤销。</p><div className="actions"><button type="button" disabled={pending} onClick={()=>setEditing(false)}>取消</button><button disabled={pending||!text.trim()||isBusy(session)}>保存并重发</button></div></form>;
}
export function MessageVersions({session,act}:{session:AgentSession;act(a:Action):Promise<unknown>}) {
  if(!session.versions?.length)return null;
  return <label className="version-picker">回答版本<select aria-label="聊天版本" disabled={isBusy(session)} value={session.versionId??''} onChange={e=>void act({type:'session.version',id:session.id,versionId:e.target.value})}>
    {!session.versions.some(v=>v.id===session.versionId)&&<option value={session.versionId}>当前版本</option>}
    {session.versions.map((v,index)=><option value={v.id} key={v.id}>{index+1} · {v.label}</option>)}
  </select></label>;
}

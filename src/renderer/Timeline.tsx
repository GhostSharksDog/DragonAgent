import { CollaborationCard } from './CollaborationCard';
import { ArtifactCard } from './ArtifactPreview';
import { EditMessage, MessageVersions } from './MessageVersions';
import React, { useEffect, useRef } from 'react';
import type { Action, AgentSession, PendingRequest, ToolEvent, ChatMessage, FileArtifact } from '../shared/contracts';
import type { CollaborationState } from '../shared/collaboration';
import { isBusy } from '../shared/contracts';
import { CopyButton, RichText } from './RichText';
import { TaskTree } from './TaskTree';
import { Icon } from './Icons';

const states: Record<ToolEvent['status'], string> = { queued:'等待执行', approval:'等待批准', running:'正在运行', completed:'已运行', declined:'已拒绝', error:'执行失败', cancelled:'已停止', unknown:'结果未知' };
function Operation({ tool, session, request }: { tool: ToolEvent; session: AgentSession; request?: React.ReactNode }) {
  const command = /terminal|powershell|command/i.test(tool.name);
  const editing=/files_(write|move|copy)|fileChange/.test(tool.name),reading=/files_(read|search|list)/.test(tool.name);
  let summary = tool.name,filename='';
  try { const args=JSON.parse(tool.arguments); if(typeof args.command==='string')summary=args.command;filename=String(args.destination??args.path??''); } catch { /* Preserve raw arguments for older records. */ }
  const label=tool.status==='completed'?(editing?'已编辑':reading?'已读取':command?'已运行命令':'已调用工具'):tool.status==='approval'?(command?'请求运行命令':'等待批准'):states[tool.status];
  const duration = tool.startedAt !== undefined && tool.completedAt !== undefined ? Math.max(0,tool.completedAt-tool.startedAt)/1000 : undefined;
  return <section className={`inline-operation ${tool.status}`}>
    <details><summary><Icon name={command?'terminal':editing?'edit':reading?'file':'globe'} size={15}/><span className="operation-state">{label}</span>{!command&&<span className="operation-title" title={filename||summary}>{filename?<u>{filename.split(/[\\/]/).at(-1)}</u>:summary}</span>}<Icon name="chevron" size={12}/></summary>
      {duration !== undefined&&<p className="hint">执行耗时 {duration.toFixed(1)} 秒</p>}
      {tool.agentId && <p className="hint">{session.tasks?.find(t=>t.id===tool.agentId)?.title ?? '主任务'}</p>}
      {tool.cwd && <p className="hint">目录：{tool.cwd}</p>}
      <div className="code-card"><div className="code-toolbar"><span>{command?'命令':'参数'}</span><CopyButton text={command?summary:tool.arguments}/></div><pre>{command?summary:tool.arguments}</pre></div>
      {tool.result && <div className="code-card"><div className="code-toolbar"><span>输出{tool.exitCode != null?` · 退出码 ${tool.exitCode}`:''}</span><CopyButton text={tool.result}/></div><pre>{tool.result}</pre></div>}
    </details>{request}
  </section>;
}
export function Timeline({ session, act, compact=false, renderRequest }: { session: AgentSession; act(a:Action):Promise<unknown>; compact?:boolean; renderRequest(r:PendingRequest):React.ReactNode }) {
  const end=useRef<HTMLDivElement>(null), viewport=useRef<HTMLDivElement>(null), follow=useRef(true);
  useEffect(()=>{follow.current=true;},[session.id]);
  useEffect(()=>{if(follow.current)end.current?.scrollIntoView({block:'end'});},[session.id,session.messages.length,session.messages.at(-1)?.text,session.tools.length,session.pending.length]);
  const activeRuns=new Set(session.messages.map(m=>m.runId));
  type Item={id:string;time:number;order:number;message?:ChatMessage;tool?:ToolEvent;artifact?:FileArtifact;collaboration?:CollaborationState};
  const items:Item[]=[...session.messages.map((message,index)=>({id:message.id,time:message.createdAt,order:message.sequence??index,message})),...session.tools.map((tool,index)=>({id:tool.id,time:tool.createdAt,order:tool.sequence??session.messages.length+index,tool})),...(session.artifacts??[]).filter(a=>activeRuns.has(a.runId)).map(artifact=>({id:artifact.id,time:artifact.createdAt,order:0,artifact})),...[...(session.collaborationHistory??[]),...(session.collaborationState?[session.collaborationState]:[])].filter(c=>activeRuns.has(c.runId)).map(collaboration=>({id:`plan:${collaboration.runId}`,time:collaboration.createdAt??0,order:0,collaboration}))].sort((a,b)=>a.time-b.time||a.order-b.order);
  const visible=compact?items.filter((item,i)=>i>=items.length-8||!!item.collaboration?.confirmations):items;
  const visibleTools=new Set(visible.filter(i=>i.tool).map(i=>i.id));
  return <div className="conversation" ref={viewport} onScroll={()=>{const el=viewport.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
    <MessageVersions session={session} act={act}/>{!compact && <TaskTree session={session} act={act}/>}
    {visible.map(item=>item.collaboration?<CollaborationCard key={item.id} session={{...session,collaborationState:item.collaboration}} act={act}/>:item.artifact?<ArtifactCard key={item.id} file={item.artifact} sessionId={session.id} act={act}/>:item.tool?<Operation key={item.id} tool={item.tool} session={session} request={session.pending.filter(r=>r.toolId===item.id).map(renderRequest)}/>:item.message&&<article className={`message ${item.message.role}`} key={item.id}>
      <div className="message-by">{item.message.role==='user'?'你':item.message.role==='assistant'?'霜璃':'系统记录'}{item.message.partial&&<span className="typing"> · 正在回复</span>}</div>
      <div className="message-content">{item.message.attachments?.length?<div className="attachment-strip">{item.message.attachments.map(a=><span className="attachment-chip" key={a.id}>{a.name}</span>)}</div>:null}
      <RichText text={item.message.text} sessionId={session.id} files={session.artifacts}/></div><div className="message-actions">{item.message.role==='user'&&<time dateTime={new Date(item.message.createdAt).toISOString()} title={new Date(item.message.createdAt).toLocaleString('zh-CN')}>{new Date(item.message.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}<CopyButton prose text={item.message.text} iconOnly={item.message.role==='user'} label="复制消息"/>{item.message.role==='user'&&item.message.id===session.messages.filter(m=>m.role==='user').at(-1)?.id&&<EditMessage key={item.message.id} message={item.message} session={session} act={act}/>}{item.message.role==='assistant'&&!compact&&<button className="plain" onClick={()=>void act({type:'memory.save',text:item.message!.text,tags:['对话摘录']})}>保存为记忆</button>}</div>
    </article>)}
    {session.pending.filter(r=>r.id!==session.collaborationState?.confirmations&&(!r.toolId||!visibleTools.has(r.toolId))).map(renderRequest)}
    {session.error&&<div className="error" role="alert">{session.error}</div>}
    {isBusy(session)&&!session.pending.length&&<div className="working"><i/>霜璃正在处理任务</div>}<div ref={end}/>
  </div>;
}

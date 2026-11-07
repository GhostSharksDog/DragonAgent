import { CollaborationCard } from './CollaborationCard';
import { ArtifactCard } from './ArtifactPreview';
import { EditMessage, MessageVersions } from './MessageVersions';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Action, AgentSession, PendingRequest, ToolEvent, ChatMessage, FileArtifact } from '../shared/contracts';
import type { CollaborationState } from '../shared/collaboration';
import { isBusy } from '../shared/contracts';
import { RichText } from './RichText';
import { TaskTree } from './TaskTree';
import { PlanCard } from './PlanCard';
import type { PlanVersion } from '../shared/planning';
import { Icon } from './Icons';

type Item={id:string;time:number;order:number;message?:ChatMessage;tool?:ToolEvent;artifact?:FileArtifact;collaboration?:CollaborationState;plan?:PlanVersion};
// Snapshots replace payload objects while streaming. Reuse stable ordering unless entries change.
function orderedItems(items:Item[],previous:Item[]) {
  const byId=new Map(items.map(item=>[item.id,item]));
  if(previous.length===items.length&&previous.every(item=>{const next=byId.get(item.id);return next?.time===item.time&&next?.order===item.order;}))return previous.map(item=>byId.get(item.id)!);
  return items.sort((a,b)=>a.time-b.time||a.order-b.order||a.id.localeCompare(b.id));
}
type DisplayItem=Item&{operations?:ToolEvent[]};
const CODE_FILE=/\.(c|h|cpp|cs|css|go|html|java|js|jsx|json|kt|less|lock|map|mjs|cjs|php|ps1|psm1|py|rb|rs|scss|sh|sql|svelte|toml|ts|tsx|vue|ya?ml|ini|bat|cmd)$/i;
const codeArtifact=(name:string)=>CODE_FILE.test(name);
function groupOperations(items:Item[]):DisplayItem[]{
  const rows:DisplayItem[]=[];let group:DisplayItem|undefined;
  for(const item of items){
    if(item.tool){
      if(!group||group.operations?.[0].runId!==item.tool.runId){group={id:'operations:'+item.id,time:item.time,order:item.order,operations:[]};rows.push(group);}
      group.operations!.push(item.tool);
    }else {rows.push(item);if(item.message?.role!=='notice'&&item.message||item.collaboration||item.plan)group=undefined;}
  }
  return rows;
}
const states:Record<ToolEvent['status'],string>={queued:'等待执行',approval:'等待批准',running:'正在执行',completed:'已完成',declined:'已拒绝',error:'执行失败',cancelled:'已停止',unknown:'结果未知'};
function operationKind(tool:ToolEvent){return /terminal|powershell|command/i.test(tool.name)?'command':/files_(write|move|copy)|fileChange/.test(tool.name)?'edit':/files_(read|search|list)/.test(tool.name)?'read':'tool';}
function Operations({tools,session,act,renderRequest}:{tools:ToolEvent[];session:AgentSession;act(a:Action):Promise<unknown>;renderRequest(r:PendingRequest):React.ReactNode}){
  // 执行中的单次失败先不打扰：模型通常会自动换方法重试，最后仍失败才在结果说明里交代。
  const visible=tools.filter(t=>t.status!=='error');
  if(!visible.length)return null;
  const editing=visible.some(t=>operationKind(t)==='edit'),commands=visible.some(t=>operationKind(t)==='command');
  const active=visible.some(t=>['queued','running','approval'].includes(t.status)),issues=visible.filter(t=>['unknown','declined'].includes(t.status)).length;
  const summary=editing&&commands?'编辑了文件并运行了命令':commands?'运行了命令':editing?'编辑了文件':'使用了工具';
  return <section className="operations-block"><details className="operations-group"><summary><Icon name={editing?'edit':'terminal'} size={15}/><span>{active?'正在处理操作':summary}</span><Icon name="chevron" size={12}/>{issues>0&&<small className="operations-issue">{issues} 项需处理</small>}</summary>
    <div className="operations-list">{visible.map(tool=>{
      const kind=operationKind(tool);let filename='';try{const args=JSON.parse(tool.arguments);filename=String(args.destination??args.path??'');}catch{}
      const file=session.artifacts?.find(f=>f.path.replaceAll('\\','/').toLowerCase()===filename.replaceAll('\\','/').toLowerCase());
      const label=tool.status==='completed'?kind==='command'?'已运行命令':kind==='edit'?'已编辑':kind==='read'?'已读取':'已调用工具':states[tool.status];
      const source=tool.agentId&&session.tasks?.find(t=>t.id===tool.agentId&&t.parentId)?.title;
      return <div className={'operation-row '+tool.status} key={tool.id}><Icon name={kind==='command'?'terminal':kind==='edit'?'edit':kind==='read'?'file':'globe'} size={15}/><span>{label}</span>{filename&&(file?<button className="plain operation-file" title={filename} onClick={()=>void act({type:'artifact.preview',sessionId:session.id,artifactId:file.id})}>{filename.split(/[\\/]/).at(-1)}</button>:<span className="operation-file" title={filename}>{filename.split(/[\\/]/).at(-1)}</span>)}{kind==='tool'&&<span className="operation-file" title={tool.name}>{tool.name}</span>}{source&&<small title={source}>· {source}</small>}</div>;
    })}</div></details>
    {session.pending.filter(r=>r.toolId&&tools.some(t=>t.id===r.toolId)).map(renderRequest)}
  </section>;
}
export function Timeline({ session, act, compact=false, renderRequest }: { session: AgentSession; act(a:Action):Promise<unknown>; compact?:boolean; renderRequest(r:PendingRequest):React.ReactNode }) {
  const [limit,setLimit]=useState(100),[atBottom,setAtBottom]=useState(true);
  const [remembered,setRemembered]=useState<Record<string,'saving'|'saved'|'error'>>({});
  useEffect(()=>{setLimit(100);},[session.id]);
  const end=useRef<HTMLDivElement>(null), viewport=useRef<HTMLDivElement>(null), follow=useRef(true);
  useEffect(()=>{follow.current=true;},[session.id]);
  const scrollFrame = useRef(0);
  useEffect(()=>()=>{if(scrollFrame.current)cancelAnimationFrame(scrollFrame.current);},[]);
  // 流式 token 可能几十毫秒就来一次；合并到一帧，避免每个 token 都强制布局和滚动。
  useLayoutEffect(()=>{
    if(!follow.current||scrollFrame.current)return;
    scrollFrame.current=requestAnimationFrame(()=>{
      scrollFrame.current=0;
      if(follow.current)end.current?.scrollIntoView({block:'end'});
    });
  },[session.id,session.messages.length,session.messages.at(-1)?.text,session.tools.length,session.pending.length]);
  // 每轮（一条提问 + 后续回复）结尾处放一条分隔线，右下角是「保存记忆」。
  const turnEndBefore=new Map<string,string>();
  let lastReply:string|undefined;
  for(const message of session.messages){
    if(message.role==='user'){if(lastReply)turnEndBefore.set(message.id,lastReply);lastReply=undefined;}
    else if(message.role==='assistant')lastReply=message.id;
  }
  const tailReply=isBusy(session)?undefined:lastReply;
  const rememberTurn=(reply:ChatMessage)=>{
    const index=session.messages.findIndex(m=>m.id===reply.id);
    const question=session.messages.slice(0,index).findLast(m=>m.role==='user')?.text.trim();
    const answer=reply.text.trim();
    if(!question&&!answer)return;
    const text=[question?'你：'+question:'',answer?'霜璃：'+answer:''].filter(Boolean).join('\n\n').slice(0,16000);
    setRemembered(prev=>({...prev,[reply.id]:'saving'}));
    void act({type:'memory.save',text,tags:['对话摘录']})
      .then(()=>setRemembered(prev=>({...prev,[reply.id]:'saved'})))
      .catch(()=>setRemembered(prev=>({...prev,[reply.id]:'error'})));
  };
  const turnDivider=(replyId:string)=>{
    const reply=session.messages.find(m=>m.id===replyId);
    if(!reply)return null;
    const state=remembered[replyId];
    return <div className="turn-divider" key={'divider:'+replyId}>
      <button className="plain turn-remember" data-state={state??'idle'} disabled={state==='saving'} title="把这一轮对话存进长期记忆"
        onClick={()=>rememberTurn(reply)}>
        <Icon name="spark" size={13}/><span>{state==='saved'?'已记住':state==='saving'?'保存中…':state==='error'?'重试保存':'保存记忆'}</span>
      </button>
    </div>;
  };
  const activeRuns=new Set(session.messages.map(m=>m.runId));
  // 计划提交发生在工具调用期间，不能只按 createdAt 排在回答正文前面；
  // 把它固定到本轮最后一条消息/工具之后，下一条用户消息之前。
  const runEnds=new Map<string,number>();
  for(const message of session.messages) if(message.runId) runEnds.set(message.runId,Math.max(runEnds.get(message.runId)??0,message.createdAt));
  for(const tool of session.tools) runEnds.set(tool.runId,Math.max(runEnds.get(tool.runId)??0,tool.createdAt,tool.completedAt??0));
  const planItems=(session.plans??[]).map((plan,index)=>({id:'plan:'+plan.id,time:Math.max(plan.createdAt,(runEnds.get(plan.runId)??0)+1),order:1_000_000+index,plan}));
  const orderCache=useRef<Item[]>([]),loadAnchor=useRef<{height:number;top:number}|null>(null);
  const items=orderedItems([...session.messages.map((message,index)=>({id:message.id,time:message.createdAt,order:message.sequence??index,message})),...session.tools.map((tool,index)=>({id:tool.id,time:tool.createdAt,order:tool.sequence??session.messages.length+index,tool})),...(session.artifacts??[]).filter(a=>activeRuns.has(a.runId)&&!codeArtifact(a.name)).map(artifact=>({id:artifact.id,time:artifact.createdAt,order:0,artifact})),...planItems,...[...(session.collaborationHistory??[]),...(session.collaborationState?[session.collaborationState]:[])].filter(c=>activeRuns.has(c.runId)).map(collaboration=>({id:`plan:${collaboration.runId}`,time:collaboration.createdAt??0,order:0,collaboration}))],orderCache.current);orderCache.current=items;
  const grouped=groupOperations(items);
  const visible=compact?grouped.filter((item,i)=>i>=grouped.length-8||!!item.collaboration?.confirmations):grouped.slice(-limit);
  useLayoutEffect(()=>{const el=viewport.current;if(el&&loadAnchor.current){el.scrollTop=loadAnchor.current.top+el.scrollHeight-loadAnchor.current.height;loadAnchor.current=null;}},[limit]);
  const lastUser=session.messages.findLast(m=>m.role==='user')?.id;
  const visibleTools=new Set(visible.flatMap(i=>i.operations?.map(t=>t.id)??[]));
  return <div className="conversation" ref={viewport} onScroll={()=>{const el=viewport.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;setAtBottom(follow.current);}}>
    {!compact&&grouped.length>limit&&<button className="history-load" onClick={()=>{const el=viewport.current;if(el)loadAnchor.current={height:el.scrollHeight,top:el.scrollTop};follow.current=false;setLimit(v=>v+100);}}>加载更早记录</button>}{!atBottom&&<button className="conversation-bottom" aria-label="回到底部" onClick={()=>{follow.current=true;end.current?.scrollIntoView({block:'end'});}}>↓</button>}<MessageVersions session={session} act={act}/>{!compact && <TaskTree session={session} act={act}/>}
    {visible.map(item=><div key={item.id} className="timeline-entry" data-entry={item.id}>
    {!compact&&item.message?.role==='user'&&turnEndBefore.has(item.message.id)&&turnDivider(turnEndBefore.get(item.message.id)!)}{item.collaboration?<CollaborationCard key={item.id} session={{...session,collaborationState:item.collaboration}} act={act}/>:item.plan?<PlanCard key={item.id} plan={item.plan} session={session} act={act}/>:item.artifact?<ArtifactCard key={item.id} file={item.artifact} sessionId={session.id} act={act}/>:item.operations?<Operations tools={item.operations} session={session} act={act} renderRequest={renderRequest}/>:item.message&&<article className={`message ${item.message.role}`} key={item.id}>
      {item.message.role!=='assistant'?<div className="message-by">{item.message.role==='user'?'你':'系统记录'}</div>:item.message.partial?<div className="message-by"><span className="typing">正在回复</span></div>:null}
      <div className="message-content">{item.message.attachments?.length?<div className="attachment-strip">{item.message.attachments.map(a=><span className="attachment-chip" key={a.id}>{a.name}</span>)}</div>:null}
      <RichText text={item.message.text} sessionId={session.id} files={session.artifacts} act={act}/></div><div className="message-actions">{item.message.role==='user'&&<time dateTime={new Date(item.message.createdAt).toISOString()} title={new Date(item.message.createdAt).toLocaleString('zh-CN')}>{new Date(item.message.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}{item.message.role==='user'&&item.message.id===lastUser&&<EditMessage key={item.message.id} message={item.message} session={session} act={act}/>}</div>
    </article>}</div>)}
    {!compact&&tailReply&&turnDivider(tailReply)}
    {session.pending.filter(r=>r.id!==session.collaborationState?.confirmations&&(!r.toolId||!visibleTools.has(r.toolId))).map(renderRequest)}
    {session.error&&<div className="error" role="alert">{session.error}</div>}
    {isBusy(session)&&!session.pending.length&&<div className="working"><i/>正在处理任务</div>}<div ref={end}/>
  </div>;
}

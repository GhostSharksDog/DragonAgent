import React,{useState} from 'react';
import type {Action,AgentSession} from '../shared/contracts';
import {isBusy} from '../shared/contracts';
import {planMarkdown} from '../shared/planning';
import {RichText} from './RichText';
export function PlanCard({session,act}:{session:AgentSession;act(a:Action):Promise<unknown>}) {
  const [selected,setSelected]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const versions=session.plans??[],latest=versions.at(-1),plan=versions.find(p=>p.id===selected)??latest;
  if(!plan)return null;
  const disabled=pending||isBusy(session)||!!session.pending.length||!!session.queuedMessages?.length||session.readOnly;
  const execute=async()=>{setPending(true);setError('');try{await act({type:'session.plan.execute',id:session.id,versionId:plan.id,commandId:crypto.randomUUID()});}catch(e){setError(String(e));}finally{setPending(false);}};
  return <section className="dragon-plan-card"><header><strong>实施计划</strong><select aria-label="计划版本" value={plan.id} onChange={e=>setSelected(e.target.value)}>{versions.map((p,i)=><option key={p.id} value={p.id}>版本 {i+1}{p===latest?' · 最新':''}{p.stale?' · 待修订':''}</option>)}</select></header><RichText text={planMarkdown(plan.plan)} act={act} sessionId={session.id}/><footer><button onClick={()=>void navigator.clipboard.writeText(planMarkdown(plan.plan)).then(()=>setCopied(true)).catch(()=>setError('复制失败'))}>{copied?'已复制':'复制计划'}</button><button disabled={disabled||session.backend!=='dragon'||session.collaboration?.enabled} onClick={()=>void act({type:'session.mode',id:session.id,mode:'plan'}).then(()=>act({type:'session.draft',id:session.id,text:'请修改计划：'})).catch(e=>setError(String(e)))}>继续修改</button><button className="primary" disabled={disabled||plan!==latest||plan.stale||!!plan.execution||!!plan.plan.questions.length||session.mode!=='plan'} onClick={()=>void execute()}>{plan.execution?'已确认执行':'按此计划执行'}</button></footer>{plan.plan.questions.length>0&&<p className="hint">请先明确待决定事项，再提交新版计划。</p>}{plan.stale&&<p className="hint">已有后续讨论，请提交更新后的计划。</p>}{error&&<p className="error">{error}</p>}</section>;
}

import React, { useState } from 'react';
import type { Action, AgentSession } from '../shared/contracts';
const stages={planning:'整理计划',confirmation:'等待确认',executing:'执行中',reviewing:'复核中',completed:'已完成',paused:'等待继续',error:'未完成'};
export function CollaborationCard({session,act}:{session:AgentSession;act(a:Action):Promise<unknown>}) {
  const c=session.collaborationState;
  const [requirements,setRequirements]=useState(''),[sending,setSending]=useState(false);
  if(!c)return null;
  const request=session.pending.find(r=>r.id===c.confirmations);
  const answer=async(decision:string)=>{if(!request||sending)return;setSending(true);try{await act({type:'request.answer',sessionId:session.id,id:request.id,value:{decision,requirements}});}finally{setSending(false);}};
  return <section className="collaboration-card" aria-label="协作计划">
    <header><strong>{stages[c.stage]}</strong><span>{c.planner} 规划 · DeepSeek 执行{c.reviewer?` · ${c.reviewer} 复核`:''}</span></header>
    {c.plan&&<details open={c.stage==='confirmation'}><summary>{c.plan.goal}</summary><ol>{c.plan.steps.map(step=><li key={step.id}><strong>{step.title}</strong><p>{step.instructions}</p>{!!step.outputs.length&&<p>产物：{step.outputs.join('、')}</p>}{!!step.checks.length&&<p>验证：{step.checks.join('；')}</p>}{!!step.dependsOn.length&&<small>依赖步骤：{step.dependsOn.join('、')}</small>}</li>)}</ol><p>验收条件：{c.plan.checks.join('；')}</p></details>}
    {c.fallbackReason&&<p className="hint">GPT 接入失败：{c.fallbackReason}</p>}
    {c.review&&<div><strong>{c.review.passed?'复核通过':'需要修正'}</strong><p>{c.review.summary}</p><ul>{c.review.fixes.map((text,i)=><li key={i}>{text}</li>)}</ul></div>}
    {request&&<div className="plan-confirmation"><textarea aria-label="补充计划要求" placeholder="可以补充要求，让霜璃重新规划…" value={requirements} onChange={e=>setRequirements(e.target.value)} maxLength={16000}/><div><button className="primary" disabled={sending} onClick={()=>void answer('确认执行')}>确认并执行</button><button disabled={sending||!requirements.trim()} onClick={()=>void answer('重新规划')}>重新规划</button><button disabled={sending} onClick={()=>void answer('取消')}>取消</button></div></div>}
    <small className="hint">DeepSeek 请求 {c.dragonRequests} · GPT 规划 {c.gptPlanning} 次／复核 {c.gptReviews} 次 · 修正 {c.repairs}/2</small>
  </section>;
}

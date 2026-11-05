import React, {useRef,useState} from 'react';
import type {Action, PendingRequest} from '../shared/contracts';
import {CopyButton} from './RichText';

export function ApprovalCard({request,act}:{request:PendingRequest;act(a:Action):Promise<unknown>}) {
  const [answers,setAnswers]=useState<Record<string,string>>({}),[custom,setCustom]=useState<Record<string,boolean>>({}),[sending,setSending]=useState(false);
  const inFlight=useRef(false);
  let data:Record<string,unknown>={};try{const value=JSON.parse(request.operation?.arguments??request.details);if(value&&typeof value==='object'&&!Array.isArray(value))data=value;}catch{}
  const target=[data.path,data.destination,data.url,data.cwd].filter(v=>typeof v==='string').join(' → ');
  const diffStart=request.details.indexOf('--- 当前文件\n+++ 修改后\n'),diff=diffStart<0?undefined:request.details.slice(diffStart),reason=diffStart<0?request.details:request.details.slice(0,diffStart);
  const answer=async(value:unknown)=>{if(inFlight.current)return;inFlight.current=true;setSending(true);try{await act({type:'request.answer',sessionId:request.sessionId,id:request.id,value});}finally{inFlight.current=false;setSending(false);}};
  return <section className="approval-card" aria-label={request.title}>
    <header><strong>{request.kind==='approval'?'等待批准':'需要你的回答'}</strong><span>{request.source?.title??'当前任务'}</span></header><h3>{request.title}</h3>
    {target&&<p className="approval-target" title={target}>{target}</p>}
    {request.kind==='approval'&&<p className="hint">本次操作需要你确认；批准只作用于这一项操作。</p>}
    {request.kind==='approval'&&<p className="approval-reason">{reason.length>900?reason.slice(0,900)+'…（完整说明见下方）':reason}</p>}
    {diff?<details className="approval-diff"><summary>查看文件修改前后内容</summary><CopyButton text={diff}/><pre>{diff.split('\n').slice(0,400).map((line,i)=><span className={line.startsWith('+ ')?'diff-add':line.startsWith('- ')?'diff-remove':''} key={i}>{line}{'\n'}</span>)}</pre>{diff.split('\n').length>400&&<p className="hint">预览前 400 行；复制或展开完整参数可查看全部内容。</p>}</details>:request.operation&&/write|fileChange|move|copy/.test(request.operation.name)&&<p className="hint">此操作未提供可核验的前后内容，请核对路径与完整参数。</p>}
    {typeof data.command==='string'&&<div className="code-card"><div className="code-toolbar"><span>将运行的命令</span><CopyButton text={data.command}/></div><pre>{data.command}</pre></div>}
    {request.details&&<details><summary>完整操作说明与参数</summary><pre>{request.details}</pre></details>}
    {request.questions?.map(q=><label key={q.id} className="question">{q.question}{q.options?.length?<><div className="choices">{q.options.map(v=><button disabled={sending} key={v} aria-pressed={answers[q.id]===v} onClick={()=>{setAnswers({...answers,[q.id]:v});setCustom({...custom,[q.id]:false});}}>{v}</button>)}<button disabled={sending} onClick={()=>setCustom({...custom,[q.id]:true})}>自行填写</button></div>{custom[q.id]&&<input aria-label={q.question} value={answers[q.id]??''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/>}</>:<input aria-label={q.question} value={answers[q.id]??''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/>}</label>)}
    <div className="actions"><button disabled={sending} onClick={()=>void answer(false)}>拒绝</button><button className="primary" disabled={sending||request.kind==='question'&&request.questions?.some(q=>!answers[q.id]?.trim())} onClick={()=>void answer(request.kind==='approval'?true:answers)}>{sending?'正在提交…':request.kind==='approval'?'批准本次操作':'提交回答'}</button></div>
  </section>;
}

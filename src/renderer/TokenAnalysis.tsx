import React from 'react';
import { tokenCost } from '../shared/token-pricing';
import type { AgentSession, ModelProfile } from '../shared/contracts';
import { addUsage } from '../../packages/agent-core/src/usage';

export function TokenAnalysis({session,profiles=[]}:{session:AgentSession;profiles?:ModelProfile[]}) {
  const attempts=(session.attempts??[]).filter(a=>a.runId===session.runId);
  const samples=attempts.filter(a=>a.usage);
  const usage=samples.length?samples.reduce<import('../../packages/agent-core/src/types').Usage>((sum,a)=>addUsage(sum,a.usage!),{input:0,output:0}):session.usage;
  const costs=samples.map(a=>{const p=profiles.find(p=>p.id===a.profileId);return p?tokenCost(p,a.usage!):undefined;});
  const complete=attempts.every(a=>a.status==='completed')&&costs.length>0&&costs.every(Boolean)&&new Set(costs.map(c=>c?.currency)).size===1;
  const value=(n?:number)=>n===undefined?'未提供':n.toLocaleString();
  return <details className="token-analysis"><summary>Token 分析 · {attempts.length?`${attempts.length} 次请求`:'用量详情'}</summary>
    <dl><dt>本任务输入（含缓存）</dt><dd>{value(usage?.reported===false&&!usage.input?undefined:usage?.input)}</dd><dt>输出</dt><dd>{value(usage?.reported===false&&!usage.output?undefined:usage?.output)}</dd><dt>缓存读取</dt><dd>{value(usage?.cacheRead)}</dd><dt>缓存写入</dt><dd>{value(usage?.cacheWrite)}</dd><dt>推理输出（包含在输出中）</dt><dd>{value(usage?.reasoning)}</dd><dt>当前上下文</dt><dd>{value(session.usage?.context)} / {value(session.usage?.window)}</dd></dl>
    <p>模型费用估算：{complete?costs[0]!.currency+' '+costs.reduce((n,c)=>n+c!.low,0).toFixed(5)+' – '+costs.reduce((n,c)=>n+c!.high,0).toFixed(5):'暂无完整用量或适用单价'}</p>{complete&&<p className="hint">{[...new Set(costs.map(c=>c!.basis))].join('；')}。非实际账单。</p>}
    <p className="hint">累计消耗与当前上下文占用分别统计。缓存命中仍占用上下文。{usage?.reported===false?'部分请求缺少完整用量，合计可能不完整。':''}</p>
    {session.usage?.composition&&<details><summary>当前上下文组成（保守估算）</summary><dl>{([['system','系统提示'],['tools','工具定义'],['history','对话与已读附件'],['results','工具结果'],['images','图片预留'],['overhead','协议预留']] as const).map(([key,label])=><React.Fragment key={key}><dt>{label}</dt><dd>{value(session.usage?.composition?.[key])}</dd></React.Fragment>)}</dl><p className="hint">{session.usage.calibrated?'总占用已用同配置的真实用量校准；组成仍为独立估算，不应相加当作计费量。':'估算保留安全余量；服务返回的计费量以请求记录为准。'}</p></details>}
    {attempts.some(a=>a.status!=='completed')&&<p className="hint">未完成或失败请求的费用可能未由服务返回，不按零费用处理。</p>}
    <p className="hint">摘要请求 {attempts.filter(a=>a.purpose==='summary').length} 次；重试 {attempts.filter(a=>(a.retry??0)>0).length} 次；失败请求 {attempts.filter(a=>a.status==='failed').length} 次。</p>
  </details>;
}

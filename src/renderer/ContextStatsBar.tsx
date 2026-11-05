import React from 'react';
import type { Action, AgentSession, ModelProfile } from '../shared/contracts';
import { contextPolicy, isBusy } from '../shared/contracts';
import { Icon } from './Icons';
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const short=(n:number,base=1000)=>n>=base*base?(n/base/base).toFixed(1)+'M':n>=base?(n/base).toFixed(n%base===0?0:1)+'K':String(n);
export function ContextStatsBar({session,profiles,act}:{session:AgentSession;profiles:ModelProfile[];act(a:Action):Promise<unknown>}) {
  const usage=session.usage,profile=profiles.find(p=>p.id===session.profileId);
  const windowTokens=usage?.window??(session.backend==='dragon'&&profile?contextPolicy(profile).window:undefined),context=usage?.context;
  const hasContext=finite(context)&&finite(windowTokens)&&windowTokens>0;
  const percent=hasContext?context/windowTokens*100:undefined;
  // Request IDs are upserted during streaming; never add intermediate usage or cache twice.
  const attempts=[...new Map((session.attempts??[]).filter(a=>a.runId===session.runId).map(a=>[a.id,a])).values()];
  const samples=attempts.length?attempts.flatMap(a=>a.usage?[a.usage]:[]):[...(usage?[usage]:[]),...(session.tasks??[]).filter(t=>t.parentId&&t.runId===session.runId).map(t=>t.usage)];
  const input=samples.reduce((n,u)=>n+(finite(u.input)?u.input:0),0),output=samples.reduce((n,u)=>n+(finite(u.output)?u.output:0),0),known=samples.some(u=>u.reported!==false||u.input>0||u.output>0);
  const partial=attempts.some(a=>!a.usage||a.usage.reported===false)||samples.some(u=>u.reported===false);
  const cacheKnown=known&&samples.every(u=>finite(u.cacheRead)&&u.cacheRead<=u.input),cache=cacheKnown?samples.reduce((n,u)=>n+u.cacheRead!,0):undefined;
  const cacheRate=cache!==undefined&&input>0?cache/input*100:undefined;
  const contextLabel=hasContext?`${percent!.toFixed(percent!<10?1:0)}%`:'—';
  const contextTitle=hasContext?`上下文 ${context.toLocaleString()} / ${windowTokens.toLocaleString()} tokens${usage?.estimated?usage.calibrated?'（实际用量校准后的估算）':'（保守估算）':''}。与累计消耗分别计算。`:'上下文数据尚未返回；不代表占用为零。';
  const usageTitle=known?`${session.backend==='codex'&&!attempts.length?'最近一次请求':'本任务'}已记录 ${input.toLocaleString()} 输入 + ${output.toLocaleString()} 输出 = ${(input+output).toLocaleString()} tokens。缓存读取包含在输入内，推理输出包含在输出内，不重复相加。${partial?'仍有请求未返回完整用量。':''}${session.collaboration?'GPT 规划与复核使用订阅通道，单独记录。':''}`:'等待服务返回真实用量';
  return <div className="context-stats-bar">
    <span className="context-summary" title={contextTitle} aria-label={contextTitle}><span className="context-donut" style={{'--context-fill':`${Math.min(100,percent??0)}%`} as React.CSSProperties}/><span>上下文 <b>{contextLabel}</b></span>{hasContext&&<span className="context-fraction">{short(context,1024)} / {short(windowTokens,1024)}</span>}</span>
    <span className="context-stat token-total" title={usageTitle}>{session.backend==='codex'&&!attempts.length?'最近请求':partial?'已记录':'本任务'} <b>{known?short(input+output):'—'}</b> tokens</span>
    {cacheRate!==undefined&&<span className="context-stat cache-stat" title={`缓存读取 ${cache!.toLocaleString()} / 输入 ${input.toLocaleString()} tokens`}>缓存 <b>{cacheRate.toFixed(0)}%</b></span>}
    <details className="context-actions"><summary title="聊天操作" aria-label="聊天操作"><Icon name="settings" size={16}/></summary><div className="context-actions-menu"><button disabled={isBusy(session)||session.readOnly||session.backend==='codex'} onClick={()=>void act({type:'session.compact',id:session.id})}>压缩上下文</button><button disabled={isBusy(session)} onClick={()=>void act({type:'session.create',backend:session.backend==='dragon'?'codex':'dragon',carryFrom:session.id})}>携带摘录切换引擎 ↗</button><button disabled={isBusy(session)} onClick={()=>void act({type:'session.archive',id:session.id})}>归档此会话</button></div></details>
  </div>;
}

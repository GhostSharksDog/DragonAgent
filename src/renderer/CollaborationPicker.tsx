import React, { useState } from 'react';
import type { Action, AgentSession, CodexCatalog, ModelProfile } from '../shared/contracts';
import { ReasoningControl } from './ModelPicker';

export function CollaborationPicker({session,profiles,catalog,act,close}:{session:AgentSession;profiles:ModelProfile[];catalog:CodexCatalog;act(a:Action):Promise<unknown>;close():void}) {
  const choices=profiles.filter(p=>/deepseek/i.test(p.model));
  const [profileId,setProfile]=useState(choices.find(p=>p.id===session.profileId)?.id??choices[0]?.id??'');
  const [model,setModel]=useState(session.collaboration?.plannerModel??'');
  const [effort,setEffort]=useState(session.collaboration?.effort);
  const [saving,setSaving]=useState(false);
  const selected=catalog.models.find(m=>m.model===model)??(!model?catalog.models.find(m=>m.isDefault):undefined);
  const save=async()=>{setSaving(true);try{
    let id=session.id;
    if(session.backend!=='dragon'){const result=await act({type:'session.create',backend:'dragon',profileId,carryFrom:session.id});if(typeof result!=='string')return;id=result;}
    const ok=await act({type:'session.collaboration',id,config:{enabled:true,plannerModel:model||undefined,effort,executionProfileId:profileId}});
    if(ok)close();
  }finally{setSaving(false);}};
  return <section className="collaboration-picker">
    <strong>GPT 规划 · DeepSeek 执行</strong><p className="menu-footnote">先审核计划，再执行；GPT 只读复核。GPT 不可用时会说明原因，由 DeepSeek 接手。</p>
    <label>规划与复核<select aria-label="协作规划模型" value={model} onChange={e=>{setModel(e.target.value);setEffort(undefined);}}><option value="">Codex 账号默认</option>{catalog.models.map(m=><option key={m.model} value={m.model}>{m.name}</option>)}</select></label>
    {catalog.status==='error'&&<p className="catalog-error">{catalog.error}<button onClick={()=>void act({type:'codex.models'})}>重试</button></p>}
    {selected&&<ReasoningControl session={{...session,model:selected.model,reasoningEffort:effort}} model={selected} act={act} openModels={()=>document.querySelector<HTMLSelectElement>('[aria-label="协作规划模型"]')?.focus()} save={async(m,e)=>{setModel(m);setEffort(e);return true;}}/>}
    <label>执行模型<select aria-label="协作执行模型" value={profileId} onChange={e=>setProfile(e.target.value)}>{choices.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
    {!choices.length&&<p className="catalog-error">请在设置中添加 DeepSeek 模型连接。</p>}
    {session.backend==='codex'&&<p className="menu-footnote">将携带可审核摘录创建新聊天，默认全请求批准。</p>}
    <button className="primary" disabled={saving||!profileId} onClick={()=>void save()}>{saving?'正在保存…':'使用协作模式'}</button>
    {session.collaboration?.enabled&&<button className="menu-action" onClick={async()=>{if(await act({type:'session.collaboration',id:session.id,config:{enabled:false}}))close();}}>切回单模型</button>}
  </section>;
}

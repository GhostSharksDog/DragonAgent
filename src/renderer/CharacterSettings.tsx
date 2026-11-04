import React, { useState } from 'react';
import { ANIMA_SETTINGS, ANIMAGINE_SETTINGS, characterSettings, workshopBusy, type WorkshopProject, type CharacterSettings as Settings } from '../shared/workshop';
import type { Action } from '../shared/contracts';

export function CharacterSettings({ p, act }: { p: WorkshopProject; act(a: Action): Promise<unknown> }) {
  const [draft,setDraft]=useState(()=>({...characterSettings(p.settings)}));
  const [pending,setPending]=useState(false);
  const locked=workshopBusy(p)||!!p.operation||pending;
  const field=(key:keyof Settings,value:string|number)=>setDraft({...draft,[key]:value});
  return <details className="studio-settings"><summary>立绘模型与采样 · {characterSettings(p.settings).backend==='anima'?'Anima':'Animagine XL'}</summary><fieldset disabled={locked}><label>立绘模型体系<select value={draft.backend} onChange={e=>setDraft({...e.target.value==='anima'?ANIMA_SETTINGS:ANIMAGINE_SETTINGS})}><option value="anima">Anima</option><option value="animagine">Animagine XL</option></select></label><p>切换模型体系会停用原 LoRA；已有图片和提示词保留，可让霜璃按新模型整理提示词。</p>
    <label>模型文件<input value={draft.model} onChange={e=>field('model',e.target.value)}/></label>
    {draft.backend==='anima'&&<><label>文字编码器<input value={draft.encoder} onChange={e=>field('encoder',e.target.value)}/></label><label>立绘 VAE<input value={draft.vae} onChange={e=>field('vae',e.target.value)}/></label></>}
    <div className="studio-grid">{(['width','height','steps','cfg'] as const).map((key,i)=><label key={key}>{['宽度','高度','步数','CFG'][i]}<input type="number" value={draft[key]} step={key==='cfg'?.5:key==='width'||key==='height'?8:1} onChange={e=>field(key,+e.target.value)}/></label>)}</div>
    <label>采样器<select value={draft.sampler} onChange={e=>field('sampler',e.target.value)}>{['dpmpp_2m_sde_gpu','euler_ancestral','er_sde','euler'].map(v=><option key={v}>{v}</option>)}</select></label><label>调度器<select value={draft.scheduler} onChange={e=>field('scheduler',e.target.value)}>{['normal','simple','karras','beta'].map(v=><option key={v}>{v}</option>)}</select></label>
    <button onClick={async()=>{setPending(true);try{await act({type:'workshop.character.settings',id:p.id,settings:draft});}finally{setPending(false);}}}>保存立绘参数</button></fieldset></details>;
}

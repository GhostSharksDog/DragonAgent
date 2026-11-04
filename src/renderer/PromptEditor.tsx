import React,{useEffect,useState} from 'react';
import type {Action} from '../shared/contracts';
import {workshopBusy,type WorkshopProject} from '../shared/workshop';
export function PromptEditor({p,act}:{p:WorkshopProject;act(a:Action):Promise<unknown>}) {
  const source=p.draft??p;
  const [draft,setDraft]=useState({description:source.description,characterPrompt:source.characterPrompt,negativePrompt:source.negativePrompt});
  const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false);
  const serialized=JSON.stringify({description:source.description,characterPrompt:source.characterPrompt,negativePrompt:source.negativePrompt});
  useEffect(()=>{if(!dirty)setDraft(JSON.parse(serialized));},[serialized,dirty]);
  return <div className="creative-parameters"><p className="studio-caption">这里显示实际提交的完整提示词。{p.draft?'当前显示下一次制作草稿。':''}</p>{(['description','characterPrompt','negativePrompt'] as const).map((key,i)=><label key={key}>{['角色设定','正面提示词','负面提示词'][i]}<textarea aria-label={['编辑角色设定','编辑正面提示词','编辑负面提示词'][i]} value={draft[key]} rows={i===1?5:3} maxLength={[4000,6000,3000][i]} onChange={e=>{setDirty(true);setDraft({...draft,[key]:e.target.value});}}/></label>)}<button disabled={!dirty||saving} onClick={async()=>{setSaving(true);try{if(await act({type:'workshop.parameters',id:p.id,parameters:draft})===true)setDirty(false);}finally{setSaving(false);}}}>{workshopBusy(p)||p.operation?'保存到下一次草稿':'保存提示词'}</button>{dirty&&<button onClick={()=>setDirty(false)}>放弃未保存修改</button>}</div>;
}

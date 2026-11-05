import React, { useEffect, useState } from 'react';
import type { Action } from '../shared/contracts';
import { PROMPT_AGENT_PERSONA, type IllustrationPreferences as Preferences, type IllustrationProject } from '../shared/illustration';

export function IllustrationPreferences({ preferences, project, act }: {preferences?:Preferences;project:IllustrationProject;act(a:Action):Promise<unknown>}) {
  const [persona,setPersona]=useState(preferences?.persona??PROMPT_AGENT_PERSONA),[memory,setMemory]=useState(preferences?.memory??''),[facts,setFacts]=useState(project.memory?.text??''),[notice,setNotice]=useState('');
  useEffect(()=>{setFacts(project.memory?.text??'');setNotice('');},[project.id,project.memory?.updatedAt]);
  useEffect(()=>{setPersona(preferences?.persona??PROMPT_AGENT_PERSONA);setMemory(preferences?.memory??'');},[preferences?.updatedAt]);
  return <details className="illustration-section illustration-agent"><summary>插画人设与记忆</summary>
    <p className="hint">仅用于角色插画。保存后下一轮生效，留空记忆并保存可清除。</p>
    <label>创作人设<textarea rows={6} value={persona} onChange={e=>setPersona(e.target.value)}/></label>
    <label>插画通用偏好<textarea rows={3} value={memory} onChange={e=>setMemory(e.target.value)}/></label>
    <div className="actions"><button onClick={async()=>{if(await act({type:'illustration.preferences.save',persona,memory})===true)setNotice('插画人设与偏好已保存');}}>保存人设与偏好</button><button onClick={()=>{setPersona(PROMPT_AGENT_PERSONA);setNotice('已恢复默认草稿，保存后生效');}}>恢复默认</button></div>
    <label>当前项目设定<textarea rows={3} value={facts} onChange={e=>setFacts(e.target.value)}/></label>
    {project.memory&&<small>{project.memory.source} · {new Date(project.memory.updatedAt).toLocaleString()}</small>}
    <button onClick={async()=>{if(await act({type:'illustration.memory.save',id:project.id,text:facts})===true)setNotice('项目设定已保存');}}>保存项目设定</button>
    <p role="status">{notice}</p>
  </details>;
}

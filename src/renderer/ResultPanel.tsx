import React,{useEffect,useState} from 'react';
import type {Action,AgentSession,Snapshot} from '../shared/contracts';
import {ArtifactCard,ArtifactPreview} from './ArtifactPreview';
import {PlanInspector} from './PlanInspector';
import {CopyButton,RichText} from './RichText';
import {TaskTree} from './TaskTree';

export function ResultPanel({state,session,act}:{state:Snapshot;session:AgentSession;act(a:Action):Promise<unknown>}) {
  const [tab,setTab]=useState('results');
  useEffect(()=>{if(state.artifactPreview?.artifact)setTab('preview');},[state.artifactPreview?.artifact.id]);
  // 顶部 Plan 摘要只负责请求预览；真正切到“计划”页由这里完成。
  useEffect(()=>{if(state.planPreview?.sessionId===session.id&&(session.plans??[]).some(plan=>plan.id===state.planPreview?.planId))setTab('plan');},[state.planPreview?.at,state.planPreview?.planId,state.planPreview?.sessionId,session.id]);
  const runs=new Set(session.messages.map(m=>m.runId));
  const tools=session.tools.filter(t=>t.runId===session.runId);
  const files=(session.artifacts??[]).filter(f=>runs.has(f.runId));
  const response=session.messages.findLast(m=>m.role==='assistant'&&m.runId===session.runId&&!m.partial);
  const tabs:(string)[][] = [...((session.plans??[]).length?[['plan','计划']]:[]),['results','成果'],['preview','文件预览'],['execution','执行详情']];
  return <><nav className="result-panel-tabs" aria-label="任务侧栏">{tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==='plan'?<PlanInspector state={state} session={session} act={act}/>:tab==='preview'?<ArtifactPreview state={state} session={session} act={act}/>:tab==='results'?<><h3>文件产物</h3>{files.length?files.map(file=><ArtifactCard key={file.id} file={file} sessionId={session.id} act={act}/>):<p className="hint">本聊天暂无已核验的文件产物。</p>}{response&&<details><summary>本轮回复</summary><RichText text={response.text}/><CopyButton text={response.text} prose/></details>}</>:<><TaskTree session={session} act={act}/><p>{tools.filter(t=>t.status==='completed').length} 项操作完成 · {tools.filter(t=>['error','unknown'].includes(t.status)).length} 项需处理</p><p className="hint">完成操作不等于整个任务通过验收。工具输出保留在本地记录；展开操作组后可复制各项结果。</p>{session.collaborationState?.review&&<details open><summary>协作复核结论</summary><RichText text={session.collaborationState.review.summary}/>{session.collaborationState.review.fixes.map((fix,index)=><p key={index}>{fix}</p>)}</details>}</>}
  </>;
}

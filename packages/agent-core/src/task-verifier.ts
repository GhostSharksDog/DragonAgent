import type {AgentRecord, Message, TaskStep} from './types.js';

/** Checks inspect saved execution facts; model prose never satisfies a check. */
export function verifySteps(steps:TaskStep[],messages:Message[],evidence?:AgentRecord['evidence']):TaskStep[] {
  const seen=new Set<string>(),complete=new Set<string>();
  return steps.map(step=>{
    if(seen.has(step.id))throw Error('任务步骤编号重复');
    if(step.dependsOn?.some(id=>!seen.has(id)))throw Error('任务步骤依赖必须指向之前的步骤');seen.add(step.id);
    if(!['completed','awaiting-verification'].includes(step.status))return step;
    const checks=step.checks??[],verified=checks.length>0&&checks.every(check=>{
      if(check.kind==='manual')return false;
      const call=evidence?undefined:messages.flatMap(m=>m.calls??[]).find(c=>c.id===check.callId);
      const result=evidence?undefined:messages.findLast(m=>m.role==='tool'&&m.callId===check.callId);
      const saved=evidence?evidence[check.callId]:result?{name:call?.name,isError:!!result.isError,facts:result.facts}:undefined;
      if(check.kind==='command-exit')return saved?.name==='pet_terminal'&&saved.facts?.exitCode===check.exitCode;
      if(check.kind==='artifact-exists')return !!saved&&!saved.isError&&!!saved.facts?.artifacts?.some(f=>f.path===check.path&&Number.isFinite(f.size)&&f.size>=0);
      return saved?.name===check.toolName&&!saved.isError;
    });
    const status=verified&&(step.dependsOn??[]).every(id=>complete.has(id))?'completed':'awaiting-verification';
    if(status==='completed')complete.add(step.id);
    return {...step,status};
  });
}

// Attach only to an explicitly supplied local acceptance app; do not restart it or expose keys.
import {chromium} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const port=Number(process.argv[2]);assert(Number.isInteger(port)&&port>0&&port<65536,'Supply the existing acceptance app CDP port');
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('view=workbench'));assert(page);
const action=a=>page.evaluate(a=>window.dragon.action(a),a),snapshot=()=>page.evaluate(()=>window.dragon.snapshot());
const workspace=path.resolve('.runtime/online040-'+Date.now());await mkdir(workspace,{recursive:true});
const report={mode:'existing-actual-app-saved-credentials',startedAt:new Date().toISOString(),checks:[],status:'running'};
const save=()=>writeFile('test-results/online040-attached.json',JSON.stringify(report,null,2));
async function check(name,fn){try{report.checks.push({name,status:'passed',result:await fn()});}catch(error){report.checks.push({name,status:'failed',error:error.message});}console.log(name+': '+report.checks.at(-1).status);await save();}
async function wait(id,confirm=false){let answered=new Set();for(const until=Date.now()+480000;Date.now()<until;){
  const s=(await snapshot()).sessions.find(s=>s.id===id);
  if(['error','paused'].includes(s.status))throw Error(s.error??'Task paused');
  for(const r of s.pending){if(answered.has(r.id))continue;assert(confirm&&r.id===s.collaborationState?.confirmations,'Unexpected approval');
    const plan=s.collaborationState.plan;assert(plan.goal&&plan.steps.length);assert(plan.steps.every(step=>!/(删除|安装|上传|推送)/.test(step.instructions)),'Plan exceeds fixture scope');
    answered.add(r.id);await action({type:'request.answer',sessionId:id,id:r.id,value:{decision:'确认执行'}});
  }
  if(s.status==='completed')return s;await new Promise(r=>setTimeout(r,500));
}await action({type:'session.stop',id});throw Error('Timed out');}
try{
  const initial=await snapshot();assert(!initial.sessions.some(s=>['running','waiting','stopping'].includes(s.status)));
  const profile=initial.settings.profiles.find(p=>new URL(p.baseUrl).hostname==='api.deepseek.com'&&p.hasKey);assert(profile);
  await check('Codex quota and models',async()=>{await action({type:'quota.refresh'});await action({type:'codex.models'});const s=await snapshot();assert.equal(s.quota.status,'ready',s.quota.error);assert.equal(s.codexCatalog.status,'ready',s.codexCatalog.error);return {buckets:s.quota.buckets,models:s.codexCatalog.models.map(m=>m.model)};});
  await check('GPT Astra high DeepSeek closed loop',async()=>{
    const model=(await snapshot()).codexCatalog.models.find(m=>/astra/i.test(m.model));assert(model);assert(model.efforts.some(e=>e.value==='high'));
    const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});report.collaborationSessionId=id;await save();
    await action({type:'session.permissionMode',id,mode:'auto'});await action({type:'session.collaboration',id,config:{enabled:true,plannerModel:model.model,effort:'high'}});
    const output=path.join(workspace,'collaboration.txt');
    await action({type:'session.send',id,text:`只做有限范围的协作验收：在 ${output} 写入 DRAGON_COLLAB_040，然后读取核对内容。不访问其他目录，不运行命令，不联网，不创建子任务，不增加功能。GPT 规划，用户确认后 DeepSeek 执行，GPT 根据实际工具记录复核。`,commandId:'online040-collaboration'});
    const s=await wait(id,true);assert.equal((await readFile(output,'utf8')).trim(),'DRAGON_COLLAB_040');assert.equal(s.collaborationState.stage,'completed');
    report.collaboration=s.collaborationState;await save();assert.equal(s.collaborationState.planner,'GPT',s.collaborationState.fallbackReason);assert.equal(s.collaborationState.reviewer,'GPT',s.collaborationState.fallbackReason);
    assert(!(s.tasks??[]).some(t=>t.parentId));return {model:model.model,effort:'high',planner:s.collaborationState.planner,reviewer:s.collaborationState.reviewer,dragonRequests:s.collaborationState.dragonRequests,gptUsage:s.collaborationState.gptUsage};
  });
  await check('Tavily real read-only search',async()=>{
    const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});await action({type:'session.permissionMode',id,mode:'auto'});
    await action({type:'session.send',id,text:'只读验收：使用 Tavily MCP 搜索 ComfyUI official documentation，仅查询一次，返回两个结果的名称和链接。不调用其他工具，不创建子任务，不修改任何文件。',commandId:'online040-tavily'});
    const s=await wait(id);assert(s.tools.some(t=>/tavily/.test(t.name)&&t.status==='completed'));return {sessionId:id,tools:s.tools.map(t=>({name:t.name,status:t.status}))};
  });
  report.status=report.checks.every(c=>c.status==='passed')?'passed':'partial';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{await save();await browser.close();}

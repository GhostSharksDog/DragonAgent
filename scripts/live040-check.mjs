// Real service acceptance in the original app's OS encryption context. Never prints secrets.
import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const env={...process.env};delete env.DRAGON_DATA_DIR;delete env.ELECTRON_RUN_AS_NODE;delete env.DRAGON_SMOKE;
const githubOnly=process.argv.includes('--github-only');
const workspace=path.resolve(`.runtime/live040-${Date.now()}`);await mkdir(workspace,{recursive:true});await mkdir('test-results',{recursive:true});
const report={mode:'actual-app-saved-credentials',startedAt:new Date().toISOString(),checks:[],status:'running'};
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});let page,original;
const action=a=>page.evaluate(a=>window.dragon.action(a),a),snapshot=()=>page.evaluate(()=>window.dragon.snapshot());
const save=()=>writeFile(githubOnly?'test-results/github040-live.json':'test-results/live040-check.json',JSON.stringify(report,null,2));
async function check(name,run){try{const result=await run();report.checks.push({name,status:'passed',result});}catch(e){report.checks.push({name,status:'failed',error:e.message});}await save();console.log(name+': '+report.checks.at(-1).status);}
async function wait(id,{plan=false,timeout=240000}={}){const answered=new Set();for(const until=Date.now()+timeout;Date.now()<until;){const s=(await snapshot()).sessions.find(s=>s.id===id);if(s.status==='error'||s.status==='paused')throw Error(s.error??'Task paused');
  for(const r of s.pending){if(answered.has(r.id))continue;answered.add(r.id);if(plan&&r.id===s.collaborationState?.confirmations){const p=s.collaborationState.plan;assert(p.goal&&p.steps.length);assert(p.steps.every(step=>!/(删除|安装|上传|推送)/.test(step.instructions)),'Plan exceeds read/local fixture task');await action({type:'request.answer',sessionId:id,id:r.id,value:{decision:'确认执行'}});}else throw Error('Unexpected approval: '+r.title);}
  if(s.status==='completed')return s;await new Promise(r=>setTimeout(r,500));}await action({type:'session.stop',id});throw Error('Live task timed out');}
try {
  await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);original=await snapshot();assert(!original.sessions.some(s=>['running','waiting','stopping'].includes(s.status)));
  const profile=original.settings.profiles.find(p=>new URL(p.baseUrl).hostname==='api.deepseek.com'&&p.hasKey);assert(profile,'Missing real DeepSeek profile');
  if(githubOnly){
    await check('GitHub real read-only call',async()=>{
      await action({type:'mcp.connect'});const state=await snapshot();const github=state.mcp.find(m=>m.id==='github');assert.equal(github?.state,'connected',github?.error??'GitHub 未连接');
      const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});await action({type:'session.permissionMode',id,mode:'auto'});
      await action({type:'session.send',id,text:'只读验收：调用 GitHub MCP 搜索 GhostSharksDog/DragonAgent 仓库，报告仓库名称和 URL。不要修改仓库，不创建 Issue 或 PR，不创建子任务，不调用其他工具。',commandId:'live040-github-'+Date.now()});
      const s=await wait(id);assert(s.tools.some(t=>/github/.test(t.name)&&t.status==='completed'));
      return {sessionId:id,tools:s.tools.map(t=>({name:t.name,status:t.status}))};
    });
    report.status=report.checks.every(c=>c.status==='passed')?'passed':'failed';
  } else {
  await check('DeepSeek balance',async()=>{await action({type:'provider.balance.refresh',profileId:profile.id,force:true});const b=(await snapshot()).balances.find(b=>b.profileId===profile.id);assert.equal(b.status,'ready',b.error);return {currencies:b.balances.map(v=>v.currency),available:b.available};});
  await check('Codex model catalog and quota',async()=>{await action({type:'codex.models'});const c=(await snapshot()).codexCatalog;assert.equal(c.status,'ready',c.error);await action({type:'quota.refresh'});const q=(await snapshot()).quota;assert.equal(q.status,'ready',q.error);return {models:c.models.map(m=>m.model),quotaWindows:q.buckets.map(b=>({id:b.id,primary:!!b.primary,secondary:!!b.secondary}))};});
  await check('DeepSeek live Search Fetch and image analysis',async()=>{
    const image=path.join(workspace,'vision.png');await sharp(Buffer.from('<svg width="300" height="200"><rect width="300" height="200" fill="#fff"/><rect x="30" y="30" width="100" height="100" fill="#7b4eb0"/><text x="20" y="170" font-size="28" fill="#111">DRAGON 040</text></svg>')).png().toFile(image);
    const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});await action({type:'session.permissionMode',id,mode:'auto'});await action({type:'session.attachDrop',id,files:[{path:image,name:'vision.png'}]});
    const s=(await snapshot()).sessions.find(s=>s.id===id),attachmentId=s.draftAttachments[0].id;
    await action({type:'session.send',id,text:`只读验收：使用 deepseek_web_search 搜索 DeepSeek Search Fetch documentation，count=2；使用 deepseek_web_fetch 读取 https://api-docs.deepseek.com/guides/search/；使用 image_analyze 分析附件 ${attachmentId} 的颜色与文字。只调用这三项，不修改文件、不创建子任务，报告真实结果。`,commandId:'live040-tools'});
    const result=await wait(id);for(const name of ['deepseek_web_search','deepseek_web_fetch','image_analyze'])assert(result.tools.some(t=>t.name===name&&t.status==='completed'),name+' failed');return {sessionId:id,tools:result.tools.map(t=>({name:t.name,status:t.status})),requests:result.tasks.find(t=>!t.parentId)?.requests};
  });
  await check('GPT planning DeepSeek execution GPT review',async()=>{
    const catalog=(await snapshot()).codexCatalog,model=catalog.models.find(m=>/astra/i.test(m.model))??catalog.models.find(m=>m.isDefault);assert(model,'Codex has no model');
    const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});await action({type:'session.permissionMode',id,mode:'auto'});await action({type:'session.collaboration',id,config:{enabled:true,plannerModel:model.model,effort:model.efforts.some(e=>e.value==='high')?'high':model.defaultEffort}});
    const output=path.join(workspace,'collaboration.txt');await action({type:'session.send',id,text:`这是有限范围的协作连通性验收。只在 ${output} 写入 DRAGON_COLLAB_040，然后读取核对内容。不访问其他目录，不运行命令，不联网，不创建子任务，不增加额外功能。GPT 先规划，确认后让 DeepSeek 执行，最后 GPT 按工具记录复核。`,commandId:'live040-collaboration'});
    const s=await wait(id,{plan:true,timeout:360000});assert.equal((await readFile(output,'utf8')).trim(),'DRAGON_COLLAB_040');assert.equal(s.collaborationState.stage,'completed');assert.equal(s.collaborationState.planner,'GPT',s.collaborationState.fallbackReason);assert.equal(s.collaborationState.reviewer,'GPT');return {sessionId:id,model:model.model,effort:s.collaboration.effort,planner:s.collaborationState.planner,reviewer:s.collaborationState.reviewer,dragonRequests:s.collaborationState.dragonRequests,gptUsage:s.collaborationState.gptUsage};
  });
  await check('Tavily and GitHub MCP discovery',async()=>{await action({type:'mcp.connect'});const state=await snapshot();const tavily=state.mcp.find(m=>m.id==='tavily');assert.equal(tavily?.state,'connected',tavily?.error);return {tavilyTools:tavily.tools,github:state.mcp.find(m=>m.id==='github')?.state??'credential-not-configured'};});
  // Keep the real app open while the user supplies their optional service credentials.
  await action({type:'window.workbench',page:'workshop'});console.log('READY_FOR_CREDENTIALS');report.status='waiting-for-service-credentials';await save();
  const control=path.resolve('.cache/live040-control.json');
  for(const until=Date.now()+60*60*1000;Date.now()<until;){if(existsSync(control)){const input=JSON.parse(await readFile(control,'utf8'));if(input.command==='finish')break;if(input.command==='download'&&!report.downloadAttempted){report.downloadAttempted=true;await check('Civitai authenticated LoRA download',async()=>{
      const id=await action({type:'workshop.create',commandId:'live040-download-'+Date.now(),name:'真实 Civitai 下载验收'});const state=await snapshot();await action({type:'workshop.settings',settings:{...state.workshop.settings,modelsRoot:'E:/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI/models'}});
      const candidates=await action({type:'workshop.lora.search',id,query:'https://civitai.com/models/2657988?modelVersionId=2984632'}),candidate=candidates.find(c=>c.versionId===2984632&&c.compatible);assert(candidate,'Compatible candidate unavailable');await action({type:'workshop.lora.install',id,versionId:candidate.versionId});const project=(await snapshot()).workshop.projects.find(p=>p.id===id);assert.equal(project.lora.sha256,candidate.sha256);return {sha256:project.lora.sha256,file:project.lora.file};
    });}if(input.command==='github'&&!report.githubAttempted){report.githubAttempted=true;await check('GitHub real read-only call',async()=>{await action({type:'mcp.connect'});const state=await snapshot();assert.equal(state.mcp.find(m=>m.id==='github')?.state,'connected');const id=await action({type:'session.create',backend:'dragon',profileId:profile.id,workspace});await action({type:'session.permissionMode',id,mode:'auto'});await action({type:'session.send',id,text:'只读验收：调用 GitHub MCP 搜索 GhostSharksDog/DragonAgent 仓库，报告仓库名称和 URL。不要修改仓库，不创建 Issue 或 PR，不调用其他工具。',commandId:'live040-github'});const s=await wait(id);assert(s.tools.some(t=>/github/.test(t.name)&&t.status==='completed'));return {sessionId:id,tools:s.tools.map(t=>({name:t.name,status:t.status}))};});}}
    await new Promise(r=>setTimeout(r,1000));}
  report.status=report.checks.every(c=>c.status==='passed')?'passed':'partial';
  }
}catch(e){report.status='failed';report.error=e.message;console.error(e.message);}
finally {await save();if(page)await page.screenshot({path:'test-results/live040-workbench.png'}).catch(()=>{});await app.evaluate(({app})=>app.quit()).catch(()=>{});console.log('Live report saved');}

import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const env={...process.env};delete env.DRAGON_DATA_DIR;delete env.ELECTRON_RUN_AS_NODE;
const workspace=path.resolve(`.runtime/deepseek-search-live-${Date.now()}`);await mkdir(workspace,{recursive:true});
const app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],env,timeout:45000});
let page,id,selected;const report={status:'running',search:false,fetch:false,autoApproval:false};
try{await app.firstWindow();await new Promise(r=>setTimeout(r,600));page=app.windows().find(w=>w.url().includes('view=workbench'));const state=await page.evaluate(()=>window.dragon.snapshot());selected=state.selectedSessionId;
 assert(!state.sessions.some(s=>['running','waiting','stopping'].includes(s.status)));
 const profile=state.settings.profiles.find(p=>new URL(p.baseUrl).hostname==='api.deepseek.com'&&p.deepseekSearch!==false);assert(profile,'DeepSeek 官方配置未启用');
 id=await page.evaluate(args=>window.dragon.action({type:'session.create',backend:'dragon',...args}),{workspace,profileId:profile.id});
 await page.evaluate(id=>window.dragon.action({type:'session.permissionMode',id,mode:'auto'}),id);
 await page.evaluate(id=>window.dragon.action({type:'session.send',id,text:'只读连通性验收：请使用 deepseek_web_search 搜索 DeepSeek Search Fetch API documentation，count=2；再用 deepseek_web_fetch 读取 https://api-docs.deepseek.com/guides/search/ 。只执行这两次网页查询，不调用其他工具、不创建子任务。简要说明结果并给出来源，最后用你自己的龙娘口吻介绍一下你的名字、发色和眼睛。',commandId:`search-fetch-${Date.now()}`}),id);
 for(const until=Date.now()+180000;Date.now()<until;){const s=await page.evaluate(async id=>(await window.dragon.snapshot()).sessions.find(s=>s.id===id),id);if(s.status==='error')throw Error(s.error);assert(!s.pending.length,'Auto mode unexpectedly requested approval');if(s.status==='completed'){
 report.search=s.tools.some(t=>t.name==='deepseek_web_search'&&t.status==='completed'&&/https?:/.test(t.result??''));report.fetch=s.tools.some(t=>t.name==='deepseek_web_fetch'&&t.status==='completed');assert(report.search&&report.fetch);
 report.autoApproval=true;report.reply=s.messages.filter(m=>m.role==='assistant').map(m=>m.text).join('\n').slice(0,1200);report.status='passed';break;}await new Promise(r=>setTimeout(r,250));}
 assert.equal(report.status,'passed','Online search/fetch timed out');
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{if(page&&id){await page.evaluate(async id=>{const s=(await window.dragon.snapshot()).sessions.find(s=>s.id===id);if(['running','waiting','stopping'].includes(s.status))await window.dragon.action({type:'session.stop',id});},id).catch(()=>{});await page.evaluate(id=>window.dragon.action({type:'session.archive',id}),id).catch(()=>{});}if(page&&selected)await page.evaluate(id=>window.dragon.action({type:'session.select',id}),selected).catch(()=>{});await writeFile('test-results/deepseek-search-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.evaluate(({app})=>app.quit());}

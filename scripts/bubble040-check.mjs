import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import{createServer}from'node:http';import{mkdir,writeFile}from'node:fs/promises';import path from'node:path';import assert from'node:assert/strict';
const home=path.resolve('.runtime/bubble040-'+Date.now());await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const server=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);let text;
  if(!body.tools?.length){const data=JSON.parse(body.messages.at(-1).content);text=JSON.stringify({sessionId:data.candidates.find(c=>data.text.includes('网页')&&c.title.includes('网页'))?.id??null});}
  else text='**结论**：==重点内容==\n\n> [!TIP]\n> 保持原有草稿。\n\n| 项目 | 状态 |\n| --- | --- |\n| 文件 | 已完成 |';
  await new Promise(r=>setTimeout(r,500));res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{role:'assistant',content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],env:{...process.env,DRAGON_DATA_DIR:home},timeout:45000});let page;
const report={checks:[],passed:false};
try{await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);const act=a=>page.evaluate(a=>window.dragon.action(a),a),snap=()=>page.evaluate(()=>window.dragon.snapshot());
  const until=async predicate=>{for(const end=Date.now()+20000;Date.now()<end;){if(predicate(await snap()))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for application state');};
  const wait=id=>until(s=>s.sessions.find(s=>s.id===id)?.status==='completed');
  await act({type:'profile.save',profile:{id:'fixture',name:'模拟账户',provider:'custom',protocol:'openai-completions',baseUrl:`http://127.0.0.1:${server.address().port}`,model:'fixture',contextWindow:32768,maxOutput:4096,hasKey:false},apiKey:'fixture'});
  const a=await act({type:'session.create',backend:'dragon'});await act({type:'session.send',id:a,text:'网页设计项目',commandId:'first'});await wait(a);
  await act({type:'session.draft',id:a,text:'工作台未发送草稿'});await act({type:'session.attachDrop',id:a,files:[{name:'workbench.txt',data:[65]}]});
  const b=await act({type:'session.create',backend:'dragon'});
  await act({type:'pet.chat.attach',files:[{name:'pet.txt',data:[66]}]});
  const command={type:'pet.chat.send',text:'网页项目继续优化',commandId:'pet-once'};const ids=await Promise.all([act(command),act(command)]);assert.deepEqual(ids,[a,a]);await wait(a);
  let s=await snap(),target=s.sessions.find(v=>v.id===a);assert.equal(s.selectedSessionId,b);assert.equal(target.draft,'工作台未发送草稿');assert.equal(target.draftAttachments[0].name,'workbench.txt');assert.equal(target.messages.filter(m=>m.commandId==='pet-once').length,1);assert.equal(target.messages.find(m=>m.commandId==='pet-once').attachments[0].name,'pet.txt');assert.equal(s.petChat.attachments.length,0);
  report.checks.push('Automatic routing preserves workbench focus, draft and attachments; duplicate request executes once');
  const fresh=await act({type:'pet.chat.send',text:'完全无关的新话题',commandId:'new-topic'});assert.notEqual(fresh,a);await wait(fresh);assert.equal((await snap()).sessions.find(s=>s.id===fresh).permissionMode,'ask');
  await act({type:'pet.chat.bind',id:a,pinned:true});await act({type:'pet.chat.send',text:'第一项',commandId:'busy-first'});await act({type:'pet.chat.send',text:'排队项',commandId:'busy-second'});await until(s=>s.sessions.some(v=>v.messages.some(m=>m.commandId==='busy-second')&&v.status==='completed'));
  report.checks.push('No match creates ask-permission chat; pinned busy chat queues and sends in order');
  await act({type:'settings.save',pet:{visible:true}});await act({type:'pet.chatMode',mode:'detailed'});await act({type:'pet.view',view:'reply'});const bubble=app.windows().find(p=>p.url().includes('view=bubble'));assert(bubble);
  assert(await bubble.locator('mark').count());assert(await bubble.locator('.message-callout.tip').count());
  const close=bubble.getByRole('button',{name:'收起气泡',exact:true});assert.equal(Math.round((await close.boundingBox()).width),36);await close.click();assert.equal((await snap()).petView,'hidden');
  await act({type:'pet.view',view:'quota'});await bubble.getByLabel('选择额度或余额账户').selectOption('fixture');await bubble.getByText('此供应商暂不支持余额查询').waitFor();await bubble.screenshot({path:'test-results/bubble040-balance.png'});await close.click();await new Promise(r=>setTimeout(r,1200));assert.equal((await snap()).petView,'hidden');
  await act({type:'pet.view',view:'reply'});await bubble.keyboard.press('Escape');assert.equal((await snap()).petView,'hidden');report.checks.push('Styled emphasis/callout, balance switching, 36px real close click, refresh cannot reopen, Escape closes');
  for(const theme of ['light','dark'])for(const zoom of [1,1.5]){
    await act({type:'settings.save',theme});await act({type:'pet.view',view:'quota'});
    await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=bubble')).webContents.setZoomFactor(zoom),zoom);
    await bubble.getByLabel('选择额度或余额账户').selectOption('fixture');
    assert(await bubble.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Bubble horizontal overflow');
    await close.click();assert.equal((await snap()).petView,'hidden');
  }
  report.checks.push('Both themes at 100% and 150%: no horizontal overflow, close remains clickable');report.passed=true;
}catch(e){report.error=e.message;process.exitCode=1;}finally{await writeFile('test-results/bubble040-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.evaluate(({app})=>app.quit()).catch(()=>{});server.close();}

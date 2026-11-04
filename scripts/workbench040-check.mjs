// Integrated desktop acceptance with local protocol fixtures; not live model validation.
import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import path from 'node:path';
const home=path.resolve(`.runtime/workbench040-${Date.now()}`);await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const database=path.join(home,'data.db'),pdf=path.join(home,'sample.pdf'),large=path.join(home,'large.txt');
const db=new DatabaseSync(database);db.exec('CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES (\'READ_ONLY_OK\')');db.close();
await writeFile(large,'银白紫瞳\n'.repeat(50000));
const report={mode:'local-model-fixture-real-desktop',checks:[],passed:false};let versionBRequests=0;
const plan={goal:'写入协作验收文件',steps:[{id:'one',title:'写入文件',instructions:'只写入工作目录下的协作文件',dependsOn:[],outputs:['collaboration.txt'],checks:['内容与请求一致']}],checks:['文件实际存在']};
const html=`<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;padding:20px;background:white;color:#222}button{padding:10px}</style><h1>交互成品</h1><button onclick="document.querySelector('output').textContent='CLICK_OK'">点我</button><output></output><script>window.isolated=!window.dragon&&typeof require==='undefined';window.networkBlocked=false;fetch('https://example.com').catch(()=>window.networkBlocked=true);</script>`;
const server=createServer(async(req,res)=>{try{
  let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw),messages=body.messages??[];
  const lastUser=messages.findLastIndex(m=>m.role==='user'),prompt=messages[lastUser]?.content??'',tools=messages.slice(lastUser+1).filter(m=>m.role==='tool');
  let delta,done=false;
  if(!body.tools?.length){delta={role:'assistant',content:JSON.stringify(String(prompt).includes('复核助手')?{passed:true,summary:'文件工具已返回成功，验收记录存在。',fixes:[],scopeChanged:false}:plan)};done=true;}
  else {
    const variant=String(prompt).includes('版本B')?'B':'A',collab=String(prompt).includes('已确认的执行计划');
    if(variant==='B'){versionBRequests++;assert(!messages.some(m=>m.role==='assistant'&&String(m.content).includes('ANSWER_A')),'Edited context contains replaced answer');}
    const calls=collab?[['pet_files_write',{path:path.join(home,'collaboration.txt'),content:'COLLAB_OK'}]]:[
      ['pet_files_write',{path:path.join(home,`preview-${variant}.html`),content:html}],
      ['pet_artifact_publish',{paths:[pdf,large]}],
      ['sqlite_read',{path:database,query:'SELECT value FROM evidence'}],
      ['local_time',{timezone:'Asia/Shanghai'}],
      ['pet_terminal',{command:"Write-Output 'STREAM_ONE'; Start-Sleep -Milliseconds 300; Write-Output 'STREAM_TWO'"}],
    ];
    if(tools.length<calls.length){const [name,args]=calls[tools.length];delta={role:'assistant',tool_calls:[{index:0,id:`${collab?'collab':variant}-${tools.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]};}
    else {delta={role:'assistant',content:`# ANSWER_${variant}\n\n段落一。\n\n- 列表\n\n| 检查 | 结果 |\n| --- | --- |\n| 文件 | 成功 |\n\n\`\`\`ts\nconst checked = true;\n\`\`\`\n\n[预览文件](${path.join(home,`preview-${variant}.html`).replaceAll('\\','/')})`};done=true;}
  }
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}],usage:{prompt_tokens:120,completion_tokens:60}})}\n\ndata: [DONE]\n\n`);
}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let app,page;const action=a=>page.evaluate(a=>window.dragon.action(a),a);
const snapshot=()=>page.evaluate(()=>window.dragon.snapshot());
async function wait(id,predicate,timeout=60000){for(const until=Date.now()+timeout;Date.now()<until;){const s=(await snapshot()).sessions.find(s=>s.id===id);if(s.status==='error')throw Error(s.error);if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('Desktop acceptance timed out');}
try {
  app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],env:{...process.env,DRAGON_DATA_DIR:home},timeout:45000});await app.firstWindow();
  for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);
  await page.waitForFunction(()=>!!window.dragon);
  const pdfBytes=await app.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({show:false});try{await w.loadURL('data:text/html,<h1>PDF_PREVIEW_OK</h1>');return (await w.webContents.printToPDF({})).toString('base64');}finally{w.destroy();}});await writeFile(pdf,Buffer.from(pdfBytes,'base64'));
  await action({type:'profile.save',profile:{id:'fixture',name:'本地验收',provider:'custom',protocol:'openai-completions',baseUrl:`http://127.0.0.1:${server.address().port}`,model:'deepseek-fixture',contextWindow:32768,maxOutput:4096,hasKey:false},apiKey:'fixture'});
  const id=await action({type:'session.create',backend:'dragon',workspace:home});await action({type:'session.permissionMode',id,mode:'auto'});
  await action({type:'session.send',id,text:'版本A：文件与消息版本验收',commandId:'a'});let s=await wait(id,s=>s.status==='completed');
  assert(s.tools.some(t=>t.name==='sqlite_read'&&t.result.includes('READ_ONLY_OK')));assert(s.tools.some(t=>t.name==='pet_terminal'&&t.exitCode===0&&t.result.includes('STREAM_TWO')));
  assert.equal(await page.locator('.message.user .message-content').count(),1);assert.equal(await page.locator('.message.user .icon-copy svg').count(),1);assert.equal(await page.locator('.message.assistant table').count(),1);
  report.checks.push('Inline actual tools, SQLite read, terminal output and exit code; Markdown table and user bubble copy icon');
  await action({type:'artifact.preview',sessionId:id,artifactId:s.artifacts.find(a=>a.name==='preview-A.html').id});
  const frame=page.frameLocator('.artifact-frame');await frame.getByRole('button',{name:'点我'}).click();assert.equal(await frame.locator('output').innerText(),'CLICK_OK');
  assert(await frame.locator('body').evaluate(()=>window.isolated));await page.waitForTimeout(200);assert(await frame.locator('body').evaluate(()=>window.networkBlocked));
  report.checks.push('Isolated HTML executes UI script, denies network and exposes neither Node nor application bridge');
  await action({type:'artifact.preview',sessionId:id,artifactId:s.artifacts.find(a=>a.name==='sample.pdf').id});assert.equal((await snapshot()).artifactPreview.pages,1);assert((await snapshot()).artifactPreview.url.startsWith('data:image/'));
  await action({type:'artifact.preview',sessionId:id,artifactId:s.artifacts.find(a=>a.name==='large.txt').id});const first=(await snapshot()).artifactPreview;assert(first.nextOffset>0);await action({type:'artifact.preview',sessionId:id,artifactId:first.artifact.id,offset:first.nextOffset});const second=(await snapshot()).artifactPreview;assert(!second.text.includes('\uFFFD'));assert(second.offset>0);
  report.checks.push('PDF page rendered safely; large UTF-8 text paged without broken characters');
  await action({type:'session.resend',id,messageId:s.messages.find(m=>m.role==='user').id,text:'版本B：重新生成',commandId:'b'});s=await wait(id,s=>s.status==='completed');assert(versionBRequests>0);assert(s.messages.some(m=>m.text.includes('ANSWER_B')));assert(await readFile(path.join(home,'preview-A.html'),'utf8'));
  const old=s.versions[0].id;await action({type:'session.version',id,versionId:old});s=(await snapshot()).sessions.find(s=>s.id===id);assert(s.messages.some(m=>m.text.includes('ANSWER_A')));assert(!s.messages.some(m=>m.text.includes('ANSWER_B')));
  report.checks.push('Edit rerun restores independent context; versions switch in same chat and old file side effects remain');
  await action({type:'settings.save',codexPath:path.join(home,'missing-codex.exe')});const collab=await action({type:'session.create',backend:'dragon',workspace:home});await action({type:'session.permissionMode',id:collab,mode:'auto'});await action({type:'session.collaboration',id:collab,config:{enabled:true}});
  await action({type:'session.send',id:collab,text:'协作验收，只写入测试文件',commandId:'collab'});s=await wait(collab,s=>s.pending.some(r=>r.title==='确认协作计划'));assert.equal(s.tools.length,0);assert.equal(s.collaborationState.planner,'DeepSeek');
  await page.getByRole('button',{name:'确认并执行',exact:true}).click();s=await wait(collab,s=>s.status==='completed');assert.equal(await readFile(path.join(home,'collaboration.txt'),'utf8'),'COLLAB_OK');assert.equal(s.collaborationState.reviewer,'DeepSeek');assert.equal(s.collaborationState.dragonRequests,4);
  report.checks.push('Unavailable GPT explicitly falls back; auto permission still waits for plan confirmation; complete execution/review and shared request accounting');
  for(const theme of ['light','dark']){await action({type:'settings.save',theme});await page.screenshot({path:`test-results/workbench040-${theme}.png`});}
  await action({type:'layout.save',leftCollapsed:true,rightCollapsed:true});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench')).setSize(900,650));await page.screenshot({path:'test-results/workbench040-compact.png'});
  report.passed=true;
}catch(error){report.error=error.message;if(page)await page.screenshot({path:'test-results/workbench040-failure.png'}).catch(()=>{});throw error;}
finally{await writeFile('test-results/workbench040-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(app)await app.evaluate(({app})=>app.quit()).catch(()=>{});server.close();}


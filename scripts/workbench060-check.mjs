import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {Store,initialState} from '../src/main/store.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const home=path.resolve('.runtime/workbench060-'+Date.now());await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const store=new Store(home),state=initialState(),now=Date.now();
state.settings.layout={leftCollapsed:true,rightCollapsed:true};state.settings.profiles=[{id:'fixture',name:'验收模型',provider:'custom',protocol:'openai-completions',baseUrl:'http://127.0.0.1:1',model:'fixture',contextWindow:524288,maxOutput:32768,hasKey:false}];state.settings.selectedProfile='fixture';
const messages=Array.from({length:500},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'历史消息 '+i,createdAt:now+i,sequence:i+1,runId:'old'}));
messages.push({id:'before',role:'assistant',text:'我会检查文件并执行验证，然后汇总结果。',createdAt:now+501,sequence:501,runId:'run'});
const tools=Array.from({length:10},(_,i)=>({id:'tool'+i,name:i<3?'pet_files_write':'pet_terminal',arguments:JSON.stringify(i<3?{path:'E:\\Example\\File'+i+'.tsx',content:'test'}:{command:'RAW_COMMAND '+i}),result:'执行结果 '+i,status:'completed',createdAt:now+502+i,sequence:502+i,runId:'run'}));
messages.push({id:'after',role:'assistant',text:'## 已完成修改\n\n正文会随窗口调整宽度，**重要结论保持清晰**。\n\n| 项目 | 结果 |\n|---|---|\n| 文件修改 | 已完成 |\n| 验证 | 已通过 |\n\n```ts\nconst example = "'+ 'long-content-'.repeat(40)+'";\n```\n\n长路径：`E:/'+ 'LongDirectory/'.repeat(30)+'file.ts`',createdAt:now+513,sequence:513,runId:'run'});
const attempt=(id,input,output,cacheRead)=>({id,profileId:'fixture',agentId:'s',runId:'run',startedAt:now,status:'completed',purpose:'response',usage:{input,output,cacheRead,reported:true}});
state.sessions=[{id:'s',title:'0.6 排版验收',backend:'dragon',profileId:'fixture',status:'completed',runId:'run',messages,tools,pending:[],origins:[],browserInput:false,terminalEnabled:false,draft:'',createdAt:now,updatedAt:now,permissionMode:'ask',usage:{input:999999,output:999999,context:32768,window:524288,estimated:true,calibrated:true},attempts:[attempt('a',10000,2000,8000),attempt('a',12000,2500,9000),attempt('b',6000,1500,6000)]}];state.selectedSessionId='s';store.save(state);store.close();
const env={...process.env,DRAGON_DATA_DIR:home};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});
const report={passed:false,checks:[],matrix:[]};let page;
try{
 await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);
 await page.locator('.operations-group').waitFor();
 assert.equal(await page.locator('.token-analysis,.timeline-search,.history-search').count(),0);
 assert.match(await page.locator('.token-total').innerText(),/22K/);assert.match(await page.locator('.context-summary').innerText(),/6.3%/);
 assert.equal(await page.locator('.operations-group').count(),1);const group=page.locator('.operations-group');assert.equal(await group.getAttribute('open'),null);assert.equal(await page.locator('.operation-row').first().isVisible(),false);
 await group.locator('summary').click();assert.equal(await page.locator('.operation-row:visible').count(),10);assert(!await page.locator('.conversation').innerText().then(t=>t.includes('RAW_COMMAND')));assert.equal(await group.locator('details').count(),0);
 report.checks.push('两段文字间十项操作共用一个折叠组；展开不显示原始命令','去除搜索和输入栏上方分析；请求去重统计 22K、上下文 6.3%');
 for(const width of [900,1100,1440])for(const scale of [1,1.5,2]){
  await app.evaluate(({BrowserWindow},{width,scale})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.setBounds({width,height:850});w.webContents.setZoomFactor(scale);},{width,scale});await page.waitForTimeout(80);
  await group.locator('summary').scrollIntoViewIfNeeded();
  const dimensions=await page.evaluate(()=>{const conversation=document.querySelector('.conversation'),before=document.querySelector('[data-entry="before"] .message-content'),summary=document.querySelector('.operations-group>summary'),after=document.querySelector('[data-entry="after"] .message-content');return {client:conversation.clientWidth,scroll:conversation.scrollWidth,before:before.getBoundingClientRect().left,summary:summary.getBoundingClientRect().left,after:after.getBoundingClientRect().left,doc:document.documentElement.scrollWidth,viewport:innerWidth};});
  assert(dimensions.scroll<=dimensions.client+1,JSON.stringify(dimensions));assert(dimensions.doc<=dimensions.viewport+1,JSON.stringify(dimensions));assert(Math.abs(dimensions.before-dimensions.summary)<2,JSON.stringify(dimensions));assert(Math.abs(dimensions.after-dimensions.summary)<2,JSON.stringify(dimensions));report.matrix.push({width,scale,...dimensions});
  if(width===1440&&scale===1){await page.screenshot({path:'test-results/workbench060-operations-expanded.png'});await group.locator('summary').click();await page.screenshot({path:'test-results/workbench060-operations-collapsed.png'});await group.locator('summary').click();}
 }
 await page.getByRole('button',{name:'加载更早记录'}).click();assert((await page.locator('.timeline-entry').count())>100);report.checks.push('500 条历史分段加载，三种宽度与缩放下正文和操作左边缘对齐，无页面横向溢出');
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.setBounds({width:1440,height:900});w.webContents.setZoomFactor(1);});
 await page.evaluate(()=>window.dragon.action({type:'layout.save',leftCollapsed:false}));
 if(await group.getAttribute('open')!==null)await group.locator('summary').click();
 await group.locator('summary').scrollIntoViewIfNeeded();
 for(const theme of ['light','dark']){await page.evaluate(theme=>window.dragon.action({type:'settings.save',theme}),theme);await page.waitForTimeout(100);const frame=await page.locator('.main-area').evaluate(el=>({radius:getComputedStyle(el).borderRadius,x:el.getBoundingClientRect().x,top:el.getBoundingClientRect().top}));assert.equal(frame.radius,'18px');assert(frame.top>=36&&frame.x>=220);await page.screenshot({path:'test-results/workbench060-layered-'+theme+'.png'});}
 report.checks.push('浅深色双层工作台、外层导航与独立圆角内容面板');
 report.passed=true;console.log('Workbench 060 PASS');
}catch(error){report.error=error.stack;if(page)await page.screenshot({path:'test-results/workbench060-failure.png'}).catch(()=>{});throw error;}
finally{await writeFile('test-results/workbench060.json',JSON.stringify(report,null,2));await app.close();}

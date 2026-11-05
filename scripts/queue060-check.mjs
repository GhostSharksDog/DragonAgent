import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const home=path.resolve('.runtime/queue060-'+Date.now());await mkdir(home,{recursive:true});
const requests=[],held=[];let hold=true;
const server=createServer(async(req,res)=>{const parts=[];for await(const p of req)parts.push(p);requests.push(JSON.parse(Buffer.concat(parts).toString()));const finish=()=>{if(res.destroyed)return;res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'已处理'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:5}})+'\n\ndata: [DONE]\n\n');};if(hold)held.push(finish);else finish();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,DRAGON_DATA_DIR:home};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const open=async()=>{app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});await app.firstWindow();for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('view=workbench'));if(page)break;await new Promise(r=>setTimeout(r,100));}};
const act=a=>page.evaluate(a=>window.dragon.action(a),a),snap=()=>page.evaluate(()=>window.dragon.snapshot());
const wait=async(test)=>{for(let i=0;i<200;i++){const s=await snap();if(test(s))return s;await new Promise(r=>setTimeout(r,50));}throw Error('状态等待超时');};
const report={passed:false,checks:[]};
try{
 await open();await act({type:'profile.save',profile:{id:'fixture',name:'fixture',provider:'custom',protocol:'openai-completions',baseUrl:`http://127.0.0.1:${server.address().port}`,model:'fixture',contextWindow:65536,maxOutput:4096,hasKey:false}});
 const id=await act({type:'session.create',backend:'dragon',profileId:'fixture'});const current=s=>s.sessions.find(s=>s.id===id);
 await act({type:'session.send',id,text:'first',commandId:'first'});await wait(()=>requests.length===1);
 await act({type:'session.attachDrop',id,files:[{name:'notes.txt',mime:'text/plain',data:[...Buffer.from('QUEUE_ATTACHMENT')]}]});
 const second={type:'session.send',id,text:'second',commandId:'second'};await Promise.all([act(second),act(second)]);let s=current(await snap());assert.equal(s.queuedMessages.length,1);assert.equal(s.queuedMessages[0].attachments.length,1);
 await act({type:'session.draft',id,text:'尚未发送的新草稿'});hold=false;held.shift()();await wait(s=>current(s).status==='completed'&&current(s).messages.filter(m=>m.role==='user').length===2);
 s=current(await snap());assert.equal(s.draft,'尚未发送的新草稿');assert.equal(s.messages.find(m=>m.commandId==='second').attachments.length,1);assert.equal(requests.length,2);report.checks.push('忙碌消息与附件独立排队；重复编号只入队一次；自动发送不覆盖新草稿');
 hold=true;await act({type:'session.send',id,text:'third',commandId:'third'});await wait(()=>requests.length===3);await act({type:'session.send',id,text:'fourth',commandId:'fourth'});await act({type:'session.stop',id});await wait(s=>current(s).status==='cancelled'&&current(s).queuedMessages[0]?.paused);assert.equal(requests.length,3);
 await app.close();app=undefined;page=undefined;hold=false;await open();s=current(await snap());assert.equal(s.queuedMessages[0].paused,true);assert.equal(requests.length,3);
 await act({type:'session.resumeQueued',id});await wait(s=>current(s).status==='completed'&&current(s).messages.some(m=>m.commandId==='fourth'));assert.equal(requests.length,4);report.checks.push('停止后队列暂停，重启不重放，显式继续才发送');
 report.passed=true;console.log('Queue 060 PASS');
}catch(e){report.error=e.stack;throw e;}finally{await writeFile('test-results/queue060.json',JSON.stringify(report,null,2));if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

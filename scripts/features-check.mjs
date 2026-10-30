import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve(`.runtime/features-${Date.now()}`),inside=path.join(dir,'workspace'),outside=path.join(dir,'outside.txt'); await mkdir(inside,{recursive:true});
const txt=path.join(dir,'notes.txt'),docx=path.join(dir,'notes.docx'),pdf=path.join(dir,'notes.pdf'),png=path.join(dir,'dragon.png');
await writeFile(txt,'TEXT_MARKER_441');
const require=createRequire(import.meta.url),Zip=createRequire(require.resolve('mammoth'))('jszip'),zip=new Zip();
zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX_MARKER_552</w:t></w:r></w:p></w:body></w:document>');await writeFile(docx,await zip.generateAsync({type:'nodebuffer'}));
let persona=false,attachments=false;
const server=createServer(async(req,res)=>{let input='';for await(const part of req)input+=part;const body=JSON.parse(input);persona ||= body.messages.some(m=>m.role==='system'&&m.content.includes('紫色眼睛')&&m.content.includes('霜璃'));
 const users=body.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:'').join('\n'),results=body.messages.filter(m=>m.role==='tool');let delta,done=false;
 const call=(name,args)=>({role:'assistant',tool_calls:[{index:0,id:`c${results.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 if(users.includes('附件验收')){attachments=['TEXT_MARKER_441','DOCX_MARKER_552','PDF_MARKER_663','CHAT_MARKER_776'].every(v=>users.includes(v));assert(attachments,'All extracted/reference contents must reach model');const refs=JSON.parse(users.slice(users.lastIndexOf('\n[')+1).trim());delta=results.length?{role:'assistant',content:'附件内容已核对。'}:call('pet_attachment_read',{id:refs.find(a=>a.mime==='image/png').id});done=!!results.length;}
 else if(users.includes('AUTO_CHECK')||users.includes('FULL_CHECK')){delta=results.length===0?call('pet_files_write',{path:outside,content:'FULL_OK'}):results.length===1?call('pet_terminal',{command:"Write-Output 'TERMINAL_OK'"}):{role:'assistant',content:'权限验收完成。'};done=results.length>=2;}
 else{delta={role:'assistant',content:'CHAT_MARKER_776 已记下。'};done=true;}
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],env:{...process.env,DRAGON_DATA_DIR:dir},timeout:45000});
let page,bubble;const report={persona:false,attachments:false,manualReadApproval:false,autoWithinScope:false,fullAcrossScope:false,commandAutoApproval:false};
async function wait(id,approve=false){for(const until=Date.now()+60000;Date.now()<until;){const s=await page.evaluate(async id=>(await window.dragon.snapshot()).sessions.find(s=>s.id===id),id);if(s.status==='error')throw Error(s.error);if(s.pending.length){assert(approve,'Auto mode must not ask approval');await bubble.getByRole('button',{name:'允许本次操作',exact:true}).click();report.manualReadApproval=true;}if(s.status==='completed')return s;await new Promise(r=>setTimeout(r,100));}throw Error('Feature task timeout');}
try{await app.firstWindow();await new Promise(r=>setTimeout(r,600));page=app.windows().find(w=>w.url().includes('view=workbench'));bubble=app.windows().find(w=>w.url().includes('view=bubble'));
 const pngBytes=await app.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({show:false});await w.loadURL('data:text/html,<p>PDF_MARKER_663</p>');const data=await w.webContents.printToPDF({});w.destroy();return data.toString('base64');});await writeFile(pdf,Buffer.from(pngBytes,'base64'));
 const skin=await page.evaluate(async()=>(await window.dragon.snapshot()).skin.manifest.animations.idle.frames[0]);await copyFile(path.join('assets/skins/silver-dragon-frames',skin),png);
 await page.evaluate(baseUrl=>window.dragon.action({type:'profile.save',profile:{id:'fixture',name:'验收',provider:'custom',protocol:'openai-completions',baseUrl,model:'fixture',contextWindow:524288,maxOutput:32768,hasKey:false},apiKey:'fixture'}),`http://127.0.0.1:${server.address().port}/v1`);
 await page.evaluate(()=>window.dragon.action({type:'pet.toggle'}));await page.evaluate(()=>window.dragon.action({type:'pet.view',view:'compose'}));await page.evaluate(()=>window.dragon.action({type:'pet.chatMode',mode:'detailed'}));
 const source=await page.evaluate(()=>window.dragon.action({type:'session.create',backend:'dragon'}));await page.evaluate(id=>window.dragon.action({type:'session.send',id,text:'历史资料 CHAT_MARKER_776',commandId:'source'}),source);await wait(source);
 let id=await page.evaluate(workspace=>window.dragon.action({type:'session.create',backend:'dragon',workspace}),inside);
 await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[txt,docx,pdf,png]);
 await page.getByRole('button',{name:'添加文件或关联聊天'}).click();await page.getByRole('menuitem',{name:'上传文件',exact:false}).click();await page.waitForFunction(async()=>{const state=await window.dragon.snapshot();return (state.sessions.find(s=>s.id===state.selectedSessionId).draftAttachments??[]).length===4;},{},{timeout:30000});
 const meta=await page.evaluate(async()=>{const state=await window.dragon.snapshot();return state.sessions.find(s=>s.id===state.selectedSessionId).draftAttachments;});assert(meta.every(a=>!a.extractionError),JSON.stringify(meta));
 await page.getByRole('button',{name:'添加文件或关联聊天'}).click();await page.getByRole('menuitem',{name:'关联聊天记录',exact:false}).click();await page.getByRole('dialog',{name:'关联聊天记录'}).getByRole('button',{name:'历史资料 CHAT_MARKER_776',exact:false}).click();
 assert.equal(await bubble.locator('.attachment-chip').count(),5);
 await page.getByRole('textbox',{name:'发送给龙娘的消息'}).fill('附件验收');await page.getByRole('button',{name:'发送消息',exact:true}).click();await wait(id,true);
 id=await page.evaluate(workspace=>window.dragon.action({type:'session.create',backend:'dragon',workspace}),inside);
 await page.getByLabel('当前对话权限等级').click();await page.getByRole('menuitemradio',{name:/帮我批准/}).click();await bubble.waitForFunction(()=>document.querySelector('.permission-trigger')?.dataset.mode==='auto');
 await page.evaluate(id=>window.dragon.action({type:'session.send',id,text:'AUTO_CHECK',commandId:'auto'}),id);let result=await wait(id);assert(result.tools.some(t=>t.name==='pet_files_write'&&t.status==='error'));assert(result.tools.some(t=>t.name==='pet_terminal'&&t.result?.includes('TERMINAL_OK')));report.autoWithinScope=true;report.commandAutoApproval=true;
 const full=await page.evaluate(workspace=>window.dragon.action({type:'session.create',backend:'dragon',workspace}),inside);await page.getByLabel('当前对话权限等级').click();await page.getByRole('menuitemradio',{name:/完全放开/}).click();await page.evaluate(id=>window.dragon.action({type:'session.send',id,text:'FULL_CHECK',commandId:'full'}),full);result=await wait(full);assert.equal(await readFile(outside,'utf8'),'FULL_OK');report.fullAcrossScope=true;
 report.persona=persona;report.attachments=attachments;await page.screenshot({path:'test-results/features-workbench.png'});await bubble.screenshot({path:'test-results/features-bubble.png'});await writeFile('test-results/features-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.evaluate(({app})=>app.quit());server.close();}

import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const live=process.argv.includes('--live'),dataDir=path.resolve(`.runtime/creative-ui031-${Date.now()}`),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;if(!live)env.DRAGON_DATA_DIR=dataDir;else delete env.DRAGON_DATA_DIR;
await mkdir('test-results',{recursive:true});
const app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],env,timeout:45000});
const report={mode:live?'actual-app-saved-credentials':'isolated-Electron-UI',checks:[],passed:false};let page;
try{
 await app.firstWindow();for(let i=0;i<100;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(page)break;await new Promise(r=>setTimeout(r,100));}assert(page);
 const state=await page.evaluate(()=>window.dragon.snapshot());assert(!state.sessions.some(s=>['running','waiting','stopping'].includes(s.status)),'Active chat task');
 const id=await page.evaluate(()=>window.dragon.action({type:'workshop.create',commandId:'creative-ui-'+Date.now(),name:'0.3.1 创作验收'}));
 if(live){
   if(!process.argv.includes('--download')){
   const profile=state.settings.profiles.find(p=>p.id===state.settings.selectedProfile)??state.settings.profiles[0];assert(profile,'No text model configured');
   await page.evaluate(async({id,profileId})=>window.dragon.action({type:'workshop.assistant.send',id,profileId,text:'请用中文回复，并调用 revise_character 把本项目设定为成年银白紫瞳龙娘、紫色长外套、全身站立、简单背景，整理 Anima 正负面提示词并保存。不要联网搜索，不要开始生成。'}),{id,profileId:profile.id});
   const deadline=Date.now()+180000;while(true){const status=await page.evaluate(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id).assistant?.status,id);if(status&&status!=='running')break;if(Date.now()>deadline)throw Error('Creative assistant live timeout');await new Promise(r=>setTimeout(r,500));}
   const p=await page.evaluate(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id),id);assert.equal(p.assistant.status,'idle',p.assistant.error);assert(p.revisions?.length,'Assistant did not save parameters');report.checks.push('Saved model credentials work in actual app; Chinese assistant updated project prompts');
   }
   try{const candidates=await page.evaluate(id=>window.dragon.action({type:'workshop.lora.search',id,query:'https://civitai.com/models/2657988?modelVersionId=2984632'}),id);report.civitai={status:'responded',count:candidates.length,candidates:candidates.slice(0,3).map(c=>({name:c.name,baseModel:c.baseModel,url:c.url,compatible:c.compatible}))};report.checks.push('Real Civitai lookup returned '+candidates.length+' candidates');
     if(process.argv.includes('--download')){
       const candidate=candidates.find(c=>c.versionId===2984632&&c.compatible);assert(candidate,'Reference LoRA version is not available');
       await page.evaluate(async()=>{const s=await window.dragon.snapshot();return window.dragon.action({type:'workshop.settings',settings:{...s.workshop.settings,modelsRoot:'E:/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI/models'}});});
       await page.evaluate(({id,versionId})=>window.dragon.action({type:'workshop.lora.install',id,versionId}),{id,versionId:candidate.versionId});
       const installed=await page.evaluate(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id).lora,id);assert.equal(installed.sha256,candidate.sha256);report.civitai.download={status:'passed',sha256:installed.sha256,file:installed.file};report.checks.push('Real Electron network download and SafeTensors/SHA256 validation');
     }
   }catch(e){report.civitai={...report.civitai,status:'failed',error:e.message};throw e;}
 }else{
   const preferences={persona:'霜璃是一只银白紫瞳、机灵俏皮的成年龙娘。',creativePreferences:'简短自然的中文，保留角色外观。'};
   await page.evaluate(preferences=>window.dragon.action({type:'assistant.preferences.save',preferences}),preferences);const saved=await page.evaluate(()=>window.dragon.snapshot());assert.deepEqual(saved.settings.assistant,preferences);
   await page.evaluate(()=>window.dragon.action({type:'window.workbench',page:'settings'}));await page.getByRole('heading',{name:'龙娘人设与创作偏好'}).waitFor();await page.screenshot({path:'test-results/persona-settings031.png'});
   await page.evaluate(()=>window.dragon.action({type:'window.workbench',page:'workshop'}));await page.locator('.studio-project-card').filter({hasText:'0.3.1 创作验收'}).click();
   await page.getByLabel('编辑正面提示词',{exact:true}).fill('full body, silver hair, purple coat');await page.getByRole('button',{name:'保存提示词',exact:true}).click();await page.waitForFunction(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id).characterPrompt==='full body, silver hair, purple coat',id);
   await page.getByText('立绘模型与采样 · Anima',{exact:true}).click();await page.getByLabel('立绘模型体系').selectOption('animagine');await page.getByRole('button',{name:'保存立绘参数',exact:true}).click();await page.waitForFunction(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id).settings.character.backend==='animagine',id);
   report.checks.push('Persona settings persistence, editable exact prompts and model switch through real UI');
   for(const theme of ['light','dark']){await page.evaluate(theme=>window.dragon.action({type:'settings.save',theme}),theme);await page.waitForTimeout(150);await page.screenshot({path:`test-results/creative031-${theme}.png`});}
   await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.setBounds({width:850,height:650});w.webContents.setZoomFactor(1.5);});await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Horizontal overflow');await page.screenshot({path:'test-results/creative031-small.png'});report.checks.push('New panels at 150% zoom and both themes');
 }
 report.passed=true;
}catch(e){report.error=e.message;process.exitCode=1;}
finally{await writeFile(`test-results/creative031-${live?'live':'ui'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await app.evaluate(({app})=>app.quit()).catch(()=>{});}

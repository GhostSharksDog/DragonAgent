import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const integration=JSON.parse(await readFile('test-results/workshop-integration.json','utf8'));
assert(integration.passed,'Run workshop-check.ts first');
const dataDir=path.resolve(`.runtime/workshop-visual-${Date.now()}`);await cp(integration.uiHome,dataDir,{recursive:true});await mkdir('test-results',{recursive:true});
const app=await electron.launch({executablePath:process.env.DRAGON_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.DRAGON_EXE?[]:['.'],cwd:process.cwd(),env:{...process.env,DRAGON_DATA_DIR:dataDir,DRAGON_SMOKE:''},timeout:45000});
const errors=[],checks=[];
try{
  await app.firstWindow();let page;
  for(let i=0;i<100;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  assert(page);page.on('pageerror',error=>errors.push(error.message));
  const sourceFile=await page.evaluate(id=>{const p=(window.dragon.snapshot());return p.then(s=>s.workshop.projects.find(p=>p.id===id).characters[0].file);},integration.projectId);
  const importFile=path.join(dataDir,'workshop/projects',integration.projectId,sourceFile),exportFile=path.join(dataDir,'desktop-export.zip');
  await app.evaluate(({dialog},{importFile,exportFile})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[importFile]});dialog.showSaveDialog=async()=>({canceled:false,filePath:exportFile});},{importFile,exportFile});
  const workerProject=await page.evaluate(()=>window.dragon.action({type:'workshop.create',commandId:'packaged-image-worker',name:'发行版图片处理检查'}));
  assert.equal(await page.evaluate(id=>window.dragon.action({type:'workshop.upload',id}),workerProject),true);
  assert.equal(await page.evaluate(async id=>(await window.dragon.snapshot()).workshop.projects.find(p=>p.id===id).characters.length,workerProject),1);
  await page.evaluate(id=>window.dragon.action({type:'workshop.delete',id}),workerProject);
  assert.equal(await page.evaluate(id=>window.dragon.action({type:'workshop.export',id}),integration.projectId),true);
  assert.equal((await readFile(exportFile)).subarray(0,2).toString(),'PK');
  checks.push('Desktop file import runs the image worker and native Sharp; export creates a ZIP through the application');
  await page.getByRole('button',{name:'创作工坊',exact:true}).click();
  await page.getByRole('heading',{name:'创作工坊',exact:true}).waitFor();
  await page.locator('.studio-art-pet .sprite-canvas[data-ready="true"]').waitFor();
  await page.screenshot({path:'test-results/workshop-home-light.png'});
  await page.evaluate(()=>window.dragon.action({type:'settings.save',theme:'dark'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.waitForTimeout(250);
  await page.screenshot({path:'test-results/workshop-home-dark.png'});
  checks.push('Workshop home, local setup entrance, project records and skin library in both themes');
  await page.locator('.studio-project-card').filter({hasText:'协议验收样例（模拟素材）'}).click();
  await page.waitForFunction(()=>document.querySelector('.studio-player-canvas img')?.naturalWidth>0);
  assert.equal(await page.locator('.studio-motion-list button').count(),11);
  await page.screenshot({path:'test-results/workshop-preview-dark.png'});
  await page.evaluate(()=>window.dragon.action({type:'settings.save',theme:'light'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.waitForTimeout(250);
  await page.getByRole('button',{name:'暂停动画',exact:true}).first().click();
  const range=page.getByRole('slider',{name:'动画帧',exact:true}).first();await range.focus();await range.press('Home');await range.press('ArrowRight');assert.equal(await range.inputValue(),'1');
  await page.getByRole('button',{name:'深色',exact:true}).click();
  await page.screenshot({path:'test-results/workshop-preview-light.png'});
  const compare=page.getByRole('combobox',{name:'对比动作版本',exact:true});await compare.selectOption({index:1});assert.equal(await page.locator('.studio-player').count(),2);
  await page.screenshot({path:'test-results/workshop-compare.png'});await compare.selectOption('');
  checks.push('All motions, frame stepping via keyboard, playback controls, contrast backgrounds and version comparison');
  await page.getByRole('button',{name:/确定角色/}).click();await page.getByRole('tab',{name:'文字创作'}).click();await page.getByRole('button',{name:'生成角色立绘',exact:true}).waitFor();
  await page.screenshot({path:'test-results/workshop-character.png'});
  await page.getByRole('button',{name:/准备环境/}).click();await page.getByRole('button',{name:'保存并检测',exact:true}).waitFor();await page.getByText('模型位置与名称',{exact:true}).click();
  await page.screenshot({path:'test-results/workshop-setup.png'});
  await page.getByRole('button',{name:/预览与导出/}).click();
  for(const zoom of [1,1.5]){
    await app.evaluate(({BrowserWindow},zoom)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.setBounds({width:850,height:650});w.webContents.setZoomFactor(zoom);},zoom);
    await page.waitForTimeout(350);const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,studioRight:document.querySelector('.studio').getBoundingClientRect().right,studioWidth:document.querySelector('.studio').getBoundingClientRect().width}));assert(size.scroll<=size.width+2&&size.studioRight<=size.width+2,`Horizontal overflow at ${zoom}: ${JSON.stringify(size)}`);
    // Electron's CDP screenshot clipping can be stale after zoom changes. Capture the native compositor.
    const capture=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));return(await w.webContents.capturePage()).toPNG().toString('base64');});
    await writeFile(`test-results/workshop-small-${zoom===1?'100':'150'}.png`,Buffer.from(capture,'base64'));
  }
  checks.push('Minimum window at 100% and 150% zoom without horizontal document overflow');
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.webContents.setZoomFactor(1);w.setBounds({width:1260,height:850});});
  await page.getByRole('button',{name:'应用到桌面',exact:true}).click();await page.waitForFunction(async()=>Boolean((await window.dragon.snapshot()).workshop.selectedSkinId));
  const pet=app.windows().find(w=>w.url().includes('view=pet'));assert(pet);
  await pet.waitForFunction(()=>document.querySelector('.sprite-canvas[data-ready="true"]')?.getAttribute('data-source')?.startsWith('workshop://skins/'));
  const transparent=await pet.evaluate(()=>[document.documentElement,document.body,document.getElementById('root')].every(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'));assert(transparent);
  await pet.screenshot({path:'test-results/workshop-applied-pet.png'});
  await page.evaluate(()=>window.dragon.action({type:'skin.select',id:null}));await pet.waitForFunction(()=>document.querySelector('.sprite-canvas[data-ready="true"]')?.getAttribute('data-source')?.startsWith('pet-skin://asset/'));
  checks.push('Real desktop renderer applies generated-format skin, keeps transparency, and restores original assets');
  assert.deepEqual(errors,[]);
  await writeFile('test-results/workshop-ui.json',JSON.stringify({passed:true,checkedAt:new Date().toISOString(),executable:process.env.DRAGON_EXE||'development Electron',mode:'Electron UI with explicitly simulated animation fixtures',checks,errors,dataDir},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}catch(error){await writeFile('test-results/workshop-ui.json',JSON.stringify({passed:false,error:String(error),errors,checks,dataDir},null,2));throw error;}
finally{await app.close();}

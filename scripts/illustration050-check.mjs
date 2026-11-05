// Integration fixture: validates the app pipeline, not real model quality or Pixiv access.
import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {comfyFixture} from '../tests/fixtures/comfy.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=await comfyFixture(),home=path.resolve('.runtime/illustration050-'+Date.now());await mkdir(home,{recursive:true});
const env={...process.env,DRAGON_DATA_DIR:home};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});
const report={passed:false,checks:[]};
try{
  await app.firstWindow();let page;
  for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}
  assert(page);const act=a=>page.evaluate(a=>window.dragon.action(a),a),snap=()=>page.evaluate(()=>window.dragon.snapshot());
  const id=await act({type:'illustration.create',commandId:'one',description:'银白龙娘在窗边看书'});
  assert.equal(await act({type:'illustration.create',commandId:'one',description:'重复'}),id);
  await act({type:'illustration.launch.save',config:{endpoint:fixture.endpoint,python:'unused',entry:'unused',modelsRoot:home,output:home,source:'manual'}});
  const parameters=(await snap()).illustration.projects[0].parameters;
  parameters.positive='masterpiece, best quality, silver hair, purple eyes, reading book';
  await act({type:'illustration.update',id,parameters});
  await act({type:'illustration.generate',id,commandId:'generate-one'});
  let p;for(let i=0;i<200;i++){p=(await snap()).illustration.projects[0];if(['idle','needs-attention'].includes(p.status)&&p.runs.length)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(p.runs[0].state,'completed',p.error);assert(p.runs[0].sha256);assert.equal(p.runs[0].parameters.positive,parameters.positive);
  await act({type:'illustration.generate',id,commandId:'generate-one'});assert.equal((await snap()).illustration.projects[0].runs.length,1);
  report.checks.push('Independent project creation and generation request deduplication, exact prompt snapshot, output hash');
  await act({type:'window.workbench',page:'illustration'});await page.getByRole('heading',{name:'角色插画',exact:true}).waitFor();
  await page.locator('.illustration-result img').waitFor();await page.screenshot({path:'test-results/illustration050-fixture.png'});
  report.checks.push('Illustration page and registered output preview');
  await app.evaluate(({app,BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));win.destroy();app.emit('second-instance',{},[],process.cwd());});
  let recovered;
  for(let i=0;i<100&&!recovered;i++){recovered=app.windows().find(p=>p!==page&&!p.isClosed()&&p.url().includes('view=workbench'));if(!recovered)await new Promise(r=>setTimeout(r,100));}
  assert(recovered,'Destroyed workbench should be recreated');await recovered.waitForFunction(()=>!!window.dragon);
  assert.equal((await recovered.evaluate(()=>window.dragon.snapshot())).illustration.projects[0].id,id);
  report.checks.push('Destroyed workbench recreated on second-instance without losing project');report.passed=true;
}finally{await mkdir('test-results',{recursive:true});await writeFile('test-results/illustration050-check.json',JSON.stringify(report,null,2));await app.close();await fixture.close();}


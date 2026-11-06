// 0.6 集中布局检查：实际窗口、缩放、面板切换、滚动和点击；使用本地 Comfy 模拟接口。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { comfyFixture } from '../tests/fixtures/comfy.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=await comfyFixture(),home=path.resolve('.runtime/illustration-layout-'+Date.now());
await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const env={...process.env,DRAGON_DATA_DIR:home};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});
const report={passed:false,mode:'local-fixture',matrix:[]},errors=[];
let page;
try{
  await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);
  page.on('pageerror',e=>errors.push(e.message));
  const act=a=>page.evaluate(a=>window.dragon.action(a),a),snap=()=>page.evaluate(()=>window.dragon.snapshot());
  const id=await act({type:'illustration.create',commandId:'layout-one',description:'银白龙娘在窗边读书，午后暖光'});
  await act({type:'illustration.launch.save',config:{endpoint:fixture.endpoint,python:'unused',entry:'unused',modelsRoot:home,output:home,source:'manual'}});
  const parameters=(await snap()).illustration.projects[0].parameters;parameters.positive='silver hair, reading book, warm light';
  await act({type:'illustration.update',id,parameters});await act({type:'illustration.generate',id,commandId:'layout-generate'});
  let project;
  for(let i=0;i<120;i++){project=(await snap()).illustration.projects[0];if(project.runs.length&&['completed','error','unknown','cancelled'].includes(project.runs[0].state))break;await page.waitForTimeout(500);}
  assert.equal(project.runs[0].state,'completed',project.error);
  await act({type:'window.workbench',page:'illustration'});await page.locator('.illustration-page').waitFor();
  await act({type:'layout.save',leftCollapsed:true,rightCollapsed:true});
  const click=async locator=>{await locator.scrollIntoViewIfNeeded();await locator.click({timeout:5000});};
  for(const theme of ['light','dark'])for(const width of [900,1100,1440])for(const scale of [1,1.25,1.5,2]){
    await act({type:'settings.save',theme});
    await app.evaluate(({BrowserWindow},{width,scale})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench'));w.setMinimumSize(600,380);w.setBounds({width,height:width===900?600:850});w.webContents.setZoomFactor(scale);},{width,scale});
    await page.waitForTimeout(100);
    const narrow=await page.locator('.illustration-page').getAttribute('data-narrow')==='true';
    if(narrow)await click(page.locator('[data-tab=chat]'));
    await page.getByRole('textbox',{name:'补充要求',exact:true}).fill('保留当前草稿');
    await page.getByRole('button',{name:'整理提示词',exact:true}).scrollIntoViewIfNeeded();
    await click(page.locator('[data-tab=prompts]'));
    await page.getByRole('textbox',{name:'正面提示词',exact:true}).fill('silver hair, reading book, warm light');
    const save=page.getByRole('button',{name:'保存草稿',exact:true});await click(save);
    await click(page.locator('[data-tab=references]'));await page.getByRole('textbox',{name:'Pixiv 作品链接'}).fill('https://www.pixiv.net/artworks/123');
    await click(page.locator('[data-tab=results]'));await page.locator('.illustration-result img').first().scrollIntoViewIfNeeded();
    await click(page.getByRole('button',{name:'环境与连接',exact:true}));await page.locator('.illustration-environment[open]').waitFor();
    await page.getByRole('button',{name:'连接／启动',exact:true}).scrollIntoViewIfNeeded();
    await click(page.locator('.illustration-environment > header button'));assert.equal(await page.locator('.illustration-environment[open]').count(),0);
    const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,content:document.querySelector('.illustration-page').clientWidth,visible:[...document.querySelectorAll('[data-pane]')].filter(e=>getComputedStyle(e).display!=='none').length}));
    assert(size.scroll<=size.client+1,`横向溢出 ${theme}/${width}/${scale}: ${JSON.stringify(size)}`);assert.equal(size.visible,narrow?1:2);
    report.matrix.push({theme,width,scale,narrow,...size});
    if(scale===1||width===900&&scale===2)await page.screenshot({path:`test-results/illustration-060-${theme}-${width}-${scale}.png`});
  }
  assert.deepEqual(errors,[]);report.passed=true;console.log('Illustration layout PASS: '+report.matrix.length+' viewport/theme/zoom combinations');
}catch(error){report.error=error.stack;if(page)await page.screenshot({path:'test-results/illustration-layout-failure.png'}).catch(()=>{});throw error;}
finally{await writeFile('test-results/illustration-layout.json',JSON.stringify(report,null,2));await app.close();await fixture.close();}

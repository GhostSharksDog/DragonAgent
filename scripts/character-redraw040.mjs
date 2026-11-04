// Real, non-explicit character redraw. Stops at user review; never starts animation.
import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
const env={...process.env};delete env.DRAGON_DATA_DIR;delete env.ELECTRON_RUN_AS_NODE;delete env.DRAGON_SMOKE;
const report={mode:'actual-app-local-inference',startedAt:new Date().toISOString(),status:'running'};
await mkdir('test-results',{recursive:true});
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});
let page;
const save=()=>writeFile('test-results/character-redraw040.json',JSON.stringify(report,null,2));
try{
  await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);
  const action=a=>page.evaluate(a=>window.dragon.action(a),a), snapshot=()=>page.evaluate(()=>window.dragon.snapshot());
  const initial=await snapshot();assert(!initial.sessions.some(s=>['running','waiting','stopping'].includes(s.status)),'Active chat task');
  const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();assert(!queue.queue_running.length&&!queue.queue_pending.length,'ComfyUI is busy; not submitting');
  const id=await action({type:'workshop.create',commandId:'author-guidance-redraw040-v1',name:'周防有希 · 作者触发词重绘（待确认）'});report.projectId=id;
  let p=(await snapshot()).workshop.projects.find(p=>p.id===id);
  if(p.operation)throw Error('Existing generation must be reconciled first; not resubmitting');
  if(!p.characters.length){
    const candidates=await action({type:'workshop.lora.search',id,query:'https://civitai.com/models/2657988?modelVersionId=2984632'});
    const candidate=candidates.find(c=>c.versionId===2984632&&c.compatible);assert(candidate,'Selected compatible LoRA unavailable');
    await action({type:'workshop.lora.install',id,versionId:candidate.versionId});
    assert.equal(candidate.suggestedStrength,1,'Author weight must be checked before generating');
    const triggerWords=candidate.triggerWords.join(', ');
    const positive=`1girl, solo, ${triggerWords}, full body, standing, front view, feet visible, arms relaxed at sides, gentle confident smile, closed mouth, fully clothed, black shoes, simple plain light gray background, centered composition, anime illustration, clean lineart, best quality`;
    const negative='lowres, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, multiple characters, duplicate, cropped, out of frame, cut off feet, text, watermark, logo, nude, naked, nsfw, sexual pose';
    await action({type:'workshop.parameters',id,parameters:{characterPrompt:positive,negativePrompt:negative,seed:413040,description:'按照所选作者的角色和校服触发词制作完整着装的全身桌宠立绘。等待用户确认，不启动动画。'}});
    report.author={url:candidate.url,triggerWords:candidate.triggerWords,weight:candidate.suggestedStrength,sha256:candidate.sha256};await save();
    await action({type:'workshop.character',id});
    for(let deadline=Date.now()+30*60*1000;Date.now()<deadline;){
      p=(await snapshot()).workshop.projects.find(p=>p.id===id);report.progress=p.progress;report.metrics=p.metrics;await save();
      if(!['character','queued','running','stopping'].includes(p.status))break;
      await new Promise(r=>setTimeout(r,2000));
    }
  }
  p=(await snapshot()).workshop.projects.find(p=>p.id===id);assert.equal(p.status,'awaiting-character',p.error??p.progress.label);
  assert.equal(p.characterConfirmed,false);const asset=p.characters.at(-1);assert(asset);
  const home=await app.evaluate(({app})=>app.getPath('userData'));
  const source=path.join(home,'workshop/projects',id,asset.file),preview=path.resolve('test-results/character-redraw040.png');await copyFile(source,preview);
  report.asset=asset;report.file=source;report.preview=preview;report.status='awaiting-user-character-confirmation';
  await action({type:'window.workbench',page:'workshop'});
  console.log(JSON.stringify({status:report.status,preview,projectId:id}));
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await save();await app.evaluate(({app})=>app.quit()).catch(()=>{});}

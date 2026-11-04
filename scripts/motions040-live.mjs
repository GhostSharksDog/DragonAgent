// Real app acceptance after the user explicitly confirmed the Anima reference.
import {_electron as electron} from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const reference=JSON.parse(await readFile('test-results/character-redraw040.json','utf8'));
assert.equal(reference.status,'awaiting-user-character-confirmation');
assert.equal(reference.asset.model,'anima-base-v1.0.safetensors');
const env={...process.env};delete env.DRAGON_DATA_DIR;delete env.ELECTRON_RUN_AS_NODE;delete env.DRAGON_SMOKE;
const report={mode:'actual-app-local-inference',startedAt:new Date().toISOString(),status:'running',characterConfirmedByUser:true,projectId:reference.projectId,characterId:reference.asset.id,characterModel:reference.asset.model};
const save=()=>writeFile('test-results/motions040-live.json',JSON.stringify(report,null,2));
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.'],env,timeout:45000});let page;
try{
  await app.firstWindow();for(let i=0;i<100&&!page;i++){page=app.windows().find(w=>w.url().includes('view=workbench'));if(!page)await new Promise(r=>setTimeout(r,100));}assert(page);
  const action=a=>page.evaluate(a=>window.dragon.action(a),a),snapshot=()=>page.evaluate(()=>window.dragon.snapshot());
  let p=(await snapshot()).workshop.projects.find(p=>p.id===reference.projectId);assert(p);
  const asset=p.characters.find(a=>a.id===reference.asset.id);assert.equal(asset.sha256,reference.asset.sha256);
  const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();assert(!queue.queue_running.length&&!queue.queue_pending.length,'ComfyUI has another task; not submitting');
  assert(!p.operation,'An existing operation must be reconciled before continuing');
  if(!p.characterConfirmed)await action({type:'workshop.confirmCharacter',id:p.id,characterId:asset.id});
  assert.equal((await snapshot()).workshop.projects.find(x=>x.id===p.id).characterId,asset.id);
  await action({type:'window.workbench',page:'workshop'});
  await action({type:'workshop.run',id:p.id});
  let last='';
  while(true){
    const state=await snapshot();p=state.workshop.projects.find(p=>p.id===reference.projectId);
    report.progress=p.progress;report.metrics=p.metrics;report.error=p.error;report.operation=p.operation;
    report.actions=p.actions.map(a=>({key:a.key,selectedVersionId:a.selectedVersionId,versions:a.versions.map(v=>({id:v.id,status:v.status,quality:v.quality,error:v.error,elapsedMs:v.elapsedMs,atlas:v.animation?.frames[0]}))}));await save();
    const summary=p.progress.label+' '+(p.progress.value??'')+'/'+(p.progress.maximum??'');if(summary!==last){last=summary;console.log(summary);}
    if(!['character','queued','running','stopping'].includes(p.status)&&state.workshop.activeProjectId!==p.id)break;
    await new Promise(r=>setTimeout(r,5000));
  }
  report.status=p.actions.every(a=>a.versions.some(v=>v.id===a.selectedVersionId&&v.animation))?'generated-awaiting-visual-review':'incomplete';
}catch(error){report.status='failed';report.error=error.message;console.error(error.message);process.exitCode=1;}
finally{await save();console.log(JSON.stringify({status:report.status,error:report.error}));await app.evaluate(({app})=>app.quit()).catch(()=>{});}

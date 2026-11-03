import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, cp, stat } from 'node:fs/promises';
import { WorkshopManager } from '../src/main/workshop/manager';
import { motionVersion, workshopBusy } from '../src/shared/workshop';
import { loadSkin } from '../src/pet/main/skin';
// @ts-expect-error JavaScript HTTP fixture intentionally has no production types.
import { comfyFixture } from '../tests/fixtures/comfy.mjs';

const fixture=await comfyFixture(),home=path.resolve(`.runtime/workshop-check-${Date.now()}`),uiHome=`${home}-ui`,checks:string[]=[];
await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
let currentSkin:any,progressEvents=0;
const options={home,workerPath:path.resolve('dist/main/workshop-worker.cjs'),bundledSkin:path.resolve('assets/skins/silver-dragon-frames/skin.json'),changed:()=>{if(manager?.state.projects.some(p=>p.progress.maximum))progressEvents++;},skin:(v:any)=>{currentSkin=v;},profiles:()=>[],key:async()=>''};
let manager:WorkshopManager|undefined=new WorkshopManager(options);
const until=async(check:()=>boolean,label:string,timeout=240000)=>{const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error(`Timeout: ${label}`);await new Promise(r=>setTimeout(r,35));}};
const p=()=>manager!.state.projects[0];
try{
  await manager.init();await manager.action({type:'workshop.settings',settings:{...manager.state.settings,endpoint:fixture.endpoint}});
  await manager.check();assert.equal(manager.state.environment.status,'ready');checks.push('Node connection, model and node discovery');
  fixture.controls.invalidJson=true;await manager.check();assert.equal(manager.state.environment.status,'offline');fixture.controls.invalidJson=false;await manager.check();assert.equal(manager.state.environment.status,'ready');checks.push('Malformed response is visible and recoverable');
  fixture.controls.missingModel=true;fixture.controls.missingNode=true;await manager.check();assert.equal(manager.state.environment.status,'incomplete');assert(manager.state.environment.issues.some(i=>i.name==='BiRefNetRMBG'));assert(manager.state.environment.issues.some(i=>i.name===manager!.state.settings.videoModel));fixture.controls.missingModel=false;fixture.controls.missingNode=false;await manager.check();assert.equal(manager.state.environment.status,'ready');checks.push('Missing model and missing matting node are reported with repair links and recover after installation');
  const request={type:'workshop.create' as const,commandId:'deduplicated-create',name:'协议验收样例（模拟素材）',description:'此项目只验收接口与文件处理，不代表真实 AI 生成质量。'};
  const [id,duplicate]=await Promise.all([manager.action(request),manager.action(request)]);assert.equal(id,duplicate);assert.equal(manager.state.projects.length,1);checks.push('Concurrent duplicate creation produces one project');
  fixture.controls.holdNext=true;await manager.action({type:'workshop.character',id:id as string});await until(()=>Boolean(p().operation?.promptId),'character submitted');await until(()=>progressEvents>0,'WebSocket progress');fixture.complete();await until(()=>p().status==='awaiting-character','character result');assert.equal(p().characters.length,1);checks.push('Text-to-image protocol and WebSocket progress');
  const uploaded=path.join(home,'reference.png');await writeFile(uploaded,fixture.frames[0]);await manager.upload(id as string,uploaded);assert.equal(p().characters.length,2);
  await manager.action({type:'workshop.confirmCharacter',id:id as string,characterId:p().characters.at(-1)!.id});checks.push('Uploaded character remains local and requires confirmation');
  console.log('Generating full 11-motion fixture through real HTTP, image processing, worker and SQLite paths…');
  await Promise.all([manager.action({type:'workshop.run',id:id as string}),manager.action({type:'workshop.run',id:id as string})]);
  await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,'full motion package');
  assert(['review','needs-attention'].includes(p().status),p().error);assert.equal(p().actions.filter(m=>motionVersion(m)?.animation).length,11);
  assert(fixture.requests.filter((r:any)=>r.kind==='video').length>=11);
  for(const m of p().actions){const v=motionVersion(m)!;assert.equal(v.rawFiles.length,49);assert.equal(v.matteFiles.length,49);assert(v.frames.length>=16);assert.equal(v.quality!.emptyFrames,0);assert.equal(v.quality!.opaqueCorners,0);}
  checks.push('All 11 motions, PNG retrieval, batched matting, loop preparation and atlas output');
  await manager.action({type:'workshop.review',id:id as string,accepted:true});const goodIdle=motionVersion(p().actions[0])!.id;
  const skinId=await manager.publish(id as string),zip=path.join(home,'export.zip');await manager.export(id as string,zip);assert((await stat(zip)).size>1000);assert.equal((await readFile(zip)).subarray(0,2).toString(),'PK');
  const skin=await loadSkin(path.join(home,'workshop/skins',skinId,'skin.json'));assert.equal(Object.keys(skin.manifest.animations).length,11);assert.deepEqual(skin.manifest.anchor,{x:136,y:264});
  await manager.selectSkin(skinId);assert(currentSkin.baseUrl.startsWith('workshop://skins/'));await manager.selectSkin(null);assert.equal(currentSkin.baseUrl,'pet-skin://asset/');checks.push('Review, immutable library, ZIP export, skin reload and original dragon restoration');
  await assert.rejects(()=>manager!.asset('skins',`/${skinId}/../../workshop.db`));checks.push('Media protocol rejects traversal outside skin root');
  fixture.controls.loseNext=true;const before=fixture.requests.length;await manager.action({type:'workshop.retry',id:id as string,key:'idle'});await until(()=>p().status==='paused'&&!manager!.state.activeProjectId,'lost submit response');assert.equal(p().operation!.state,'unknown');assert.equal(fixture.requests.length,before+1);
  await manager.action({type:'workshop.resume',id:id as string});await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,'recovered lost response');assert.equal(fixture.requests.slice(before).filter((r:any)=>r.kind==='video').length,1);checks.push('Lost submission response resolves by operation marker without replay');
  for(const fault of ['brokenSubmit','brokenHistory'] as const){
    const beforeFault=fixture.requests.length;fixture.controls[fault]=true;await manager.action({type:'workshop.retry',id:id as string,key:'idle'});await until(()=>p().status==='paused'&&!manager!.state.activeProjectId,`${fault} paused`);assert(p().operation,'Unknown result must retain its operation record');fixture.controls[fault]=false;
    await manager.action({type:'workshop.resume',id:id as string});await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,`${fault} recovered`);assert.equal(fixture.requests.slice(beforeFault).filter((r:any)=>r.kind==='video').length,1);
  }checks.push('Malformed submit and history responses retain the accepted task and recover without GPU replay');
  const oomBefore=fixture.requests.length;fixture.controls.oomNext=true;await manager.action({type:'workshop.retry',id:id as string,key:'idle'});await until(()=>p().status==='error'&&!manager!.state.activeProjectId,'out of memory');assert(p().error?.includes('显存不足'));assert.equal(fixture.requests.length,oomBefore+1);assert(p().actions.every(m=>motionVersion(m)?.animation));checks.push('Out of memory is reported without an automatic GPU retry and completed versions are retained');
  fixture.controls.holdNext=true;await manager.action({type:'workshop.retry',id:id as string,key:'thinking'});await until(()=>Boolean(p().operation?.promptId),'restart fixture submitted');const originalPrompt=p().operation!.promptId;
  await manager.dispose();manager=undefined;fixture.complete();manager=new WorkshopManager(options);await manager.init();assert.equal(p().status,'paused');assert.equal(p().operation!.promptId,originalPrompt);
  const submittedBeforeResume=fixture.requests.filter((r:any)=>r.kind==='video').length;await manager.action({type:'workshop.resume',id:id as string});await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,'restart resumed');assert.equal(fixture.requests.filter((r:any)=>r.kind==='video').length,submittedBeforeResume);checks.push('Application restart fetches original result without rerunning the model');
  fixture.controls.holdNext=true;fixture.controls.externalPending=true;await manager.action({type:'workshop.retry',id:id as string,key:'speaking'});await until(()=>Boolean(p().operation?.promptId),'cancel fixture submitted');await manager.action({type:'workshop.cancel',id:id as string});await new Promise(r=>setTimeout(r,150));assert.equal(p().status,'stopping');fixture.complete();await until(()=>p().status==='cancelled'&&!manager!.state.activeProjectId,'safe cancellation');assert.equal(fixture.controls.interrupts,0);assert(!fixture.queueDeletes.includes('unrelated-task'));fixture.controls.externalPending=false;checks.push('Running cancellation waits for own stage and never globally interrupts or clears others');
  await manager.action({type:'workshop.resume',id:id as string});await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,'resume cancelled stage');
  fixture.controls.opaqueMatte=true;const opaqueBefore=fixture.requests.filter((r:any)=>r.kind==='video').length;await manager.action({type:'workshop.retry',id:id as string,key:'idle'});await until(()=>!workshopBusy(p())&&!manager!.state.activeProjectId,'bounded quality retries');assert.equal(fixture.requests.filter((r:any)=>r.kind==='video').length-opaqueBefore,3);assert(motionVersion(p().actions[0])!.quality!.opaqueCorners>0);await assert.rejects(()=>manager!.action({type:'workshop.review',id:id as string,key:'idle',accepted:true}));fixture.controls.opaqueMatte=false;checks.push('Opaque background triggers at most two automatic retries and cannot be approved as valid');
  await manager.action({type:'workshop.selectVersion',id:id as string,key:'idle',versionId:goodIdle});await manager.action({type:'workshop.review',id:id as string,accepted:true});await manager.publish(id as string);
  // Create a closed-database copy for visual checks; production/user data is never read or modified.
  await manager.dispose();manager=undefined;await cp(home,uiHome,{recursive:true});manager=new WorkshopManager(options);await manager.init();
  await manager.action({type:'workshop.delete',id:id as string});assert.equal(manager.state.projects.length,0);await manager.selectSkin(skinId);assert(currentSkin.manifest.animations.idle);checks.push('Deleting production project keeps copied library skin available');
  await manager.dispose();manager=undefined;
  const report={mode:'local-protocol-fixture-not-real-inference',checkedAt:new Date().toISOString(),checks,passed:true,uiHome,projectId:id,requests:fixture.requests.length,webSocketConnections:fixture.controls.webSockets,realComfyGeneration:'pending user-prepared ComfyUI and model weights'};
  await writeFile('test-results/workshop-integration.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile('test-results/workshop-integration.json',JSON.stringify({passed:false,mode:'local-protocol-fixture',checks,error:String(error),uiHome},null,2));throw error;}
finally{await manager?.dispose();await fixture.close();}

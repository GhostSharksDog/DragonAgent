// Run only after the user confirms the reference character. No global interrupt/replay.
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {WorkshopManager} from '../src/main/workshop/manager';
import {motionVersion,workshopBusy} from '../src/shared/workshop';
const home=path.resolve('.runtime/workshop-live031');
const manager=new WorkshopManager({home,workerPath:path.resolve('dist/main/workshop-worker.cjs'),bundledSkin:path.resolve('assets/skins/silver-dragon-frames/skin.json'),changed:()=>{},skin:()=>{},profiles:()=>[],key:async()=>''});
const report:any={mode:'real-local-inference',startedAt:new Date().toISOString(),status:'running',characterConfirmedByUser:true};
const p=manager.state.projects.find(p=>p.commandId==='acceptance-anima-lora');
const save=async()=>{if(p){report.projectId=p.id;report.progress=p.progress;report.metrics=p.metrics;report.actions=p.actions.map(m=>({key:m.key,versions:m.versions.map(v=>({id:v.id,status:v.status,quality:v.quality,error:v.error,elapsedMs:v.elapsedMs,atlas:v.animation?.frames[0]}))}));}await writeFile('test-results/workshop-motions-live031.json',JSON.stringify(report,null,2));};
try{
 if(!p?.characters.length)throw Error('缺少已确认的 Anima LoRA 立绘');
 await manager.init();
 const q=await(await fetch('http://127.0.0.1:8188/queue')).json();if(q.queue_running.length||q.queue_pending.length)throw Error('ComfyUI 正忙，未提交');
 if(p.operation)throw Error('存在未确认的原生成任务，请核对后恢复');
 if(!p.characterConfirmed)await manager.action({type:'workshop.confirmCharacter',id:p.id,characterId:p.characters.at(-1)!.id});
 await manager.action({type:'workshop.run',id:p.id});
 let last='',saved=0;while(workshopBusy(p)||manager.state.activeProjectId===p.id){const status=p.progress.label+' '+(p.progress.value??'')+'/'+(p.progress.maximum??'');if(status!==last){last=status;console.log(status);}if(Date.now()-saved>10000){saved=Date.now();await save();}await new Promise(r=>setTimeout(r,1000));}
 report.status=p.actions.every(m=>motionVersion(m)?.animation)?'generated-awaiting-visual-review':'failed';report.error=p.error;if(report.status==='failed')process.exitCode=1;
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await save();console.log(JSON.stringify({status:report.status,error:report.error}));await manager.dispose();}

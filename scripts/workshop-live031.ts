// Real local inference. Uses an isolated project store; never interrupts unrelated ComfyUI jobs.
import path from 'node:path';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {WorkshopManager} from '../src/main/workshop/manager';
import {ANIMA_SETTINGS,ANIMAGINE_SETTINGS,workshopBusy} from '../src/shared/workshop';
const root='E:/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI',home=path.resolve('.runtime/workshop-live031'),report:any={mode:'real-local-inference',startedAt:new Date().toISOString(),characters:[],status:'running'};
await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const queue=await(await fetch('http://127.0.0.1:8188/queue')).json();if(queue.queue_running.length||queue.queue_pending.length)throw Error('ComfyUI 正在处理其他任务，本次验收未提交。');
let manager:WorkshopManager;
const options={home,workerPath:path.resolve('dist/main/workshop-worker.cjs'),bundledSkin:path.resolve('assets/skins/silver-dragon-frames/skin.json'),changed:()=>{},skin:()=>{},profiles:()=>[],key:async()=>''};
manager=new WorkshopManager(options);
const save=()=>writeFile('test-results/workshop-live031.json',JSON.stringify(report,null,2));
try{
 await manager.init();await manager.action({type:'workshop.settings',settings:{...manager.state.settings,modelsRoot:root+'/models'}});
 const basic=JSON.parse(await readFile(root+'/user/default/workflows/Basic.json','utf8'));
 const reference=basic.nodes.find((n:any)=>n.title==='正面提示词').widgets_values[0].replace(/<lora:[^>]+>,?\s*/g,'');
 const lora=basic.nodes.find((n:any)=>n.type==='LoraLoader').widgets_values[0];
 for(const variant of ['anima-base','anima-lora','animagine'] as const){
   const id=await manager.action({type:'workshop.create',commandId:'acceptance-'+variant,name:'真实生成验收 · '+variant}) as string;
   const p=manager.state.projects.find(p=>p.id===id)!;
   if(p.characters.length){report.characters.push({variant,id,file:path.join(home,'workshop/projects',id,p.characters.at(-1)!.file),metrics:p.metrics,reused:true});await save();continue;}
   if(p.operation){
     if(!process.argv.includes('--retry-verified-missing'))throw Error('验收项目仍有未确认的原任务：'+id+'，请先核对，未重复提交。');
     const history=await(await fetch('http://127.0.0.1:8188/history/'+encodeURIComponent(p.operation.promptId??''))).json();
     const pending=await(await fetch('http://127.0.0.1:8188/queue')).json();
     const output=path.resolve('E:/Comfy-Desktop/ComfyUI-Shared/output/DragonAgent',id);
     if(Object.keys(history).length||pending.queue_running.length||pending.queue_pending.length||await stat(output).catch(()=>null))throw Error('存在原任务或输出，需要人工核对，未重试。');
     await manager.action({type:'workshop.resume',id});while(workshopBusy(p)||manager.state.activeProjectId===id)await new Promise(r=>setTimeout(r,500));
     if(p.operation?.state!=='unknown')throw Error('原任务恢复状态需要核对，未重试');
     report.verifiedRetry={promptId:p.operation.promptId,reason:'Operator verified restarted server, empty queue/history and no output directory'};
     await manager.action({type:'workshop.resolveUnknown',id});
   }
   await manager.action({type:'workshop.character.settings',id,settings:variant==='animagine'?ANIMAGINE_SETTINGS:ANIMA_SETTINGS});
   if(variant!=='animagine')await manager.action({type:'workshop.parameters',id,parameters:{seed:413031,characterPrompt:reference+', full body, feet visible, centered, standing, simple plain background',negativePrompt:'worst quality, low quality, blurry, cropped, text, watermark, extra limbs, multiple characters'}});
   if(variant==='anima-lora')await manager.importLora(id,path.join(root,'models/loras',lora));
   const start=Date.now();console.log('START '+variant);await manager.action({type:'workshop.character',id});
   let last='';while(workshopBusy(p)||manager.state.activeProjectId===id){const status=p.progress.label;if(status!==last){console.log(variant+': '+status);last=status;}await new Promise(r=>setTimeout(r,1000));}
   if(p.status!=='awaiting-character')throw Error(variant+': '+p.error);
   const file=path.join(home,'workshop/projects',id,p.characters.at(-1)!.file);report.characters.push({variant,id,file,elapsedMs:Date.now()-start,metrics:p.metrics,asset:p.characters.at(-1)});await save();console.log('COMPLETE '+variant+' '+file);
 }
 report.status='characters-generated-awaiting-visual-review';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;console.error(String(e));}
finally{await save();await manager.dispose();}

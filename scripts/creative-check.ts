import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {WorkshopManager} from '../src/main/workshop/manager';
import {LoraLibrary} from '../src/main/workshop/lora';
import {ANIMA_SETTINGS,ANIMAGINE_SETTINGS,characterSettings} from '../src/shared/workshop';
import {characterGraph} from '../src/main/workshop/graphs';
import {assistantPrompt,DEFAULT_ASSISTANT_PREFERENCES} from '../src/shared/persona';
const home=path.resolve(`.runtime/creative-check-${Date.now()}`),checks:string[]=[];
await mkdir(home,{recursive:true});await mkdir('test-results',{recursive:true});
const captured:any[]=[];
const model=createServer(async(req,res)=>{
  const parts=[];for await(const b of req)parts.push(b);const request=JSON.parse(Buffer.concat(parts).toString());captured.push(request);
  const last=request.messages.at(-1),tool=last.role!=='tool';
  const delta=tool?{tool_calls:[{index:0,id:'revise-'+captured.length,type:'function',function:{name:'revise_character',arguments:JSON.stringify({description:'银白龙娘，紫色外套',characterPrompt:'silver hair, purple coat, full body',negativePrompt:'cropped, blurry'})}},{index:1,id:'motion-'+captured.length,type:'function',function:{name:'revise_motion',arguments:JSON.stringify({key:'idle',prompt:'gentle blinking, still camera'})}}]}:{content:'已保留银发并换成紫色外套。'};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:60,completion_tokens:20}})}\n\ndata: [DONE]\n\n`);
});await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));
const profile={id:'fixture',name:'Protocol fixture',provider:'fixture',protocol:'openai-completions' as const,baseUrl:`http://127.0.0.1:${(model.address() as any).port}`,model:'fixture',contextWindow:32768,maxOutput:2048,hasKey:false};
const options={home,workerPath:path.resolve('dist/main/workshop-worker.cjs'),bundledSkin:path.resolve('assets/skins/silver-dragon-frames/skin.json'),changed:()=>{},skin:()=>{},profiles:()=>[profile],key:async()=>'',preferences:()=>({...DEFAULT_ASSISTANT_PREFERENCES,creativePreferences:'只用简短中文'})};
let manager=new WorkshopManager(options);
const until=async(fn:()=>boolean)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Assistant fixture timed out');};
try{
 await manager.init();const a=await manager.action({type:'workshop.create',commandId:'a',name:'A'}) as string,b=await manager.action({type:'workshop.create',commandId:'b',name:'B'}) as string;
 const project=()=>manager.state.projects.find(p=>p.id===a)!;assert.equal(characterSettings(project().settings).backend,'anima');
 const original=project().characterPrompt;await manager.action({type:'workshop.assistant.send',id:a,text:'紫色外套，并修改待机动作',profileId:'fixture'});await until(()=>project().assistant?.status!=='running');assert.equal(project().assistant?.status,'idle',project().assistant?.error);assert.equal(project().characterPrompt,'silver hair, purple coat, full body');assert.equal(project().actions[0].prompt,'gentle blinking, still camera');assert.equal(manager.state.projects.find(p=>p.id===b)!.characterPrompt,original);assert(captured[0].messages[0].content.includes('只用简短中文'));checks.push('AgentRuntime streaming, character and action tool calls, preferences and project isolation');
 await manager.action({type:'workshop.undo',id:a});assert.notEqual(project().actions[0].prompt,'gentle blinking, still camera');
 project().status='running';const before=project().characterPrompt;await manager.action({type:'workshop.parameters',id:a,parameters:{characterPrompt:'next draft',actions:{idle:'next idle'}}});assert.equal(project().characterPrompt,before);assert.equal(project().draft?.characterPrompt,'next draft');project().status='draft';await manager.action({type:'workshop.draft.apply',id:a});assert.equal(project().characterPrompt,'next draft');assert.equal(project().actions[0].prompt,'next idle');checks.push('Undo and deferred edits preserve active generation parameters');
 for(const settings of [ANIMA_SETTINGS,ANIMAGINE_SETTINGS]){await manager.action({type:'workshop.character.settings',id:a,settings});const graph=characterGraph(project().settings,'exact positive','exact negative',42,'test');assert.equal(graph['2'].inputs.text,'exact positive');assert.equal(graph['3'].inputs.text,'exact negative');assert.equal(graph['5'].inputs.cfg,settings.cfg);assert.equal(graph['1'].class_type,settings.backend==='anima'?'UNETLoader':'CheckpointLoaderSimple');}
 assert.equal(characterSettings({endpoint:'http://127.0.0.1:8188',checkpoint:'old.safetensors',videoModel:'',textEncoder:'',vae:'',matteModel:''}).backend,'animagine');checks.push('Anima/SDXL model wiring, exact prompt submission and legacy fallback');
 await manager.dispose();manager=new WorkshopManager(options);await manager.init();assert.equal(project().characterPrompt,'next draft');assert(project().assistant!.messages.length>=2);await manager.action({type:'workshop.assistant.send',id:a,text:'继续保留设定',profileId:'fixture'});await until(()=>project().assistant?.status!=='running');assert(captured.at(-2).messages.some((m:any)=>m.role==='assistant'));checks.push('Project parameters and assistant conversation survive restart');
 const header=Buffer.from(JSON.stringify({__metadata__:{ss_base_model_version:'anima'},'diffusion_model.blocks.0.cross_attn.k_proj.lora_A.weight':{dtype:'F32',shape:[1],data_offsets:[0,4]}})),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));const file=Buffer.concat([prefix,header,Buffer.alloc(4)]),sha256=createHash('sha256').update(file).digest('hex'),source=path.join(home,'fixture.safetensors');await writeFile(source,file);
 let downloads=0;const library=new LoraLibrary(async()=>{downloads++;await new Promise(r=>setTimeout(r,30));return new Response(file);});
 const imported=await library.import(home,source,'anima');assert.equal(imported.sha256,sha256);await assert.rejects(()=>library.import(home,source,'animagine'));
 const candidate={versionId:31,name:'Fixture',author:'Fixture',baseModel:'Anima',backend:'anima' as const,triggerWords:[],description:'fixture',url:'https://civitai.com/models/31',sizeKB:file.length/1024,sha256,downloadUrl:'https://civitai.com/api/download/models/31',compatible:true};
 const c1=new AbortController(),c2=new AbortController();const first=library.install(home,candidate,c1.signal),second=library.install(home,candidate,c2.signal);const rejected=assert.rejects(first);setTimeout(()=>c1.abort(),10);await rejected;await second;assert.equal(downloads,1);await library.install(home,candidate,new AbortController().signal);assert.equal(downloads,1);
 await assert.rejects(()=>library.install(home,{...candidate,versionId:32,sha256:'0'.repeat(64)},new AbortController().signal),/SHA256/);checks.push('SafeTensors import, incompatible architecture rejection, shared download cancellation, reuse and SHA256 failure');
 assert(assistantPrompt({...DEFAULT_ASSISTANT_PREFERENCES,persona:'测试龙娘'}).includes('遵守当前对话的权限设置'));checks.push('Editable persona retains host permission instructions');
 await writeFile('test-results/creative-integration.json',JSON.stringify({passed:true,mode:'local-protocol-fixtures-not-real-generation',checks,home},null,2));console.log(JSON.stringify({passed:true,checks}));
}catch(e){await writeFile('test-results/creative-integration.json',JSON.stringify({passed:false,checks,error:String(e)},null,2));throw e;}
finally{await manager.dispose();model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));}


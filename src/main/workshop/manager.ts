import { assistantPrompt, type AssistantPreferences } from '../../shared/persona';
import { characterSettings, characterDefaults, type CharacterSettings, type WorkshopParameters } from '../../shared/workshop';
import { CreativeAssistant } from './assistant';
import { LoraLibrary } from './lora';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { mkdir, readFile, realpath, rename, rm, copyFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import type { ModelProfile } from '../../shared/contracts';
import type { SkinData, SkinManifest } from '../../pet/shared/types';
import { loadSkin } from '../../pet/main/skin';
import { HttpModelAdapter } from '../../../packages/agent-core/src';
import { MOTIONS, PET_WORKFLOW_VERSION, motionVersion, workshopBusy, type CharacterAsset, type ComfyOperation, type MotionKey, type MotionTask, type MotionVersion, type WorkshopAction, type WorkshopProject, type WorkshopSettings, type WorkshopSkin, type WorkshopSnapshot } from '../../shared/workshop';
import { WorkshopStore, inside } from './store';
import { ComfyClient, ComfyError, localEndpoint, operation, type Graph } from './comfy';
import { characterGraph, matteGraph, videoGraph } from './graphs';
import { atomicFile, referenceImage } from './images';

class Cancelled extends Error {}
const text = (value: unknown, maximum: number, label: string) => { if (typeof value !== 'string' || value.length > maximum) throw new Error(`${label}无效或过长。`); return value.trim(); };
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve,reject) => {
  if(signal.aborted){reject(signal.reason);return;} const end=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
  const abort=()=>{end();reject(signal.reason);},timer=setTimeout(()=>{end();resolve();},ms);signal.addEventListener('abort',abort,{once:true});
});
export class WorkshopManager {
  readonly store: WorkshopStore;
  readonly state: WorkshopSnapshot;
  private working?: Promise<void>;
  private assistant: CreativeAssistant;
  private loras: LoraLibrary;
  private downloads=new Map<string,AbortController>();
  private downloadJobs=new Set<Promise<unknown>>();
  private controller = new AbortController();
  private closed = false;
  private editing = new Set<string>();
  private creating = new Map<string, Promise<string>>();
  private pendingEdits = new Set<Promise<unknown>>();
  private workers = new Set<Worker>();
  private selection = Promise.resolve();
  constructor(private options: { home: string; preferences?(): AssistantPreferences | undefined; fetch?: typeof fetch; workerPath: string; bundledSkin: string; changed(): void; skin(data: SkinData): void; profiles(): ModelProfile[]; key(id: string): Promise<string> }) {
    this.store = new WorkshopStore(path.join(options.home, 'workshop'));
    this.loras=new LoraLibrary(options.fetch??fetch);
    this.assistant=new CreativeAssistant({root:this.root,preferences:options.preferences,profiles:options.profiles,key:options.key,save:p=>this.save(p),revise:(p,v)=>this.revise(p,v),search:(p,q)=>this.searchLora(p,q)});
    const settings=this.store.settings();
    this.state={settings,environment:{endpoint:settings.endpoint,status:'unchecked',issues:[],checkpoints:[]},projects:this.store.projects(),skins:this.store.skins(),selectedSkinId:this.store.value('selectedSkin',null)};
    for(const p of this.state.projects) { const source=p.candidates?.find(c=>c.versionId===p.lora?.versionId);if(p.lora&&source){p.lora.authorNotes??=source.description;p.lora.sourceUrl??=source.url;} if(p.assistant?.status==='running'){p.assistant.status='error';p.assistant.error='上次回复被中断，请重新发送。';}if(p.download?.state==='running'){p.download.state='error';p.download.error='上次下载被中断，请重新选择下载。';}this.store.save(p); }
    for(const p of this.state.projects) if(workshopBusy(p)){p.status='paused';p.progress={label:'上次制作已中断，继续时先核对 ComfyUI 原任务。'};this.store.save(p);}
  }
  get root(){return this.store.root;}
  get busy(){return this.downloads.size>0||this.state.projects.some(p=>this.assistant.busy(p.id))||!!this.working||this.editing.size>0||this.state.projects.some(workshopBusy);}
  snapshot(): WorkshopSnapshot {
    return {...this.state,projects:this.state.projects.map(p=>({...p,operationLog:[],actions:p.actions.map(m=>({...m,versions:m.versions.map(v=>({...v,rawFiles:[],matteFiles:[],frames:[]}))}))}))};
  }
  private parameters(p:WorkshopProject):WorkshopParameters {return {characterPrompt:p.characterPrompt,negativePrompt:p.negativePrompt,description:p.description,seed:p.seed,actions:Object.fromEntries(p.actions.map(m=>[m.key,m.prompt]))};}
  private applyParameters(p:WorkshopProject,v:WorkshopParameters){p.characterPrompt=v.characterPrompt;p.negativePrompt=v.negativePrompt;p.description=v.description;if(v.seed!==undefined)p.seed=v.seed;for(const m of p.actions)if(v.actions?.[m.key]!==undefined)m.prompt=v.actions[m.key]!;}
  private revise(p:WorkshopProject,v:Partial<WorkshopParameters>) {
    const previous=p.draft??this.parameters(p),next={...previous,...v,actions:{...previous.actions,...v.actions}};
    next.characterPrompt=text(next.characterPrompt,6000,'正面提示词');next.negativePrompt=text(next.negativePrompt,3000,'负面提示词');next.description=text(next.description,4000,'角色设定');
    if(next.seed!==undefined&&(!Number.isSafeInteger(next.seed)||next.seed<0||next.seed>2**32-1))throw Error('种子需为 0–4294967295 的整数');
    for(const [key,value] of Object.entries(next.actions)){if(!MOTIONS.some(m=>m.key===key))throw Error('未知动作');next.actions[key as MotionKey]=text(value,4000,'动作描述');}
    if(workshopBusy(p)||p.operation){p.draft=next;this.save(p);return;}
    p.revisions??=[];p.revisions.push(this.parameters(p));p.revisions=p.revisions.slice(-50);this.applyParameters(p,next);this.save(p);
  }
  private searches=new Map<string,number>();
  private async searchLora(p:WorkshopProject,query:string){const ticket=(this.searches.get(p.id)??0)+1;this.searches.set(p.id,ticket);const backend=characterSettings(p.settings).backend;const candidates=await this.loras.search(text(query,300,'搜索词'),backend);if(this.searches.get(p.id)!==ticket||!this.state.projects.includes(p)||characterSettings(p.settings).backend!==backend)throw Error('搜索期间项目或模型已改变，请重新搜索');p.candidates=candidates;this.save(p);return candidates;}
  private project(id:string){const p=this.state.projects.find(v=>v.id===id);if(!p)throw new Error('制作项目不存在。');return p;}
  private directory(p:WorkshopProject){return inside(this.root,`projects/${p.id}`);}
  private save(p?:WorkshopProject){if(this.closed)return;if(p){p.updatedAt=Date.now();this.store.save(p);}this.options.changed();}
  private idle(p:WorkshopProject){if(workshopBusy(p)||this.state.activeProjectId===p.id||this.editing.has(p.id)||p.operation)throw new Error('请先结束或恢复当前制作阶段，再修改项目。');}
  private async lock<T>(p:WorkshopProject,fn:()=>Promise<T>){this.idle(p);this.editing.add(p.id);const task=fn();this.pendingEdits.add(task);try{return await task;}finally{this.editing.delete(p.id);this.pendingEdits.delete(task);}}
  async init(){await mkdir(path.join(this.root,'projects'),{recursive:true});await mkdir(path.join(this.root,'skins'),{recursive:true});try{await this.selectSkin(this.state.selectedSkinId);}catch(error){this.state.environment.issues.push({name:'桌宠恢复',detail:(error as Error).message,severity:'warning'});this.save();}}
  async check(){
    if(this.state.environment.status==='checking')return;
    this.state.environment={...this.state.environment,status:'checking',issues:[]};this.save();
    this.state.environment=await new ComfyClient(this.state.settings.endpoint).inspect(this.state.settings);this.save();return this.state.environment;
  }
  async action(a:WorkshopAction):Promise<unknown>{
    if(this.closed)throw new Error('工坊正在退出。');
    if(a.type==='workshop.check')return this.check();
    if(a.type==='skin.select')return this.selectSkin(a.id);
    if(a.type==='workshop.settings'){
      if(this.busy)throw new Error('请在制作结束后修改生成环境。');
      const s=a.settings;localEndpoint(s.endpoint);
      for(const key of ['checkpoint','videoModel','textEncoder','vae','matteModel'] as const)if(!text(s[key],200,'模型名称')||/[\0\r\n]/.test(s[key]))throw new Error('模型名称无效。');
      this.state.settings={...s,endpoint:localEndpoint(s.endpoint)};this.store.setValue('settings',this.state.settings);
      this.state.environment={status:'unchecked',endpoint:this.state.settings.endpoint,issues:[],checkpoints:[]};this.save();return true;
    }
    if(a.type==='workshop.create'){
      const commandId=text(a.commandId,100,'请求编号');if(!commandId)throw new Error('缺少请求编号。');
      const previous=this.state.projects.find(p=>p.commandId===commandId);if(previous)return previous.id;
      const pending=this.creating.get(commandId);if(pending)return pending;
      const name=text(a.name,80,'角色名称')||'新的桌宠',description=text(a.description??'',4000,'角色描述');
      const p:WorkshopProject={id:randomUUID(),commandId,templateId:'pet-2d',templateVersion:PET_WORKFLOW_VERSION,name,description,...characterDefaults(characterSettings(this.state.settings).backend),seed:randomInt(1,2**31),settings:{...this.state.settings},status:'draft',characters:[],characterConfirmed:false,actions:MOTIONS.map(m=>({key:m.key,prompt:m.prompt,versions:[],attempts:0})),operationLog:[],progress:{label:'从一张角色图或一句描述开始。'},anchor:{x:136,y:264},createdAt:Date.now(),updatedAt:Date.now(),metrics:{elapsedMs:0,peakVramBytes:0}};
      const task=(async()=>{await mkdir(this.directory(p),{recursive:true});this.state.projects.unshift(p);this.store.event(p.id,'created',{templateVersion:p.templateVersion});this.save(p);return p.id;})();this.creating.set(commandId,task);try{return await task;}finally{this.creating.delete(commandId);}
    }
    if(!('id' in a))throw new Error('未知工坊操作。');
    const p=this.project(a.id);
    switch(a.type){
      case 'workshop.character.settings': {
        this.idle(p);const c=a.settings;
        if(!['anima','animagine'].includes(c.backend)||![c.width,c.height].every(v=>Number.isInteger(v)&&v>=512&&v<=1536&&v%8===0)||!Number.isInteger(c.steps)||c.steps<1||c.steps>100||!Number.isFinite(c.cfg)||c.cfg<1||c.cfg>20)throw Error('立绘参数无效：尺寸需为 512–1536 的 8 倍数，步数 1–100，CFG 1–20。');
        for(const value of [c.model,c.encoder,c.vae,c.sampler,c.scheduler])if(typeof value!=='string'||value.length>200||/[\0\r\n]/.test(value))throw Error('模型或采样器名称无效');
        if(!c.model.trim()||(c.backend==='anima'&&(!c.encoder.trim()||!c.vae.trim())))throw Error('请填写立绘模型、编码器和 VAE');
        if(this.downloads.has(p.id))throw Error('请等待下载完成或取消下载后再切换模型');
        if(characterSettings(p.settings).backend!==c.backend){p.lora=undefined;p.candidates=undefined;}
        p.settings={...p.settings,character:structuredClone(c)};this.save(p);return true;
      }
      case 'workshop.assistant.send':return this.assistant.send(p,a.text,a.profileId);
      case 'workshop.assistant.stop':this.assistant.stop(p.id);return true;
      case 'workshop.lora.search':return this.searchLora(p,a.query);
      case 'workshop.parameters':this.revise(p,a.parameters);return true;
      case 'workshop.undo':{this.idle(p);const old=p.revisions?.pop();if(old)this.applyParameters(p,old);this.save(p);return true;}
      case 'workshop.draft.apply':{this.idle(p);if(p.draft){this.revise(p,p.draft);p.draft=undefined;this.save(p);}return true;}
      case 'workshop.lora.clear':this.idle(p);p.lora=undefined;this.save(p);return true;
      case 'workshop.lora.weight':this.idle(p);if(!Number.isFinite(a.strength)||a.strength<0||a.strength>2)throw Error('权重需要在 0–2 之间');if(p.lora)p.lora.strength=a.strength;this.save(p);return true;
      case 'workshop.lora.cancel':this.downloads.get(p.id)?.abort();return true;
      case 'workshop.lora.install':{
        this.idle(p);if(this.downloads.has(p.id))throw Error('本项目正在下载');const c=p.candidates?.find(c=>c.versionId===a.versionId);if(!c)throw Error('请先搜索并选择候选');
        const controller=new AbortController();this.downloads.set(p.id,controller);p.download={state:'running',received:0,total:c.sizeKB*1024};this.save(p);
        const job=(async()=>{try{const file=await this.loras.install(this.state.settings.modelsRoot??'',c,controller.signal,(received,total)=>{p.download={state:'running',received,total};this.save(p);});this.idle(p);p.lora={backend:characterSettings(p.settings).backend,file,sha256:c.sha256,name:c.name,strength:c.suggestedStrength??.8,triggerWords:c.triggerWords,authorNotes:c.description,sourceUrl:c.url,versionId:c.versionId};p.download={state:'completed',received:c.sizeKB*1024,total:c.sizeKB*1024};this.save(p);return true;}catch(e){p.download={state:controller.signal.aborted?'cancelled':'error',received:p.download?.received??0,total:c.sizeKB*1024,error:(e as Error).message};this.save(p);throw e;}})();this.downloadJobs.add(job);
        try{return await job;}finally{this.downloads.delete(p.id);this.downloadJobs.delete(job);}
      }
      case 'workshop.update':{
        this.idle(p);if(a.characterPrompt!==undefined||a.negativePrompt!==undefined||a.description!==undefined)this.revise(p,{characterPrompt:a.characterPrompt??p.characterPrompt,negativePrompt:a.negativePrompt??p.negativePrompt,description:a.description??p.description});if(a.name!==undefined){p.name=text(a.name,80,'角色名称')||p.name;p.skinId=undefined;}if(a.description!==undefined)p.description=text(a.description,4000,'角色描述');
        if(a.characterPrompt!==undefined)p.characterPrompt=text(a.characterPrompt,6000,'角色提示词');if(a.negativePrompt!==undefined)p.negativePrompt=text(a.negativePrompt,3000,'负面提示词');
        if(a.seed!==undefined){if(!Number.isSafeInteger(a.seed)||a.seed<0||a.seed>2**32-1)throw new Error('种子需为 0–4294967295 的整数。');p.seed=a.seed;}
        if(a.anchor){if(![a.anchor.x,a.anchor.y].every(v=>Number.isFinite(v)&&v>=0&&v<=272))throw new Error('锚点超出画布。');p.anchor={...a.anchor};p.reviewedAt=undefined;p.skinId=undefined;}
        this.save(p);return true;
      }
      case 'workshop.prompt':return this.assistant.send(p,'根据当前角色描述整理完整的正面与负面提示词，并调用工具保存；保留我已确认的角色特征。',a.profileId);
      case 'workshop.character':
        this.idle(p);if(this.downloads.has(p.id))throw Error('请等待 LoRA 下载完成再生成');if(p.lora&&(p.lora.backend??'animagine')!==characterSettings(p.settings).backend)throw Error('当前 LoRA 与立绘模型不兼容，请重新选择');if(!p.characterPrompt.trim())throw new Error('请先填写角色提示词。');p.generationRequested=true;p.cancelRequested=false;p.status='character';p.error=undefined;this.save(p);this.kick();return true;
      case 'workshop.confirmCharacter':{
        this.idle(p);if(!p.characters.some(c=>c.id===a.characterId))throw new Error('角色图片不存在。');
        if(p.characterId!==a.characterId){for(const motion of p.actions){motion.selectedVersionId=undefined;motion.attempts=0;}p.skinId=undefined;p.reviewedAt=undefined;}
        p.characterId=a.characterId;p.characterConfirmed=true;p.status='draft';p.error=undefined;p.progress={label:'角色已确认，可以制作完整动作包。'};this.save(p);return true;
      }
      case 'workshop.run':{
        if(workshopBusy(p))return true;this.idle(p);if(!p.characterConfirmed)throw new Error('请先确认角色形象。');
        p.requestedActions=p.actions.filter(m=>{const v=motionVersion(m);return !v?.animation||v.characterId!==p.characterId||v.status==='error';}).map(m=>m.key);
        if(!p.requestedActions.length){this.finish(p);return true;}
        p.cancelRequested=false;p.status='queued';p.error=undefined;this.save(p);this.kick();return true;
      }
      case 'workshop.retry':{
        this.idle(p);const m=this.motion(p,a.key);if(!p.characterConfirmed)throw new Error('请先确认角色。');if(a.prompt!==undefined)m.prompt=text(a.prompt,4000,'动作描述');
        // A manual retry always creates a new version; earlier candidates remain reviewable.
        for(const v of m.versions)if(['generating','matting','processing','cancelled'].includes(v.status))v.status='error';
        m.attempts=1;m.versions.push({id:randomUUID(),seed:randomInt(1,2**31),createdAt:Date.now(),prompt:m.prompt,model:this.state.settings.videoModel,characterId:p.characterId!,status:'generating',rawFiles:[],matteFiles:[],frames:[]});p.requestedActions=[m.key];p.cancelRequested=false;p.status='queued';p.error=undefined;p.reviewedAt=undefined;p.skinId=undefined;this.save(p);this.kick();return true;
      }
      case 'workshop.resume':
        if(workshopBusy(p))return true;if(this.editing.has(p.id))throw new Error('项目正在处理素材。');
        p.cancelRequested=false;p.status=p.generationRequested?'character':'queued';p.error=undefined;this.save(p);this.kick();return true;
      case 'workshop.cancel':{
        p.cancelRequested=true;
        if(this.state.activeProjectId===p.id||p.operation){p.status='stopping';p.progress={label:'已取消后续阶段；正在核对当前任务，必要时等待当前阶段收尾。'};this.save(p);this.kick();}
        else{p.status='cancelled';p.progress={label:'制作已取消，已有素材保留。'};this.save(p);}return true;
      }
      case 'workshop.resolveUnknown':{
        if(this.state.activeProjectId===p.id||p.operation?.state!=='unknown')throw new Error('当前没有待核实的未知提交。');
        this.store.event(p.id,'unknown.acknowledged',p.operation);p.operationLog.push({...p.operation});p.operation=undefined;p.status='paused';p.error=undefined;p.progress={label:'已记录人工核实；点击继续将重新提交未完成阶段。'};this.save(p);return true;
      }
      case 'workshop.selectVersion':{
        this.idle(p);const m=this.motion(p,a.key),v=m.versions.find(v=>v.id===a.versionId);
        if(!v?.animation||v.characterId!==p.characterId)throw new Error('该版本不能用于当前角色。');m.selectedVersionId=v.id;p.reviewedAt=undefined;p.skinId=undefined;this.finish(p);return true;
      }
      case 'workshop.review':{
        this.idle(p);const versions=(a.key?[this.motion(p,a.key)]:p.actions).map(motionVersion);
        for(const v of versions){if(!v?.animation)throw new Error('仍有动作尚未生成。');if(a.accepted&&(v.quality?.emptyFrames||v.quality?.opaqueCorners))throw new Error('动作中含空帧或不透明边角，请先重做。');}
        for(const v of versions)v!.reviewed=Boolean(a.accepted);p.reviewedAt=undefined;this.finish(p);return true;
      }
      case 'workshop.publish':return this.publish(p.id);
      case 'workshop.delete':{
        if(this.assistant.busy(p.id)||this.downloads.has(p.id))throw Error('请先停止助手和下载。');this.idle(p);const target=inside(this.root,`projects/${p.id}`),actual=await realpath(target),relative=path.relative(await realpath(this.root),actual);
        if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('项目目录不在工坊内。');
        this.assistant.remove(p.id);await rm(actual,{recursive:true,force:true});this.store.remove(p.id);this.state.projects=this.state.projects.filter(v=>v.id!==p.id);this.save();return true;
      }
      default:throw new Error('该操作需要桌面文件选择窗口。');
    }
  }
  private motion(p:WorkshopProject,key:MotionKey){const m=p.actions.find(v=>v.key===key);if(!m)throw new Error('动作不存在。');return m;}
  async upload(id:string,filename:string){const p=this.project(id);return this.lock(p,async()=>{
    if((await stat(filename)).size>20*1024*1024)throw new Error('角色图片不能超过 20 MB。');
    const assetId=randomUUID(),file=`characters/${assetId}.png`,result=await this.worker('character',{root:this.directory(p),file,source:await readFile(filename)});
    const asset:CharacterAsset={id:assetId,file,source:'upload',sha256:result.sha256,createdAt:Date.now()};p.characters.push(asset);p.status='awaiting-character';p.progress={label:'图片已导入，请确认全身、双脚和配饰均完整。'};this.save(p);return true;
  });}
  async importLora(id:string,filename:string){const p=this.project(id);return this.lock(p,async()=>{p.lora=await this.loras.import(this.state.settings.modelsRoot??'',filename,characterSettings(p.settings).backend);this.save(p);return true;});}
  private worker(kind:string,input:unknown):Promise<any>{
    return new Promise((resolve,reject)=>{const w=new Worker(this.options.workerPath,{workerData:{kind,input}});this.workers.add(w);let settled=false;
      const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;this.workers.delete(w);error?reject(error):resolve(value);void w.terminate();};
      w.on('message',m=>finish(m.error?new Error(m.error):undefined,m.result));w.on('error',e=>finish(e));w.on('exit',code=>{if(!settled)finish(new Error(`图片处理进程退出（${code}）。`));});
    });
  }
  private kick(){
    if(this.working||this.closed)return;
    this.working=this.drain().finally(()=>{this.working=undefined;if(!this.closed&&this.state.projects.some(p=>['queued','character','stopping'].includes(p.status)))this.kick();});
  }
  private async drain(){
    while(!this.closed){const p=[...this.state.projects].reverse().find(p=>['queued','character','stopping'].includes(p.status));if(!p)break;
      this.state.activeProjectId=p.id;const began=Date.now();this.save();
      try{await this.produce(p);}
      catch(error){
        if(this.closed)break;
        if(error instanceof ComfyError&&error.kind==='invalid'&&p.operation)p.operation.state='unknown';
        if(error instanceof Cancelled){p.status='cancelled';p.progress={label:'已停止制作，完成的素材与动作版本保留。'};}
        else{p.error=error instanceof Error?error.message:String(error);p.status=p.operation||this.controller.signal.aborted?'paused':'error';p.progress={label:p.status==='paused'?'制作已暂停；继续前将核对原任务。':'制作未完成，请处理错误后继续。'};this.store.event(p.id,'failed',{message:p.error,operationId:p.operation?.id});}
      }finally{p.metrics.elapsedMs+=Date.now()-began;this.state.activeProjectId=undefined;this.save(p);}
    }
  }
  private async produce(p:WorkshopProject){
    if(p.cancelRequested&&!p.operation)throw new Cancelled();
    const client=new ComfyClient(p.operation?.endpoint??p.settings.endpoint);
    let usedGpu = false;
    if(p.generationRequested){
      const files=await this.stage(p,client,'character',{},op=>characterGraph(p.settings,p.characterPrompt,p.negativePrompt,p.seed,op.prefix,p.lora));
      const assetId=randomUUID(),file=`characters/${assetId}.png`;const result=await this.worker('character',{root:this.directory(p),file,source:await client.image(files[0],this.controller.signal)});
      p.characters.push({id:assetId,file,source:'generated',seed:p.seed,model:characterSettings(p.settings).model,settings:structuredClone(characterSettings(p.settings)),prompt:p.characterPrompt,negativePrompt:p.negativePrompt,lora:p.lora?structuredClone(p.lora):undefined,sha256:result.sha256,createdAt:Date.now()});
      this.completeOperation(p);p.generationRequested=false;p.status='awaiting-character';p.progress={label:'立绘已生成。确认角色后，自动制作 11 项动作。'};this.save(p);if(p.cancelRequested)throw new Cancelled();return;
    }
    if(!p.characterConfirmed||!p.characterId)throw new Error('请先确认角色形象。');
    const character=p.characters.find(c=>c.id===p.characterId);if(!character)throw new Error('角色图片不存在。');
    const targets=p.requestedActions??p.actions.filter(m=>!motionVersion(m)?.animation).map(m=>m.key);
    p.status=p.cancelRequested?'stopping':'running';this.save(p);
    for(const key of targets){
      const m=this.motion(p,key),definition=MOTIONS.find(v=>v.key===key)!;
      if(p.cancelRequested&&!p.operation)throw new Cancelled();
      // If a prior action finished before a restart, never regenerate it automatically.
      if(m.versions.at(-1)?.animation&&!p.operation&&m.versions.at(-1)?.id===m.selectedVersionId)continue;
      let attemptsRemain=true;
      while(attemptsRemain){
        let v=p.operation?.versionId?m.versions.find(v=>v.id===p.operation!.versionId):m.versions.at(-1);
        if(!v||v.characterId!==p.characterId||(['ready','needs-attention'].includes(v.status) || v.status==='error'&&!v.rawFiles.length)){
          v={id:randomUUID(),seed:randomInt(1,2**31),createdAt:Date.now(),prompt:m.prompt,model:p.settings.videoModel,characterId:p.characterId,status:'generating',rawFiles:[],matteFiles:[],frames:[]};m.versions.push(v);m.attempts++;
        }
        const started=Date.now();p.progress={label:`${definition.name} · 生成动作（第 ${m.attempts} 次）`};this.save(p);
        try{
          if(!v.rawFiles.length){
            usedGpu = true;
            const files=await this.stage(p,client,'video',{actionKey:key,versionId:v.id},async op=>videoGraph(p.settings,await client.upload(await referenceImage(this.directory(p),character.file),`${p.id}-${character.id}-${op.id}.png`,this.controller.signal),v!.prompt,v!.seed,op.prefix));
            if(files.length!==49)throw new ComfyError(`视频应返回 49 帧，实际为 ${files.length}，未标记成功。`,'invalid');
            v.rawFiles=await this.download(p,client,files,`actions/${key}/${v.id}/raw`);this.completeOperation(p);this.save(p);
          }
          if(p.cancelRequested)throw new Cancelled();
          v.status='matting';this.save(p);
          if(v.matteFiles.length<v.rawFiles.length){ usedGpu=true; await client.releaseIdleModels().catch(()=>undefined); }
          while(v.matteFiles.length<v.rawFiles.length){
            const start=v.matteFiles.length,batch=v.rawFiles.slice(start,start+8);p.progress={label:`${definition.name} · 透明抠图 ${start}/${v.rawFiles.length}`};this.save(p);
            const files=await this.stage(p,client,'matte',{actionKey:key,versionId:v.id,batchStart:start},async op=>{
              const uploads:string[]=[];for(let i=0;i<batch.length;i++)uploads.push(await client.upload(await readFile(inside(this.directory(p),batch[i])),`${op.id}-${i}.png`,this.controller.signal));
              return matteGraph(p.settings,uploads,op.prefix);
            });
            if(files.length!==batch.length)throw new ComfyError('抠图返回帧数与输入不一致。','invalid');
            v.matteFiles.push(...await this.download(p,client,files,`actions/${key}/${v.id}/matte`,start));this.completeOperation(p);this.save(p);
            if(p.cancelRequested)throw new Cancelled();
          }
          v.status='processing';p.progress={label:`${definition.name} · 整理循环与透明图集`};this.save(p);
          const result=await this.worker('normalize',{root:this.directory(p),files:v.matteFiles,output:`actions/${key}/${v.id}/prepared`,loop:definition.loop});
          Object.assign(v,result);v.status=v.quality!.passed?'ready':'needs-attention';v.elapsedMs=Date.now()-started;m.selectedVersionId=v.id;
          this.store.event(p.id,'motion.prepared',{key,versionId:v.id,quality:v.quality});this.save(p);
          attemptsRemain=!v.quality!.passed&&m.attempts<3&&!p.cancelRequested;
          if(attemptsRemain){p.progress={label:`${definition.name} · 检查发现问题，自动重试 ${m.attempts}/2`};this.save(p);}
        }catch(error){
          if(error instanceof Cancelled){v.status='cancelled';throw error;}
          if(!p.operation&&v.status==='processing'&&!this.controller.signal.aborted){v.status='error';v.error=(error as Error).message;this.save(p);// Deterministic local processing errors must not spin on the same frames.
}
          if(!p.operation){v.status='error';v.error=(error as Error).message;}this.save(p);throw error;
        }
      }
      p.requestedActions=(p.requestedActions??targets).filter(v=>v!==key);this.save(p);
      if(usedGpu)await client.releaseIdleModels().catch(()=>undefined);
    }
    if(p.cancelRequested)throw new Cancelled();this.finish(p);
  }
  private completeOperation(p:WorkshopProject){if(p.operation){p.operation.state='finished';p.operationLog.push({...p.operation});this.store.event(p.id,'operation.finished',p.operation);p.operation=undefined;this.save(p);}}
  private async stage(p:WorkshopProject,client:ComfyClient,stage:ComfyOperation['stage'],extra:Partial<ComfyOperation>,graph:(op:ComfyOperation)=>Graph|Promise<Graph>){
    let op=p.operation;
    if(op&&(op.stage!==stage||op.versionId!==extra.versionId||op.batchStart!==extra.batchStart))throw new Error('恢复阶段与原任务不一致；未提交新的生成任务。');
    if(op&&!op.promptId){op.promptId=await client.findOperation(op.id);if(!op.promptId){op.state='unknown';this.save(p);throw new ComfyError('上次提交的结果未知。请在 ComfyUI 核对队列和历史后，再选择“已核实，允许重试”。','unknown');}op.state='submitted';this.save(p);}
    if(!op){
      const env=await client.inspect(p.settings,stage);
      if(client.endpoint===this.state.settings.endpoint)this.state.environment=env;
      this.save();
      if(env.status==='offline')throw new ComfyError(env.issues[0]?.detail??'ComfyUI 未连接。');
      const missing=env.issues.filter(i=>i.severity==='error');
      if(missing.length)throw new ComfyError(missing.map(i=>i.name+'：'+i.detail).join('\n'),'invalid');
      op=operation(stage,p.id,client.endpoint,extra);const body=await graph(op);this.controller.signal.throwIfAborted();if(p.cancelRequested)throw new Cancelled();
      p.operation=op;this.store.event(p.id,'operation.submitting',op);this.save(p);
      try{op.promptId=await client.submit(body,op,this.controller.signal);op.state='submitted';this.save(p);}
      catch(error){if(error instanceof ComfyError&&error.kind==='rejected'){this.store.event(p.id,'operation.rejected',{...op,error:error.message});p.operation=undefined;}else op.state='unknown';this.save(p);throw error;}
    }
    if(op.outputs)return op.outputs;
    const stopWatch=client.watch(op.clientId,()=>op!.promptId,progress=>{if(this.closed)return;p.progress={...progress,label:`${stage==='video'?'动作生成':stage==='matte'?'透明抠图':'绘制角色'} · ${progress.label}`};this.options.changed();});
    let sampled=0;const monitoringStarted=Date.now();
    try{
      while(true){
        this.controller.signal.throwIfAborted();
        if(p.cancelRequested&&await client.cancelQueued(op.promptId!)){this.completeOperation(p);throw new Cancelled();}
        let result;
        try{result=await client.result(op.promptId!);}catch(error){if(error instanceof ComfyError&&error.kind==='execution'){this.store.event(p.id,'operation.failed',{...op,error:error.message});p.operation=undefined;this.save(p);}throw error;}
        if(result.state==='missing'){op.state='unknown';this.save(p);throw new ComfyError('ComfyUI 队列和历史中已找不到此任务。请核对后再允许重新提交。','unknown');}
        if(result.state==='completed'){op.outputs=result.files!;op.state='finished';this.save(p);return op.outputs;}
        if(Date.now()-sampled>30000){sampled=Date.now();try{const s=await client.json('/system_stats'),gpu=s.devices?.find((d:any)=>d.type==='cuda')??s.devices?.[0];if(gpu){p.metrics.gpu=String(gpu.name);p.metrics.peakVramBytes=Math.max(p.metrics.peakVramBytes,Math.max(0,Number(gpu.vram_total)-Number(gpu.vram_free))||0);}if(typeof s.system?.ram_free==='number')p.metrics.minRamFreeBytes=Math.min(p.metrics.minRamFreeBytes??Infinity,s.system.ram_free);this.save(p);}catch{/* Progress can continue without optional telemetry. */}}
        if(Date.now()-monitoringStarted>6*60*60*1000)throw new ComfyError('此阶段已等待超过 6 小时；任务编号已保留，可稍后继续查询。');
        await wait(1500,this.controller.signal);
      }
    }finally{stopWatch();}
  }
  private async download(p:WorkshopProject,client:ComfyClient,files:import('../../shared/workshop').ComfyFile[],folder:string,start=0){
    const output:string[]=[];for(let i=0;i<files.length;i++){const file=`${folder}/${String(start+i).padStart(3,'0')}.png`;await atomicFile(inside(this.directory(p),file),await client.image(files[i],this.controller.signal));output.push(file);}return output;
  }
  private finish(p:WorkshopProject){
    const versions=p.actions.map(motionVersion),all=versions.every(v=>v?.animation&&v.characterId===p.characterId),issues=versions.some(v=>v?.quality&&!v.quality.passed&&!v.reviewed);
    p.status=all?(issues?'needs-attention':'review'):'needs-attention';p.progress={label:all?'动作已整理，请预览角色外观、肢体与循环效果。':'仍有动作未完成，可继续制作或单独重做。'};p.error=undefined;this.save(p);
  }
  private reviewed(p:WorkshopProject){for(const m of p.actions){const v=motionVersion(m);if(!v?.animation||!v.reviewed||v.characterId!==p.characterId)throw new Error('请先预览并确认全部 11 项动作，再导出或加入素材库。');if(v.quality?.emptyFrames||v.quality?.opaqueCorners)throw new Error('仍有空帧或透明背景异常的动作。');}}
  async publish(id:string):Promise<string>{const p=this.project(id);return this.lock(p,async()=>{
    this.reviewed(p);if(p.skinId&&this.state.skins.some(s=>s.id===p.skinId))return p.skinId;
    const id=randomUUID(),folder=inside(this.root,`skins/${id}`);await mkdir(folder,{recursive:true});
    const manifest:SkinManifest={name:p.name,width:272,height:272,anchor:{...p.anchor},animations:{}};
    for(const m of p.actions){const v=motionVersion(m)!,target=`actions/${m.key}`;await mkdir(inside(folder,`${target}/frames`),{recursive:true});
      await copyFile(inside(this.directory(p),v.animation!.frames[0]),inside(folder,`${target}/atlas.png`));
      for(let i=0;i<v.frames.length;i++)await copyFile(inside(this.directory(p),v.frames[i]),inside(folder,`${target}/frames/${String(i).padStart(3,'0')}.png`));
      manifest.animations[m.key]={...v.animation!,frames:[`${target}/atlas.png`]};
    }
    await atomicFile(path.join(folder,'skin.json'),JSON.stringify(manifest,null,2));
    await atomicFile(path.join(folder,'provenance.json'),JSON.stringify({templateId:p.templateId,templateVersion:p.templateVersion,createdAt:Date.now(),character:p.characters.find(c=>c.id===p.characterId),motions:p.actions.map(m=>{const v=motionVersion(m)!;return {key:m.key,seed:v.seed,prompt:v.prompt,model:v.model,quality:v.quality,reviewed:v.reviewed};}),generation:{width:512,height:512,frames:49,fps:24},metrics:p.metrics},null,2));
    await loadSkin(path.join(folder,'skin.json'));
    const skin:WorkshopSkin={id,name:p.name,projectId:p.id,createdAt:Date.now(),manifest,thumbnail:`workshop://skins/${id}/actions/idle/frames/000.png`};
    this.store.skin(skin);this.state.skins.unshift(skin);p.skinId=id;p.reviewedAt=Date.now();p.status='completed';p.progress={label:'桌宠已加入素材库，可导出或应用到桌面。'};this.save(p);return id;
  });}
  async export(id:string,destination:string){
    const skinId=await this.publish(id),skin=this.state.skins.find(s=>s.id===skinId)!,root=inside(this.root,`skins/${skinId}`),zip=new ZipFile();
    const temporary=`${destination}.${randomUUID()}.tmp`;await mkdir(path.dirname(destination),{recursive:true});
    const stream=zip.outputStream as Readable,completed=pipeline(stream,createWriteStream(temporary));zip.on('error',error=>stream.destroy(error));
    try{
      zip.addFile(path.join(root,'skin.json'),'skin.json');zip.addFile(path.join(root,'provenance.json'),'provenance.json');
      for(const [key,animation]of Object.entries(skin.manifest.animations)){zip.addFile(inside(root,animation.frames[0]),`actions/${key}/atlas.png`);for(let i=0;i<animation.atlas!.indices.length;i++){const f=`actions/${key}/frames/${String(i).padStart(3,'0')}.png`;zip.addFile(inside(root,f),f);}}
      zip.end();await completed;await rename(temporary,destination);this.store.event(id,'exported',{skinId});return true;
    }catch(error){stream.destroy();await completed.catch(()=>undefined);await rm(temporary,{force:true});throw error;}
  }
  selectSkin(id:string|null):Promise<void>{
    const perform=async()=>{
      try{
        if(id&&!this.state.skins.some(s=>s.id===id))throw new Error('所选桌宠已不存在。');
        const source=id?inside(this.root,`skins/${id}/skin.json`):this.options.bundledSkin,data=await loadSkin(source);
        data.baseUrl=id?`workshop://skins/${id}/`:'pet-skin://asset/';this.options.skin(data);this.state.selectedSkinId=id;this.store.setValue('selectedSkin',id);this.save();
      }catch(error){const fallback=await loadSkin(this.options.bundledSkin);this.options.skin(fallback);this.state.selectedSkinId=null;this.store.setValue('selectedSkin',null);this.save();if(id)throw new Error(`桌宠切换失败，已恢复银白龙娘：${(error as Error).message}`);else throw error;}
    };
    const task=this.selection.then(perform,perform);this.selection=task.catch(()=>undefined);return task;
  }
  async asset(host:string,pathname:string):Promise<string>{
    if(!['projects','skins'].includes(host))throw new Error('素材位置无效。');const relative=decodeURIComponent(pathname).replace(/^\/+/,''),parts=relative.split('/');
    if(host==='projects'&&!this.state.projects.some(p=>p.id===parts[0])||host==='skins'&&!this.state.skins.some(s=>s.id===parts[0]))throw new Error('素材不存在。');
    if(!/\.png$/i.test(relative))throw new Error('只允许加载 PNG 预览素材。');
    const target=await realpath(inside(this.root,`${host}/${relative}`)),base=await realpath(inside(this.root,`${host}/${parts[0]}`)),rel=path.relative(base,target);
    if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('素材不能链接到库外。');return target;
  }
  async dispose(){
    await this.assistant.close();for(const c of this.downloads.values())c.abort();await Promise.allSettled([...this.downloadJobs]);
    this.closed=true;this.controller.abort(new Error('应用退出，制作状态已保存。'));for(const w of this.workers)void w.terminate();await this.working;await Promise.allSettled([...this.pendingEdits,...this.creating.values()]);
    for(const p of this.state.projects)if(workshopBusy(p)){p.status='paused';this.store.save(p);}await this.selection;this.store.close();
  }
}

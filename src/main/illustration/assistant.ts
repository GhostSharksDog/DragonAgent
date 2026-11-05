import {randomUUID} from 'node:crypto';
import {utilityProcess,type UtilityProcess} from 'electron';
import type {AgentEvent,AgentRecord,AgentRuntime,ModelProfile} from '../../../packages/agent-core/src';

export class IllustrationAssistant {
  private worker?:UtilityProcess;
  private starting?:Promise<void>;
  private closed=false;
  private pending=new Map<string,{resolve(value:any):void;reject(error:Error):void;timer?:NodeJS.Timeout}>();
  constructor(private filename:string,private workerPath:string,private event:(event:AgentEvent)=>void){}
  private rpc(method:string,args:unknown={},timeout=30000):Promise<any>{
    if(!this.worker)return Promise.reject(Error('插画内核未启动'));
    const id=randomUUID();return new Promise((resolve,reject)=>{const timer=timeout?setTimeout(()=>{this.pending.delete(id);reject(Error('插画内核操作超时：'+method));},timeout):undefined;this.pending.set(id,{resolve,reject,timer});try{this.worker!.postMessage({id,method,args});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  }
  private rejectPending(error:Error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  private async start(){
    if(this.closed)throw Error('插画内核已关闭');
    if(this.starting)return this.starting;if(this.worker)return;
    this.starting=(async()=>{
      const worker=this.worker=utilityProcess.fork(this.workerPath,[],{serviceName:'DragonAgent Illustration',stdio:'pipe'});
      worker.stdout?.on('data',()=>{});worker.stderr?.on('data',()=>{});
      const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{worker.kill();reject(Error('插画内核启动超时'));},30000);this.pending.set('ready',{resolve:()=>resolve(),reject,timer});});
      worker.on('message',data=>{if(this.worker!==worker)return;if(data.event){this.event(data.event);return;}const id=data.ready?'ready':data.id,p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);data.error?p.reject(Error(data.error)):p.resolve(data.result);});
      worker.on('exit',()=>{if(this.worker!==worker)return;this.worker=undefined;this.rejectPending(Error('插画内核已退出，未确认操作不会自动重放'));});
      try{await ready;await this.rpc('init',{filename:this.filename});}catch(error){this.worker=undefined;this.rejectPending(error as Error);worker.kill();throw error;}
    })().finally(()=>{this.starting=undefined;});return this.starting;
  }
  async exists(id:string){await this.start();return this.rpc('exists',{id});}
  async deleteSession(id:string){await this.start();return this.rpc('delete',{id});}
  async run(input:Parameters<AgentRuntime['run']>[0],profile:ModelProfile,key?:string):Promise<Pick<AgentRecord,'status'|'result'|'error'|'usage'>>{
    await this.start();input.signal?.throwIfAborted();const {signal,...serializable}=input;
    const abort=()=>{void this.rpc('cancel',{id:input.sessionId}).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{return await this.rpc('run',{input:serializable,profile,key},0);}finally{signal?.removeEventListener('abort',abort);}
  }
  async dispose(){this.closed=true;if(this.starting)await this.starting.catch(()=>{});if(!this.worker)return;const worker=this.worker;try{await this.rpc('dispose',{},10000);}finally{this.worker=undefined;this.rejectPending(Error('插画内核已关闭'));worker.kill();}}
}

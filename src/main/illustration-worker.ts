import {AgentRuntime,HttpModelAdapter,ToolRegistry} from '../../packages/agent-core/src';
import {SqliteSessionStore} from '../../packages/agent-core/src/sqlite-store';
const port=(process as any).parentPort;
let store:SqliteSessionStore;
const runs=new Map<string,{engine:AgentRuntime;controller:AbortController;done:Promise<unknown>}>();
async function dispatch(method:string,args:any){
  if(method==='init'){if(store)throw Error('插画内核已初始化');store=new SqliteSessionStore(args.filename);return true;}
  if(!store)throw Error('插画内核尚未初始化');
  if(method==='exists')return !!await store.getAgent(args.id);
  if(method==='delete'){if(runs.has(args.id))throw Error('请先停止插画对话');await store.deleteSession(args.id);return true;}
  if(method==='cancel'){runs.get(args.id)?.controller.abort();return true;}
  if(method==='dispose'){for(const r of runs.values())r.controller.abort();await Promise.allSettled([...runs.values()].map(r=>r.done));store.close();return true;}
  if(method==='run'){
    if(runs.has(args.input.sessionId))throw Error('项目对话仍在执行');
    const engine=new AgentRuntime({store,adapter:new HttpModelAdapter(),tools:new ToolRegistry(),profiles:()=>[args.profile],key:async()=>args.key,toolFilter:t=>t.name==='attachment_read',approve:async()=>false,question:async()=>({}),event:event=>{if(['text','usage','notice','compacted'].includes(event.type))port.postMessage({event});}});
    const controller=new AbortController(),done=engine.run({...args.input,signal:controller.signal});
    runs.set(args.input.sessionId,{engine,controller,done});
    try{const result=await done;return {status:result.status,result:result.result,error:result.error,usage:result.usage};}
    finally{runs.delete(args.input.sessionId);await engine.dispose();}
  }
  throw Error('未知插画内核操作');
}
port.on('message',async({data}:any)=>{try{port.postMessage({id:data.id,result:await dispatch(data.method,data.args)});}catch(error){port.postMessage({id:data.id,error:(error as Error).message});}});
port.postMessage({ready:true});

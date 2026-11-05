import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentRuntime,MemorySessionStore,ToolRegistry,type Message} from '../packages/agent-core/src';
const profile={id:'p',model:'fixture',protocol:'openai-completions' as const,baseUrl:'http://fixture',contextWindow:65536,maxOutput:4096};
const grant={folders:[],origins:[],terminal:true,browserInput:false,approvalMode:'auto' as const};
const response=(message:Message)=>({message,usage:{input:100,output:10,reported:true},finish:message.calls?.length?'tools' as const:'stop' as const});
test('read batches preserve request ordering and facts verify steps without trusting completion prose',async()=>{
  const tools=new ToolRegistry(),store=new MemorySessionStore();let active=0,peak=0,step=0;
  tools.register({name:'read',description:'read',effect:'read',parallelSafe:true,parameters:{type:'object',properties:{n:{type:'integer'}}},execute:async args=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(4-Number(args.n))*10));active--;return {text:String(args.n)};}});
  tools.register({name:'pet_terminal',description:'command',effect:'write',parameters:{type:'object'},execute:async()=>({text:'passed',facts:{exitCode:0}})});
  const core=new AgentRuntime({tools,store,profiles:()=>[profile],key:async()=>'',approve:async()=>true,question:async()=>({}),adapter:{generate:async r=>{
    if(step++===0)return response({role:'assistant',text:'',calls:[1,2,3].map(n=>({id:'r'+n,name:'read',arguments:JSON.stringify({n})}))});
    if(step===2){assert.deepEqual(r.messages.filter(m=>m.role==='tool').map(m=>m.text),['1','2','3']);return response({role:'assistant',text:'',calls:[{id:'exec',name:'pet_terminal',arguments:'{}'}]});}
    if(step===3)return response({role:'assistant',text:'',calls:[{id:'plan',name:'todo_write',arguments:JSON.stringify({todos:[{id:'tested',content:'Run check',status:'completed',checks:[{kind:'command-exit',callId:'exec',exitCode:0}]},{id:'visual',content:'Looks right',status:'completed',dependsOn:['tested'],checks:[{kind:'manual',description:'user confirms appearance'}]}]})}]});
    return response({role:'assistant',text:'done'});
  }}});
  const result=await core.run({sessionId:'s',profileId:'p',prompt:'work',grant});
  assert.equal(result.status,'completed');assert.equal(peak,3);assert.equal(result.steps?.[0].status,'completed');assert.equal(result.steps?.[1].status,'awaiting-verification');assert.equal(result.evidence?.exec.facts?.exitCode,0);
  assert.equal((await store.history('s')).filter(e=>e.type==='request'&&e.attempt.status==='completed').length,4);
});
test('identical oversized results pause at eight calls even though attachment IDs differ',async()=>{
  const tools=new ToolRegistry(),store=new MemorySessionStore();let n=0;
  tools.register({name:'stuck',description:'read',effect:'read',parameters:{type:'object'},execute:async()=>({text:'same'.repeat(6000)})});
  const core=new AgentRuntime({tools,store,profiles:()=>[profile],key:async()=>'',approve:async()=>true,question:async()=>({}),adapter:{generate:async()=>response({role:'assistant',text:'',calls:[{id:String(++n),name:'stuck',arguments:'{}'}]})}});
  const result=await core.run({sessionId:'s',profileId:'p',prompt:'work',grant});assert.equal(result.status,'paused');assert.equal(n,8);
  assert.match(result.error??'',/八次/);
});

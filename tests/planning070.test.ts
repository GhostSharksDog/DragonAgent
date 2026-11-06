import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentRuntime,ToolRegistry,MemorySessionStore,type AgentRecord,type Message} from '../packages/agent-core/src';
import {appearanceValues} from '../src/shared/appearance';
import {validatePlanSteps,wantsPlan} from '../src/shared/planning';
const profile={id:'p',model:'fixture',protocol:'openai-completions' as const,baseUrl:'http://fixture',contextWindow:65536,maxOutput:4096};
const reply=(message:Message)=>({message,usage:{input:20,output:5},finish:message.calls?.length?'tools' as const:'stop' as const});
test('plan policy blocks writes and untrusted MCP reads under every permission; children inherit it',async()=>{
 for(const approvalMode of ['ask','auto','full'] as const){
  let writes=0;const registry=new ToolRegistry(),store=new MemorySessionStore();
  for(const [name,effect,planSafe]of [['unsafe','write',false],['mcp__fake__read','read',false],['read_file','read',true]] as const)registry.register({name,effect,planSafe,description:name,parameters:{type:'object'},execute:async()=>{if(name!=='read_file')writes++;return {text:'ok'};}});
  const grant={mode:'plan' as const,approvalMode,allFolders:true,allOrigins:true,folders:[],origins:[],browserInput:true,terminal:true};
  const dummy:AgentRecord={id:'s',sessionId:'s',runId:'run',rootId:'s',title:'计划',profileId:'p',grant,messages:[],status:'running',requests:0,usage:{input:0,output:0},createdAt:0,updatedAt:0};
  for(const name of ['unsafe','mcp__fake__read']){assert.equal(registry.allowed(name,dummy),false);const result=await registry.call(name,{}, {agent:dummy,signal:new AbortController().signal,approve:async()=>true,question:async()=>({})});assert.equal(result.errorKind,'denied');}
  let root=0;const core=new AgentRuntime({tools:registry,store,profiles:()=>[profile],key:async()=>'',approve:async()=>true,question:async()=>({}),adapter:{generate:async r=>{
   assert(!r.tools.some(t=>t.name==='unsafe'||t.name==='mcp__fake__read'));assert(r.tools.some(t=>t.name==='read_file'));
   if(r.tools.some(t=>t.name==='agent_spawn')&&root++===0)return reply({role:'assistant',text:'',calls:[{id:'spawn',name:'agent_spawn',arguments:JSON.stringify({title:'只读调查',task:'尝试修改文件'})}]});
   return reply({role:'assistant',text:'已调查'});
  }}});
  await core.run({sessionId:'s',profileId:'p',prompt:'计划',grant});const children=(await store.listAgents('s')).filter(a=>a.parentId);assert.equal(children.length,1);assert.equal(children[0].grant.mode,'plan');assert.equal(writes,0);await core.dispose();
 }
});
test('appearance values clamp nonfinite input and never contain composer opacity',()=>{
 const a=appearanceValues({output:NaN,selection:2,x:-2,fontSize:999 as any,customAccent:'url(fake)'});assert.equal(a.output,.48);assert.equal(a.selection,1);assert.equal(a.x,0);assert.equal(a.fontSize,15);assert.equal(a.customAccent,undefined);assert(!('composer' in a));
});

const planGrant = {mode:'plan' as const,approvalMode:'auto' as const,allFolders:false,allOrigins:false,folders:[] as string[],origins:[] as string[],browserInput:false,terminal:false};
test('plan steps require unique ids and backward-only dependencies', () => {
  assert.equal(validatePlanSteps([{id:'a',dependsOn:[]},{id:'b',dependsOn:['a']}]), undefined);
  assert.match(validatePlanSteps([{id:'a',dependsOn:[]},{id:'a',dependsOn:[]}])!, /唯一/);
  assert.match(validatePlanSteps([{id:'a',dependsOn:['a']}])!, /成环/);
  assert.match(validatePlanSteps([{id:'a',dependsOn:['b']},{id:'b',dependsOn:[]}])!, /成环/);
  assert.match(validatePlanSteps([])!, /至少/);
});
test('plan mode rejects a model-constructed call to a hidden tool at execution time', async () => {
  let writes = 0;
  const registry = new ToolRegistry(), store = new MemorySessionStore();
  registry.register({name:'write_file',effect:'write',planSafe:false,description:'write',parameters:{type:'object'},execute:async()=>{writes++;return {text:'written'};}});
  registry.register({name:'read_file',effect:'read',planSafe:true,description:'read',parameters:{type:'object'},execute:async()=>({text:'data'})});
  let calls = 0;
  const core = new AgentRuntime({tools:registry,store,profiles:()=>[profile],key:async()=>'',approve:async()=>true,question:async()=>({}),adapter:{generate:async()=>{
    calls++;
    if(calls===1)return reply({role:'assistant',text:'',calls:[{id:'hidden',name:'write_file',arguments:'{}'}]});
    return reply({role:'assistant',text:'已停止尝试'});
  }}});
  const result = await core.run({sessionId:'hidden-plan',profileId:'p',prompt:'计划',grant:planGrant});
  assert.equal(writes,0,'hidden write must never execute');
  const agent = await store.getAgent('hidden-plan');
  const toolMessage = agent!.messages.find(m=>m.role==='tool'&&m.name==='write_file');
  assert.match(toolMessage?.text??'',/不属于当前任务可用范围/);
  assert.equal(result.status,'completed');
  await core.dispose();
});
test('plan tool discovery never exposes unaudited MCP tools', async () => {
  const registry = new ToolRegistry(), store = new MemorySessionStore();
  registry.register({name:'mcp__fake__read',effect:'read',planSafe:false,description:'fake mcp read',parameters:{type:'object'},execute:async()=>({text:'secret'})});
  let calls = 0;
  const core = new AgentRuntime({tools:registry,store,profiles:()=>[profile],key:async()=>'',approve:async()=>true,question:async()=>({}),adapter:{generate:async()=>{
    calls++;
    if(calls===1)return reply({role:'assistant',text:'',calls:[{id:'search',name:'tool_search',arguments:JSON.stringify({query:'fake'})}]});
    if(calls===2)return reply({role:'assistant',text:'',calls:[{id:'load',name:'tool_load',arguments:JSON.stringify({names:['mcp__fake__read']})}]});
    return reply({role:'assistant',text:'结束'});
  }}});
  await core.run({sessionId:'tool-plan',profileId:'p',prompt:'计划',grant:planGrant});
  const agent = await store.getAgent('tool-plan');
  const search = agent!.messages.find(m=>m.role==='tool'&&m.name==='tool_search')!;
  assert.deepEqual(JSON.parse(search.text), [], 'plan tool_search must not list unaudited MCP tools');
  const load = agent!.messages.find(m=>m.role==='tool'&&m.name==='tool_load')!;
  assert.equal(load.isError, true);
  assert.match(load.text, /工具不存在或连接不可用/);
  await core.dispose();
});

test('explicit plan requests are detected without treating ordinary mentions as plan mode', () => {
  assert.equal(wantsPlan('请制定计划：整理工作目录'), true);
  assert.equal(wantsPlan('请先制定计划，再执行：整理工作目录'), true);
  assert.equal(wantsPlan('先给出实施步骤，然后再动手'), true);
  assert.equal(wantsPlan('只讨论方案，不要执行'), true);
  assert.equal(wantsPlan('make a plan first'), true);
  assert.equal(wantsPlan("don't execute anything yet"), true);
  assert.equal(wantsPlan('这个计划文件在哪里'), false);
  assert.equal(wantsPlan('继续执行，把结果写出来'), false);
  assert.equal(wantsPlan('plan.md 打不开'), false);
  assert.equal(wantsPlan('帮我整理计划目录'), false);
});

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AgentRuntime, HttpModelAdapter, McpManager, ToolRegistry, type AgentRecord, type ToolContext } from '../../packages/agent-core/src';
import { SqliteSessionStore } from '../../packages/agent-core/src/sqlite-store';
import { registerDeepSeekSearch } from './deepseek-search';
const port = (process as any).parentPort;
const send = (value: unknown) => port.postMessage(value);
let engine: AgentRuntime, store: SqliteSessionStore, mcp: McpManager, registry: ToolRegistry;
const replies = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
const external = new Map<string, { agent: AgentRecord; controller: AbortController }>();
function host(kind: string, agent: AgentRecord, params: unknown, signal: AbortSignal): Promise<any> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { replies.delete(id); send({ withdraw: id }); reject(new Error('操作已取消。')); };
    const finish = () => signal.removeEventListener('abort', abort);
    replies.set(id, { resolve: v => { finish(); resolve(v); }, reject: e => { finish(); reject(e); } }); signal.addEventListener('abort', abort, { once: true });
    send({ request: id, kind, agent, params });
  });
}
function context(agent: AgentRecord, signal: AbortSignal): ToolContext {
  return { agent, signal, approve: async (title, details) => {
    const id=randomUUID(),meta={agentId:agent.id,sessionId:agent.sessionId,runId:agent.runId,time:Date.now()};
    await store.append({...meta,type:'approval.requested',id,title,details});
    const allowed=await host('approval',agent,{id,title,details},signal)===true&&!signal.aborted;
    await store.append({...meta,time:Date.now(),type:'approval.resolved',id,allowed}); return allowed;
  }, question: questions => host('question', agent, { questions }, signal) };
}
async function dispatch(method: string, args: any) {
  if (method === 'init') {
    registry = new ToolRegistry(); store = new SqliteSessionStore(path.join(args.home, 'agent-core.db'));
    for (const d of args.definitions) registry.register({ name: d.name, description: d.description, parameters: d.inputSchema, approval: 'managed', effect: d.name.startsWith('pet_files_') && ['list', 'read', 'search'].some(s => d.name.endsWith(`_${s}`)) || d.name === 'pet_task_scope' || d.name === 'pet_attachment_read' ? 'read' : 'unknown', execute: async (input, ctx) => {
      if (d.name.startsWith('pet_browser_') && ctx.agent.grant.approvalMode === 'ask' && !await ctx.approve(d.description, JSON.stringify(input))) return {isError:true,text:'用户拒绝了本次网页操作。'};
      const result = await host('tool', ctx.agent, { name: d.name, arguments: input }, ctx.signal);
      return { text: result.contentItems.filter((v: any) => v.type === 'inputText').map((v: any) => v.text).join('\n'), images: result.contentItems.filter((v: any) => v.type === 'inputImage').map((v: any) => v.imageUrl), isError: !result.success };
    } });
    engine = new AgentRuntime({ profiles: () => args.profiles, key: async id => args.keys[id], store, tools: registry, adapter: new HttpModelAdapter(), event: event => { if (event.type === 'agent') send({ event: 'core', data: { ...event, agent: { ...event.agent, messages: [] } } }); else send({ event: 'core', data: event }); }, approve: (agent, request, signal) => host('approval', agent, request, signal), question: (agent, questions, signal) => host('question', agent, { questions }, signal) });
    registerDeepSeekSearch(registry,args.profiles,args.selectedProfile,id=>args.keys[id]);
    mcp = new McpManager(registry, status => send({ event: 'mcp', data: status }), args.home);
    await mcp.configure(args.mcp); return true;
  }
  if (method === 'run') return engine.run(args);
  if (method === 'mcpReconnect') { await mcp.configure(args); return true; }
  if (method === 'approveTool') {
    const scope = external.get(args.sessionId);
    if (!scope) return engine.approveTool(args.sessionId, args.agentId, args.title, args.details);
    return context(scope.agent, scope.controller.signal).approve(args.title, args.details);
  }
  if (method === 'cancel') { engine.cancel(args.sessionId, args.agentId); if (!args.agentId) external.get(args.sessionId)?.controller.abort(); return true; }
  if (method === 'bind') {
    const agent: AgentRecord = { id: args.id, rootId: args.id, runId: args.runId, sessionId: args.id, title: 'Codex 工具通道', profileId: '', grant: args.grant, messages: [], status: 'running', requests: 0, usage: { input: 0, output: 0 }, createdAt: Date.now(), updatedAt: Date.now() };
    external.set(args.id, { agent, controller: new AbortController() });
    return registry.schemas().filter(d => !d.name.startsWith('agent_') && !['ask_user', 'pet_terminal', 'todo_write', 'attachment_read'].includes(d.name));
  }
  if (method === 'tool') { const scope = external.get(args.id); if (!scope) throw new Error('工具会话未连接。'); if (!registry.schemas().some(d => d.name === args.name) || /^(agent_|ask_user$|pet_terminal$|todo_write$|attachment_read$)/.test(args.name)) throw new Error('工具不在此通道的范围内。'); return registry.call(args.name, args.arguments, context(scope.agent, scope.controller.signal)); }
  if (method === 'unbind') { external.get(args.id)?.controller.abort(); external.delete(args.id); return true; }
  if (method === 'dispose') { await engine?.dispose(); await mcp?.dispose(); store?.close(); return true; }
  throw new Error('未知内核操作。');
}
port.on('message', async ({ data }: any) => {
  if (data.reply) { const p = replies.get(data.reply); replies.delete(data.reply); if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data.result); return; }
  try { send({ id: data.id, result: await dispatch(data.method, data.params ?? {}) }); }
  catch (error) { send({ id: data.id, error: (error as Error).message }); }
});
send({ event: 'ready' });

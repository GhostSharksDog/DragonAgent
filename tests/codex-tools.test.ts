import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexToolBindings } from '../src/main/codex-tools';
import { CodexBackend } from '../src/main/codex';
import type { AgentSession, BackendHooks } from '../src/shared/contracts';
const definition = (name: string) => ({ name, description: 'Search fixture', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } });

test('Codex aliases external names without collisions, invalid characters, or discovery-order dependence', () => {
  const names = ['pet_task_scope', 'mcp__tavily__tavily_search', 'mcp__second__tavily_search', 'mcp__中文__搜索', 'mcp__test__' + 'x'.repeat(80), 'a.b', 'a_b'];
  const a = new CodexToolBindings(names.map(definition)), b = new CodexToolBindings(names.toReversed().map(definition));
  assert.equal(a.definitions[0].name, 'pet_task_scope');
  assert.equal(new Set(a.definitions.map(d => d.name)).size, names.length);
  for (const [i, d] of a.definitions.entries()) {
    assert.match(d.name, /^[A-Za-z0-9_-]{1,64}$/); assert(!d.name.startsWith('mcp__'));
    assert.equal(a.resolve(d.name), names[i]); assert.equal(b.resolve(d.name), names[i]);
    assert.deepEqual(d.inputSchema, definition(names[i]).inputSchema);
  }
  assert.equal(a.resolve('mcp__tavily__tavily_search'), undefined);
  assert.equal(a.resolve('unregistered'), undefined);
  assert.throws(() => new CodexToolBindings([definition('x'), definition('x')]));
});

test('Codex start/resume dispatch aliases back to original tools and reject unregistered calls', async () => {
  let definitions = [definition('mcp__tavily__tavily_search')];
  const requests: { method: string; params: any }[] = [], executed: string[] = [], responses: any[] = [], displayed: string[] = [];
  let round = 0;
  const backend = new CodexBackend({ home: '.', executable: () => '', tools: {
    bindTools: async () => definitions,
    callTool: async (_session, name, args) => { executed.push(name); assert.deepEqual(args, { query: 'safe fixture' }); return { success: true, contentItems: [{ type: 'inputText', text: 'fixture result' }] }; },
    unbindTools: async () => {}, cancel: async () => {},
  }, state: () => {}, account: () => {}, quota: () => {}, open: async () => {} });
  (backend as any).connect = async () => {
    const rpc: any = new EventEmitter();
    rpc.close = () => {}; rpc.respond = (_id: unknown, value: unknown) => responses.push(value);
    rpc.request = async (method: string, params: any) => {
      requests.push({ method, params });
      if (method.startsWith('thread/')) return { thread: { id: 'native', turns: [] } };
      if (method === 'turn/start') {
        const alias = new CodexToolBindings(definitions).definitions[0].name;
        const n = ++round;
        setImmediate(() => {
          rpc.emit('message', { id: n * 10, method: 'item/tool/call', params: { threadId: 'native', tool: alias, arguments: { query: 'safe fixture' } } });
          rpc.emit('message', { id: n * 10 + 1, method: 'item/tool/call', params: { threadId: 'native', tool: 'mcp__tavily__tavily_search', arguments: {} } });
          rpc.emit('message', { method: 'item/started', params: { threadId: 'native', item: { id: 'event', type: 'dynamicToolCall', tool: alias, arguments: {} } } });
          setImmediate(() => rpc.emit('message', { method: 'turn/completed', params: { threadId: 'native', turn: { id: 'turn', status: 'completed' } } }));
        });
        return { turn: { id: 'turn' } };
      }
    };
    const pipe = { destroy: () => {} };
    return { rpc, child: { stdin: pipe, stdout: pipe, stderr: pipe, kill: () => {}, unref: () => {} } };
  };
  const session = { id: 'session', workspace: '', terminalEnabled: false, model: 'configured-model', reasoningEffort: 'configured-effort' } as AgentSession;
  const hooks: BackendHooks = { text: () => {}, tool: v => displayed.push(v.name), usage: () => {}, request: async () => false, notice: () => {}, nativeId: id => { session.nativeId = id; } };
  await backend.run(session, 'hello', hooks, new AbortController().signal);
  definitions = [definition('mcp__other__search')];
  await backend.run(session, 'continue', hooks, new AbortController().signal);
  assert.deepEqual(executed, ['mcp__tavily__tavily_search', 'mcp__other__search']);
  assert.deepEqual(displayed, executed);
  assert.equal(responses.filter(r => r.success === false).length, 2);
  assert.equal(responses.filter(r => r.success === true).length, 2);
  const start = requests.find(r => r.method === 'thread/start')!, resume = requests.find(r => r.method === 'thread/resume')!;
  assert(!start.params.dynamicTools[0].name.startsWith('mcp__'));
  assert.notEqual(resume.params.dynamicTools[0].name, start.params.dynamicTools[0].name);
  assert.equal(resume.params.threadId, 'native');
  for (const request of requests.filter(r => r.method === 'turn/start')) { assert.equal(request.params.model, 'configured-model'); assert.equal(request.params.effort, 'configured-effort'); }
  assert.equal(start.params.config.model_reasoning_effort, 'configured-effort');
  assert.equal(resume.params.config.model_reasoning_effort, 'configured-effort');
});

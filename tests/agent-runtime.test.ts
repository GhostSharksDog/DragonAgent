import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentRuntime, MemorySessionStore, ToolRegistry, type ModelAdapter, type ModelRequest, type Message, type ToolResult } from '../packages/agent-core/src';
import { SqliteSessionStore } from '../packages/agent-core/src/sqlite-store';
const profile = { id: 'p', model: 'fixture', protocol: 'openai-completions' as const, baseUrl: 'http://fixture', contextWindow: 65536, maxOutput: 4096 };
const grant = { folders: [] as string[], origins: [], browserInput: false, terminal: false };
function response(message: Message) { return { message, usage: { input: 100, output: 10 }, finish: message.calls?.length ? 'tools' as const : 'stop' as const }; }
const tool = (name: string, args: unknown, id = name): Message => ({ role: 'assistant', text: '', calls: [{ id, name, arguments: JSON.stringify(args) }] });
function harness(generate: ModelAdapter['generate'], tools = new ToolRegistry(), store = new MemorySessionStore(), extra: Partial<ConstructorParameters<typeof AgentRuntime>[0]> = {}) {
  const runtime = new AgentRuntime({ adapter: { generate }, profiles: () => [profile], key: async () => '', tools, store, approve: async () => true, question: async () => ({}), ...extra }); return { runtime, tools, store };
}
test('independent core executes a multi-step tool loop and persists complete history', async () => {
  let calls = 0; const tools = new ToolRegistry(); tools.register({ name: 'increment', description: 'test', effect: 'write', parameters: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] }, execute: async args => { calls += Number(args.amount); return { text: String(calls) }; } });
  const { runtime, store } = harness(async request => response(request.messages.filter(m => m.role === 'tool').length < 2 ? tool('increment', { amount: 1 }, `c${calls}`) : { role: 'assistant', text: 'done' }), tools);
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant });
  assert.equal(result.status, 'completed'); assert.equal(calls, 2); assert.equal(result.messages.filter(m => m.role === 'tool').length, 2);
  assert.equal((await store.history('s')).filter(e => e.type === 'tool.started').length, 2);
});

test('core reserves session before asynchronous storage, and cancellation during startup is honored', async () => {
  let calls = 0; const { runtime } = harness(async () => { calls++; return response({ role: 'assistant', text: 'done' }); });
  const first = runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant });
  await assert.rejects(runtime.run({ sessionId: 's', profileId: 'p', prompt: 'duplicate', grant }), /已有任务/); await first;
  assert.equal(calls, 1);
  const second = runtime.run({ sessionId: 'next', profileId: 'p', prompt: 'cancel immediately', grant }); runtime.cancel('next'); assert.equal((await second).status, 'cancelled'); assert.equal(calls, 1);
});
test('children execute concurrently, parent waits, effects serialize and nested spawn is hidden', async () => {
  let inFlight = 0, max = 0, mutations = 0, modelActive = 0, modelMax = 0; const tools = new ToolRegistry();
  tools.register({ name: 'write', description: 'test', effect: 'write', parameters: { type: 'object' }, execute: async () => { inFlight++; max = Math.max(max, inFlight); await new Promise(r => setTimeout(r, 15)); inFlight--; mutations++; return { text: 'written' }; } });
  const { runtime, store } = harness(async r => {
    const child = r.messages[0].text.includes('你是 DragonAgent 的子'); const results = r.messages.filter(m => m.role === 'tool');
    if (child) { assert(!r.tools.some(t => t.name.startsWith('agent_'))); modelActive++; modelMax = Math.max(modelMax, modelActive); await new Promise(r => setTimeout(r, 20)); modelActive--; return response(results.length ? { role: 'assistant', text: 'child done' } : tool('write', {})); }
    if (!results.length) return response({ role: 'assistant', text: '', calls: [1, 2, 3].map(i => ({ id: `spawn${i}`, name: 'agent_spawn', arguments: JSON.stringify({ title: `child ${i}`, task: 'write' }) })) });
    if (!results.some(m => m.name === 'agent_wait')) return response(tool('agent_wait', {}));
    return response({ role: 'assistant', text: 'all done' });
  }, tools);
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'delegate', grant });
  assert.equal(result.status, 'completed'); assert.equal(mutations, 3); assert.equal(max, 1); assert.equal(modelMax, 3);
  assert.equal((await store.listAgents('s')).filter(a => a.parentId && a.status === 'completed').length, 3);
});

test('duplicate call IDs reuse saved results and do not repeat a side effect', async () => {
  let effects = 0, requests = 0; const tools = new ToolRegistry();
  tools.register({ name: 'write_once', description: '', parameters: { type: 'object' }, effect: 'write', execute: async () => { effects++; return { text: 'saved' }; } });
  const { runtime } = harness(async () => response(++requests < 3 ? tool('write_once', {}, 'duplicate') : { role: 'assistant', text: 'done' }), tools);
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant }); assert.equal(result.status, 'completed'); assert.equal(effects, 1);
});

test('child limit pauses the task; a resumed task retains completed child provenance', async () => {
  let resume = false; const { runtime, store } = harness(async r => {
    if (r.messages[0].text.startsWith('你是 DragonAgent 的子')) return response({ role: 'assistant', text: 'child result' });
    if (resume) return response({ role: 'assistant', text: 'summarized' });
    return response(tool('agent_spawn', { title: 'child', task: 'do' }, String(r.messages.length)));
  });
  const first = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant, limits: { concurrency: 1, children: 1, requests: 10 } });
  assert.equal(first.status, 'paused'); assert(first.error?.includes('子任务总数')); resume = true;
  const next = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'summarize', grant }); assert.equal(next.status, 'completed'); assert(next.messages.some(m => m.text.includes('child result')));
  assert.equal((await store.listAgents('s')).filter(a => a.parentId).length, 1);
});
test('child permission expansion is refused and entire tree shares request budget', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dragon-bound-'));
  const { runtime } = harness(async r => {
    const last = r.messages.at(-1)!;
    if (last.role === 'user') return response(tool('agent_spawn', { title: 'escape', task: 'read', folders: [os.tmpdir()] }));
    assert.equal(last.isError, true); assert(last.text.includes('不能扩大')); return response(tool('todo_write', { todos: [] }, String(r.messages.length)));
  });
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant: { ...grant, folders: [root] }, limits: { concurrency: 1, children: 2, requests: 2 } });
  assert.equal(result.status, 'paused'); assert.equal(result.requests, 2);
});
test('stop one child leaves its sibling running; root cancel drains children', async () => {
  const ids: string[] = []; let waitStarted!: () => void; const ready = new Promise<void>(r => { waitStarted = r; });
  const { runtime, store } = harness(async r => {
    if (r.messages[0].text.includes('你是 DragonAgent 的子')) return new Promise((resolve, reject) => { r.signal.addEventListener('abort', () => reject(r.signal.reason), { once: true }); });
    if (!r.messages.some(m => m.role === 'tool')) return response({ role: 'assistant', text: '', calls: [1, 2].map(i => ({ id: `spawn${i}`, name: 'agent_spawn', arguments: JSON.stringify({ title: `child${i}`, task: 'wait' }) })) });
    ids.push(...r.messages.filter(m => m.name === 'agent_spawn').map(m => JSON.parse(m.text).id)); waitStarted(); return response(tool('agent_wait', {}));
  });
  const task = runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant }); await ready;
  runtime.cancel('s', ids[0]); await new Promise(r => setTimeout(r, 10));
  assert.equal((await store.getAgent(ids[0]))!.status, 'cancelled'); assert.equal((await store.getAgent(ids[1]))!.status, 'running');
  runtime.cancel('s'); const result = await task; assert.equal(result.status, 'cancelled'); assert.equal((await store.getAgent(ids[1]))!.status, 'cancelled');
});
test('large tool output is attached and an invalid argument never executes the tool', async () => {
  let calls = 0; const tools = new ToolRegistry(); tools.register({ name: 'large', description: '', effect: 'read', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, execute: async () => { calls++; return { text: 'x'.repeat(40000) }; } });
  const { runtime, store } = harness(async r => { const count = r.messages.filter(m => m.role === 'tool').length; return response(count === 0 ? tool('large', { ok: 'wrong' }, 'bad') : count === 1 ? tool('large', { ok: true }, 'good') : { role: 'assistant', text: 'done' }); }, tools);
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant }); assert.equal(result.status, 'completed'); assert.equal(calls, 1);
  const m = result.messages.find(m => m.callId === 'good')!; const id = m.text.match(/附件 ([a-z0-9-]+)/)![1]; assert.equal((await store.readAttachment('s', id, 0, 50000)).length, 40000); await assert.rejects(store.readAttachment('other', id, 0, 10));
});
test('SQLite recovery preserves events and repairs missing results without replay', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-coredb-')), file = path.join(dir, 'core.db');
  const store = new SqliteSessionStore(file);
  const { runtime } = harness(async () => response({ role: 'assistant', text: 'ok' }), new ToolRegistry(), store as any);
  await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'go', grant }); const old = (await store.getAgent('s'))!;
  old.status = 'running'; old.messages.push(tool('dangerous', {}, 'unknown')); await store.putAgent(old); store.close();
  const next = new SqliteSessionStore(file); assert.equal((await next.getAgent('s'))!.status, 'interrupted');
  const h = harness(async r => { assert(r.messages.some(m => m.callId === 'unknown' && m.isError)); return response({ role: 'assistant', text: 'inspect first' }); }, new ToolRegistry(), next as any);
  const result = await h.runtime.run({ sessionId: 's', profileId: 'p', prompt: 'continue', grant }); assert.equal(result.status, 'completed'); next.close();
});

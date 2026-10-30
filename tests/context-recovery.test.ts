import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentRuntime, MemorySessionStore, ToolRegistry, contextBudget, estimateTokens, historyGroups, type Message } from '../packages/agent-core/src';
import { Store, initialState } from '../src/main/store';
import { ToolHost } from '../src/pet/main/tools';

test('512K cap, small-window compaction and tool-result pairing preserve archived originals', async () => {
  assert.equal(contextBudget({ contextWindow: 1048576, maxOutput: 65536 }).window, 524288);
  const store = new MemorySessionStore(), tools = new ToolRegistry(), profile = { id: 'p', model: 'fixture', protocol: 'openai-completions' as const, baseUrl: 'http://fixture', contextWindow: 16384, maxOutput: 2048 };
  let summaries = 0, exactCounts = 0;
  const runtime = new AgentRuntime({ store, tools, profiles: () => [profile], key: async () => '', approve: async () => true, question: async () => ({}), adapter: {
    countTokens: async r => { exactCounts++; return estimateTokens(r.messages, r.tools); },
    generate: async r => {
      assert(estimateTokens(r.messages, r.tools) + r.maxOutput < profile.contextWindow);
      const summary = r.messages[0].text.startsWith('压缩对话资料'); if (summary) summaries++;
      return { message: { role: 'assistant', text: summary ? '目标：保留用户要求。已变更 note.txt；未完成：验证。' : 'continue' }, usage: { input: 20, output: 10 }, finish: 'stop' };
    },
  } });
  await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'goal', grant: { folders: [], origins: [], browserInput: false, terminal: false } });
  const previous = (await store.getAgent('s'))!;
  previous.messages.push(...Array.from({ length: 25 }, (_, i): Message => ({ role: i % 2 ? 'assistant' : 'user', text: `${i} ${'保留约束 '.repeat(60)}` })));
  previous.messages.push({ role: 'assistant', text: '', calls: [{ id: 'read', name: 'read', arguments: '{}' }] }, { role: 'tool', callId: 'read', name: 'read', text: 'paired result' });
  await store.putAgent(previous);
  const result = await runtime.run({ sessionId: 's', profileId: 'p', prompt: 'continue', grant: previous.grant });
  assert.equal(result.status, 'completed'); assert(summaries > 0); assert(exactCounts > 0);
  assert.equal(result.requests, summaries + 1); assert((await store.history('s')).some(e => e.type === 'compacted'));
  const summary = result.messages.find(m => m.text.includes('原始记录附件：'))!;
  const id = summary.text.match(/原始记录附件：([^\s]+)/)![1]; const archived = await store.readAttachment('s', id, 0, 1000000); assert(archived.includes('保留约束'));
  for (const group of historyGroups(result.messages)) for (const call of group[0].calls ?? []) assert(group.some(m => m.callId === call.id));
});

test('two agents reading the same file cannot overwrite each other using stale versions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-conflict-')), file = path.join(dir, 'shared.txt'); await writeFile(file, 'initial');
  const host = () => new ToolHost({ getGrant: () => ({ folders: [dir], origins: [] }), requestApproval: async () => true, onBrowserChange() {} });
  const a = host(), b = host();
  try {
    const read = await b.call('pet_files_read', { path: file }); const version = JSON.parse((read.contentItems[0] as any).text).version;
    assert((await a.call('pet_files_write', { path: file, content: 'first change', expectedVersion: version })).success);
    assert(!(await b.call('pet_files_write', { path: file, content: 'stale change', expectedVersion: version })).success);
    assert.equal(await readFile(file, 'utf8'), 'first change');
  } finally { await a.dispose(); await b.dispose(); }
});

test('v1 migration backs up before modification and preserves model, memory, encrypted secrets as readonly history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-migrate-')); const initial = new Store(dir); initial.close();
  const state = initialState(); state.memory.push({ id: 'm', text: 'TypeScript', tags: [], createdAt: 0 });
  state.sessions.push({ id: 'old', backend: 'dsh', nativeId: 'foreign', title: 'Old', status: 'waiting', messages: [], tools: [], pending: [], origins: [] } as any);
  const db = new DatabaseSync(path.join(dir, 'dragonagent.db')); db.prepare('INSERT INTO app_state VALUES(1,1,?)').run(JSON.stringify(state)); db.prepare('INSERT INTO secrets VALUES(?,?)').run('profile:p', new Uint8Array([1, 2, 3])); db.close();
  const store = new Store(dir); const migrated = store.load(); assert(migrated.sessions[0].readOnly); assert.equal(migrated.sessions[0].nativeId, undefined); assert.equal(migrated.memory[0].text, 'TypeScript'); assert.deepEqual([...store.secret('profile:p')!], [1, 2, 3]); store.close();
  const backup = (await readdir(dir)).find(f => f.endsWith('.bak'))!; assert(backup);
  const old = new DatabaseSync(path.join(dir, backup), { readOnly: true }); assert.equal(old.prepare('SELECT version FROM app_state').get()!.version, 1); old.close();
});

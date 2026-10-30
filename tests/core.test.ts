import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { contextPolicy } from '../src/shared/contracts';
import { Store, initialState, importLegacy } from '../src/main/store';
import { Runtime } from '../src/main/runtime';
import { ToolHost } from '../src/pet/main/tools';
import { digest } from '../src/pet/main/tools/policy';
import { PetClickController } from '../src/pet/renderer/pet-click-controller';

test('original pet distinguishes single click, double click and drag without overlapping actions', () => {
  let time = 0, single = 0, double = 0, dragged = 0; const scheduled = new Set<() => void>();
  const gesture = new PetClickController({ single: () => single++, double: () => double++, drag: (dx, dy) => { dragged += Math.abs(dx) + Math.abs(dy); }, now: () => time, schedule: cb => { scheduled.add(cb); return cb; }, clear: id => scheduled.delete(id as () => void) });
  const point = { x: 10, y: 10 }; gesture.down(point); gesture.up(point); assert.equal(single, 0); for (const cb of scheduled) cb(); scheduled.clear(); assert.equal(single, 1);
  time = 400; gesture.down(point); gesture.up(point); time = 500; gesture.down(point); gesture.up(point); for (const cb of scheduled) cb(); scheduled.clear(); assert.equal(double, 1); assert.equal(single, 1);
  time = 1000; gesture.down(point); gesture.move({ x: 30, y: 20 }); gesture.up({ x: 40, y: 20 }); assert(dragged > 0); assert.equal(double, 1); assert.equal(single, 1); gesture.cancel();
});

test('524288 is a total-token cap and scales safely to smaller model windows', () => {
  const large = contextPolicy({ contextWindow: 1048576, maxOutput: 100000 });
  assert.deepEqual(large, { window: 524288, output: 32768, headroom: 65536, threshold: 419430, retainRatio: .16 });
  const small = contextPolicy({ contextWindow: 8192, maxOutput: 8192 });
  assert(small.threshold + small.output + small.headroom <= small.window);
  assert.throws(() => contextPolicy({ contextWindow: 1000, maxOutput: 1 }));
  assert.throws(() => contextPolicy({ contextWindow: 8192, maxOutput: NaN }));
});

test('crash recovery never replays approvals or running tool operations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-recovery-'));
  const store = new Store(dir), state = initialState();
  state.sessions.push({ id: 's', title: 't', backend: 'dragon', profileId: '', workspace: '', draft: '', createdAt: 0, updatedAt: 0, status: 'waiting', messages: [], tools: [{ id: 'tool', name: 'write', status: 'running', arguments: '{}', runId: 'r', createdAt: 0 }], pending: [{ id: 'p', kind: 'approval', title: 'write', details: '', sessionId: 's', runId: 'r' }], origins: [], browserInput: false, terminalEnabled: false });
  store.save(state); store.close();
  const recovered = new Store(dir); const s = recovered.load().sessions[0];
  assert.equal(s.status, 'interrupted'); assert.equal(s.pending.length, 0); assert.equal(s.tools[0].status, 'unknown'); recovered.close();
});

test('Legacy import reads supported data, deduplicates, and preserves source bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-import-')), file = path.join(dir, 'legacy.db');
  const db = new DatabaseSync(file); db.exec("CREATE TABLE sessions(id TEXT,title TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE turns(session_id TEXT,seq INTEGER,user TEXT,assistant TEXT,tool_summary TEXT); CREATE TABLE memory_facts(id TEXT,text TEXT,tags TEXT,ts REAL); INSERT INTO sessions VALUES('1','旧对话','2026-01-01','2026-01-02'); INSERT INTO turns VALUES('1',1,'你好','你好呀',''); INSERT INTO memory_facts VALUES('m','用 TypeScript','[\"偏好\"]',1700000000);"); db.close();
  const before = await readFile(file), state = initialState();
  assert.deepEqual(importLegacy(file, state), { sessions: 1, memory: 1 });
  assert.deepEqual(importLegacy(file, state), { sessions: 0, memory: 0 });
  assert.deepEqual(await readFile(file), before); assert.equal(state.sessions[0].nativeId, undefined); assert.equal(state.sessions[0].messages.length, 2);
});

test('file writes show complete diff, denial and cancellation prevent mutation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-files-')), file = path.join(dir, 'note.txt'); await writeFile(file, 'old');
  let active = 'run', allow = false, details = '';
  const host = new ToolHost({ getGrant: () => ({ folders: [dir], origins: [] }), getTaskId: () => active, onBrowserChange() {}, requestApproval: async r => { details = r.details.join('\n'); return allow; } });
  let result = await host.call('pet_files_write', { path: file, content: 'new', expectedVersion: digest('old') }); assert.equal(result.success, false); assert.equal(await readFile(file, 'utf8'), 'old'); assert(details.includes('- old')); assert(details.includes('+ new'));
  allow = true; result = await host.call('pet_files_write', { path: file, content: 'new', expectedVersion: digest('old') }); assert.equal(result.success, true); assert.equal(await readFile(file, 'utf8'), 'new');
  active = ''; result = await host.call('pet_files_write', { path: file, content: 'cancelled' }); assert.equal(result.success, false); assert.equal(await readFile(file, 'utf8'), 'new'); await host.dispose();
});

test('two UI send commands cannot duplicate a run; cancellation is session-scoped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-runtime-')), store = new Store(dir);
  const runtime = new Runtime(store, { get: async () => '', set: async () => {}, remove() {} } as any, { home: dir, workerPath: '', open: async () => {} });
  runtime.state.settings.profiles.push({ id: 'p', name: 'fixture', model: 'fixture', provider: 'custom', baseUrl: 'http://127.0.0.1', protocol: 'openai-completions', contextWindow: 8192, maxOutput: 1024, hasKey: false });
  let calls = 0; const releases = new Map<string, () => void>();
  runtime.dragon.run = async (s, _prompt, hooks, signal) => { calls++; hooks.nativeId(s.id); await new Promise<void>(resolve => { releases.set(s.id, resolve); signal.addEventListener('abort', () => resolve(), { once: true }); }); };
  runtime.dragon.cancel = async () => {};
  const one = runtime.create('dragon', 'p'), two = runtime.create('dragon', 'p');
  runtime.send(one, 'task one', 'same-command'); runtime.send(one, 'task one', 'same-command'); runtime.send(two, 'task two', 'second-command');
  assert.equal(calls, 2); assert.equal(runtime.session(one).messages.length, 1);
  await runtime.stop(one); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runtime.session(one).status, 'cancelled'); assert.equal(runtime.session(two).status, 'running');
  releases.get(two)!(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(runtime.session(two).status, 'completed'); await runtime.dispose();
});

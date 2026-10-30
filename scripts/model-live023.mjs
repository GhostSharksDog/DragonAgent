// Explicit live validation using the actual app data and OS key-decryption context.
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import assert from 'node:assert/strict';
const env = { ...process.env }; for (const key of ['DRAGON_DATA_DIR','DRAGON_SMOKE','ELECTRON_RUN_AS_NODE']) delete env[key];
const home = path.join(process.env.APPDATA, 'DragonAgent');
const workspace = path.resolve(`.runtime/model-live023-${Date.now()}`); await mkdir(workspace, { recursive: true });
const report = { status: 'running', version: '0.2.3' }, ids = []; let page, initial, preferences;
const app = await electron.launch({ executablePath: process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), args: process.env.DRAGON_EXE ? [] : ['.'], env, timeout: 45000 });
const action = a => page.evaluate(a => window.dragon.action(a), a);
async function finish(id) {
  for (const until = Date.now() + 150000; Date.now() < until;) {
    const s = await page.evaluate(async id => (await window.dragon.snapshot()).sessions.find(s => s.id === id), id);
    if (s.status === 'error') throw Error(s.error);
    if (s.pending.length) throw Error('Greeting-only validation unexpectedly requested a tool.');
    if (s.status === 'completed') return s;
    await new Promise(r => setTimeout(r, 300));
  }
  throw Error('Online inference timed out.');
}
async function walk(root) { const files = []; for (const d of await readdir(root, { withFileTypes: true })) { const file = path.join(root,d.name); if (d.isDirectory()) files.push(...await walk(file)); else files.push(file); } return files; }
try {
  await app.firstWindow(); await new Promise(r => setTimeout(r, 800)); page = app.windows().find(w => w.url().includes('view=workbench'));
  initial = await page.evaluate(() => window.dragon.snapshot()); assert(!initial.sessions.some(s => ['running','waiting','stopping'].includes(s.status)));
  preferences = Object.fromEntries(['selectedBackend','selectedProfile','selectedCodexModel','selectedCodexEffort'].map(key => [key, initial.settings[key]]));
  await action({ type: 'codex.models' }); const catalog = (await page.evaluate(() => window.dragon.snapshot())).codexCatalog; assert.equal(catalog.status, 'ready');
  const model = catalog.models.find(m => m.isDefault) ?? catalog.models[0]; assert(model);
  const low = model.efforts.find(e => e.value === 'low')?.value ?? model.defaultEffort;
  const medium = model.efforts.find(e => e.value === 'medium')?.value ?? model.defaultEffort;
  const id = await action({ type: 'session.create', backend: 'codex', workspace, model: model.model, reasoningEffort: low }); ids.push(id);
  await action({ type: 'session.send', id, text: '这是只读连通性验收。只回复“你好，霜璃在这里”。不要调用工具。', commandId: 'live-codex-low-023' });
  const first = await finish(id); assert(first.messages.some(m => m.role === 'assistant' && m.text.includes('你好')));
  await page.getByLabel('当前对话模型').click(); await page.getByRole('slider', { name: 'Codex 推理强度' }).waitFor();
  const slider = page.getByRole('slider', { name: 'Codex 推理强度' }); await slider.focus(); await slider.press('End');
  await page.screenshot({ path: 'test-results/023-codex-live-max.png' }); await page.keyboard.press('Escape');
  await action({ type: 'session.codexModel', id, model: model.model, effort: medium });
  await action({ type: 'session.send', id, text: '继续只读连通性验收。只回复“模型与推理强度设置已生效”。不要调用工具。', commandId: 'live-codex-medium-023' });
  const second = await finish(id); assert.equal(second.nativeId, first.nativeId);
  const files = (await walk(path.join(home, 'codex-runtime/codex/sessions'))).filter(f => f.endsWith('.jsonl') && f.includes(second.nativeId));
  assert(files.length, 'Native Codex rollout not found');
  const contexts = [];
  for (const file of files) for (const line of (await readFile(file, 'utf8')).split('\n')) { try { const event = JSON.parse(line); if (event.type === 'turn_context') contexts.push({ model: event.payload.model, effort: event.payload.effort ?? event.payload.reasoning_effort }); } catch {} }
  assert(contexts.some(c => c.model === model.model && c.effort === low)); assert(contexts.some(c => c.model === model.model && c.effort === medium));
  report.codex = { model: model.model, efforts: [low, medium], nativeRolloutVerified: true, resumedSameThread: true, maxAnimationShown: true };
  const profile = initial.settings.profiles.find(p => new URL(p.baseUrl).hostname === 'api.deepseek.com');
  if (profile) { const dragon = await action({ type: 'session.create', backend: 'dragon', profileId: profile.id, workspace }); ids.push(dragon); await action({ type: 'session.send', id: dragon, text: '只读连通性验收：请只回复“霜璃在这里”，不要调用任何工具。', commandId: 'live-dragon-023' }); const result = await finish(dragon); assert(result.messages.some(m => m.role === 'assistant' && m.text.includes('霜璃'))); report.dragon = { model: profile.model, passed: true }; }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  if (page) for (const id of ids) { await action({ type: 'session.stop', id }).catch(() => {}); await action({ type: 'session.archive', id }).catch(() => {}); }
  if (page && initial?.selectedSessionId) await action({ type: 'session.select', id: initial.selectedSessionId }).catch(() => {});
  const exited = new Promise(resolve => { if (app.process().exitCode !== null) resolve(); else app.process().once('exit', resolve); });
  await app.evaluate(({ app }) => app.quit()).catch(() => {}); await exited;
  if (preferences) { const db = new DatabaseSync(path.join(home, 'dragonagent.db')); try { const row = db.prepare('SELECT json FROM app_state WHERE id=1').get(); const state = JSON.parse(row.json); for (const [key, value] of Object.entries(preferences)) { if (value === undefined) delete state.settings[key]; else state.settings[key] = value; } db.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(state)); } finally { db.close(); } }
  await writeFile('test-results/model-live023.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}

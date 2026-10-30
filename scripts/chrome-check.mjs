import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.resolve(`.runtime/chrome-${Date.now()}`); await mkdir(dir, { recursive: true });
const observations = []; let summaries = 0;
const server = createServer(async (req, res) => {
  let data = ''; for await (const chunk of req) data += chunk;
  const body = JSON.parse(data); observations.push(body);
  const compact = body.messages[0]?.content?.includes('压缩对话资料'); if (compact) summaries++;
  const latest = body.messages.filter(m => m.role === 'user').at(-1)?.content ?? '';
  const text = compact ? '摘要：用户目标是界面验收，需记住 CHAIN_HISTORY_023。没有文件变更。' : `由 ${body.model} 回复：CHAIN_HISTORY_023 已记下。`;
  if (latest.includes('SLOW_CHECK')) await new Promise(r => setTimeout(r, 2000));
  if (res.destroyed) return;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const environment = { ...process.env, DRAGON_DATA_DIR: dir }; delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), args: process.env.DRAGON_EXE ? [] : ['.'], env: environment, timeout: 45000 });
const report = { status: 'running', version: JSON.parse(await readFile('package.json', 'utf8')).version };
let page, bubble; const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function state() { return page.evaluate(() => window.dragon.snapshot()); }
async function finish(id) { for (let i = 0; i < 300; i++) { const s = (await state()).sessions.find(s => s.id === id); if (s.status === 'error') throw Error(s.error); if (s.status === 'completed') return s; await sleep(100); } throw Error('Task timeout'); }
async function action(a) { return page.evaluate(a => window.dragon.action(a), a); }
async function menu(name, option) { await page.getByRole('button', { name, exact: true }).click(); if (option) await page.getByRole('menuitemradio', { name: option }).click(); }
try {
  await app.firstWindow(); await sleep(800); page = app.windows().find(w => w.url().includes('view=workbench')); bubble = app.windows().find(w => w.url().includes('view=bubble'));
  page.on('pageerror', e => errors.push(e.message)); bubble.on('pageerror', e => errors.push(e.message));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  for (const [id, name, contextWindow] of [['large', 'DeepSeek · 霜璃', 524288], ['small', '小窗口模型', 16384]]) await action({ type: 'profile.save', profile: { id, name, provider: 'custom', protocol: 'openai-completions', baseUrl, model: id, contextWindow, maxOutput: 1024, hasKey: false }, apiKey: 'fixture' });
  const id = await action({ type: 'session.create', backend: 'dragon', profileId: 'large', workspace: dir });
  await action({ type: 'pet.toggle' }); await action({ type: 'pet.view', view: 'compose' });
  assert.equal(await page.locator('.backend-select').count(), 0); assert.equal(await page.locator('.permission-caption,.composer-note').count(), 0);
  const send = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox(); assert.equal(send.width, 36); assert.equal(send.height, 36);
  await menu('当前对话权限等级'); assert.equal(await page.getByRole('menuitemradio').count(), 3);
  await sleep(150); await page.screenshot({ path: 'test-results/023-permissions-light.png' });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await bubble.waitForFunction(() => document.querySelector('.permission-trigger')?.dataset.mode === 'auto');
  await menu('当前对话权限等级'); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu', { name: '权限等级' }).count(), 0); assert.equal(await page.getByLabel('当前对话权限等级').evaluate(e => e === document.activeElement), true);
  await menu('当前对话模型'); await page.screenshot({ path: 'test-results/023-models-light.png' }); await page.locator('.empty-chat h2').click(); assert.equal(await page.getByRole('dialog', { name: '选择对话模型' }).count(), 0);
  const textarea = page.getByRole('textbox', { name: '发送给龙娘的消息' }); await textarea.fill('输入法草稿'); await textarea.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true }); assert.equal((await state()).sessions.find(s => s.id === id).messages.length, 0);
  await textarea.press('Shift+Enter'); assert((await textarea.inputValue()).includes('\n'));
  for (let i = 0; i < 6; i++) { await action({ type: 'session.send', id, text: `CHAIN_HISTORY_023 第${i}段资料：${'银白紫瞳龙娘界面'.repeat(360)}`, commandId: `history-${i}` }); await finish(id); }
  await textarea.fill('保留的草稿');
  const note = path.join(dir, 'draft.txt'); await writeFile(note, '草稿附件'); await app.evaluate(({ dialog }, note) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [note] }); }, note);
  await page.getByLabel('添加文件或关联聊天').click(); await page.getByRole('menuitem', { name: '上传文件' }).click(); await page.waitForFunction(async () => { const s = await window.dragon.snapshot(); return s.sessions.find(x => x.id === s.selectedSessionId).draftAttachments.length === 1; });
  const before = (await state()).sessions.find(s => s.id === id);
  await menu('当前对话模型', /小窗口模型/); await bubble.waitForFunction(() => document.querySelector('.model-trigger')?.textContent.includes('小窗口模型'));
  const switched = (await state()).sessions.find(s => s.id === id); assert.equal(switched.draft, before.draft); assert.deepEqual(switched.draftAttachments, before.draftAttachments); assert.equal(switched.permissionMode, 'auto'); assert.equal(switched.messages.length, before.messages.length);
  await action({ type: 'session.send', id, text: '继续 CHAIN_HISTORY_023', commandId: 'switched' }); const result = await finish(id); assert(result.messages.at(-1).text.includes('small')); assert(summaries > 0, 'Switch to small window must compact accumulated history'); assert(observations.at(-1).messages.some(m => JSON.stringify(m.content).includes('CHAIN_HISTORY_023'))); assert.equal(result.usage.window, 16384);
  await action({ type: 'session.send', id, text: 'SLOW_CHECK', commandId: 'slow' }); await page.getByRole('button', { name: '停止任务' }).waitFor(); assert(await page.getByLabel('当前对话模型').isDisabled()); await assert.rejects(action({ type: 'session.model', id, profileId: 'large' }), /结束后/); await page.getByRole('button', { name: '停止任务' }).click();
  await page.waitForFunction(async id => (await window.dragon.snapshot()).sessions.find(s => s.id === id).status === 'cancelled', id);
  await textarea.fill('原聊天保留这份草稿');
  await page.getByLabel('添加文件或关联聊天').click(); await page.getByRole('menuitem', { name: '上传文件' }).click(); await page.waitForFunction(async id => (await window.dragon.snapshot()).sessions.find(s => s.id === id).draftAttachments.length === 1, id);
  await menu('当前对话模型'); await page.getByRole('tab', { name: 'Codex', exact: true }).click(); await page.getByRole('group', { name: 'Codex 模型', exact: true }).getByRole('menuitemradio').first().click(); const cross = await state(); const next = cross.sessions.find(s => s.id === cross.selectedSessionId); assert.notEqual(next.id, id); assert.equal(next.backend, 'codex'); assert.equal(next.permissionMode, 'ask'); assert(next.draft.includes('参考摘录')); assert.equal(cross.sessions.find(s => s.id === id).draft, '原聊天保留这份草稿'); assert.equal(cross.sessions.find(s => s.id === id).draftAttachments.length, 1);
  await menu('当前对话模型');
  await page.waitForFunction(async () => (await window.dragon.snapshot()).codexCatalog.status === 'ready');
  const catalog = (await state()).codexCatalog.models, selectedCodex = catalog.find(m => m.model === next.model);
  assert(selectedCodex);
  if (selectedCodex.efforts.length > 1) {
    const slider = page.getByRole('slider', { name: 'Codex 推理强度' }); await slider.focus(); await slider.press('Home');
    await page.waitForFunction(async args => (await window.dragon.snapshot()).sessions.find(s => s.id === args.id).reasoningEffort === args.effort, { id: next.id, effort: selectedCodex.efforts[0].value });
    await slider.press('End');
    assert.equal(await page.locator('.reasoning-control.peak-burst').count(), 1);
    await page.screenshot({ path: 'test-results/023-codex-max.png' });
    await page.waitForFunction(async args => (await window.dragon.snapshot()).sessions.find(s => s.id === args.id).reasoningEffort === args.effort, { id: next.id, effort: selectedCodex.efforts.at(-1).value });
    await bubble.waitForFunction(effort => document.querySelector('.model-trigger')?.title.includes(effort), selectedCodex.efforts.at(-1).value);
    report.codexReasoning = true; report.maxAnimation = true;
  }
  await page.keyboard.press('Escape');
  await page.locator('.new-chat').click(); assert.equal((await state()).sessions[0].backend, 'codex'); assert.equal((await state()).sessions[0].model, next.model);
  await action({ type: 'session.select', id });
  await menu('当前对话模型'); await page.getByRole('button', { name: '管理模型连接' }).click(); await page.getByRole('heading', { name: '让龙娘准备就绪' }).waitFor();
  await page.getByRole('button', { name: '对话与任务' }).click();
  for (const theme of ['light', 'dark']) {
    await action({ type: 'settings.save', theme }); await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
    assert.equal((await state()).resolvedTheme, theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')).setSize(1260, 850));
    await page.screenshot({ path: `test-results/023-workbench-${theme}.png` });
    await menu('当前对话权限等级'); await page.screenshot({ path: `test-results/023-permissions-${theme}.png` }); await page.keyboard.press('Escape');
    await bubble.getByLabel('当前对话权限等级').click(); const pop = await bubble.getByRole('menu', { name: '权限等级' }).boundingBox(); const viewport = await bubble.evaluate(() => ({ w: innerWidth, h: innerHeight })); assert(pop.x >= 0 && pop.y >= 0 && pop.y + pop.height <= viewport.h + 1); await bubble.screenshot({ path: `test-results/023-bubble-${theme}.png` }); await bubble.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')).setSize(850, 600));
    await menu('当前对话模型'); await page.screenshot({ path: `test-results/023-minimum-${theme}.png` }); await page.keyboard.press('Escape');
  }
  await action({ type: 'settings.save', theme: 'system' });
  for (const theme of ['light','dark']) { await app.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, theme); await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme); assert.equal((await state()).resolvedTheme, theme); }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')); w.setSize(1260, 850); w.webContents.setZoomFactor(1.5); });
  await sleep(200); await menu('当前对话权限等级'); await page.screenshot({ path: 'test-results/023-150-percent.png' }); await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')); w.webContents.setZoomFactor(1); w.maximize(); }); await sleep(200);
  assert(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')).isMaximized()));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')); w.unmaximize(); w.close(); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')).isVisible()), false);
  await action({ type: 'window.workbench' }); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')).isVisible()), true);
  assert.deepEqual(errors, []);
  Object.assign(report, { status: 'passed', menus: true, modelSwitch: true, smallWindowCompaction: summaries, crossEngine: true, sharedDraft: true, imeAndStop: true, themes: true, minimumWindow: true, zoom150: true, windowLifecycle: true });
} catch (e) { report.status = 'failed'; report.error = e.stack; process.exitCode = 1; if (page) await page.screenshot({ path: 'test-results/023-failure.png' }).catch(() => {}); }
finally { await writeFile('test-results/chrome-023.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await app.evaluate(({ app }) => app.quit()).catch(() => {}); server.close(); }

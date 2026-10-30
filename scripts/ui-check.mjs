import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
await mkdir('test-results', { recursive: true });
const dataDir = path.resolve(`.runtime/ui-check-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const testFile = path.join(dataDir, 'approved.txt');
const fixture = createServer(async (req, res) => {
  let data = ''; for await (const part of req) data += part;
  const body = JSON.parse(data), complete = body.messages.some(m => m.role === 'tool');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = delta => ({ id: 'ui-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] });
  let delta, finished = complete;
  const collaborative = body.messages.some(m => typeof m.content === 'string' && m.content.includes('协作验收'));
  const child = body.messages[0]?.content?.startsWith('你是 DragonAgent 的子');
  const tool = (name, args, id) => ({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (collaborative && child) {
    const number = body.messages.find(m => m.role === 'user').content.includes('子任务二') ? 2 : 1;
    delta = complete ? { role: 'assistant', content: `子任务${number}完成` } : tool('pet_files_write', { path: path.join(dataDir, `child-${number}.txt`), content: `child ${number}` }, `child-write-${number}`);
  } else if (collaborative) {
    const waited = body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'wait');
    finished = waited;
    delta = !complete ? { role: 'assistant', tool_calls: [1, 2].map((number, index) => ({ index, id: `spawn-${number}`, type: 'function', function: { name: 'agent_spawn', arguments: JSON.stringify({ title: number === 1 ? '子任务一' : '子任务二', task: `协作验收 ${number === 1 ? '子任务一' : '子任务二'}，写入指定文件` }) } })) } : !waited ? tool('agent_wait', {}, 'wait') : { role: 'assistant', content: '协作结果已汇总。' };
  } else delta = complete ? { role: 'assistant', content: '已写入测试文件。' } : tool('pet_files_write', { path: testFile, content: 'Approved from the dragon bubble.' }, 'call_write');
  res.write(`data: ${JSON.stringify(chunk(delta))}\n\n`);
  const end = chunk({}); end.choices[0].finish_reason = finished ? 'stop' : 'tool_calls'; res.end(`data: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = { ...process.env, DRAGON_DATA_DIR: dataDir, DRAGON_SMOKE: '' };
if (process.env.DRAGON_EXE) {
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.Path = [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
}
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const errors = [];
app.process().stderr.on('data', data => { const text = data.toString(); if (!/DevTools listening|Debugger attached|sqlite|ExperimentalWarning|GPU|cache/.test(text)) console.log(text); });
try {
  await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1500));
  const page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  console.log('windows', app.windows().map(w => w.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.sprite-canvas')?.getAttribute('data-ready') === 'true');
  await page.screenshot({ path: 'test-results/workbench.png' });
  await page.getByRole('button', { name: '召唤龙娘', exact: false }).first().click();
  await page.waitForTimeout(500);
  const windows = app.windows(); assert.equal(windows.length, 3);
  const pet = windows.find(w => w.url().includes('view=pet'));
  await pet.waitForFunction(() => document.querySelector('.sprite-canvas')?.getAttribute('data-ready') === 'true');
  await pet.screenshot({ path: 'test-results/pet.png' });
  await pet.getByRole('button', { name: '输入消息', exact: true }).click();
  const bubble = windows.find(w => w.url().includes('view=bubble'));
  await bubble.getByRole('button', { name: '打开工作台' }).waitFor();
  await bubble.screenshot({ path: 'test-results/bubble.png' });
  const expectedVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
  assert.equal((await page.evaluate(() => window.dragon.snapshot())).version, expectedVersion);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.dragon.action({ type: 'settings.save', theme }), theme);
    for (const [kind, win] of [['pet', pet], ['bubble', bubble]]) {
      await win.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      const backgrounds = await win.evaluate(() => [document.documentElement, document.body, document.getElementById('root')].map(e => getComputedStyle(e).backgroundColor));
      assert(backgrounds.every(color => color === 'rgba(0, 0, 0, 0)'), `${kind}/${theme}: ${backgrounds}`);
      await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const capture = await app.evaluate(async ({ BrowserWindow }, kind) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`view=${kind}`));
        // Windows may recreate the compositor surface when syncWindows reapplies always-on-top.
        // Wait for a painted frame, then test its pixels; a persistent empty window still fails.
        let result;
        for (let attempt = 0; attempt < 20; attempt++) {
          const picture = await win.webContents.capturePage(), { width, height } = picture.getSize(), bitmap = picture.toBitmap();
          const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x,y]) => bitmap[(y * width + x) * 4 + 3]);
          let opaque = 0; for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] === 255) opaque++;
          result = { corners, opaque, png: picture.toPNG().toString('base64') };
          if (opaque > 100) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return result;
      }, kind);
      await writeFile(`test-results/${kind}-${theme}-transparent.png`, Buffer.from(capture.png, 'base64'));
      assert.deepEqual(capture.corners, [0,0,0,0], `${kind}/${theme} corners must be transparent`); assert(capture.opaque > 100, `${kind}/${theme}: character/panel should still render (opaque=${capture.opaque})`);
    }
  }
  await page.evaluate(() => window.dragon.action({ type: 'settings.save', theme: 'light' }));
  await pet.locator('.pet-button').click(); await pet.waitForTimeout(380);
  assert.equal((await page.evaluate(() => window.dragon.snapshot())).petView, 'reply');
  await pet.locator('.pet-button').dblclick({ delay: 70 }); await pet.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.dragon.snapshot())).petView, 'quota');
  await pet.getByRole('button', { name: '输入消息', exact: true }).click();
  const beforeDrag = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet')).getBounds());
  await pet.mouse.move(130,150); await pet.mouse.down(); await pet.mouse.move(145,158,{ steps:3 }); await pet.mouse.up(); await pet.waitForTimeout(150);
  const afterDrag = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet')).getBounds());
  assert(beforeDrag.x !== afterDrag.x || beforeDrag.y !== afterDrag.y); assert.equal((await page.evaluate(() => window.dragon.snapshot())).petView, 'compose');
  console.log(`Transparency and gestures PASS; application version ${expectedVersion}.`);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  await page.getByLabel('配置名称').fill('本地测试配置');
  await page.getByLabel('模型 ID', { exact: true }).fill('fixture');
  await page.getByLabel('API 地址', { exact: true }).fill(`http://127.0.0.1:${fixture.address().port}/v1`);
  await page.getByLabel('API 密钥', { exact: true }).fill('fixture-only-not-a-real-secret');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByText('fixture · 512K 上下文', { exact: false }).waitFor();
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.getByRole('button', { name: '新的对话', exact: false }).click();
  await page.getByRole('textbox', { name: '发送给龙娘的消息' }).fill('在两个窗口共享这份草稿');
  await bubble.getByRole('textbox', { name: '发送给龙娘的消息' }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await bubble.getByRole('textbox', { name: '发送给龙娘的消息' }).inputValue(), '在两个窗口共享这份草稿');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, dataDir);
  await page.getByRole('button', { name: '选择工作文件夹', exact: false }).click();
  await page.getByRole('textbox', { name: '发送给龙娘的消息' }).fill('保存测试文件');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await bubble.getByRole('button', { name: '允许本次操作', exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: 'test-results/approval.png' });
  await bubble.getByRole('button', { name: '允许本次操作', exact: true }).click();
  await page.locator('.prose').filter({ hasText: /^已写入测试文件。$/ }).waitFor({ timeout: 30000 });
  assert.equal(await readFile(testFile, 'utf8'), 'Approved from the dragon bubble.');
  await page.screenshot({ path: 'test-results/conversation.png' });
  await page.getByRole('button', { name: '新的对话', exact: false }).click();
  await page.getByRole('button', { name: '选择工作文件夹', exact: false }).click();
  const session = await page.evaluate(async () => (await window.dragon.snapshot()).selectedSessionId);
  const command = { type: 'session.send', id: session, text: '协作验收：分派两个子任务。', commandId: 'dual-window-idempotency' };
  await Promise.all([page.evaluate(a => window.dragon.action(a), command), bubble.evaluate(a => window.dragon.action(a), command)]);
  for (let i = 0; i < 2; i++) {
    await bubble.getByRole('button', { name: '允许本次操作', exact: true }).waitFor({ timeout: 30000 });
    assert((await bubble.locator('.approval h3').innerText()).includes('子任务'));
    await bubble.getByRole('button', { name: '允许本次操作', exact: true }).click();
  }
  let result;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    result = await page.evaluate(async () => { const state = await window.dragon.snapshot(); return state.sessions.find(s => s.id === state.selectedSessionId); });
    if (result.status === 'completed' && result.tasks.filter(t => t.parentId && t.status === 'completed').length === 2) break;
    if (result.status === 'error') throw new Error(result.error);
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(result.status, 'completed');
  assert.equal(result.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(result.tasks.filter(t => t.parentId && t.status === 'completed').length, 2);
  assert(result.messages.some(m => m.text.includes('协作结果已汇总')));
  assert.equal(await readFile(path.join(dataDir, 'child-1.txt'), 'utf8'), 'child 1');
  assert.equal(await readFile(path.join(dataDir, 'child-2.txt'), 'utf8'), 'child 2');
  await page.screenshot({ path: 'test-results/task-tree.png' });
  const core = new DatabaseSync(path.join(dataDir, 'agent-core.db'), { readOnly: true });
  const events = core.prepare('SELECT json FROM events').all().map(r => JSON.parse(r.json));
  assert.equal(events.filter(e => e.type === 'approval.resolved' && e.allowed).length, 3); core.close();
  await page.getByRole('button', { name: '工具连接', exact: false }).click();
  await page.getByRole('heading', { name: '连接更大的世界' }).waitFor();
  await page.screenshot({ path: 'test-results/mcp.png' });
  assert.deepEqual(errors, []); console.log('UI PASS: workbench, original pet, shared draft, encrypted key form, Dragon tool loop, child task tree, cross-window approval and duplicate sends, persisted approvals, MCP settings; no renderer errors.');
} catch (error) {
  for (const [i, page] of app.windows().entries()) { console.log('diagnostic', page.url(), await page.locator('body').innerText().catch(() => 'unavailable')); await page.screenshot({ path: `test-results/failure-${i}.png` }).catch(() => undefined); }
  throw error;
} finally { await app.evaluate(({ app }) => app.quit()); fixture.close(); }

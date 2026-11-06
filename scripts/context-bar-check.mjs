// 回归：输入框下方的上下文/用量状态条有样式、能用，并且不会把页面撑出滚动条。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const port = await new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '好的，我在。' } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 300 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

const home = path.resolve('.runtime/context-bar-' + Date.now());
await mkdir(home, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
const report = { passed: false, checks: [] };
const errors = [];
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().includes('view=workbench')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  assert(page);
  page.on('pageerror', error => errors.push(error.message));
  const act = a => page.evaluate(a => window.dragon.action(a), a), snap = () => page.evaluate(() => window.dragon.snapshot());
  const waitFor = async (fn, label) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('等待超时：' + label); };

  await act({ type: 'profile.save', profile: { id: 'ctx', name: '上下文测试', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  const id = await act({ type: 'session.create', backend: 'dragon', profileId: 'ctx' });
  await act({ type: 'window.workbench', page: 'chat' });
  await page.locator('.context-stats-bar').waitFor();
  await act({ type: 'session.send', id, text: '你好', commandId: crypto.randomUUID() });
  await waitFor(() => requests.length >= 1, '模型请求');
  await waitFor(async () => { const s = (await snap()).sessions.find(v => v.id === id); return s && s.status !== 'running' && s.usage?.context; }, '用量回填');
  await page.waitForTimeout(400);

  const bar = await page.evaluate(() => {
    const root = document.querySelector('.context-stats-bar');
    const donut = document.querySelector('.context-donut');
    const r = root.getBoundingClientRect(), d = donut.getBoundingClientRect();
    return {
      text: root.textContent.replace(/\s+/g, ' ').trim(),
      height: Math.round(r.height),
      donut: { width: Math.round(d.width), height: Math.round(d.height), fill: getComputedStyle(donut).backgroundImage },
      doc: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
      overflow: getComputedStyle(root).display,
    };
  });
  assert.match(bar.text, /上下文 \d+(\.\d+)?%/, '应显示当前上下文占用');
  assert.match(bar.text, /1\.3K tokens/, '应显示本任务累计 Token');
  assert.match(bar.text, /缓存 75%/, '应按缓存读取/输入显示命中率');
  assert.ok(bar.height >= 24 && bar.height < 60, `状态条高度应紧凑，实际 ${bar.height}`);
  assert.ok(bar.donut.width >= 12, '圆形上下文图应有尺寸');
  assert.match(bar.donut.fill, /conic-gradient/, '圆形图应有 conic-gradient 填充');
  assert.ok(bar.doc[0] <= bar.doc[1] + 1, '状态条不应把页面撑出滚动条');
  report.bar = bar;
  report.checks.push('上下文状态条有样式：圆形占用、轮/步、Token、缓存命中，且不撑高页面');
  await page.screenshot({ path: 'test-results/context-stats-bar.png' });

  await page.locator('.context-actions > summary').click();
  await page.locator('.context-actions-menu').waitFor();
  const menu = await page.evaluate(() => { const m = document.querySelector('.context-actions-menu'); const r = m.getBoundingClientRect(); return { text: m.textContent.replace(/\s+/g, ' ').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: innerHeight }; });
  assert.match(menu.text, /压缩上下文/);
  assert.ok(menu.top >= 0 && menu.bottom <= menu.viewport, '操作菜单应完整显示在窗口内');
  report.menu = menu;
  report.checks.push('操作菜单在状态条上方展开且完整可见');
  await page.screenshot({ path: 'test-results/context-stats-menu.png' });
  await page.locator('.context-actions > summary').click();

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench'))?.setSize(700, 800); });
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => {
    const root = document.querySelector('.context-stats-bar'), cache = document.querySelector('.cache-stat');
    const r = root.getBoundingClientRect();
    return { height: Math.round(r.height), width: Math.round(r.width), doc: [document.documentElement.scrollWidth, innerWidth], cacheVisible: !!cache && getComputedStyle(cache).display !== 'none' };
  });
  assert.ok(narrow.height <= 80, `窄屏状态条不应过高：${narrow.height}`);
  assert.ok(narrow.doc[0] <= narrow.doc[1] + 1, '窄屏不应出现横向溢出');
  assert.equal(narrow.cacheVisible, false, '窄屏隐藏缓存统计');
  report.narrow = narrow;
  report.checks.push('窄屏状态条不溢出、缓存统计自动收起');
  await page.screenshot({ path: 'test-results/context-stats-narrow.png' });

  assert.deepEqual(errors, [], `页面异常：${errors.join('; ')}`);
  report.passed = true;
  console.log('Context stats bar PASS');
} finally {
  await writeFile('test-results/context-bar-check.json', JSON.stringify(report, null, 2));
  await app.close();
  await new Promise(resolve => server.close(resolve));
}

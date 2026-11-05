// 端到端校验：DeepSeek 推理强度从输入栏控件一路传到模型请求（本地假服务，不访问真实 API）。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const port = await new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '好的，我在听。' } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

const home = path.resolve('.runtime/reasoning-' + Date.now());
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
  const session = async id => (await snap()).sessions.find(s => s.id === id);

  await act({ type: 'profile.save', profile: { id: 'deepseek', name: 'DeepSeek 官方', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-flash', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  const id = await act({ type: 'session.create', backend: 'dragon', profileId: 'deepseek' });
  assert.equal(typeof id, 'string');
  await act({ type: 'window.workbench', page: 'chat' });
  await page.locator('.composer textarea').waitFor();

  const openReasoning = async () => {
    await page.getByRole('button', { name: '选择推理强度' }).click();
    const slider = page.locator('input[aria-label="DeepSeek 推理强度"]');
    await slider.waitFor();
    await slider.focus();
    return slider;
  };

  let slider = await openReasoning();
  await page.screenshot({ path: 'test-results/reasoning-deepseek.png' });
  await page.keyboard.press('End');
  await waitFor(async () => (await session(id))?.reasoningEffort === 'max', '保存最高强度');
  await page.keyboard.press('Escape');

  await page.locator('.composer textarea').click();
  await page.keyboard.type('你好');
  await page.keyboard.press('Enter');
  await waitFor(() => requests.length >= 1, '第一次模型请求');
  assert.equal(requests[0].body.model, 'deepseek-flash');
  assert.equal(requests[0].body.reasoning_effort, 'max');
  assert.equal(requests[0].body.thinking?.type, 'enabled');
  report.checks.push('选择「最高」后请求带 reasoning_effort=max 与 thinking.enabled');

  await waitFor(async () => (await session(id))?.status !== 'running', '第一次回答结束');
  slider = await openReasoning();
  await page.keyboard.press('Home');
  await waitFor(async () => (await session(id))?.reasoningEffort === 'none', '保存关闭思考');
  await page.keyboard.press('Escape');

  await page.locator('.composer textarea').click();
  await page.keyboard.type('再说一次');
  await page.keyboard.press('Enter');
  await waitFor(() => requests.length >= 2, '第二次模型请求');
  assert.equal(requests[1].body.reasoning_effort, undefined);
  assert.equal(requests[1].body.thinking?.type, 'disabled');
  report.checks.push('选择「关闭」后请求只带 thinking.disabled，不发送 reasoning_effort');

  // 恢复默认档位（高）时清空会话设置，交给服务端默认值。
  await waitFor(async () => (await session(id))?.status !== 'running', '第二次回答结束');
  slider = await openReasoning();
  await page.keyboard.press('Home');
  await waitFor(async () => (await session(id))?.reasoningEffort === 'none', '重新设为关闭');
  await page.getByRole('button', { name: '恢复默认推理强度' }).click();
  await waitFor(async () => (await session(id))?.reasoningEffort === undefined, '恢复默认');
  report.checks.push('「恢复默认」清空显式档位，交给 DeepSeek 官方默认（高）');
  await page.keyboard.press('Escape');

  // 非 DeepSeek 模型不显示推理强度入口，避免把扩展参数发给其他服务商。
  await act({ type: 'profile.save', profile: { id: 'other', name: '其他模型', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'qwen-max', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  await act({ type: 'session.create', backend: 'dragon', profileId: 'other' });
  await page.locator('.composer textarea').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: '选择推理强度' }).count(), 0, '非 DeepSeek 模型不应显示推理强度');
  report.checks.push('非 DeepSeek 模型不显示推理强度入口');

  assert.deepEqual(errors, [], `页面异常：${errors.join('; ')}`);
  report.passed = true;
  console.log('DeepSeek reasoning PASS');
} finally {
  await writeFile('test-results/reasoning-check.json', JSON.stringify(report, null, 2));
  await app.close();
  await new Promise(resolve => server.close(resolve));
}

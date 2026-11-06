// 模型切换回归：同一聊天内切换 Codex/Dragon，不再新建会话；协作模式可退出。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const server = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: '已记录切换前的上下文。' } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const home = path.resolve('.runtime/model-switch-' + Date.now());
await mkdir(home, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
const report = { passed: false, checks: [] };
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().includes('view=workbench')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  assert(page);
  const act = a => page.evaluate(a => window.dragon.action(a), a), snap = () => page.evaluate(() => window.dragon.snapshot());
  for (const [id, name] of [['a', '模型 A'], ['b', '模型 B']]) {
    await act({ type: 'profile.save', profile: { id, name, provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  }
  const id = await act({ type: 'session.create', backend: 'dragon', profileId: 'a' });
  await act({ type: 'session.send', id, text: '这是切换前的用户消息，请记住。', commandId: 'before-switch' });
  for (let i = 0; i < 100; i++) { const v = (await snap()).sessions.find(v => v.id === id); if (['completed', 'error', 'cancelled'].includes(v.status)) break; await page.waitForTimeout(100); }
  assert.equal((await snap()).sessions.find(v => v.id === id).status, 'completed');
  const before = (await snap()).sessions.length;
  await act({ type: 'session.switch', id, backend: 'codex', model: 'gpt-test' });
  let s = (await snap()).sessions.find(v => v.id === id);
  assert.equal(s.backend, 'codex'); assert.equal(s.model, 'gpt-test'); assert.equal(s.collaboration?.enabled, false);
  assert.ok(s.handoff?.includes('这是切换前的用户消息'), '切换后应保留一份对话摘录供下一条消息使用');
  assert.ok(s.messages.some(m => m.role === 'notice' && m.text.includes('已切换到')));
  report.checks.push('Dragon → Codex 在当前聊天内切换，保留摘录与提示');

  await act({ type: 'session.switch', id, backend: 'dragon', profileId: 'b' });
  s = (await snap()).sessions.find(v => v.id === id);
  assert.equal(s.backend, 'dragon'); assert.equal(s.profileId, 'b'); assert.equal(s.model, undefined);
  report.checks.push('Codex → Dragon 在当前聊天内切换');

  await act({ type: 'session.collaboration', id, config: { enabled: true, executionProfileId: 'b' } });
  s = (await snap()).sessions.find(v => v.id === id);
  assert.equal(s.collaboration?.enabled, true);
  await act({ type: 'session.collaboration', id, config: { enabled: false } });
  s = (await snap()).sessions.find(v => v.id === id);
  assert.equal(s.collaboration?.enabled, false);
  report.checks.push('协作模式可开启并切回单模型');

  await act({ type: 'session.collaboration', id, config: { enabled: true, executionProfileId: 'b' } });
  await act({ type: 'session.switch', id, backend: 'codex', model: 'gpt-test' });
  s = (await snap()).sessions.find(v => v.id === id);
  assert.equal(s.collaboration?.enabled, false, '切换到 Codex 必须退出协作');
  assert.equal((await snap()).sessions.length, before, '切换模型不得新建会话');
  report.checks.push('切换模型不会新建聊天，协作状态正确关闭');
  assert.equal((await snap()).sessions.length, 1);
  report.passed = true;
  console.log('Model switch PASS');
} finally {
  await writeFile('test-results/model-switch.json', JSON.stringify(report, null, 2));
  await app.close();
  await new Promise(resolve => server.close(resolve));
}

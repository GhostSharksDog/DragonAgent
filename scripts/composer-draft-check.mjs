// 回归：输入框聚焦时，IPC 往返的旧草稿不能覆盖正在输入的内容（中文输入法拼写时尤其明显）。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = path.resolve('.runtime/composer-draft-' + Date.now());
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
  const act = a => page.evaluate(a => window.dragon.action(a), a);
  const id = await act({ type: 'session.create', backend: 'dragon' });
  assert.equal(typeof id, 'string');
  await act({ type: 'window.workbench', page: 'chat' });
  const textarea = page.locator('.composer textarea');
  await textarea.waitFor();

  await textarea.click();
  await page.keyboard.type('gu');
  assert.equal(await textarea.inputValue(), 'gu');
  // 真实输入法输入时，草稿的 IPC 往返会晚于本地按键到达；模拟一个之前确实发送过的旧值回声。
  await act({ type: 'session.draft', id, text: 'g' });
  await page.waitForTimeout(350);
  assert.equal(await textarea.inputValue(), 'gu', '自己旧草稿的迟到回声不应覆盖正在输入的内容');
  report.checks.push('迟到的旧草稿回声不会覆盖输入框内容');

  // 外部设置（另一个入口恢复草稿、清空或队列）即使聚焦也要生效。
  await act({ type: 'session.draft', id, text: '外部草稿' });
  await page.waitForTimeout(350);
  assert.equal(await textarea.inputValue(), '外部草稿', '外部设置的草稿应同步到输入框');
  report.checks.push('外部设置的草稿在聚焦时仍能同步');

  assert.deepEqual(errors, [], `页面异常：${errors.join('; ')}`);
  report.passed = true;
  console.log('Composer draft PASS');
  await page.screenshot({ path: 'test-results/composer-draft.png' });
} finally {
  await writeFile('test-results/composer-draft.json', JSON.stringify(report, null, 2));
  await app.close();
}

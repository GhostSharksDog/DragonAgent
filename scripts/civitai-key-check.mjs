// 验证 Civitai 访问密钥：加密保存、状态回显、重新打开不回显原文、可清除。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { strict as assert } from 'node:assert';

const dataDir = path.resolve(`.runtime/civitai-key-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
await mkdir('test-results', { recursive: true });
const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = { ...process.env, DRAGON_DATA_DIR: dataDir, DRAGON_SMOKE: '' };
if (process.env.DRAGON_EXE) {
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.Path = [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
}
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const pageErrors = [];
let page;
const key = 'civitai-plain-key-9876';
const saved = () => page.evaluate(async () => (await window.dragon.snapshot()).workshop.civitaiKeySaved);

async function openEnvironment() {
  await page.getByRole('button', { name: '创作工坊', exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '创作工坊', exact: true }).click();
  await page.getByRole('heading', { name: '创作工坊', exact: true }).waitFor({ timeout: 20000 });
  if (!(await page.locator('.environment-panel').count())) await page.locator('.studio-connection').click();
  await page.locator('.environment-panel').waitFor({ timeout: 15000 });
  await page.getByText('Civitai 访问密钥（可选）', { exact: true }).click();
}

try {
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  await openEnvironment();

  const field = page.getByLabel('Civitai 访问密钥');
  await field.fill(key);
  await page.getByRole('button', { name: '加密保存', exact: true }).click();
  await page.getByText('已加密保存到本机密钥库', { exact: false }).waitFor({ timeout: 15000 });
  assert.equal(await field.inputValue(), '', '保存成功后输入框应清空');
  assert.equal(await saved(), true, '快照应报告密钥已保存');
  await page.locator('.environment-panel').screenshot({ path: 'test-results/civitai-key-saved.png' });

  const db = new DatabaseSync(path.join(dataDir, 'dragonagent.db'), { readOnly: true });
  const row = db.prepare("SELECT encrypted FROM secrets WHERE id = 'workshop:civitai'").get();
  db.close();
  assert.ok(row, '密钥应写入 secrets 表');
  const raw = Buffer.from(row.encrypted);
  assert.ok(raw.length > 0, '加密后的记录不应为空');
  assert.ok(!raw.toString('utf8').includes(key), '密钥不应以明文落盘');

  await page.reload();
  await openEnvironment();
  await page.getByText('已保存密钥，输入新密钥可覆盖。', { exact: false }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByLabel('Civitai 访问密钥').inputValue(), '', '重新打开时不应回显密钥原文');
  assert.match(await page.getByLabel('Civitai 访问密钥').getAttribute('placeholder'), /已保存密钥/);
  assert.equal(await saved(), true);

  await page.getByRole('button', { name: '清除密钥', exact: true }).click();
  await page.getByText('已清除保存的 Civitai 密钥。', { exact: false }).waitFor({ timeout: 15000 });
  assert.equal(await saved(), false, '清除后快照应报告未保存');
  assert.equal(await page.getByRole('button', { name: '清除密钥', exact: true }).count(), 0, '清除后不再显示清除按钮');

  assert.deepEqual(pageErrors, [], `页面出现异常：${pageErrors.join('; ')}`);
  console.log('Civitai key encrypt-and-save PASS');
} finally {
  await app.close();
}

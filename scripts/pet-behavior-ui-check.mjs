import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * 桌宠行为 UI 验收：真实启动 Electron，打开「外观工坊 → 桌宠行为」，
 * 验证预设、滑块、来回数保存，以及桌宠库默认选中当前皮肤并显示真实左右翻转。
 *
 * 用法：node scripts/pet-behavior-ui-check.mjs
 */
const dataDir = path.resolve(`.runtime/behavior-ui-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: dataDir, DRAGON_SMOKE: '', DRAGON_PET_SLEEP_MS: '600000', DRAGON_PET_ROAM_MS: '600000', DRAGON_PET_ROAM_GAP_MS: '600000' };
delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], cwd: process.cwd(), env, timeout: 45000 });
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
try {
  await app.firstWindow();
  await sleep(1200);
  const page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '外观工坊' }).click();
  await page.getByRole('button', { name: '桌宠行为' }).click();
  await page.getByRole('heading', { name: '桌宠行为' }).waitFor({ timeout: 10000 });
  check('行为页签可以打开', true);

  const before = await page.evaluate(async () => (await window.dragon.snapshot()).settings.pet.behavior);
  check('默认行为已载入', before?.enabled === true && before?.speed === 1 && before?.runChancePct === 20, JSON.stringify(before));

  await page.getByRole('button', { name: '活泼' }).click();
  await page.waitForFunction(async () => {
    const b = (await window.dragon.snapshot()).settings.pet.behavior;
    return b.speed === 1.5 && b.distancePx === 300 && b.rounds === 2;
  }, null, { timeout: 10000 });
  const lively = await page.evaluate(async () => (await window.dragon.snapshot()).settings.pet.behavior);
  check('活泼预设保存到运行时', lively?.speed === 1.5 && lively?.distancePx === 300 && lively?.rounds === 2, JSON.stringify(lively));

  check('活泼预设包含较高跑步概率', lively?.runChancePct === 45, JSON.stringify(lively));
  // 等预设的 UI draft 也同步完，再改滑块；否则随后的 re-render 会把刚填的值覆盖回预设值。
  await page.waitForFunction(() => {
    const run = document.querySelector('input[aria-label="偶尔跑步概率"]');
    const speed = document.querySelector('input[aria-label="奔跑速度"]');
    return run?.value === '45' && speed?.value === '1.5';
  }, null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.getByLabel('偶尔跑步概率').fill('70');
  await page.waitForTimeout(250);
  await page.getByLabel('奔跑速度').fill('1.8');
  await page.waitForTimeout(250);
  await page.getByLabel('每次来回').selectOption('3');
  await page.waitForFunction(() => {
    const run = document.querySelector('input[aria-label="偶尔跑步概率"]');
    const speed = document.querySelector('input[aria-label="奔跑速度"]');
    return run?.value === '70' && speed?.value === '1.8';
  }, null, { timeout: 3000 });
  await page.getByRole('button', { name: '保存行为' }).click();
  await page.waitForFunction(async () => {
    const b = (await window.dragon.snapshot()).settings.pet.behavior;
    return b.speed === 1.8 && b.rounds === 3 && b.runChancePct === 70;
  }, null, { timeout: 10000 });
  const saved = await page.evaluate(async () => (await window.dragon.snapshot()).settings.pet.behavior);
  check('滑块和来回数保存到运行时', saved?.speed === 1.8 && saved?.rounds === 3 && saved?.runChancePct === 70, JSON.stringify(saved));
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor({ timeout: 10000 });
  check('保存状态有反馈', /已保存/.test(await page.getByRole('status').innerText()), await page.getByRole('status').innerText());
  await page.screenshot({ path: 'test-results/pet-behavior-ui.png' });

  await page.getByRole('button', { name: '桌宠库' }).click();
  await page.waitForFunction(() => {
    const select = document.querySelector('select[aria-label="预览动作"]');
    return !!select && [...select.options].some(option => option.value === 'running-left') && [...select.options].some(option => option.value === 'running-right');
  }, null, { timeout: 10000 });
  const initialOptions = await page.getByLabel('预览动作').locator('option').evaluateAll(nodes => nodes.map(n => n.value));
  check('桌宠库默认显示当前桌宠的跑动动作', initialOptions.includes('running-left') && initialOptions.includes('running-right'), JSON.stringify(initialOptions));
  await page.locator('.skin-list button').filter({ hasText: '蓝色大肥鱼' }).first().click();
  await page.waitForTimeout(500);
  const preview = page.locator('.skin-preview');
  await preview.waitFor({ timeout: 10000 });
  const select = page.getByLabel('预览动作');
  const options = await select.locator('option').evaluateAll(nodes => nodes.map(n => ({ value: n.value, text: n.textContent })));
  const has = value => options.some(option => option.value === value);
  check('桌宠库包含左右跑动动作', has('running-left') && has('running-right'), JSON.stringify(options.map(option => option.value)));
  if (has('running-left')) await select.selectOption('running-left');
  await page.waitForTimeout(300);
  check('预览 running-left 使用原始左向素材', await preview.getAttribute('data-flipx') === 'false', String(await preview.getAttribute('data-flipx')));
  if (has('running-right')) await select.selectOption('running-right');
  await page.waitForTimeout(300);
  check('预览 running-right 使用镜像右向素材', await preview.getAttribute('data-flipx') === 'true', String(await preview.getAttribute('data-flipx')));

  const report = { ok: checks.every(item => item.ok), dataDir, checks, options };
  await writeFile('test-results/pet-behavior-ui.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) throw new Error('行为 UI 验收失败');
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
}

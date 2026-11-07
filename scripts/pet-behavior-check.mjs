import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 桌宠行为验收：真实启动 Electron，用 pet.behavior 写入自定义首次等待、
 * 速度、单程距离和冷却，确认窗口位移、动画、方向翻转和再次触发都跟随配置。
 *
 * 用法：node scripts/pet-behavior-check.mjs
 */
await mkdir('test-results', { recursive: true });
const dataDir = path.resolve(`.runtime/pet-behavior-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = {
  ...process.env,
  DRAGON_DATA_DIR: dataDir,
  DRAGON_SMOKE: '',
  DRAGON_PET_SLEEP_MS: '800',
  DRAGON_PET_ROAM_MS: '',
  DRAGON_PET_ROAM_GAP_MS: '',
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const errors = [];
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };
let page, pet;
const readAnimation = () => pet.evaluate(() => document.querySelector('.video-canvas')?.getAttribute('data-animation') ?? null);
const readFlip = () => pet.evaluate(() => document.querySelector('.video-frame')?.getAttribute('data-flipx') ?? null);
const readBounds = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet'));
  return win ? win.getBounds() : null;
});
const setBehavior = behavior => page.evaluate(value => window.dragon.action({ type: 'pet.behavior', behavior: value }), behavior);
const waitForAnimation = async (predicate, timeout, label) => {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await readAnimation();
    if (predicate(last)) return last;
    await sleep(50);
  }
  throw new Error(`等待 ${label} 超时，最后动画：${last}`);
};
const base = {
  enabled: true,
  firstDelayMinSec: 0,
  firstDelayMaxSec: 0,
  intervalMinSec: 30,
  intervalMaxSec: 30,
  speed: 2,
  distancePx: 120,
  rounds: 1,
  runChancePct: 100,
  wake: true,
};
const runOnce = async (label, timeout = 12000) => {
  const first = await waitForAnimation(value => typeof value === 'string' && value.startsWith('running-'), timeout, label);
  const startedAt = Date.now();
  let minX = Infinity, maxX = -Infinity, last = first, flips = {};
  while (Date.now() - startedAt < 8000) {
    last = await readAnimation();
    if (last?.startsWith('walking-') || last?.startsWith('running-')) {
      if (!flips[last]) flips[last] = await readFlip();
      const bounds = await readBounds();
      if (bounds) { minX = Math.min(minX, bounds.x); maxX = Math.max(maxX, bounds.x); }
    }
    if (last === 'idle') break;
    await sleep(35);
  }
  return { first, last, duration: Date.now() - startedAt, travelled: maxX - minX, minX, maxX, flips };
};

try {
  await app.firstWindow();
  await sleep(1200);
  page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });
  await setBehavior(base);
  await page.evaluate(() => window.dragon.action({ type: 'pet.toggle' }));
  const petDeadline = Date.now() + 20000;
  while (!pet && Date.now() < petDeadline) {
    pet = app.windows().find(w => w.url().includes('view=pet'));
    if (!pet) await sleep(120);
  }
  if (!pet) throw new Error('找不到桌宠窗口');
  pet.on('pageerror', error => errors.push(error.message));
  await pet.waitForFunction(() => document.querySelector('.video-canvas')?.getAttribute('data-ready') === 'true', null, { timeout: 30000 });

  const first = await runOnce('自定义首次跑动', 10000);
  check('自定义首次等待后触发跑动', first.first.startsWith('running-'), first.first);
  check('速度 2x 时单腿/来回节奏更快', first.duration > 300 && first.duration < 3500, `${first.duration}ms`);
  check('单程距离约 120px', first.travelled >= 100 && first.travelled <= 150, `${first.travelled}px`);
  check('跑完回到待机', first.last === 'idle', String(first.last));
  check('running-left keeps original left-facing source', first.flips['running-left'] === 'false', String(first.flips['running-left']));
  check('running-right is mirrored to face right', first.flips['running-right'] === 'true', String(first.flips['running-right']));

  const endedAt = Date.now();
  const second = await runOnce('30 秒冷却后的第二次跑动', 40000);
  // 截图放在第二次跑动之后再拍；透明置顶窗口截图可能较慢，不能让它吃掉 30 秒冷却窗口。
  await pet.screenshot({ path: 'test-results/pet-behavior-first-run.png' });
  const gap = Date.now() - endedAt;
  check('自定义 30 秒间隔生效', gap >= 28_000, `${gap}ms`);
  check('第二次仍然正常跑动', second.first.startsWith('running-'), second.first);

  // 等它重新趴下，再验证 wake=false 不会叫醒；改回 true 后会被叫醒并跑动。
  await waitForAnimation(value => value === 'sleep-loop', 12000, '入睡');
  await setBehavior({ ...base, wake: false });
  await sleep(2500);
  const sleepingAnimation = await readAnimation();
  check('wake=false 时睡觉不跑动', !sleepingAnimation?.startsWith('walking-') && !sleepingAnimation?.startsWith('running-'), String(sleepingAnimation));
  await setBehavior({ ...base, wake: true });
  const wakeRun = await waitForAnimation(value => typeof value === 'string' && value.startsWith('running-'), 6000, '叫醒后跑动');
  check('wake=true 时会被跑动叫醒', wakeRun.startsWith('running-'), wakeRun);

  // 跑动中关闭 enabled：当前路线应停止，之后不再自动触发。
  await setBehavior({ ...base, enabled: false });
  await sleep(2200);
  const disabledAnimation = await readAnimation();
  check('enabled=false 立即停止且不再触发', !disabledAnimation?.startsWith('walking-') && !disabledAnimation?.startsWith('running-'), String(disabledAnimation));

  const report = { ok: checks.every(item => item.ok), dataDir, checks, rendererErrors: errors, first, second, gap, sleepingAnimation, wakeRun, disabledAnimation };
  await writeFile('test-results/pet-behavior.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('渲染进程错误：' + errors.join(' | '));
  if (!report.ok) throw new Error('未通过：' + checks.filter(item => !item.ok).map(item => item.name).join(', '));
  console.log('PET BEHAVIOR PASS');
} catch (error) {
  const report = { ok: false, dataDir, checks, error: String(error), rendererErrors: errors };
  await writeFile('test-results/pet-behavior.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
}

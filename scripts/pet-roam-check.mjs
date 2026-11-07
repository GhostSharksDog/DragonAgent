import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 空闲跑动验收：真实启动 Electron，把首次跑动和冷却缩短，
 * 确认桌宠窗口真的在水平方向来回移动、动画是 running-*，并且跑完会停、冷却期内不会马上再跑。
 *
 * 用法：node scripts/pet-roam-check.mjs
 */
await mkdir('test-results', { recursive: true });
const dataDir = path.resolve(`.runtime/pet-roam-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = {
  ...process.env,
  DRAGON_DATA_DIR: dataDir,
  DRAGON_SMOKE: '',
  DRAGON_PET_SLEEP_MS: '600000',
  DRAGON_PET_ROAM_MS: '1500',
  DRAGON_PET_ROAM_GAP_MS: '5000',
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const errors = [];
const checks = [];
let samples = [];
const flips = {};
let windowInfo = null;
let displayInfo = null;
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };

try {
  await app.firstWindow();
  await sleep(1200);
  const page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });
  // 默认 20% 会在统计上呈两成；验收固定为 100%，才能稳定观察“先走→切跑”。
  await page.evaluate(async () => {
    const state = await window.dragon.snapshot();
    await window.dragon.action({ type: 'pet.behavior', behavior: { ...state.settings.pet.behavior, runChancePct: 100 } });
  });

  try {
    await page.getByRole('button', { name: '召唤龙娘', exact: false }).first().click({ timeout: 6000 });
  } catch {
    await page.evaluate(() => window.dragon.action({ type: 'pet.toggle' }));
  }

  let pet;
  const petDeadline = Date.now() + 20000;
  while (!pet && Date.now() < petDeadline) {
    pet = app.windows().find(w => w.url().includes('view=pet'));
    if (!pet) await sleep(120);
  }
  if (!pet) throw new Error('找不到桌宠窗口');
  pet.on('pageerror', error => errors.push(error.message));
  await pet.waitForFunction(() => document.querySelector('.video-canvas')?.getAttribute('data-ready') === 'true', null, { timeout: 30000 });

  const readAnimation = () => pet.evaluate(() => document.querySelector('.video-canvas')?.getAttribute('data-animation') ?? null);
  const readFlip = () => pet.evaluate(() => document.querySelector('.video-frame')?.getAttribute('data-flipx') ?? null);
  const readBounds = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet'));
    return win ? win.getBounds() : null;
  });
  const waitFor = async (predicate, timeout, label) => {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await readAnimation();
      if (predicate(last)) return last;
      await sleep(80);
    }
    throw new Error(`等待 ${label} 超时，最后动画：${last}`);
  };

  windowInfo = await pet.evaluate(() => ({ screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, innerWidth: window.innerWidth, screenWidth: screen.width, availWidth: screen.availWidth, availLeft: screen.availLeft }));
  console.log('WINDOW_INFO', JSON.stringify(windowInfo));
  displayInfo = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet'));
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return { bounds, workArea: display.workArea, displayBounds: display.bounds, scaleFactor: display.scaleFactor };
  });
  console.log('DISPLAY_INFO', JSON.stringify(displayInfo));
  const idle = await waitFor(value => value === 'idle', 20000, '待机');
  check('跑动前处于待机', idle === 'idle', String(idle));
  // 固定第一轮从右边缘起跑，保证方向为左；第二轮再从左侧起跑验证镜像。
  await pet.evaluate(() => window.pet.drag(3000, 0));
  await sleep(350);
  const before = await readBounds();
  check('拿到桌宠初始位置', Boolean(before), JSON.stringify(before));

  const firstWalk = await waitFor(value => typeof value === 'string' && value.startsWith('walking-'), 20000, '第一次慢走起步');
  check('空闲跑动先进入慢走起步', firstWalk.startsWith('walking-'), firstWalk);
  const first = await waitFor(value => typeof value === 'string' && value.startsWith('running-'), 6000, '走路后切换跑步');
  check('慢走起步后切换到跑步', first.startsWith('running-'), first);

  const startedAt = Date.now();
  let minX = before.x, maxX = before.x;
  let maxStep = 0, lastX = null;
  let lastAnimation = first;
  samples = [];
  while (Date.now() - startedAt < 20000) {
    lastAnimation = await readAnimation();
    if ((lastAnimation?.startsWith('walking-') || lastAnimation?.startsWith('running-')) && !flips[lastAnimation]) {
      flips[lastAnimation] = await readFlip();
      await pet.screenshot({ path: `test-results/pet-roam-${lastAnimation}.png` });
    }
    const bounds = await readBounds();
    const visibility = await pet.evaluate(() => document.visibilityState);
    if (bounds) {
      minX = Math.min(minX, bounds.x); maxX = Math.max(maxX, bounds.x);
      if (lastX !== null) maxStep = Math.max(maxStep, Math.abs(bounds.x - lastX));
      lastX = bounds.x;
    }
    samples.push({ t: Date.now() - startedAt, animation: lastAnimation, x: bounds?.x, visibility });
    if (lastAnimation === 'idle') break;
    await sleep(60);
  }
  const endedAt = Date.now();
  const after = await readBounds();
  const travelled = maxX - minX;
  const drift = Math.abs(after.x - before.x);
  check('跑动期间窗口水平移动', travelled >= 30, `水平位移 ${travelled}px`);
  check('跑动位移连续，没有单帧瞬移', maxStep <= 30, `最大单次位移 ${maxStep}px`);
  check('跑完回到出发点附近', drift <= 50, `漂移 ${drift}px`);
  check('跑完自动停下', lastAnimation === 'idle', String(lastAnimation));

  let rerunSeen = false;
  let rerunAt = 0;
  while (Date.now() - endedAt < 2500) {
    const animation = await readAnimation();
    if (animation?.startsWith('running-')) { rerunSeen = true; rerunAt = Date.now() - endedAt; break; }
    await sleep(80);
  }
  check('冷却期内不会马上再跑', !rerunSeen, rerunSeen ? `在 ${rerunAt}ms 就再次跑动` : '2.5s 内保持安静');

  // 移到屏幕左边缘，第二轮起跑方向应变为右，从而覆盖 running-right / walking-right。
  await pet.evaluate(() => window.pet.drag(-3000, 0));
  await sleep(350);
  let second = null;
  let secondAt = 0;
  const secondDeadline = Date.now() + 16000;
  while (Date.now() < secondDeadline) {
    const animation = await readAnimation();
    if ((animation?.startsWith('walking-') || animation?.startsWith('running-')) && !flips[animation]) {
      flips[animation] = await readFlip();
      await pet.screenshot({ path: `test-results/pet-roam-${animation}.png` });
    }
    if (!second && animation?.startsWith('running-')) {
      second = animation;
      secondAt = Date.now();
    }
    if (second && animation === 'idle') break;
    await sleep(60);
  }
  if (!second) throw new Error('冷却后的第二次跑动超时');
  const gap = secondAt - endedAt;
  check('冷却结束后会再次跑动', second.startsWith('running-'), `间隔约 ${gap}ms`);
  check('两次跑动间隔符合冷却设置', gap >= 3500, `间隔 ${gap}ms`);

  check('running-left keeps left-facing source', flips['running-left'] === 'false', String(flips['running-left']));
  check('running-right mirrors to face right', flips['running-right'] === 'true', String(flips['running-right']));
  check('walking-left keeps left-facing source', flips['walking-left'] === 'false', String(flips['walking-left']));
  check('walking-right mirrors to face right', flips['walking-right'] === 'true', String(flips['walking-right']));
  const report = { ok: checks.every(item => item.ok), dataDir, checks, rendererErrors: errors, firstWalk, first, second, travelled, maxStep, drift, gap, before, after, windowInfo, displayInfo, flips, samples: samples.slice(-20) };
  await writeFile('test-results/pet-roam.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('渲染进程错误：' + errors.join(' | '));
  if (!report.ok) throw new Error('未通过：' + checks.filter(item => !item.ok).map(item => item.name).join(', '));
  console.log('PET ROAM PASS');
} catch (error) {
  const report = { ok: false, dataDir, checks, error: String(error), rendererErrors: errors, windowInfo, displayInfo, samples };
  await writeFile('test-results/pet-roam.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
}

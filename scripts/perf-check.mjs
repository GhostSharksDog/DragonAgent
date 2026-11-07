import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 可重复的流式性能检查。
 *
 * 用法：
 *   node scripts/perf-check.mjs
 *   DRAGON_PERF_BASELINE=1 DRAGON_PERF_LABEL=baseline node scripts/perf-check.mjs
 *
 * baseline 模式只关闭主进程的落盘/广播合并，用来对比同一台机器上的
 * 同步写盘与逐 token 快照成本；渲染层的 memo、滚动和画布优化仍保留。
 */
const label = process.env.DRAGON_PERF_LABEL || (process.env.DRAGON_PERF_BASELINE === '1' ? 'baseline' : 'after');
const baseline = process.env.DRAGON_PERF_BASELINE === '1';
const tokens = 700;
const tokenDelay = 8;
const dataDir = path.resolve(`.runtime/perf-${label}-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
await mkdir('test-results', { recursive: true });

const stream = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  let index = 0;
  const timer = setInterval(() => {
    if (index >= tokens) {
      clearInterval(timer);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: tokens } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    const text = `流式片段 ${index + 1}：龙娘正在整理当前任务的状态、文件变更和验收结果。\n`;
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
    index += 1;
  }, tokenDelay);
  res.on('close', () => clearInterval(timer));
};
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  stream(res);
});
const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const env = {
  ...process.env,
  DRAGON_DATA_DIR: dataDir,
  DRAGON_PERF: '1',
  DRAGON_SMOKE: '',
  ...(baseline ? { DRAGON_PERF_BASELINE: '1' } : {}),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], cwd: process.cwd(), env, timeout: 45000 });
const errors = [];
let page;
let pet;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};
let report = { label, baseline, dataDir, ok: false, checks: [] };
try {
  await app.firstWindow();
  await sleep(900);
  page = app.windows().find(window => window.url().includes('view=workbench')) ?? app.windows()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });
  const act = action => page.evaluate(value => window.dragon.action(value), action);
  const snapshot = () => page.evaluate(() => window.dragon.snapshot());
  await act({ type: 'profile.save', profile: { id: 'perf', name: '性能测试', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'fixture', contextWindow: 65536, maxOutput: 8192, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  const id = await act({ type: 'session.create', backend: 'dragon', profileId: 'perf' });
  await act({ type: 'window.workbench', page: 'chat' });
  await page.locator('.composer textarea').waitFor({ timeout: 15000 });

  await app.evaluate(() => {
    const perfHooks = process.getBuiltinModule ? process.getBuiltinModule('node:perf_hooks') : require('node:perf_hooks');
    const histogram = perfHooks.monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    globalThis.__dragonLoop = histogram;
  });
  const before = await app.evaluate(() => ({ ...(globalThis.__dragonPerf ?? { changes: 0, saves: 0, broadcasts: 0 }) }));
  await page.evaluate(() => {
    const state = { done: false, frames: [], longtasks: [], scrollTimer: 0 };
    window.__dragonPerfPage = state;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) state.longtasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = now => {
      if (state.done) return;
      state.frames.push(Math.max(0, now - last));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const conversation = document.querySelector('.conversation');
    let bottom = false;
    state.scrollTimer = window.setInterval(() => {
      if (!conversation) return;
      conversation.scrollTop = bottom ? conversation.scrollHeight : 0;
      bottom = !bottom;
    }, 220);
  });

  await page.evaluate(({ id, commandId }) => window.dragon.action({ type: 'session.send', id, text: '请开始流式性能测试。', commandId }), { id, commandId: crypto.randomUUID() });
  const started = Date.now();
  let current;
  for (let index = 0; index < 240; index += 1) {
    current = (await snapshot()).sessions.find(session => session.id === id);
    if (current && !['running', 'waiting', 'stopping'].includes(current.status)) break;
    await sleep(100);
  }
  const durationMs = Date.now() - started;
  const renderer = await page.evaluate(() => {
    const state = window.__dragonPerfPage;
    state.done = true;
    clearInterval(state.scrollTimer);
    return { frames: state.frames, longtasks: state.longtasks };
  });
  const loop = await app.evaluate(() => {
    const histogram = globalThis.__dragonLoop;
    const value = histogram ? { p95Ms: histogram.percentile(95) / 1e6, maxMs: histogram.max / 1e6, meanMs: histogram.mean / 1e6 } : {};
    histogram?.disable();
    return value;
  });
  const after = await app.evaluate(() => ({ ...(globalThis.__dragonPerf ?? { changes: 0, saves: 0, broadcasts: 0 }) }));

  await act({ type: 'pet.toggle' });
  for (let index = 0; index < 200 && !pet; index += 1) {
    pet = app.windows().find(window => window.url().includes('view=pet'));
    if (!pet) await sleep(100);
  }
  let petPaints = null;
  if (pet) {
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForFunction(() => document.querySelector('.video-canvas')?.getAttribute('data-ready') === 'true', null, { timeout: 30000 });
    await pet.bringToFront();
    await pet.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5000 });
    const paintsBefore = await pet.evaluate(() => Number(document.querySelector('.video-canvas')?.getAttribute('data-paints') ?? 0));
    await sleep(2000);
    const paintsAfter = await pet.evaluate(() => Number(document.querySelector('.video-canvas')?.getAttribute('data-paints') ?? 0));
    petPaints = paintsAfter - paintsBefore;
  }

  const frames = renderer.frames.filter(value => value > 0 && value < 500);
  const saves = after.saves - before.saves;
  const broadcasts = after.broadcasts - before.broadcasts;
  const changes = after.changes - before.changes;
  const checks = [
    { name: '流式任务完成', ok: current?.status === 'completed', detail: current?.status ?? current?.error ?? 'unknown' },
    { name: '主进程事件循环 p95 < 80ms', ok: !loop.p95Ms || loop.p95Ms < 80, detail: `${Number(loop.p95Ms ?? 0).toFixed(2)}ms` },
    { name: '工作台帧间隔 p95 < 80ms', ok: percentile(frames, .95) < 80, detail: `${percentile(frames, .95).toFixed(1)}ms` },
    { name: '工作台无 >250ms 长任务', ok: Math.max(0, ...renderer.longtasks) < 250, detail: `${renderer.longtasks.length} 个长任务，最大 ${Math.max(0, ...renderer.longtasks).toFixed(1)}ms` },
    { name: '桌宠画布空闲不空转', ok: petPaints === null || (petPaints > 0 && petPaints < 120), detail: petPaints === null ? '未打开桌宠' : `${petPaints} 次绘制/2s` },
  ];
  if (!baseline) {
    checks.push(
      { name: '落盘合并到个位数量级', ok: saves <= 12, detail: `${saves} 次保存 / ${(durationMs / 1000).toFixed(1)}s（${changes} 次变化）` },
      { name: '快照广播不超过 200 次', ok: broadcasts <= 200, detail: `${broadcasts} 次广播 / ${(durationMs / 1000).toFixed(1)}s` },
    );
  }
  report = {
    ok: checks.every(check => check.ok) && !errors.length,
    label, baseline, dataDir, durationMs, checks, errors,
    main: { changes, saves, broadcasts, ...loop },
    workbench: { frames: frames.length, frameP95Ms: percentile(frames, .95), frameP99Ms: percentile(frames, .99), longTasks: renderer.longtasks.length, maxLongTaskMs: Math.max(0, ...renderer.longtasks) },
    pet: { opened: !!pet, paintsIn2s: petPaints },
    session: { status: current?.status, messages: current?.messages.length, textLength: current?.messages.reduce((sum, message) => sum + message.text.length, 0), error: current?.error },
  };
  await writeFile(`test-results/perf-${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && !baseline) throw new Error('性能检查未通过：' + checks.filter(check => !check.ok).map(check => check.name).join(', ') + (errors.length ? '；渲染错误：' + errors.join(' | ') : ''));
  console.log(`PERF ${label.toUpperCase()} ${report.ok ? 'PASS' : 'RECORDED'}`);
} catch (error) {
  report = { ...report, ok: false, error: String(error), errors };
  await writeFile(`test-results/perf-${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
}

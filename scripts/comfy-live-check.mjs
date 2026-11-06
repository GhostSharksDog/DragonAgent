// 真实 ComfyUI 冷启动 + Animagine 单图验收（不是模拟接口）。
// 运行前确认 8188 端口空闲；脚本结束会只停止自己启动的 ComfyUI 进程。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const free = await new Promise(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(8188, '127.0.0.1', () => s.close(() => resolve(true))); });
assert(free, '端口 8188 已被占用：请先停止现有 ComfyUI');
const home = path.resolve('.runtime/comfy-live-' + Date.now());
await mkdir(home, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
const report = { passed: false, startedAt: Date.now() };
let page;
try {
  await app.firstWindow();
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().includes('view=workbench')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  assert(page);
  page.on('pageerror', e => { report.pageError = e.message; });
  const act = a => page.evaluate(a => window.dragon.action(a), a), snap = () => page.evaluate(() => window.dragon.snapshot());
  const choices = await act({ type: 'illustration.launch.detect' });
  assert(Array.isArray(choices) && choices.length, '未检测到 ComfyUI 安装');
  report.launch = choices[0];
  console.log('detected', JSON.stringify(choices[0]));

  const id = await act({ type: 'illustration.create', commandId: 'live-' + Date.now(), description: '银白龙娘在窗边读书，午后暖光' });
  const parameters = (await snap()).illustration.projects.find(p => p.id === id).parameters;
  parameters.model = { backend: 'animagine', model: 'animagineXL40_v4Opt.safetensors', encoder: '', vae: '', width: 768, height: 1024, steps: 20, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal' };
  parameters.positive = '1girl, adult woman, silver hair, purple eyes, small dragon horns, gentle smile, simple white dress, full body, feet visible, solo, centered, simple plain background, safe, masterpiece, high score, great score';
  parameters.negative = 'worst quality, low quality, blurry, bad anatomy, extra limbs, extra fingers, cropped, text, watermark, multiple characters';
  parameters.seed = 20261106;
  await act({ type: 'illustration.update', id, parameters });
  await act({ type: 'illustration.generate', id, commandId: 'live-generate-' + Date.now() });

  let last = '', run;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => { const p = (await window.dragon.snapshot()).illustration.projects[0]; return { status: p.status, run: p.runs[0] ? { state: p.runs[0].state, error: p.runs[0].error, file: p.runs[0].file, elapsedMs: p.runs[0].elapsedMs } : undefined, service: p.status }; });
    if (state.run && state.run.state !== last) { last = state.run.state; console.log('state', last, state.run.error ?? ''); }
    if (state.run && ['completed', 'error', 'unknown', 'cancelled'].includes(state.run.state)) { run = state.run; break; }
    await new Promise(r => setTimeout(r, 2000));
  }
  assert(run, '生成超时（12 分钟）');
  assert.equal(run.state, 'completed', run.error);
  const files = await readdir(path.join(home, 'illustration'), { recursive: true });
  const file = files.find(f => f.endsWith('.png') && f.includes('outputs'));
  assert(file, '未找到生成文件');
  const absolute = path.join(home, 'illustration', file);
  const meta = await sharp(absolute).metadata();
  assert.equal(meta.width, 768); assert.equal(meta.height, 1024);
  assert.equal(meta.format, 'png', `生成文件必须是 PNG，实际 ${meta.format}`);
  report.passed = true;
  report.run = run; report.file = file; report.dimensions = [meta.width, meta.height]; report.finishedAt = Date.now();
  await act({ type: 'window.workbench', page: 'illustration' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/comfy-live-result.png' });
  console.log('ComfyUI live PASS', JSON.stringify({ elapsedMs: run.elapsedMs, file, dimensions: report.dimensions }));
} catch (error) {
  report.error = String(error?.stack ?? error);
  if (page) await page.screenshot({ path: 'test-results/comfy-live-failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile('test-results/comfy-live.json', JSON.stringify(report, null, 2)).catch(() => {});
  await app.close().catch(() => {});
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', "$p=(Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if($p){Stop-Process -Id $p -Force; $p}"], { encoding: 'utf8' });
    if (out.trim()) console.log('stopped ComfyUI pid', out.trim());
  } catch {}
}

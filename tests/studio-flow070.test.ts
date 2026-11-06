import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { StudioManager } from '../src/main/studio/manager';
import type { StudioSettings } from '../src/shared/studio';

// 透明角色立绘（importCharacter 接受透明 PNG；生成时由项目 matte 填成绿底）。
const character = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 180, height: 360, channels: 4, background: { r: 245, g: 245, b: 250, alpha: 1 } } }).png().toBuffer(), left: 166, top: 120 }])
  .png().toBuffer();
// 绿色背景、周期性移动白块的 2 秒视频；用于完整云端模拟 → 抠像 → 发布链路。
const ffmpeg = path.resolve('dist/runtime/media/ffmpeg.exe');
const videoFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'studio-flow-video-')), 'raw.mp4');
const generated = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360:d=2:r=24', '-f', 'lavfi', '-i', 'color=c=white:s=120x120:d=2:r=24', '-filter_complex', "[0:v][1:v]overlay=x='100+60*sin(PI*t)':y=110", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv444p', videoFile], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);
const video = await readFile(videoFile);

const imageModel = { id: 'seedream-test', kind: 'image' as const, name: 'Seedream', price: 0.3, priceDate: '2026-01-01', source: 'https://www.volcengine.com/docs/ark/model-pricing', resolutions: ['720p'], durations: [2], imageSize: '2K', audioParameter: false };
const videoModel = { id: 'seedance-test', kind: 'video' as const, name: 'Seedance', price: 0.05, priceDate: '2026-01-01', source: 'https://www.volcengine.com/docs/ark/model-pricing', resolutions: ['720p'], durations: [2, 5], imageSize: '2K', audioParameter: false };
const settings: StudioSettings = { endpoint: 'https://ark.cn-beijing.volces.com/api/v3', models: [imageModel, videoModel], imageModel: imageModel.id, videoModel: videoModel.id, hasKey: false };

let videoSubmitFail = false, submitCount = 0, queryCount = 0, holdQuery = false;
const server = createServer(async (req, res) => {
  const chunks: Uint8Array[] = []; for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const json = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const pathname = new URL(req.url!, 'http://local').pathname;
  if (pathname.endsWith('/images/generations')) return json(200, { data: [{ b64_json: character.toString('base64') }], usage: { input_tokens: 100, output_tokens: 20 } });
  if (pathname.endsWith('/contents/generations/tasks') && req.method === 'POST') {
    if (videoSubmitFail) return json(503, { error: { code: 'ServiceUnavailable', message: 'fake upstream down' }, request_id: 'req-submit-fail' });
    submitCount++;
    return json(200, { id: `task-${submitCount}` });
  }
  if (pathname.includes('/contents/generations/tasks/') && req.method === 'GET') {
    queryCount++;
    if (holdQuery) return json(200, { status: 'running' });
    return json(200, { status: 'succeeded', content: { video_url: 'https://fake.local/raw.mp4' }, usage: { output_tokens: 500 } });
  }
  if (pathname === '/raw.mp4') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(video); }
  return json(404, { error: { code: 'NotFound', message: pathname } });
});
const port = await new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)));
const rewrite: typeof fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'fake.local' || url.hostname === 'ark.cn-beijing.volces.com') return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
  return fetch(input as any, init);
};

const home = await mkdtemp(path.join(os.tmpdir(), 'studio-flow-070-'));
const manager = new StudioManager({ home, binaries: path.resolve('dist'), dev: true, fetch: rewrite, key: async () => 'sk-test', saveKey: async () => undefined, changed: () => undefined, skin: () => undefined, profiles: () => [], modelKey: async () => '' });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitIdle = async () => { for (let i = 0; i < 800; i++) { if (!manager.state.busy) return; await sleep(50); } throw Error('等待制作完成超时'); };

test('studio end-to-end: image → confirm → video → review → publish', async () => {
  await manager.action({ type: 'studio.settings', settings, apiKey: 'sk-test' });
  const id = await manager.action({ type: 'studio.create', commandId: 'flow-a', description: '银白龙娘，正面站立，纯色背景' }) as string;
  await manager.action({ type: 'studio.update', id, patch: { motions: ['idle'], duration: 2, budget: 10, matte: { color: '#00ff00', similarity: .2, blend: 0, start: 0, end: 2 } } });
  await assert.rejects(manager.action({ type: 'studio.character.generate', id, commandId: 'image-low', budget: 0.1 }), /预算/);
  await manager.action({ type: 'studio.character.generate', id, commandId: 'image-a', budget: 1 });
  await waitIdle();
  const project = manager.state.projects.find(p => p.id === id)!;
  assert.ok(project.character, project.error);
  assert.equal(project.operations.find(o => o.stage === 'image')?.state, 'ready');
  // character() 会按立绘主色重设 matte；这里显式改回绿幕，与假视频背景一致。
  await manager.action({ type: 'studio.update', id, patch: { matte: { color: '#00ff00', similarity: .2, blend: 0, start: 0, end: 2 } } });
  await manager.action({ type: 'studio.character.confirm', id });
  await manager.action({ type: 'studio.update', id, patch: { budget: 0.01 } });
  await assert.rejects(manager.action({ type: 'studio.generate', id, commandId: 'video-low-2' }), /预算不足/);
  await manager.action({ type: 'studio.update', id, patch: { budget: 10 } });
  await manager.action({ type: 'studio.generate', id, commandId: 'video-a' });
  await waitIdle();
  assert.equal(project.error, undefined, project.error);
  assert.equal(project.status, 'review');
  const op = project.operations.find(o => o.stage === 'video')!;
  assert.equal(op.state, 'ready', op.error);
  assert.equal(op.quality?.passed, true, op.quality?.warnings.join('; '));
  assert.ok(op.result?.endsWith('animation.webm'));
  await manager.action({ type: 'studio.review', id, operationId: op.id, accepted: true });
  const skinId = await manager.action({ type: 'studio.publish', id }) as string;
  assert.equal(project.status, 'completed');
  assert.ok(manager.state.skins.some(s => s.id === skinId));
  await access(path.join(manager.root, 'skins', skinId, 'idle.webm'));
  const before = project.operations.length;
  assert.equal(await manager.action({ type: 'studio.generate', id, commandId: 'video-a' }), true);
  assert.equal(project.operations.length, before, '重复生成请求必须幂等');
});

test('unknown submission is held, can be resolved with a task id, and resumes without regeneration', async () => {
  const project = manager.state.projects[0];
  await manager.action({ type: 'studio.update', id: project.id, patch: { prompts: { ...project.prompts, idle: '新的待机动作描述' }, budget: 10 } });
  videoSubmitFail = true;
  await manager.action({ type: 'studio.generate', id: project.id, commandId: 'video-unknown' });
  await waitIdle();
  const failed = project.operations.at(-1)!;
  assert.equal(failed.state, 'unknown');
  assert.equal(failed.taskId, undefined);
  assert.ok(failed.reserved > 0, 'unknown submission keeps its reservation');
  await assert.rejects(manager.action({ type: 'studio.resume', id: project.id }), /无远端编号/);
  const submissions = submitCount;
  await assert.rejects(manager.action({ type: 'studio.resolve', id: project.id, operationId: failed.id, outcome: 'accepted', taskId: 'bad id!' }), /任务编号/);
  await manager.action({ type: 'studio.resolve', id: project.id, operationId: failed.id, outcome: 'accepted', taskId: 'task-999', note: '控制台核对' });
  assert.equal(failed.state, 'submitted');
  assert.equal(failed.taskId, 'task-999');
  videoSubmitFail = false;
  await manager.action({ type: 'studio.resume', id: project.id });
  await waitIdle();
  assert.equal(failed.state, 'ready', failed.error);
  assert.equal(submitCount, submissions, 'resume must query the recorded task, never resubmit');
});

test('confirmed-unaccepted unknown releases its reservation with an audit trail', async () => {
  const project = manager.state.projects[0];
  const reservedBefore = project.operations.reduce((sum, o) => sum + o.reserved, 0);
  await manager.action({ type: 'studio.update', id: project.id, patch: { prompts: { ...project.prompts, idle: '再次修改的待机描述' }, budget: 10 } });
  videoSubmitFail = true;
  await manager.action({ type: 'studio.generate', id: project.id, commandId: 'video-unknown-2' });
  await waitIdle();
  const failed = project.operations.at(-1)!;
  assert.equal(failed.state, 'unknown');
  const held = project.operations.reduce((sum, o) => sum + o.reserved, 0);
  assert.equal(held, reservedBefore + failed.reserved, 'unknown submission is reserved on top of prior spend');
  await manager.action({ type: 'studio.resolve', id: project.id, operationId: failed.id, outcome: 'not-accepted', note: '控制台无记录' });
  assert.equal(failed.state, 'cancelled');
  assert.equal(failed.reserved, 0);
  assert.equal(failed.manualReview?.outcome, 'not-accepted');
  assert.equal(project.operations.reduce((sum, o) => sum + o.reserved, 0), reservedBefore, 'unaccepted reservation is released');
  videoSubmitFail = false;
});

test('cancel during a running task resumes by querying the recorded task, not resubmitting', async () => {
  const project = manager.state.projects[0];
  await manager.action({ type: 'studio.update', id: project.id, patch: { prompts: { ...project.prompts, idle: '取消恢复的待机描述' }, budget: 10 } });
  const submissions = submitCount;
  holdQuery = true;
  await manager.action({ type: 'studio.generate', id: project.id, commandId: 'video-cancel' });
  for (let i = 0; i < 100 && !project.operations.at(-1)?.taskId; i++) await sleep(50);
  await manager.action({ type: 'studio.cancel', id: project.id });
  await waitIdle();
  const op = project.operations.at(-1)!;
  assert.equal(op.state, 'submitted');
  assert.ok(op.taskId);
  assert.equal(project.status, 'paused');
  assert.equal(submitCount, submissions + 1);
  holdQuery = false;
  await manager.action({ type: 'studio.resume', id: project.id });
  await waitIdle();
  assert.equal(op.state, 'ready', op.error);
  assert.equal(submitCount, submissions + 1, 'resume must not resubmit the canceled task');
});

after(() => new Promise<void>(resolve => server.close(() => resolve())));

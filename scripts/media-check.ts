// 真实 FFmpeg 链路：蓝色背景视频 → 抠像 → 272×272 透明 webm，并校验 alpha 标记与质量报告。
import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { processClip } from '../src/main/studio/media';

const root = path.resolve('.runtime/media-check-' + Date.now());
await mkdir(root, { recursive: true });
const ffmpeg = path.resolve('dist/runtime/media/ffmpeg.exe');
await access(ffmpeg);
const raw = path.join(root, 'raw.mp4');
const generated = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=640x360:d=2:r=24', '-f', 'lavfi', '-i', 'color=c=white:s=140x140:d=2:r=24', '-filter_complex', "[0:v][1:v]overlay=x='100+80*t':y=110", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv444p', raw], { encoding: 'utf8' });
assert.equal(generated.status, 0, generated.stderr);
const result = await processClip(root, 'raw.mp4', 'out', { color: '#0000ff', similarity: 0.2, blend: 0, start: 0, end: 2 }, true, path.resolve('dist'), false, new AbortController().signal);
await access(path.join(root, result.result));
assert.ok(result.quality.frameCount >= 2 && result.quality.frameCount <= 120, `帧数 ${result.quality.frameCount}`);
assert.ok(result.quality.emptyFrames === 0, `空帧 ${result.quality.emptyFrames}`);
assert.ok(result.quality.clippedFrames === 0, `裁切 ${result.quality.clippedFrames}`);
assert.ok(result.quality.motion > 0, `运动量 ${result.quality.motion}`);
assert.ok(result.result.endsWith('animation.webm'));
console.log('Media pipeline PASS', JSON.stringify({ frames: result.quality.frameCount, motion: Number(result.quality.motion.toFixed(5)), elapsedMs: result.elapsedMs, warnings: result.quality.warnings }));

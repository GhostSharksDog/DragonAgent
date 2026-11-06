// 桌宠动画质检：调用 Electron 真正解码 webm，按规范给出通过/警告。
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const executable = typeof electron === 'string' ? electron : electron.default?.path;
const probe = path.resolve('scripts/pet-clip-probe.cjs');
const root = path.resolve(process.argv[2] ?? 'assets/skins');

// 读取每个皮肤的动作表，用来判断哪些动作本来就该首尾不衔接。
const loops = new Map();
for (const skin of readdirSync(root, { withFileTypes: true })) {
  if (!skin.isDirectory()) continue;
  try {
    const json = JSON.parse(readFileSync(path.join(root, skin.name, 'skin.json'), 'utf8'));
    for (const entry of Object.values(json.videos ?? {})) loops.set(`${skin.name}/${entry.file}`, entry.loop !== false);
  } catch { /* 没有 skin.json 的目录跳过 */ }
}

const limits = {
  width: 640,
  height: 360,
  minDuration: 2,
  maxDuration: 12,
  maxBytes: 4 * 1024 * 1024,
  minAlpha: 0.05,
  maxAlpha: 0.6,
  maxLoopDiff: 0.08,
};

const rows = await new Promise((resolve, reject) => {
  const child = spawn(executable, [probe], { env: { ...process.env, CLIP_ROOT: root }, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', code => {
    const line = stdout.split('\n').find(value => value.startsWith('CLIP_JSON:'));
    if (!line) return reject(new Error(`质检脚本没有返回结果（退出码 ${code}）\n${stderr.slice(-800)}`));
    resolve(JSON.parse(line.slice('CLIP_JSON:'.length)));
  });
});

if (!rows.length) {
  console.log(`没有找到 webm 素材：${root}`);
  process.exit(0);
}

const issues = [];
const results = rows.map(row => {
  const notes = [];
  if (row.error) notes.push({ level: 'fail', text: row.error });
  else {
    if (row.width !== limits.width || row.height !== limits.height) notes.push({ level: 'warn', text: `画幅 ${row.width}×${row.height}，规范为 ${limits.width}×${limits.height}` });
    if (row.duration < limits.minDuration || row.duration > limits.maxDuration) notes.push({ level: 'warn', text: `时长 ${row.duration}s 超出 ${limits.minDuration}–${limits.maxDuration}s` });
    if (row.bytes > limits.maxBytes) notes.push({ level: 'warn', text: `体积 ${(row.bytes / 1024 / 1024).toFixed(1)} MB 超过 4 MB` });
    if (row.alphaRatio < limits.minAlpha) notes.push({ level: 'warn', text: `不透明像素仅 ${(row.alphaRatio * 100).toFixed(1)}%，主体可能太小或透明通道失效` });
    if (row.alphaRatio > limits.maxAlpha) notes.push({ level: 'warn', text: `不透明像素达 ${(row.alphaRatio * 100).toFixed(1)}%，背景可能没抠干净` });
    // 三段式（开始/结束段）本来就不该首尾衔接，只有循环动作才查跳变。
    const looping = loops.get(row.file) ?? !/(start|end)/i.test(row.file);
    if (looping && row.loopDiff > limits.maxLoopDiff) notes.push({ level: 'warn', text: `首尾帧差异 ${(row.loopDiff * 100).toFixed(1)}%，循环会跳` });
    if (row.box) {
      const margin = Math.min(row.box.left, row.box.top, row.width - 1 - row.box.right, row.height - 1 - row.box.bottom);
      if (margin < 2) notes.push({ level: 'warn', text: '主体贴边，缩放后容易被裁' });
    }
  }
  if (notes.some(note => note.level === 'fail')) issues.push(row.file);
  return { ...row, notes };
});

const pad = (value, width) => String(value).padEnd(width);
console.log(`素材目录 ${root}\n`);
console.log(pad('文件', 26) + pad('尺寸', 10) + pad('时长', 8) + pad('不透明', 9) + pad('首尾差', 9) + '结论');
for (const row of results) {
  const failed = row.notes.some(note => note.level === 'fail');
  const warned = row.notes.some(note => note.level === 'warn');
  const verdict = failed ? '失败' : warned ? `${row.notes.length} 项注意` : '通过';
  console.log(
    pad(row.file, 26)
    + pad(row.error ? '—' : `${row.width}×${row.height}`, 10)
    + pad(row.error ? '—' : `${row.duration}s`, 8)
    + pad(row.error ? '—' : `${(row.alphaRatio * 100).toFixed(1)}%`, 9)
    + pad(row.error ? '—' : `${(row.loopDiff * 100).toFixed(1)}%`, 9)
    + verdict,
  );
  for (const note of row.notes) console.log(`  ${note.level === 'fail' ? '✗' : '·'} ${note.text}`);
}

console.log(`\n共 ${results.length} 个素材，${issues.length} 个无法解码。`);
process.exit(issues.length ? 1 : 0);

import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
env.DRAGON_VERIFY_DIR = path.resolve(`.runtime/online-${version}`);
const started = Date.now();
const child = spawn(process.env.DRAGON_EXE || path.resolve('release/win-unpacked/DragonAgent.exe'), ['--verify-online'], { windowsHide: true, stdio: 'inherit', env });
child.on('exit', async code => {
  process.exitCode = code ?? 1;
  if (process.exitCode) return;
  try {
    const report = JSON.parse(await readFile(path.join(env.DRAGON_VERIFY_DIR, 'live-acceptance.json'), 'utf8'));
    if (Date.parse(report.date) < started) throw new Error('没有生成本次报告；请先退出正在运行的应用。');
    if (report.error || [...report.models, report.tavily, report.codex].some(r => r.status === 'failed')) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });

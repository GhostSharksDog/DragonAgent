import { spawn } from 'node:child_process';
import path from 'node:path';
const child = spawn(process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), process.env.DRAGON_EXE ? [] : ['.'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DRAGON_DATA_DIR: path.resolve(`.runtime/smoke-${Date.now()}`), DRAGON_SMOKE: '1' } });
let ready = false;
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; console.error('Desktop smoke timed out'); }, 90000);
child.stdout.on('data', data => { if (data.toString().includes('DRAGON_DESKTOP_READY')) { ready = true; console.log('Desktop + Dragon core ready'); } });
child.stderr.on('data', data => { const text = data.toString(); if (!/ExperimentalWarning|sqlite|GPU|cache/.test(text)) process.stderr.write(text); });
child.on('exit', code => { clearTimeout(timer); process.exitCode = ready && code === 0 ? 0 : 1; });

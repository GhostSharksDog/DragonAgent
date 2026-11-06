import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
execFileSync(process.execPath, ['node_modules/electron-builder/cli.js', '--projectDir', '.cache/package-app', '--config', '../../packaging.json', '--win', 'nsis', 'zip', '--x64'], { stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.resolve('.cache/electron-builder') } });
// 发行校验同时检查独立的 agent-core 库包；固定从这里生成，避免每次手工补包。
execFileSync('npm', ['pack', '--pack-destination', path.resolve('release', version)], { cwd: path.resolve('packages/agent-core'), stdio: 'inherit', shell: process.platform === 'win32' });

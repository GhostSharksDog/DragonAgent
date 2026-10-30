import { execFileSync } from 'node:child_process';
import path from 'node:path';
execFileSync(process.execPath, ['node_modules/electron-builder/cli.js', '--projectDir', '.cache/package-app', '--config', '../../packaging.json', '--win', 'nsis', 'zip', '--x64'], { stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE || path.resolve('.cache/electron-builder') } });

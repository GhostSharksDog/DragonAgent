import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
for (const relative of ['dist/main', 'dist/host', 'dist/assets', 'dist/licenses', 'dist/runtime/node']) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid clean path');
  await rm(target, { recursive: true, force: true });
}
await mkdir('packages/agent-core/dist', { recursive: true });
await Promise.all([
  ...['index', 'agent-worker'].map(name => build({ entryPoints: [`src/main/${name}.ts`], outfile: `dist/main/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node24', sourcemap: true })),
  build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' }),
  build({ entryPoints: ['packages/agent-core/src/index.ts', 'packages/agent-core/src/sqlite-store.ts'], outdir: 'packages/agent-core/dist', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true }),
  viteBuild({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true } }),
  cp('assets', 'dist/assets', { recursive: true, filter: source => !source.endsWith('Node.txt') }),
]);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/agent-core/tsconfig.build.json'], { stdio: 'inherit' });

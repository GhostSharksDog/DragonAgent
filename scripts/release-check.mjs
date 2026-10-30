import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const coreVersion = JSON.parse(await readFile('packages/agent-core/package.json', 'utf8')).version;
const release = path.resolve('release', version), app = path.join(release, 'win-unpacked/resources/app');
async function walk(root, relative = '') { const result = []; for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) { const name = path.join(relative, entry.name); if (entry.isDirectory()) result.push(...await walk(root, name)); else result.push(name); } return result; }
const files = await walk(app);
const prohibited = files.filter(file => /(^|[\\/])(?:@deepseek-ai|cordis|dsh|\.runtime)([\\/]|$)|(^|[\\/])node\.exe$|(^|[\\/])dist[\\/]host[\\/]|\.db(?:-|$)|(^|[\\/])auth\.json$/.test(file));
assert.deepEqual(prohibited, []);
const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8')); assert.equal(manifest.version, version);
assert(!Object.keys(manifest.dependencies).some(name => /deepseek-ai|cordis/.test(name)));
for (const file of ['dist/main/index.cjs', 'dist/main/agent-worker.cjs', 'dist/main/preload.cjs']) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), createHash('sha256').update(await readFile(path.join(app, file))).digest('hex'));
await access(path.join(app, 'dist/runtime/codex/bin/codex.exe'));
await access(path.join(app, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
await access(path.join(app, 'node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'));
const artifacts = [];
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const { NtExecutable, NtExecutableResource } = createRequire(builderRequire.resolve('app-builder-lib'))('resedit');
const iconSizes = [16,24,32,48,64,128,256];
const iconHashes = await Promise.all(iconSizes.map(async size => createHash('sha256').update(await readFile(`assets/branding/dragon-${size}.png`)).digest('hex')));
for (const filename of ['win-unpacked/DragonAgent.exe', `DragonAgent-Setup-${version}.exe`]) {
  const resources = NtExecutableResource.from(NtExecutable.from(await readFile(path.join(release, filename))));
  const hashes = resources.entries.filter(e => e.type === 3).map(e => createHash('sha256').update(Buffer.from(e.bin)).digest('hex'));
  assert(iconHashes.every(hash => hashes.includes(hash)), `${filename}: embedded avatar sizes must match master ICO`);
}
for (const name of [`DragonAgent-Setup-${version}.exe`, `DragonAgent-${version}-win.zip`, `dragon-agent-core-${coreVersion}.tgz`]) { const data = await readFile(path.join(release, name)); artifacts.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
await writeFile(path.join(release, 'SHA256SUMS.txt'), artifacts.map(a => `${a.sha256}  ${a.name}`).join('\n') + '\n');
await writeFile('test-results/release-check.json', JSON.stringify({ version: manifest.version, checkedAt: new Date().toISOString(), files: files.length, prohibited, compiledCodeMatches: true, embeddedAvatarSizes: iconSizes, artifacts }, null, 2));
console.log(JSON.stringify({ version: manifest.version, files: files.length, prohibited, compiledCodeMatches: true, artifacts }, null, 2));

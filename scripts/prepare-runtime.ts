import { cp, mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveCodex, CODEX_VERSION } from '../src/pet/main/agent/transport';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const executable = await resolveCodex();
const vendor = path.dirname(path.dirname(executable));
const packageInfo = JSON.parse(await readFile(path.join(vendor, 'codex-package.json'), 'utf8'));
await mkdir('dist/runtime', { recursive: true });
await cp(vendor, 'dist/runtime/codex', { recursive: true });
await mkdir('dist/licenses', { recursive: true });
await cp('node_modules/@modelcontextprotocol/sdk/LICENSE', 'dist/licenses/MCP-SDK-MIT.txt');
await cp('node_modules/.pnpm/node_modules/playwright-core/LICENSE', 'dist/licenses/Apache-2.0.txt');
await cp('node_modules/sharp/LICENSE', 'dist/licenses/Sharp-Apache-2.0.txt');
const sharpRequire = createRequire(createRequire(import.meta.url).resolve('sharp'));
const sharpNative = path.dirname(sharpRequire.resolve('@img/sharp-win32-x64/package'));
await cp(path.join(sharpNative, 'README.md'), 'dist/licenses/Sharp-native-NOTICE.md');
await cp(path.join(sharpNative, 'versions.json'), 'dist/licenses/Sharp-native-versions.json');
await cp('node_modules/yazl/LICENSE', 'dist/licenses/Yazl-MIT.txt');

/** 媒体工具随发行包分发：优先 DRAGON_FFMPEG_DIR，其次 PATH。开发构建不会调用本脚本。 */
function mediaSource(name: 'ffmpeg' | 'ffprobe') {
  const configured = process.env.DRAGON_FFMPEG_DIR;
  if (configured) {
    const file = path.join(configured, 'bin', `${name}.exe`);
    if (existsSync(file)) return file;
    throw new Error(`DRAGON_FFMPEG_DIR 中缺少 ${name}.exe：${configured}`);
  }
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const file = path.join(directory, `${name}.exe`);
    if (existsSync(file)) return file;
  }
  throw new Error(`未找到 ${name}.exe。发行包必须包含媒体工具；请设置 DRAGON_FFMPEG_DIR 指向 FFmpeg 构建目录。`);
}
const mediaRoot = 'dist/runtime/media';
await mkdir(mediaRoot, { recursive: true });
const media: Record<string, { version: string; sha256: string; bytes: number; license: string; source: string }> = {};
const mediaNotice: string[] = [];
for (const name of ['ffmpeg', 'ffprobe'] as const) {
  const source = mediaSource(name), target = path.join(mediaRoot, `${name}.exe`);
  await cp(source, target);
  const bytes = await readFile(target), hash = createHash('sha256').update(bytes).digest('hex');
  const line = String(execFileSync(source, ['-version'], { encoding: 'utf8' })).split(/\r?\n/)[0].trim();
  const buildRoot = path.dirname(path.dirname(source));
  const readme = await readFile(path.join(buildRoot, 'README.txt'), 'utf8').catch(() => '');
  const sourceUrl = /Source Code:\s*(\S+)/i.exec(readme)?.[1] ?? 'https://ffmpeg.org/download.html#get-sources';
  media[name] = { version: line, sha256: hash, bytes: (await stat(target)).size, license: 'GPL-3.0-or-later', source: sourceUrl };
  mediaNotice.push(`${name}: ${line}; GPL-3.0-or-later; source ${sourceUrl}; sha256 ${hash}`);
}
const mediaLicense = path.join(path.dirname(path.dirname(mediaSource('ffmpeg'))), 'LICENSE');
await cp(mediaLicense, 'dist/licenses/FFmpeg-GPL-3.0.txt');
const mediaReadme = path.join(path.dirname(path.dirname(mediaSource('ffmpeg'))), 'README.txt');
await cp(mediaReadme, 'dist/licenses/FFmpeg-build-README.txt');
await writeFile(path.join(mediaRoot, 'manifest.json'), JSON.stringify({ license: 'GPL-3.0-or-later', sourceOffer: media.ffmpeg.source, files: media }, null, 2));

await writeFile('dist/licenses/NOTICE.txt', `DragonAgent ${version}\nIndependent TypeScript Agent core. No DeepSeek Harness runtime dependency.\nCodex CLI ${CODEX_VERSION}: Apache-2.0; https://github.com/openai/codex\nPlaywright: Apache-2.0; https://github.com/microsoft/playwright\nSharp: Apache-2.0; https://github.com/lovell/sharp\nYazl: MIT; https://github.com/thejoshwolfe/yazl\nMCP TypeScript SDK: MIT; https://github.com/modelcontextprotocol/typescript-sdk\nElectron and Chromium: see LICENSE and LICENSES.chromium.html in application root.\nSilver dragon assets and renderer reused from the user's local dragon-pet project, unchanged.\n${mediaNotice.join('\n')}\nFFmpeg is distributed as a separate GPL-3.0-or-later executable; corresponding source is available at the URL above or on written request. Distribution obligations for the chosen build must be reviewed before publishing.\nBundled Codex package metadata: ${JSON.stringify(packageInfo)}\n`);
console.log(`Prepared native Codex ${CODEX_VERSION}, FFmpeg media tools and runtime notices.`);

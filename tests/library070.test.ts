import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import { exportSkin, importSkin } from '../src/main/studio/library';

const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
const manifest = { name: '测试皮肤', width: 32, height: 32, anchor: { x: 16, y: 30 }, animations: { idle: { frames: ['idle.png'], fps: 8, loop: true } } };
const manifestBuffer = Buffer.from(JSON.stringify(manifest));
const zip = (entries: Record<string, Uint8Array>) => Buffer.from(zipSync(entries));

test('skin import rejects zip-slip and missing manifests, leaving no extracted debris', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skin-import-'));
  const hostile = path.join(root, 'hostile.zip');
  await writeFile(hostile, zip({ 'skin.json': manifestBuffer, '../escape.png': png, 'idle.png': png }));
  await assert.rejects(importSkin(root, hostile, 'zip'), /路径|越界|素材/);
  await assert.rejects(access(path.join(root, 'escape.png')), 'zip-slip must not write outside the target');
  const empty = path.join(root, 'empty.zip');
  await writeFile(empty, zip({ 'readme.txt': Buffer.from('no skin') }));
  await assert.rejects(importSkin(root, empty, 'zip'), /skin\.json/);
});

test('skin import unwraps a single top-level folder and removes the duplicate copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skin-wrap-'));
  const archive = path.join(root, 'wrapped.zip');
  await writeFile(archive, zip({ 'pack/skin.json': manifestBuffer, 'pack/idle.png': png }));
  const skin = await importSkin(root, archive, 'zip');
  assert.equal(skin.manifest.name, '测试皮肤');
  assert.ok(skin.thumbnail?.endsWith('/idle.png'));
  const base = path.join(root, 'skins', skin.id);
  await access(path.join(base, 'skin.json'));
  await access(path.join(base, 'idle.png'));
  await assert.rejects(access(path.join(base, 'pack')), 'wrapper directory should be removed after resolution');
});

test('directory import exports and re-imports the same skin', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skin-roundtrip-'));
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'skin.json'), manifestBuffer);
  await writeFile(path.join(source, 'idle.png'), png);
  const first = await importSkin(root, source, 'directory');
  await access(path.join(source, 'skin.json'));
  await access(path.join(source, 'idle.png'));
  const archive = path.join(root, 'exported.zip');
  await exportSkin(root, first, archive);
  const second = await importSkin(root, archive, 'zip');
  assert.deepEqual(second.manifest, first.manifest);
  assert.notEqual(second.id, first.id);
  const base = path.join(root, 'skins', second.id);
  assert.deepEqual(await readFile(path.join(base, 'idle.png')), png);
});

test('flat zip import keeps the extracted files and never touches the archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skin-flat-'));
  const archive = path.join(root, 'flat.zip');
  const bytes = zip({ 'skin.json': manifestBuffer, 'idle.png': png });
  await writeFile(archive, bytes);
  const skin = await importSkin(root, archive, 'zip');
  const base = path.join(root, 'skins', skin.id);
  await access(path.join(base, 'skin.json'));
  await access(path.join(base, 'idle.png'));
  assert.deepEqual(await readFile(archive), bytes, 'archive remains unchanged');
});

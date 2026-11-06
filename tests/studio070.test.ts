import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArkClient, ArkFailure, settingsOf } from '../src/main/studio/ark';
import { StudioManager } from '../src/main/studio/manager';
import type { StudioSettings } from '../src/shared/studio';

const endpoint = 'https://ark.cn-beijing.volces.com/api/v3';
const baseSettings: StudioSettings = { endpoint, models: [], imageModel: '', videoModel: '', hasKey: true };
const videoModel = { id: 'seedance-1-0', kind: 'video' as const, name: 'Seedance', price: 0, priceDate: '2026-01-01', source: 'https://www.volcengine.com/docs/ark/model-pricing', resolutions: ['720p'], durations: [5], imageSize: '2K', audioParameter: false };

test('studio settings reject zero price, unverified dates and non-official sources', () => {
  assert.equal(settingsOf(baseSettings).hasKey, false);
  assert.throws(() => settingsOf({ ...baseSettings, models: [videoModel] }), /非零价格/);
  assert.throws(() => settingsOf({ ...baseSettings, models: [{ ...videoModel, price: 1, priceDate: '2026-13-40' }] }), /价格/);
  assert.throws(() => settingsOf({ ...baseSettings, models: [{ ...videoModel, price: 1, source: 'https://example.com/price' }] }), /方舟官方价格/);
  assert.throws(() => settingsOf({ ...baseSettings, endpoint: 'http://ark.cn-beijing.volces.com/api/v3' }), /方舟官方 HTTPS/);
  assert.equal(settingsOf({ ...baseSettings, models: [{ ...videoModel, price: 1 }] }).models[0].price, 1);
});

test('Ark errors expose provider code, message and request id without leaking keys', async () => {
  const body = JSON.stringify({ error: { code: 'ModelNotOpen', message: 'model not activated sk-abcdefgh12345678' }, request_id: 'req-123' });
  const client = new ArkClient(async () => new Response(body, { status: 400, headers: { 'x-request-id': 'hdr-1' } }), endpoint, 'sk-secret-12345678');
  await assert.rejects(client.request('/images/generations', new AbortController().signal, { model: 'x' }), (error: unknown) => {
    assert.ok(error instanceof ArkFailure);
    assert.equal(error.unknown, false);
    assert.match(error.message, /ModelNotOpen/);
    assert.match(error.message, /req-123/);
    assert.match(error.message, /不能确定|模型可能不支持|请检查/);
    assert.ok(!error.message.includes('sk-abcdefgh12345678') && !error.message.includes('sk-secret'));
    return true;
  });
});

test('Ark submission failures distinguish unknown from definite rejection', async () => {
  const server = new ArkClient(async () => new Response('upstream exploded', { status: 503 }), endpoint, 'sk-test');
  await assert.rejects(server.request('/contents/generations/tasks', new AbortController().signal, { model: 'x' }), (error: unknown) => {
    assert.ok(error instanceof ArkFailure);
    assert.equal(error.unknown, true, '5xx submission may have been accepted');
    assert.match(error.message, /HTTP 503/);
    return true;
  });
  const rejected = new ArkClient(async () => new Response('bad request', { status: 400 }), endpoint, 'sk-test');
  await assert.rejects(rejected.request('/contents/generations/tasks', new AbortController().signal, { model: 'x' }), (error: unknown) => {
    assert.ok(error instanceof ArkFailure);
    assert.equal(error.unknown, false, '4xx is a definite rejection');
    return true;
  });
  await assert.rejects(new ArkClient(async () => { throw new TypeError('network down'); }, endpoint, 'sk-test').request('/images/generations', new AbortController().signal, { model: 'x' }), (error: unknown) => {
    assert.ok(error instanceof ArkFailure);
    assert.equal(error.unknown, true);
    return true;
  });
});

test('studio.update only accepts whitelisted fields and invalidates confirmation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-070-'));
  const manager = new StudioManager({
    home, binaries: path.resolve('dist'), dev: true,
    fetch: async () => new Response('{}', { status: 200 }),
    key: async () => '', saveKey: async () => undefined, changed: () => undefined, skin: () => undefined,
    profiles: () => [], modelKey: async () => '',
  });
  const id = await manager.action({ type: 'studio.create', commandId: 'studio-test-1', description: '银白龙娘，正面站立，纯色背景' }) as string;
  const project = manager.state.projects.find(p => p.id === id)!;
  await manager.action({ type: 'studio.update', id, patch: { name: '新名字' } });
  assert.equal(project.name, '新名字');
  assert.equal(project.status, 'draft');
  assert.equal(project.id, id);
  await assert.rejects(manager.action({ type: 'studio.update', id, patch: { status: 'completed' } as any }), /不支持修改/);
  await assert.rejects(manager.action({ type: 'studio.update', id, patch: { operations: [] } as any }), /不支持修改/);
  assert.equal(project.status, 'draft');
  assert.ok(project.operations.length === 0);
  project.authorization = { id: 'old' } as any;
  await manager.action({ type: 'studio.update', id, patch: { prompt: '更新后的立绘提示词' } });
  assert.equal(project.authorization, undefined, 'plan changes must invalidate the confirmed budget');
  await assert.rejects(manager.action({ type: 'studio.update', id, patch: { duration: 6 } }), /制作参数无效/);
  await assert.rejects(manager.action({ type: 'studio.update', id, patch: { motions: ['idle', 'idle'] } }), /待机/);
});

test('builtin video skins get a real first-frame thumbnail', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'studio-thumb-'));
  const manager = new StudioManager({
    home, binaries: path.resolve('dist'), dev: true,
    fetch: async () => new Response('{}', { status: 200 }),
    key: async () => '', saveKey: async () => undefined, changed: () => undefined, skin: () => undefined,
    profiles: () => [], modelKey: async () => '',
  });
  await manager.init();
  assert.equal(manager.state.error, undefined);
  const fish = manager.state.skins.find(s => s.id === 'builtin-blue-fish')!;
  assert.ok(fish, 'blue-fish skin must be imported');
  assert.ok(fish.thumbnail?.includes('/thumbnail.png'), `video skin thumbnail missing: ${fish.thumbnail}`);
  await access(path.join(manager.root, 'skins', 'builtin-blue-fish', 'thumbnail.png'));
});

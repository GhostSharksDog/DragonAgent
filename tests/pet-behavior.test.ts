import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, initialState } from '../src/main/store';
import { Runtime } from '../src/main/runtime';
import {
  DEFAULT_PET_BEHAVIOR,
  PET_BEHAVIOR_LIMITS,
  PET_BEHAVIOR_PRESETS,
  validPetBehavior,
} from '../src/shared/pet-behavior';
import { videoNeedsFlip } from '../src/pet/shared/video';

test('PetBehavior defaults cover a missing field and clamp every range', () => {
  assert.deepEqual(validPetBehavior(undefined), DEFAULT_PET_BEHAVIOR);
  const normalized = validPetBehavior({
    enabled: false,
    firstDelayMinSec: 600,
    firstDelayMaxSec: 10,
    intervalMinSec: 1_800,
    intervalMaxSec: 30,
    speed: 99,
    distancePx: 1,
    rounds: 9,
    wake: false,
  });
  assert.deepEqual(normalized, {
    enabled: false,
    firstDelayMinSec: 10,
    firstDelayMaxSec: 600,
    intervalMinSec: 30,
    intervalMaxSec: 1_800,
    speed: PET_BEHAVIOR_LIMITS.speed.max,
    distancePx: PET_BEHAVIOR_LIMITS.distancePx.min,
    rounds: PET_BEHAVIOR_LIMITS.rounds.max,
    runChancePct: DEFAULT_PET_BEHAVIOR.runChancePct,
    wake: false,
  });
});

test('presets are valid and standard matches the default', () => {
  for (const preset of Object.values(PET_BEHAVIOR_PRESETS)) {
    assert.deepEqual(validPetBehavior(preset), preset);
  }
  assert.deepEqual(PET_BEHAVIOR_PRESETS.standard, DEFAULT_PET_BEHAVIOR);
  assert.deepEqual(validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 999 }), { ...DEFAULT_PET_BEHAVIOR, runChancePct: 100 });
});

test('old behavior records gain the 20% run chance without migration', () => {
  const old = { ...DEFAULT_PET_BEHAVIOR } as Partial<typeof DEFAULT_PET_BEHAVIOR>;
  delete old.runChancePct;
  assert.equal(validPetBehavior(old).runChancePct, 20);
  assert.equal(validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: -10 }).runChancePct, 0);
});

test('old stores gain default behavior without a schema version bump', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-behavior-store-'));
  const store = new Store(dir);
  const old = initialState();
  delete (old.settings.pet as Partial<typeof old.settings.pet>).behavior;
  store.save(old);
  store.close();
  const reloaded = new Store(dir).load();
  assert.deepEqual(reloaded.settings.pet.behavior, DEFAULT_PET_BEHAVIOR);
});

test('pet.behavior can be saved while a task is running and still validates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dragon-behavior-runtime-'));
  const store = new Store(dir);
  const runtime = new Runtime(store, { get: async () => '', set: async () => {}, remove() {} } as any, { home: dir, workerPath: '', open: async () => {} });
  runtime.state.sessions.push({ status: 'running' } as any);
  const result = await runtime.action({
    type: 'pet.behavior',
    behavior: { ...DEFAULT_PET_BEHAVIOR, speed: 99, distancePx: 1, rounds: 0, wake: false },
  });
  assert.equal(result, true);
  assert.equal(runtime.state.settings.pet.behavior.speed, PET_BEHAVIOR_LIMITS.speed.max);
  assert.equal(runtime.state.settings.pet.behavior.distancePx, PET_BEHAVIOR_LIMITS.distancePx.min);
  assert.equal(runtime.state.settings.pet.behavior.rounds, PET_BEHAVIOR_LIMITS.rounds.min);
  assert.equal(runtime.state.settings.pet.behavior.wake, false);
  await assert.rejects(runtime.action({ type: 'settings.save', theme: 'dark' }), /停止/);
  assert.equal(runtime.snapshot().settings.pet.behavior.speed, PET_BEHAVIOR_LIMITS.speed.max);
  await runtime.dispose();
});

test('default blue-fish left legs keep the left-facing source and right legs mirror it', async () => {
  const skin = JSON.parse(await readFile(path.resolve('assets/skins/blue-fish/skin.json'), 'utf8')) as {
    videos: Record<string, { file: string; flipX?: boolean }>;
  };
  assert.equal(skin.videos['running-left'].file, 'run.webm');
  assert.equal(skin.videos['running-right'].file, 'run.webm');
  assert.equal(skin.videos['running-left'].flipX, undefined);
  assert.equal(skin.videos['running-right'].flipX, true);
  assert.equal(skin.videos['walking-left'].file, 'walk-left.webm');
  assert.equal(skin.videos['walking-right'].file, 'walk-left.webm');
  assert.equal(skin.videos['walking-left'].flipX, undefined);
  assert.equal(skin.videos['walking-right'].flipX, true);
  assert.equal(videoNeedsFlip(skin.videos['running-left'].flipX, false), false);
  assert.equal(videoNeedsFlip(skin.videos['running-right'].flipX, false), true);
});

test('an absent flipX means use the source unchanged, not mirror it', () => {
  assert.equal(videoNeedsFlip(undefined, false), false);
  assert.equal(videoNeedsFlip(undefined, true), true);
  assert.equal(videoNeedsFlip(true, false), true);
  assert.equal(videoNeedsFlip(false, true), true);
  assert.equal(videoNeedsFlip(false, false), false);
});

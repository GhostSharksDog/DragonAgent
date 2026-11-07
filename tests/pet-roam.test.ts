import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStartDirection, planRoam, roamDelay } from '../src/pet/shared/roam';
import { DEFAULT_PET_BEHAVIOR, validPetBehavior } from '../src/shared/pet-behavior';

/** 固定种子的伪随机，保证计划测试可复现。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const both = { walking: true, running: true };

test('空闲跑动计划左右交替，去回成对等长', () => {
  for (let index = 0; index < 50; index += 1) {
    const legs = planRoam('running', DEFAULT_PET_BEHAVIOR, seeded(index + 1));
    assert.equal(legs.length, 2);
    for (let leg = 0; leg < legs.length; leg += 2) {
      assert.notEqual(legs[leg].direction, legs[leg + 1].direction);
      assert.equal(legs[leg].duration, legs[leg + 1].duration);
      assert.equal(legs[leg].distance, legs[leg + 1].distance);
      assert.ok(legs[leg].duration > 900 && legs[leg].duration <= 1_250, `跑动时长异常：${legs[leg].duration}`);
    }
  }
});

test('只有行走动作的皮肤也能生成较慢的跑动计划', () => {
  for (let index = 0; index < 50; index += 1) {
    const legs = planRoam('walking', DEFAULT_PET_BEHAVIOR, seeded(index + 7));
    for (let leg = 0; leg < legs.length; leg += 2) {
      assert.notEqual(legs[leg].direction, legs[leg + 1].direction);
      assert.equal(legs[leg].duration, legs[leg + 1].duration);
      assert.equal(legs[leg].distance, legs[leg + 1].distance);
      assert.ok(legs[leg].duration > 3_000, `行走时长异常：${legs[leg].duration}`);
    }
  }
});

test('100% 跑步概率时去程先走一段再切跑，回程始终慢走', () => {
  const behavior = validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 100 });
  const legs = planRoam(both, behavior, seeded(21), 'left');
  assert.equal(legs.length, 2);
  const outbound = legs[0];
  assert.deepEqual(outbound.phases.map(phase => phase.motion), ['walking', 'running']);
  assert.ok(outbound.phases[0].distance > 0 && outbound.phases[0].distance < outbound.distance);
  assert.ok(outbound.phases[0].duration >= 1_000, `走路起步太短：${outbound.phases[0].duration}`);
  assert.equal(outbound.phases.reduce((sum, phase) => sum + phase.distance, 0), outbound.distance);
  assert.equal(legs[1].direction, 'right');
  assert.deepEqual(legs[1].phases.map(phase => phase.motion), ['walking']);
  assert.equal(legs[1].phases[0].distance, legs[1].distance);
});

test('0% 跑步概率时全程慢走，回程也不加速', () => {
  const behavior = validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 0 });
  const legs = planRoam(both, behavior, seeded(22));
  for (const leg of legs) assert.deepEqual(leg.phases.map(phase => phase.motion), ['walking']);
});

test('默认约 20% 的去程会切换跑步', () => {
  let running = 0;
  const behavior = validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 20 });
  for (let index = 0; index < 1_000; index += 1) {
    const legs = planRoam(both, behavior, seeded(index + 100));
    if (legs[0].phases.some(phase => phase.motion === 'running')) running += 1;
  }
  assert.ok(running >= 140 && running <= 260, `20% 概率实际命中 ${running}/1000`);
});

test('缺少走路动作时回退跑步，缺少跑步动作时全程慢走', () => {
  const onlyRun = planRoam({ walking: false, running: true }, validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 100 }), seeded(31));
  assert.ok(onlyRun.every(leg => leg.phases.every(phase => phase.motion === 'running')));
  const onlyWalk = planRoam({ walking: true, running: false }, validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, runChancePct: 100 }), seeded(32));
  assert.ok(onlyWalk.every(leg => leg.phases.every(phase => phase.motion === 'walking')));
  assert.deepEqual(planRoam({ walking: false, running: false }, DEFAULT_PET_BEHAVIOR, seeded(33)), []);
});

test('速度倍率让单腿时长成比例缩短', () => {
  const slow = planRoam('running', validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, speed: 1 }), seeded(42));
  const fast = planRoam('running', validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, speed: 2 }), seeded(42));
  assert.equal(slow[0].distance, fast[0].distance);
  assert.ok(Math.abs(slow[0].duration / fast[0].duration - 2) < .02, `${slow[0].duration} / ${fast[0].duration}`);
});

test('单程距离配置改变路线长度', () => {
  const short = planRoam('running', validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, distancePx: 120 }), seeded(9));
  const long = planRoam('running', validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, distancePx: 400 }), seeded(9));
  assert.ok(short[0].distance <= 120 && short[0].distance >= 110);
  assert.ok(long[0].distance <= 400 && long[0].distance >= 368);
  assert.ok(long[0].duration > short[0].duration * 2.5);
});

test('来回数 1/2/3 生成 2/4/6 条腿', () => {
  for (const rounds of [1, 2, 3]) {
    const legs = planRoam(both, validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, rounds, runChancePct: 100 }), seeded(5));
    assert.equal(legs.length, rounds * 2);
    for (let leg = 0; leg < legs.length; leg += 2) {
      assert.notEqual(legs[leg].direction, legs[leg + 1].direction);
      assert.ok(legs[leg].phases.some(phase => phase.motion === 'running'));
      assert.deepEqual(legs[leg + 1].phases.map(phase => phase.motion), ['walking']);
    }
  }
});

test('起跑方向避开太窄的一侧', () => {
  const direction = (screenX: number, availWidth: number) => chooseStartDirection(screenX, 112, 0, availWidth, () => 0.4);
  assert.equal(direction(1780, 1920), 'left', '右侧只剩 28px 时应向左跑');
  assert.equal(direction(0, 1920), 'right', '贴左边时应向右跑');
  assert.equal(direction(100, 800), 'right', '左边只剩 100px 时应向右跑');
  assert.equal(direction(400, 800), 'left', '右边只剩 288px 时应向左跑');
  assert.equal(direction(50, 400), 'right', '两侧都窄时选空间更大的一侧');
});

test('大距离在狭窄屏幕仍选择空间更大的一侧', () => {
  assert.equal(chooseStartDirection(50, 112, 0, 400, () => 0.4, 500), 'right');
  assert.equal(chooseStartDirection(300, 112, 0, 400, () => 0.4, 500), 'left');
});

test('两侧都宽时保留随机左右', () => {
  assert.equal(chooseStartDirection(900, 112, 0, 1920, () => 0.2), 'left');
  assert.equal(chooseStartDirection(900, 112, 0, 1920, () => 0.8), 'right');
});

test('显式起跑方向用于第一条腿', () => {
  const left = planRoam('running', DEFAULT_PET_BEHAVIOR, seeded(3), 'left');
  assert.equal(left[0].direction, 'left');
  assert.equal(left[1].direction, 'right');
  const right = planRoam('running', DEFAULT_PET_BEHAVIOR, seeded(4), 'right');
  assert.equal(right[0].direction, 'right');
  assert.equal(right[1].direction, 'left');
});

test('首次等待与后续间隔读取配置范围', () => {
  const behavior = validPetBehavior({ ...DEFAULT_PET_BEHAVIOR, firstDelayMinSec: 10, firstDelayMaxSec: 20, intervalMinSec: 30, intervalMaxSec: 60 });
  for (let index = 0; index < 50; index += 1) {
    const first = roamDelay(true, behavior, seeded(index + 11));
    const later = roamDelay(false, behavior, seeded(index + 19));
    assert.ok(first >= 10_000 && first <= 20_000, `首次间隔异常：${first}`);
    assert.ok(later >= 30_000 && later <= 60_000, `冷却间隔异常：${later}`);
  }
});

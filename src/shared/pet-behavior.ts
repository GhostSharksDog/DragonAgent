/**
 * 桌宠空闲行为配置。
 *
 * 这是一套全局配置：所有皮肤共用节奏与速度，左右朝向仍由皮肤自己的
 * walking-* / running-* 映射和 flipX 决定。
 */
export interface PetBehavior {
  /** 关闭后不再自动跑动；手动方向键仍可用。 */
  enabled: boolean;
  /** 启动后第一次跑动的等待范围，单位秒。 */
  firstDelayMinSec: number;
  firstDelayMaxSec: number;
  /** 跑完一次后的冷却范围，单位秒。 */
  intervalMinSec: number;
  intervalMaxSec: number;
  /** 窗口位移和视频播放速度的倍率，1 为基准。 */
  speed: number;
  /** 单程目标距离，单位像素（实际会在 92%–100% 之间轻微随机）。 */
  distancePx: number;
  /** 每次跑动的来回数；1 表示去、回各一次。 */
  rounds: number;
  /** 单次去程使用“先走再跑”的概率，单位百分比；回程始终慢走。 */
  runChancePct: number;
  /** 睡觉时是否允许被空闲跑动叫醒。 */
  wake: boolean;
}

export const PET_BEHAVIOR_LIMITS = {
  firstDelaySec: { min: 0, max: 600 },
  intervalSec: { min: 30, max: 1_800 },
  speed: { min: 0.5, max: 2 },
  distancePx: { min: 80, max: 400 },
  rounds: { min: 1, max: 3 },
  runChancePct: { min: 0, max: 100 },
} as const;

export const DEFAULT_PET_BEHAVIOR: PetBehavior = {
  enabled: true,
  firstDelayMinSec: 60,
  firstDelayMaxSec: 120,
  intervalMinSec: 240,
  intervalMaxSec: 480,
  speed: 1,
  distancePx: 240,
  rounds: 1,
  runChancePct: 20,
  wake: true,
};

export type PetBehaviorPresetId = 'calm' | 'standard' | 'lively';

export const PET_BEHAVIOR_PRESETS: Record<PetBehaviorPresetId, PetBehavior> = {
  calm: {
    enabled: true,
    firstDelayMinSec: 180,
    firstDelayMaxSec: 300,
    intervalMinSec: 600,
    intervalMaxSec: 1_200,
    speed: 0.8,
    distancePx: 180,
    rounds: 1,
    runChancePct: 0,
    wake: false,
  },
  standard: { ...DEFAULT_PET_BEHAVIOR },
  lively: {
    enabled: true,
    firstDelayMinSec: 20,
    firstDelayMaxSec: 45,
    intervalMinSec: 60,
    intervalMaxSec: 180,
    speed: 1.5,
    distancePx: 300,
    rounds: 2,
    runChancePct: 45,
    wake: true,
  },
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

/**
 * 主进程和渲染端共用同一套收敛逻辑。旧版本没有 behavior 时补齐默认值；
 * 越界值被夹到允许范围，最小值大于最大值时交换，避免调度器拿到负区间。
 */
export function validPetBehavior(raw?: Partial<PetBehavior> | null): PetBehavior {
  const d = DEFAULT_PET_BEHAVIOR;
  let firstDelayMinSec = clamp(finite(raw?.firstDelayMinSec, d.firstDelayMinSec), PET_BEHAVIOR_LIMITS.firstDelaySec.min, PET_BEHAVIOR_LIMITS.firstDelaySec.max);
  let firstDelayMaxSec = clamp(finite(raw?.firstDelayMaxSec, d.firstDelayMaxSec), PET_BEHAVIOR_LIMITS.firstDelaySec.min, PET_BEHAVIOR_LIMITS.firstDelaySec.max);
  let intervalMinSec = clamp(finite(raw?.intervalMinSec, d.intervalMinSec), PET_BEHAVIOR_LIMITS.intervalSec.min, PET_BEHAVIOR_LIMITS.intervalSec.max);
  let intervalMaxSec = clamp(finite(raw?.intervalMaxSec, d.intervalMaxSec), PET_BEHAVIOR_LIMITS.intervalSec.min, PET_BEHAVIOR_LIMITS.intervalSec.max);
  if (firstDelayMinSec > firstDelayMaxSec) [firstDelayMinSec, firstDelayMaxSec] = [firstDelayMaxSec, firstDelayMinSec];
  if (intervalMinSec > intervalMaxSec) [intervalMinSec, intervalMaxSec] = [intervalMaxSec, intervalMinSec];
  const speed = Math.round(clamp(finite(raw?.speed, d.speed), PET_BEHAVIOR_LIMITS.speed.min, PET_BEHAVIOR_LIMITS.speed.max) * 10) / 10;
  const distancePx = Math.round(clamp(finite(raw?.distancePx, d.distancePx), PET_BEHAVIOR_LIMITS.distancePx.min, PET_BEHAVIOR_LIMITS.distancePx.max));
  const rounds = Math.round(clamp(finite(raw?.rounds, d.rounds), PET_BEHAVIOR_LIMITS.rounds.min, PET_BEHAVIOR_LIMITS.rounds.max));
  const runChancePct = Math.round(clamp(finite(raw?.runChancePct, d.runChancePct), PET_BEHAVIOR_LIMITS.runChancePct.min, PET_BEHAVIOR_LIMITS.runChancePct.max));
  return {
    enabled: boolean(raw?.enabled, d.enabled),
    firstDelayMinSec,
    firstDelayMaxSec,
    intervalMinSec,
    intervalMaxSec,
    speed,
    distancePx,
    rounds,
    runChancePct,
    wake: boolean(raw?.wake, d.wake),
  };
}

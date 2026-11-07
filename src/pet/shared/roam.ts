import { DEFAULT_PET_BEHAVIOR, type PetBehavior } from '../../shared/pet-behavior';

export type RoamMotion = 'walking' | 'running';
export type RoamDirection = 'left' | 'right';
export interface RoamMotions { walking: boolean; running: boolean }
export interface RoamPhase { motion: RoamMotion; duration: number; distance: number }
export interface RoamLeg { direction: RoamDirection; duration: number; distance: number; phases: RoamPhase[] }

/** 基准位移步长与 tick 间隔；速度倍率在运行时统一乘上去。 */
export const ROAM_STEP_PX: Record<RoamMotion, number> = { walking: 3, running: 6 };
export const ROAM_TICK_MS: Record<RoamMotion, number> = { walking: 55, running: 30 };

/** 去程先播约一段走路动作，再决定是否切换跑步。 */
export const ROAM_WALK_LEAD_MS = 1_200;

/** 跑动单腿最远约 320px；留一点余量，避免起跑就撞到屏幕边缘。 */
export const ROAM_CLEARANCE = 340;

/**
 * 根据目标距离和速度计算单腿时长。距离来自配置，速度同时影响窗口步长
 * 和视频 playbackRate，因此这里的“每秒像素”与播放节奏保持一致。
 */
export function roamLegDuration(motion: RoamMotion, distance: number, speed: number): number {
  const speedValue = Math.max(0.5, Math.min(2, Number.isFinite(speed) ? speed : 1));
  const pxPerMs = ROAM_STEP_PX[motion] * speedValue / ROAM_TICK_MS[motion];
  return Math.max(250, Math.min(15_000, Math.round(Math.max(1, distance) / pxPerMs)));
}

function normalizeMotions(value: RoamMotion | RoamMotions): RoamMotions {
  if (typeof value === 'string') return { walking: value === 'walking', running: value === 'running' };
  return { walking: !!value.walking, running: !!value.running };
}

/**
 * 生成一轮路线。去程按 runChancePct 决定是否“先走一段再跑”，回程始终慢走；
 * 没有走路动作时回退为跑，没有跑步动作时全程慢走。每腿的 phases 距离之和
 * 等于该腿 distance，方便窗口位移和回位校验。
 */
export function planRoam(
  source: RoamMotion | RoamMotions,
  behavior: PetBehavior = DEFAULT_PET_BEHAVIOR,
  random: () => number = Math.random,
  firstDirection?: RoamDirection,
): RoamLeg[] {
  const motions = normalizeMotions(source);
  if (!motions.walking && !motions.running) return [];
  const rounds = Math.max(1, Math.min(3, Math.round(behavior.rounds)));
  // 单程距离只在 92%–100% 之间轻微随机，既保留自然感，也不会超过配置上限。
  const distance = Math.max(1, Math.round(behavior.distancePx * (0.92 + random() * 0.08)));
  const chance = Math.max(0, Math.min(100, Number.isFinite(behavior.runChancePct) ? behavior.runChancePct : DEFAULT_PET_BEHAVIOR.runChancePct));
  const walkLead = Math.max(1, Math.min(distance, Math.round(ROAM_STEP_PX.walking * Math.max(.5, Math.min(2, behavior.speed)) / ROAM_TICK_MS.walking * ROAM_WALK_LEAD_MS)));
  let direction: RoamDirection = firstDirection ?? (random() < 0.5 ? 'left' : 'right');
  const legs: RoamLeg[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const outbound = true;
    const phases: RoamPhase[] = [];
    const wantsRun = outbound && motions.walking && motions.running && random() * 100 < chance;
    if (wantsRun) {
      const walkDistance = walkLead < distance ? walkLead : distance;
      if (walkDistance > 0) phases.push({ motion: 'walking', distance: walkDistance, duration: roamLegDuration('walking', walkDistance, behavior.speed) });
      const runDistance = distance - walkDistance;
      if (runDistance > 0) phases.push({ motion: 'running', distance: runDistance, duration: roamLegDuration('running', runDistance, behavior.speed) });
    } else {
      const motion: RoamMotion = motions.walking ? 'walking' : 'running';
      phases.push({ motion, distance, duration: roamLegDuration(motion, distance, behavior.speed) });
    }
    const backDirection: RoamDirection = direction === 'left' ? 'right' : 'left';
    const backMotion: RoamMotion = motions.walking ? 'walking' : 'running';
    legs.push({ direction, distance, duration: phases.reduce((sum, phase) => sum + phase.duration, 0), phases });
    legs.push({ direction: backDirection, distance, duration: roamLegDuration(backMotion, distance, behavior.speed), phases: [{ motion: backMotion, distance, duration: roamLegDuration(backMotion, distance, behavior.speed) }] });
    direction = backDirection;
  }
  return legs;
}

/**
 * 起跑方向优先选空间更大的一侧：桌宠常停在屏幕右下角，若先朝右跑会顶着边界原地踏步。
 * 两侧都够宽时再随机，保留左右来回的自然感。clearance 由配置距离决定。
 */
export function chooseStartDirection(screenX: number, windowWidth: number, availLeft: number, availWidth: number, random: () => number = Math.random, clearance = ROAM_CLEARANCE): RoamDirection {
  const leftSpace = screenX - availLeft;
  const rightSpace = availLeft + availWidth - screenX - windowWidth;
  if (rightSpace < clearance && leftSpace >= clearance) return 'left';
  if (leftSpace < clearance && rightSpace >= clearance) return 'right';
  if (leftSpace < clearance && rightSpace < clearance) return leftSpace >= rightSpace ? 'left' : 'right';
  return random() < 0.5 ? 'left' : 'right';
}

/** 首次/后续等待读取用户配置；测试窗口的 roamAfter / roamGap 在调用方优先。 */
export function roamDelay(first: boolean, behavior: PetBehavior = DEFAULT_PET_BEHAVIOR, random: () => number = Math.random): number {
  const min = first ? behavior.firstDelayMinSec : behavior.intervalMinSec;
  const max = first ? behavior.firstDelayMaxSec : behavior.intervalMaxSec;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.round((low + random() * Math.max(0, high - low)) * 1000);
}

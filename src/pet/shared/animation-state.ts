import type { Activity, SkinManifest } from './types';

type Motion = 'idle' | 'walking' | 'running';
type Direction = 'left' | 'right';

/** The clock follows the action actually drawn, including an idle fallback. */
export function effectiveAnimationKey(manifest: SkinManifest | null | undefined, activity: Activity, motion: Motion, direction: Direction): string {
  const state = activity === 'idle' ? motion : activity;
  const requested = state === 'walking' || state === 'running' ? `${state}-${direction}` : state;
  return manifest?.rig || manifest?.animations[requested] || manifest?.videos?.[requested] ? requested : 'idle';
}

/**
 * 空闲跑动可用的动作集合。骨骼皮肤仍不参与自动跑动（窗口移动时无法同步
 * 方向），有走路/跑步任一侧成对动作即可出发。
 */
export function availableRoamMotions(manifest: SkinManifest | null | undefined): { walking: boolean; running: boolean } {
  if (!manifest || manifest.rig) return { walking: false, running: false };
  const has = (key: string) => !!(manifest.animations[key] || manifest.videos?.[key]);
  return {
    walking: has('walking-left') && has('walking-right'),
    running: has('running-left') && has('running-right'),
  };
}

/** 兼容旧调用：返回优先动作；新代码应使用 availableRoamMotions 保留走/跑两种能力。 */
export function roamingAnimationMotion(manifest: SkinManifest | null | undefined): Exclude<Motion, 'idle'> | null {
  const motions = availableRoamMotions(manifest);
  if (motions.walking) return 'walking';
  if (motions.running) return 'running';
  return null;
}

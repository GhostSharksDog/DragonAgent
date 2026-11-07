/**
 * 桌宠动作的集中清单与回退。
 *
 * 皮肤可能只提供其中一部分动作；请求缺失的动作时统一回退到 idle，
 * 并只提醒一次，避免视频逐帧渲染时把控制台刷满。
 */
export const PET_ACTION_KEYS = [
  'idle',
  'walking-left',
  'walking-right',
  'running-left',
  'running-right',
  'thinking',
  'speaking',
  'awaiting-input',
  'awaiting-approval',
  'success',
  'error',
  'drag',
  'click',
  'sleep-start',
  'sleep-loop',
  'sleep-end',
] as const;

export type PetActionKey = (typeof PET_ACTION_KEYS)[number];

const warned = new Set<string>();

export function resolveVideoKey(videos: Record<string, unknown> | undefined, requested: string): string {
  if (!videos || videos[requested]) return requested;
  if (!videos.idle) return requested;
  if (!warned.has(requested)) {
    warned.add(requested);
    console.warn(`[pet] 皮肤缺少动作 ${requested}，已回退 idle。`);
  }
  return 'idle';
}

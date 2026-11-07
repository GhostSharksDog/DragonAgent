import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '../shared/types';
import { availableRoamMotions, effectiveAnimationKey } from '../shared/animation-state';
import { chooseStartDirection, planRoam, roamDelay, ROAM_CLEARANCE, ROAM_STEP_PX, ROAM_TICK_MS } from '../shared/roam';
import { DEFAULT_PET_BEHAVIOR, type PetBehavior, validPetBehavior } from '../../shared/pet-behavior';
import { resolveVideoKey } from '../shared/action-registry';
import { Egg } from './icons';
import { RigCanvas } from './RigCanvas';
import { FrameSprite } from './FrameSprite';
import { VideoSprite } from './VideoSprite';
import { PetClickController } from './pet-click-controller';

/** 完全静止多久开始打盹；测试窗口可通过 sleepAfter 参数缩短。 */
const sleepParam = Number(new URLSearchParams(location.search).get('sleepAfter'));
const SLEEP_AFTER_MS = Number.isFinite(sleepParam) && sleepParam >= 600 ? sleepParam : 180_000;

/** 测试窗口可通过 roamAfter / roamGap 缩短首次跑动与冷却时间。 */
const roamParam = Number(new URLSearchParams(location.search).get('roamAfter'));
const ROAM_FIRST_MS = Number.isFinite(roamParam) && roamParam >= 500 ? roamParam : null;
const roamGapParam = Number(new URLSearchParams(location.search).get('roamGap'));
const ROAM_GAP_MS = Number.isFinite(roamGapParam) && roamGapParam >= 1000 ? roamGapParam : null;
const firstRoamDelay = (behavior: PetBehavior) => ROAM_FIRST_MS ?? roamDelay(true, behavior);
const laterRoamDelay = (behavior: PetBehavior) => ROAM_GAP_MS ?? roamDelay(false, behavior);

type Travel = { motion: 'walking' | 'running'; direction: 'left' | 'right' };

export const activityLabels: Record<AppSnapshot['assistant']['activity'], string> = {
  idle: '在这里，随时叫我', walking: '慢走中', running: '跑动中', thinking: '正在想办法…', speaking: '正在回复你…', 'awaiting-input': '有件事想问你', 'awaiting-approval': '需要你的批准', success: '已经完成啦', error: '需要处理一下',
};

export function Pet({ snapshot }: { snapshot: AppSnapshot | null }) {
  const latest = useRef(snapshot); latest.current = snapshot;
  const gesture = useRef<PetClickController | null>(null);
  const delta = useRef({ x: 0, y: 0 });
  const moving = useRef(false);
  const rigStarted = useRef(Date.now());
  const [error, setError] = useState(false);
  const inputAt = useRef(0);
  const [failedFrame, setFailedFrame] = useState(false);
  const [sleep, setSleep] = useState<'awake' | 'start' | 'loop' | 'end'>('awake');
  const [finishedShot, setFinishedShot] = useState<string | null>(null);
  // 点击/拖动的即时反馈，优先级高于任务状态，播完或松手就撤。
  const [localAction, setLocalAction] = useState<'click' | 'drag' | null>(null);
  // 方向键行走：窗口真实移动，动作跟着方向走；Shift 加速成跑动。
  const [travel, setTravel] = useState<Travel | null>(null);
  const travelRef = useRef<{ direction: 'left' | 'right'; motion: 'walking' | 'running'; timer: number } | null>(null);
  // 空闲跑动：只在没有任务、没有气泡、没人碰它时触发；跑完自动回待机。
  const [roam, setRoam] = useState<Travel | null>(null);
  const roamRef = useRef<{ timer: number; token: number; active: boolean }>({ timer: 0, token: 0, active: false });
  const behavior = validPetBehavior(snapshot?.petBehavior);
  const behaviorRef = useRef(behavior); behaviorRef.current = behavior;
  const behaviorKey = JSON.stringify(behavior);
  const sleepRef = useRef(sleep); sleepRef.current = sleep;
  const nextRoamAt = useRef(Date.now() + firstRoamDelay(behavior));
  const [gaze, setGaze] = useState<'left' | 'right' | 'center'>('center');
  const dragging = useRef(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const activity = snapshot?.assistant.activity ?? 'idle';
  const state = activity === 'idle' ? snapshot?.motion ?? 'idle' : activity;
  const skin = snapshot?.skin;
  const awakeName = roam
    ? `${roam.motion}-${roam.direction}`
    : travel
      ? `${travel.motion}-${travel.direction}`
      : effectiveAnimationKey(skin?.manifest, activity, snapshot?.motion ?? 'idle', snapshot?.direction ?? 'right');
  useEffect(() => window.pet.onGaze?.(setGaze), []);
  // 完全静止够久就趴下：先放起手式，再循环；被点醒时补一个收尾动作，有任务时立刻回到当前动作。
  const resting = activity === 'idle' && (snapshot?.motion ?? 'idle') === 'idle' && !travel && !roam;
  const videos = skin?.manifest.videos;
  const sleepKey = sleep === 'start' ? 'sleep-start' : sleep === 'loop' ? 'sleep-loop' : sleep === 'end' ? 'sleep-end' : undefined;
  // 一次性动作（success / error / click）播一遍就回常态，否则会卡在末帧。
  const oneShotKey = !roam && videos?.[awakeName]?.loop === false && !awakeName.startsWith('sleep-') ? awakeName : null;
  const localKey = localAction && videos?.[localAction] ? localAction : null;
  const requested = localKey ?? (resting && sleepKey && videos?.[sleepKey] ? sleepKey : oneShotKey ? (finishedShot === oneShotKey ? 'idle' : oneShotKey) : awakeName);
  const name = resolveVideoKey(videos, requested);
  const wakeUp = () => setSleep(phase => phase === 'loop' && videos?.['sleep-end'] ? 'end' : phase);
  const sleepEnded = () => setSleep(phase => phase === 'start' ? (videos?.['sleep-loop'] ? 'loop' : 'awake') : phase === 'end' ? 'awake' : phase);
  // 当前动作的名称变了，允许同一段一次性动画下次重新播放。
  useEffect(() => { setFinishedShot(null); }, [awakeName]);
  const handleEnded = () => {
    if (localAction === 'click') { setLocalAction(null); return; }
    if (sleepKey) { sleepEnded(); return; }
    if (oneShotKey) setFinishedShot(oneShotKey);
  };
  useEffect(() => {
    if (!videos?.['sleep-start']) { setSleep('awake'); return; }
    // 有任务就立刻醒，动画优先响应状态。
    if (!resting) { setSleep('awake'); return; }
    if (sleep !== 'awake') return;
    const timer = window.setTimeout(() => setSleep(phase => phase === 'awake' ? 'start' : phase), SLEEP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [resting, videos, sleep]);
  const spriteScale = skin ? Math.min(viewport.width / skin.manifest.width, (viewport.height - 24) / skin.manifest.height) : 1;
  useEffect(() => { setFailedFrame(false); }, [skin?.baseUrl]);
  const activateReply = () => {
    const current = latest.current;
    const hide = current?.bubbleMode === 'quick' && (current?.quickView ?? 'chat') === 'chat';
    void (hide ? window.pet.setBubbleMode('hidden') : window.pet.showReply(inputAt.current)).catch(() => setError(true));
  };
  if (!gesture.current) gesture.current = new PetClickController({
    single: () => { setLocalAction('click'); activateReply(); },
    double: () => { void window.pet.openQuota(inputAt.current).catch(() => setError(true)); },
    drag: (dx, dy) => { if (!dragging.current) { dragging.current = true; setLocalAction('drag'); } delta.current.x += dx; delta.current.y += dy; queueDrag(); },
  });
  useEffect(() => () => {
    gesture.current?.cancel();
    const current = travelRef.current;
    if (current) window.clearTimeout(current.timer);
    const roamCurrent = roamRef.current;
    if (roamCurrent.timer) window.cancelAnimationFrame(roamCurrent.timer);
    roamCurrent.active = false;
  }, []);

  // 按住方向键时窗口持续移动；走动/跑动的节奏由这里统一驱动，松手立刻停。
  const stepTravel = () => {
    const current = travelRef.current;
    if (!current) return;
    const base = current.motion === 'running' ? ROAM_STEP_PX.running : ROAM_STEP_PX.walking;
    const step = Math.max(1, Math.round(base * behaviorRef.current.speed));
    void window.pet.drag(current.direction === 'left' ? -step : step, 0).catch(() => setError(true));
    current.timer = window.setTimeout(stepTravel, current.motion === 'running' ? ROAM_TICK_MS.running : ROAM_TICK_MS.walking);
  };
  const stopTravel = () => {
    const current = travelRef.current;
    if (!current) return;
    travelRef.current = null;
    window.clearTimeout(current.timer);
    setTravel(null);
  };
  /** 用户刚操作过就重新计时，别在人家手边马上又跑起来。 */
  const postponeRoam = () => { nextRoamAt.current = Date.now() + laterRoamDelay(behaviorRef.current); };
  /** 用户一碰、任务一开始、或气泡打开，就立刻停跑，不要拖着窗口乱跑。 */
  const stopRoam = () => {
    const current = roamRef.current;
    if (!current.active) return;
    current.active = false;
    current.token += 1;
    if (current.timer) { window.cancelAnimationFrame(current.timer); current.timer = 0; }
    setRoam(null);
    postponeRoam();
  };
  const finishRoam = () => {
    const current = roamRef.current;
    current.active = false;
    current.token += 1;
    if (current.timer) { window.cancelAnimationFrame(current.timer); current.timer = 0; }
    setRoam(null);
    postponeRoam();
  };
  const startRoam = () => {
    const current = latest.current;
    const config = behaviorRef.current;
    if (!current || !config.enabled || roamRef.current.active || travelRef.current || dragging.current) return;
    if (current.assistant.activity !== 'idle' || current.bubbleMode !== 'hidden' || document.visibilityState !== 'visible') return;
    if (sleepRef.current !== 'awake' && !config.wake) return;
    // 骨骼皮肤的动作由 snapshot 驱动，窗口移动时无法同步方向，先不参与空闲跑动。
    if (current.skin?.manifest.rig) return;
    const motions = availableRoamMotions(current.skin?.manifest);
    if (!motions.walking && !motions.running) return;
    const availLeft = (window.screen as Screen & { availLeft?: number }).availLeft ?? 0;
    const clearance = Math.max(ROAM_CLEARANCE, config.distancePx + 80);
    const startDirection = chooseStartDirection(window.screenX, window.outerWidth || window.innerWidth, availLeft, window.screen.availWidth, Math.random, clearance);
    const legs = planRoam(motions, config, Math.random, startDirection);
    const token = roamRef.current.token + 1;
    roamRef.current = { timer: 0, token, active: true };
    let legIndex = 0;
    let phaseIndex = 0;
    const runPhase = () => {
      const active = roamRef.current;
      if (!active.active || active.token !== token) return;
      if (legIndex >= legs.length) { finishRoam(); return; }
      const leg = legs[legIndex];
      const phase = leg.phases[phaseIndex];
      if (!phase) { legIndex += 1; phaseIndex = 0; runPhase(); return; }
      setRoam({ direction: leg.direction, motion: phase.motion });
      const startedAt = performance.now();
      // 单次 IPC 最多挪一小步。定时器被主进程/动画拖慢时，不能把欠下的
      // 几十像素一次性补上，否则视觉上就是“瞬移”；宁可多走几帧。
      const maxStep = phase.motion === 'running' ? 8 : 5;
      // 步长可能因 0.5x 速度变成小数；用 carry 累积，避免每帧四舍五入后越跑越偏。
      let carry = 0;
      let moved = 0;
      const moveTo = (amount: number) => {
        const wanted = Math.min(phase.distance - moved, amount, maxStep);
        if (wanted <= 0) return;
        moved += wanted;
        carry += wanted;
        const step = Math.floor(carry + 1e-9);
        if (step > 0) {
          carry -= step;
          void window.pet.drag(leg.direction === 'left' ? -step : step, 0).catch(() => { stopRoam(); setError(true); });
        }
      };
      const tick = () => {
        const state = roamRef.current;
        if (!state.active || state.token !== token) return;
        if (moved >= phase.distance) {
          phaseIndex += 1;
          if (phaseIndex >= leg.phases.length) { legIndex += 1; phaseIndex = 0; }
          state.timer = window.requestAnimationFrame(runPhase);
          return;
        }
        const elapsed = performance.now() - startedAt;
        // expected 是“整段应走距离的比例”，不是每 tick 的步长；旧公式只走了 3px，
        // 剩下几十像素在段尾一次补齐，才会看起来像瞬移。
        const expected = phase.distance * Math.min(1, Math.max(0, elapsed / (phase.duration || 1)));
        moveTo(expected - moved);
        state.timer = window.requestAnimationFrame(tick);
      };
      tick();
    };
    runPhase();
  };
  const startTravel = (direction: 'left' | 'right', motion: 'walking' | 'running') => {
    stopRoam();
    const current = travelRef.current;
    if (current?.direction === direction && current.motion === motion) return;
    stopTravel();
    travelRef.current = { direction, motion, timer: 0 };
    setTravel({ direction, motion });
    stepTravel();
  };

  // 任务开始或气泡打开时不允许跑动；空闲时按配置的间隔触发一次来回跑。
  useEffect(() => {
    if (activity !== 'idle' || (snapshot?.bubbleMode ?? 'hidden') !== 'hidden') stopRoam();
  }, [activity, snapshot?.bubbleMode]);
  // 行为配置变化：停掉旧路线，按新的首次等待重新计时。
  const behaviorKeyRef = useRef(behaviorKey);
  useEffect(() => {
    if (behaviorKeyRef.current === behaviorKey) return;
    behaviorKeyRef.current = behaviorKey;
    stopRoam();
    nextRoamAt.current = Date.now() + firstRoamDelay(behaviorRef.current);
  }, [behaviorKey]);
  useEffect(() => {
    nextRoamAt.current = Date.now() + firstRoamDelay(behaviorRef.current);
    const timer = window.setInterval(() => {
      const config = behaviorRef.current;
      if (!config.enabled) return;
      if (Date.now() < nextRoamAt.current) return;
      const current = latest.current;
      if (!current) return;
      if (current.assistant.activity !== 'idle' || current.bubbleMode !== 'hidden') { nextRoamAt.current = Date.now() + 20_000; return; }
      if (document.visibilityState !== 'visible') return;
      if (roamRef.current.active || travelRef.current || dragging.current) { nextRoamAt.current = Date.now() + 15_000; return; }
      if (sleepRef.current !== 'awake' && !config.wake) { nextRoamAt.current = Date.now() + laterRoamDelay(config); return; }
      const roamMotions = availableRoamMotions(current.skin?.manifest);
      if (!roamMotions.walking && !roamMotions.running) { nextRoamAt.current = Date.now() + laterRoamDelay(config); return; }
      startRoam();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  // 桌宠被收起时不跑；重新出现时重新等一个首次跑动间隔，避免一露面就冲出去。
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { stopRoam(); return; }
      nextRoamAt.current = Date.now() + firstRoamDelay(behaviorRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  let dragFrame = 0;
function queueDrag() {
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => { dragFrame = 0; void flushDrag(); });
}

async function flushDrag() {
    if (moving.current) return;
    moving.current = true;
    try {
      while (delta.current.x || delta.current.y) {
        const current = delta.current;
        delta.current = { x: 0, y: 0 };
        await window.pet.drag(current.x, current.y);
      }
    } catch { setError(true); delta.current = { x: 0, y: 0 }; }
    finally { moving.current = false; }
  }

  return <main className={`pet-stage state-${state}`}>
    <button className="pet-button" aria-label="查看龙娘回复；双击查看Codex额度；拖动或按方向键移动桌宠，按住 Shift 加左右方向键跑动" aria-describedby="pet-status"
      onPointerDown={event => {
        if (event.button !== 0) { gesture.current?.cancel(); return; }
        event.preventDefault();
        stopRoam();
        postponeRoam();
        event.currentTarget.setPointerCapture(event.pointerId);
        wakeUp();
        gesture.current?.down({ x: event.screenX, y: event.screenY });
      }}
      onPointerMove={event => {
        gesture.current?.move({ x: event.screenX, y: event.screenY });
      }}
      onPointerUp={event => {
        if (event.button !== 0) return;
        inputAt.current = Date.now();
        gesture.current?.up({ x: event.screenX, y: event.screenY });
        if (dragging.current) { dragging.current = false; setLocalAction(null); }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => gesture.current?.cancel()}
      onLostPointerCapture={() => { if (gesture.current?.pressed) gesture.current.cancel(); }}
      onContextMenu={event => { event.preventDefault(); stopRoam(); postponeRoam(); gesture.current?.cancel(); void window.pet.showContextMenu().catch(() => setError(true)); }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); stopRoam(); postponeRoam(); gesture.current?.cancel(); inputAt.current = Date.now(); if (!event.repeat) activateReply(); return; }
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault(); stopRoam(); postponeRoam(); gesture.current?.cancel();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { stopTravel(); void window.pet.drag(0, event.key === 'ArrowUp' ? -12 : 12).catch(() => setError(true)); return; }
        if (event.repeat) return;
        startTravel(event.key === 'ArrowLeft' ? 'left' : 'right', event.shiftKey ? 'running' : 'walking');
      }}
      onKeyUp={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') stopTravel(); }}
      onBlur={stopTravel}>
      <span id="pet-status" className="sr-only">{failedFrame ? '动画加载失败，请检查素材' : error ? '右键打开完整对话查看状态' : activityLabels[activity]}</span>
      {skin?.manifest.rig && !failedFrame ? <RigCanvas skin={skin} playback={snapshot?.rigPlayback ?? { control: { activity, motion: snapshot?.motion ?? "idle", direction: snapshot?.direction ?? "right" }, startedAt: snapshot?.animationStartedAt ?? rigStarted.current }} width={viewport.width} height={viewport.height} view={{ scale: spriteScale, x: viewport.width / 2 - skin.manifest.anchor.x * spriteScale, y: viewport.height - 8 - skin.manifest.anchor.y * spriteScale }} onError={() => setFailedFrame(true)} /> : skin && !failedFrame && skin.manifest.videos && Object.keys(skin.manifest.videos).length ? <VideoSprite skin={skin} animationKey={name} width={viewport.width} height={viewport.height} playbackRate={roam || travel ? behavior.speed : 1} mirror={gaze === 'left' && activity === 'idle' && !travel && !roam} onEnded={handleEnded} onError={() => setFailedFrame(true)} /> : skin && !failedFrame ? <FrameSprite skin={skin} animationKey={name} startedAt={snapshot?.animationStartedAt} width={viewport.width} height={viewport.height} onError={() => setFailedFrame(true)} /> : <Egg className="pet-egg" />}
      {(!skin || failedFrame) && <span className="pet-placeholder-label">{failedFrame ? '素材加载失败' : '临时形象'}</span>}
    </button>
  </main>;
}

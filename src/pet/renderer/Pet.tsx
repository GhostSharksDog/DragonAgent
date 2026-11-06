import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '../shared/types';
import { effectiveAnimationKey } from '../shared/animation-state';
import { Egg } from './icons';
import { RigCanvas } from './RigCanvas';
import { FrameSprite } from './FrameSprite';
import { VideoSprite } from './VideoSprite';
import { PetClickController } from './pet-click-controller';

/** 完全静止多久开始打盹。 */
const SLEEP_AFTER_MS = 180_000;

export const activityLabels: Record<AppSnapshot['assistant']['activity'], string> = {
  idle: '在这里，随时叫我', walking: '慢跑中', running: '慢跑中', thinking: '正在想办法…', speaking: '正在回复你…', 'awaiting-input': '有件事想问你', 'awaiting-approval': '需要你的批准', success: '已经完成啦', error: '需要处理一下',
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
  const awakeName = effectiveAnimationKey(skin?.manifest, activity, snapshot?.motion ?? 'idle', snapshot?.direction ?? 'right');
  useEffect(() => window.pet.onGaze?.(setGaze), []);
  // 完全静止够久就趴下：先放起手式，再循环；被点醒时补一个收尾动作，有任务时立刻回到当前动作。
  const resting = activity === 'idle' && (snapshot?.motion ?? 'idle') === 'idle';
  const videos = skin?.manifest.videos;
  const sleepKey = sleep === 'start' ? 'sleep-start' : sleep === 'loop' ? 'sleep-loop' : sleep === 'end' ? 'sleep-end' : undefined;
  // 一次性动作（success / error / click）播一遍就回常态，否则会卡在末帧。
  const oneShotKey = videos?.[awakeName]?.loop === false && !awakeName.startsWith('sleep-') ? awakeName : null;
  const localKey = localAction && videos?.[localAction] ? localAction : null;
  const name = localKey ?? (resting && sleepKey && videos?.[sleepKey] ? sleepKey : oneShotKey ? (finishedShot === oneShotKey ? 'idle' : oneShotKey) : awakeName);
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
    const hide = current?.bubbleMode === 'quick' && (current.quickView ?? 'chat') === 'chat';
    void (hide ? window.pet.setBubbleMode('hidden') : window.pet.showReply(inputAt.current)).catch(() => setError(true));
  };
  if (!gesture.current) gesture.current = new PetClickController({
    single: () => { setLocalAction('click'); activateReply(); },
    double: () => { void window.pet.openQuota(inputAt.current).catch(() => setError(true)); },
    drag: (dx, dy) => { if (!dragging.current) { dragging.current = true; setLocalAction('drag'); } delta.current.x += dx; delta.current.y += dy; queueDrag(); },
  });
  useEffect(() => () => gesture.current?.cancel(), []);

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
    <button className="pet-button" aria-label="查看龙娘回复；双击查看Codex额度；拖动或按方向键移动桌宠" aria-describedby="pet-status"
      onPointerDown={event => {
        if (event.button !== 0) { gesture.current?.cancel(); return; }
        event.preventDefault();
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
      onContextMenu={event => { event.preventDefault(); gesture.current?.cancel(); void window.pet.showContextMenu().catch(() => setError(true)); }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); gesture.current?.cancel(); inputAt.current = Date.now(); if (!event.repeat) activateReply(); }
        const moves: Record<string, [number, number]> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
        if (moves[event.key]) { event.preventDefault(); gesture.current?.cancel(); void window.pet.drag(...moves[event.key]).catch(() => setError(true)); }
      }}>
      <span id="pet-status" className="sr-only">{failedFrame ? '动画加载失败，请检查素材' : error ? '右键打开完整对话查看状态' : activityLabels[activity]}</span>
      {skin?.manifest.rig && !failedFrame ? <RigCanvas skin={skin} playback={snapshot?.rigPlayback ?? { control: { activity, motion: snapshot?.motion ?? "idle", direction: snapshot?.direction ?? "right" }, startedAt: snapshot?.animationStartedAt ?? rigStarted.current }} width={viewport.width} height={viewport.height} view={{ scale: spriteScale, x: viewport.width / 2 - skin.manifest.anchor.x * spriteScale, y: viewport.height - 8 - skin.manifest.anchor.y * spriteScale }} onError={() => setFailedFrame(true)} /> : skin && !failedFrame && skin.manifest.videos && Object.keys(skin.manifest.videos).length ? <VideoSprite skin={skin} animationKey={name} width={viewport.width} height={viewport.height} mirror={gaze === 'left' && activity === 'idle'} onEnded={handleEnded} onError={() => setFailedFrame(true)} /> : skin && !failedFrame ? <FrameSprite skin={skin} animationKey={name} startedAt={snapshot?.animationStartedAt} width={viewport.width} height={viewport.height} onError={() => setFailedFrame(true)} /> : <Egg className="pet-egg" />}
      {(!skin || failedFrame) && <span className="pet-placeholder-label">{failedFrame ? '素材加载失败' : '临时形象'}</span>}
    </button>
  </main>;
}

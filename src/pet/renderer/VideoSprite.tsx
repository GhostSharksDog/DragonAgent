import { useEffect, useRef } from 'react';
import type { SkinData } from '../shared/types';

interface VideoSpriteProps {
  skin: SkinData;
  animationKey: string;
  width: number;
  height: number;
  onError?: (message: string) => void;
  /** 非循环动作播放结束时触发，用于「起手式 → 循环 → 收尾」接力。 */
  onEnded?: () => void;
  /** 额外水平镜像，用于「看向鼠标」；和素材自身的 flipX 取异或。 */
  mirror?: boolean;
}

/** video 只解码不出图，画面统一画到 canvas 上。 */
/** 动作交叉淡化时长。 */
const FADE_MS = 220;

const decodeOnly: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * 透明 webm 动画通道：两个 <video> 交替缓冲解码，再逐帧绘制到 canvas。
 *
 * 为什么不直接把 <video> 显示出来：Windows 上的透明窗口不会合成 video 图层，
 * 元素样式正常也只会透出背景。canvas 走普通绘制路径，透明背景可以正常合成。
 *
 * 播放被拒（窗口还没显示、被遮挡、系统省电）只算「稍后再试」，不能当成素材损坏，
 * 否则一次时机不对就会把整只宠物换成蛋。只有解码真的报错才交给 onError。
 */
export function VideoSprite({ skin, animationKey, width, height, mirror = false, onError, onEnded }: VideoSpriteProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const slots = useRef<(HTMLVideoElement | null)[]>([]);
  const front = useRef(0);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const currentFile = useRef('');
  // 切动作时留一帧快照，与新画面交叉淡化，避免姿势硬跳。
  const fadeRef = useRef<{ bitmap: HTMLCanvasElement; start: number } | null>(null);
  const manifest = skin.manifest;
  const videos = manifest.videos ?? {};
  const video = videos[animationKey] ?? videos.idle;
  const base = skin.baseUrl.endsWith('/') ? skin.baseUrl : `${skin.baseUrl}/`;
  // 画布四周常有大量空白，按 content 裁切后再缩放，窗口才能贴合角色本体。
  const content = manifest.content ?? { x: 0, y: 0, width: manifest.width, height: manifest.height };
  const contentRef = useRef(content);
  contentRef.current = content;
  const scale = Math.min(width / content.width, (height - 8) / content.height);
  const box = {
    width: content.width * scale,
    height: content.height * scale,
    left: width / 2 - (manifest.anchor.x - content.x) * scale,
    top: height - 8 - (manifest.anchor.y - content.y) * scale,
  };

  // 逐帧把当前前台的 video 画进 canvas，只在画面真的变了的时候重绘。
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context) return;
    let frame = 0, lastKey = '';
    const paint = () => {
      const source = slots.current[front.current];
      const fade = fadeRef.current;
      const elapsed = fade ? performance.now() - fade.start : Infinity;
      const fading = !!fade && elapsed < FADE_MS;
      if (source && source.readyState >= 2 && source.videoWidth) {
        const key = `${source.src}#${source.currentTime}`;
        if (key !== lastKey || fading) {
          lastKey = key;
          const area = contentRef.current;
          if (target.width !== area.width || target.height !== area.height) {
            target.width = area.width;
            target.height = area.height;
          }
          context.clearRect(0, 0, area.width, area.height);
          context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
          if (fading && fade) {
            // 旧姿势盖在新姿势上淡出，动作衔接看起来像过渡而不是跳帧。
            context.globalAlpha = Math.max(0, 1 - elapsed / FADE_MS);
            context.drawImage(fade.bitmap, 0, 0, area.width, area.height);
            context.globalAlpha = 1;
          } else if (fade) fadeRef.current = null;
        }
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const elements = slots.current.filter((element): element is HTMLVideoElement => !!element);
    if (elements.length !== 2 || !video) return;
    let cancelled = false, retry = 0;
    const url = `${base}${video.file.split('/').map(encodeURIComponent).join('/')}`;
    const loop = video.loop !== false;
    const targetIndex = front.current === 0 ? 1 : 0;
    const target = elements[targetIndex], outgoing = elements[front.current];
    const same = currentFile.current === url && target.dataset.file === url;
    currentFile.current = url;
    target.dataset.file = url;
    target.loop = loop;

    // 解码真的失败才值得报错；自动播放被拒只是时机问题。
    const onDecodeError = () => onError?.(`宠物动画加载失败：${video.file}`);
    target.onerror = onDecodeError;
    const onEnd = () => ended.current?.();
    target.addEventListener('ended', onEnd);

    const start = async () => {
      if (cancelled) return;
      try {
        await target.play();
        if (cancelled) return;
        retry = 0;
        bringForward();
      } catch (error) {
        if (cancelled) return;
        // 窗口隐藏、被遮挡或省电都可能拒绝播放，退避重试即可。
        if (retry < 40) {
          retry++;
          window.setTimeout(start, Math.min(2000, 120 + retry * 120));
        } else {
          console.warn('[VideoSprite] 自动播放持续被拒：', error);
        }
      }
    };
    const bringForward = () => {
      if (cancelled || front.current === targetIndex) return;
      if (outgoing && outgoing !== target && !loop) outgoing.pause();
      const live = canvas.current;
      if (live && live.width && live.height) {
        const snapshot = document.createElement('canvas');
        snapshot.width = live.width;
        snapshot.height = live.height;
        const painter = snapshot.getContext('2d');
        if (painter) {
          painter.drawImage(live, 0, 0);
          fadeRef.current = { bitmap: snapshot, start: performance.now() };
        }
      }
      front.current = targetIndex;
      if (outgoing && outgoing !== target) {
        window.setTimeout(() => { if (!cancelled && outgoing !== elements[front.current]) outgoing.pause(); }, FADE_MS + 120);
      }
    };

    if (same) {
      target.currentTime = 0;
      void start();
    } else {
      target.src = url;
      void start();
    }
    return () => { cancelled = true; target.onerror = null; target.removeEventListener('ended', onEnd); };
    // 只认「切到哪个文件」和画布尺寸，同一动画不因快照刷新而重播。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, video?.file, video?.loop, width, height]);

  // 窗口重新可见时补一次播放，避免被遮挡期间彻底停住。
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      for (const element of slots.current) void element?.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);

  useEffect(() => () => {
    for (const element of slots.current) { element?.pause(); element?.removeAttribute('src'); }
  }, []);

  if (!video) return null;
  return <div className="sprite-canvas video-canvas">
    <div className="video-frame" style={{ position: 'absolute', ...box, transform: video.flipX !== mirror ? 'scaleX(-1)' : undefined }}>
      <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
      <video ref={element => { slots.current[0] = element; }} muted playsInline preload="auto" style={decodeOnly} />
      <video ref={element => { slots.current[1] = element; }} muted playsInline preload="auto" style={decodeOnly} />
    </div>
  </div>;
}

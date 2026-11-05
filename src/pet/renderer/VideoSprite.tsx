import { useEffect, useRef } from 'react';
import type { SkinData } from '../shared/types';

interface VideoSpriteProps {
  skin: SkinData;
  animationKey: string;
  width: number;
  height: number;
  onError?: (message: string) => void;
}

/** video 只解码不出图，画面统一画到 canvas 上。 */
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
 */
export function VideoSprite({ skin, animationKey, width, height, onError }: VideoSpriteProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const slots = useRef<(HTMLVideoElement | null)[]>([]);
  const front = useRef(0);
  const currentFile = useRef('');
  const manifest = skin.manifest;
  const videos = manifest.videos ?? {};
  const video = videos[animationKey] ?? videos.idle;
  const base = skin.baseUrl.endsWith('/') ? skin.baseUrl : `${skin.baseUrl}/`;
  const scale = Math.min(width / manifest.width, (height - 24) / manifest.height);
  const box = {
    width: manifest.width * scale,
    height: manifest.height * scale,
    left: width / 2 - manifest.anchor.x * scale,
    top: height - 8 - manifest.anchor.y * scale,
  };

  // 逐帧把当前前台的 video 画进 canvas，只在画面真的变了的时候重绘。
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context) return;
    let frame = 0, lastKey = '';
    const paint = () => {
      const source = slots.current[front.current];
      if (source && source.readyState >= 2 && source.videoWidth) {
        const key = `${source.src}#${source.currentTime}`;
        if (key !== lastKey) {
          lastKey = key;
          if (target.width !== source.videoWidth || target.height !== source.videoHeight) {
            target.width = source.videoWidth;
            target.height = source.videoHeight;
          }
          context.clearRect(0, 0, target.width, target.height);
          context.drawImage(source, 0, 0, target.width, target.height);
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
    let cancelled = false;
    const url = `${base}${video.file.split('/').map(encodeURIComponent).join('/')}`;
    const loop = video.loop !== false;
    const swap = async () => {
      // 目标槽如果已经装着这段动画，直接切前台重播，不再走网络。
      const targetIndex = front.current === 0 ? 1 : 0;
      const target = elements[targetIndex], outgoing = elements[front.current];
      const same = currentFile.current === url && target.dataset.file === url;
      currentFile.current = url;
      target.dataset.file = url;
      target.loop = loop;
      if (!same) {
        target.src = url;
        try { await target.play(); }
        catch (error) { if (!cancelled) onError?.(`宠物动画无法播放：${error instanceof Error ? error.message : String(error)}`); return; }
      } else {
        target.currentTime = 0;
        void target.play().catch(() => undefined);
      }
      if (cancelled) return;
      if (outgoing && outgoing !== target && !loop) outgoing.pause();
      front.current = targetIndex;
    };
    void swap();
    return () => { cancelled = true; };
    // 只认「切到哪个文件」和画布尺寸，同一动画不因快照刷新而重播。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, video?.file, video?.loop, width, height]);

  useEffect(() => () => {
    for (const element of slots.current) { element?.pause(); element?.removeAttribute('src'); }
  }, []);

  if (!video) return null;
  return <div className="sprite-canvas video-canvas">
    <div className="video-frame" style={{ position: 'absolute', ...box, transform: video.flipX ? 'scaleX(-1)' : undefined }}>
      <canvas ref={canvas} style={{ display: 'block', width: '100%', height: '100%' }} />
      <video ref={element => { slots.current[0] = element; }} muted playsInline preload="auto" style={decodeOnly} />
      <video ref={element => { slots.current[1] = element; }} muted playsInline preload="auto" style={decodeOnly} />
    </div>
  </div>;
}

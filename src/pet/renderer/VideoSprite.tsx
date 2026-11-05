import { useEffect, useRef } from 'react';
import type { SkinData } from '../shared/types';

interface VideoSpriteProps {
  skin: SkinData;
  animationKey: string;
  width: number;
  height: number;
  onError?: (message: string) => void;
}

/**
 * 透明 webm 动画通道：两个 <video> 交替换源，新片加载完成后再把旧片压到背景，
 * 避免切换瞬间露出黑底或空帧（与 dsh-pet 的 A/B 双缓冲同一思路）。
 */
export function VideoSprite({ skin, animationKey, width, height, onError }: VideoSpriteProps) {
  const host = useRef<HTMLDivElement>(null);
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
      target.classList.add('is-front');
      if (outgoing && outgoing !== target) {
        outgoing.classList.remove('is-front');
        if (!loop) outgoing.pause();
      }
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
  return <div ref={host} className="sprite-canvas video-canvas">
    <div className="video-frame" style={{ position: 'absolute', overflow: 'hidden', ...box, transform: video.flipX ? 'scaleX(-1)' : undefined }}>
      <video ref={element => { slots.current[0] = element; }} className="pet-video" muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0, transition: 'opacity .12s linear', pointerEvents: 'none', background: 'transparent' }} />
      <video ref={element => { slots.current[1] = element; }} className="pet-video" muted playsInline preload="auto" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0, transition: 'opacity .12s linear', pointerEvents: 'none', background: 'transparent' }} />
    </div>
    <style>{`.pet-video.is-front{opacity:1}`}</style>
  </div>;
}

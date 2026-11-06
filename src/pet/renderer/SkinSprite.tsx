import React from 'react';
import type { SkinData } from '../shared/types';
import { FrameSprite } from './FrameSprite';
import { VideoSprite } from './VideoSprite';
import { RigCanvas } from './RigCanvas';

/** 按皮肤类型选择渲染通道：rig 骨架 → webm 视频 → PNG 帧图集。 */
export function SkinSprite({ skin, animationKey = 'idle', width, height, startedAt, mirror = false, onError }: {
  skin: SkinData; animationKey?: string; width: number; height: number; startedAt?: number; mirror?: boolean; onError?(message: string): void;
}) {
  const manifest = skin.manifest;
  if (manifest.rig) {
    const scale = Math.min(width / manifest.width, (height - 24) / manifest.height);
    return <RigCanvas skin={skin} playback={{ control: { activity: 'idle', motion: 'idle', direction: 'right' }, startedAt: startedAt ?? Date.now() }} width={width} height={height} view={{ scale, x: width / 2 - manifest.anchor.x * scale, y: height - 8 - manifest.anchor.y * scale }} onError={onError}/>;
  }
  if (manifest.videos && Object.keys(manifest.videos).length) return <VideoSprite skin={skin} animationKey={animationKey} width={width} height={height} mirror={mirror} onError={onError}/>;
  return <FrameSprite skin={skin} animationKey={animationKey} startedAt={startedAt} width={width} height={height} onError={onError}/>;
}

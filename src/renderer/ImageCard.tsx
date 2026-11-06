import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';
import './image-card.css';

interface ImageCardProps {
  name: string;
  /** 已知地址时直接显示（例如文件预览已经拿到 url）。 */
  src?: string;
  size?: number;
  /** 展开时才取地址，避免一屏图片全部提前加载。 */
  load?: () => Promise<string | undefined>;
  open?: boolean;
}

/**
 * 图片结果卡片：折叠时和命令块一样只占一行，展开显示缩略图，双击进入大图预览。
 * 图片地址可以懒加载，折叠状态下不产生任何请求。
 */
export function ImageCard({ name, src, size, load, open = false }: ImageCardProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const loader = useRef(load);
  loader.current = load;
  const [url, setUrl] = useState(src);
  const [expanded, setExpanded] = useState(open);
  const [zoom, setZoom] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => { setUrl(src); }, [src]);

  useEffect(() => {
    if (open && details.current) details.current.open = true;
  }, [open]);

  useEffect(() => {
    if (!expanded || url || !loader.current) return;
    let cancelled = false;
    void loader.current()
      .then(value => { if (!cancelled) setUrl(value); })
      .catch(error => { if (!cancelled) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [expanded, url]);

  useEffect(() => {
    if (!zoom) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoom(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [zoom]);

  const meta = size === undefined ? '' : `${(size / 1024).toFixed(1)} KB`;
  return <>
    <details className="image-card" ref={details} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="image-card-summary">
        <Icon name="image" size={15} />
        <span className="image-card-name" title={name}>{name}</span>
        {meta && <small>{meta}</small>}
        <Icon name="chevron" size={12} />
      </summary>
      {failure
        ? <p className="image-card-error">图片加载失败：{failure}</p>
        : url
          ? <button className="plain image-card-thumb" title="双击放大" onDoubleClick={() => setZoom(true)}>
              <img src={url} alt={name} loading="lazy" />
              <span className="image-card-hint">双击放大</span>
            </button>
          : <p className="hint image-card-wait">正在读取图片…</p>}
    </details>
    {zoom && url && createPortal(
      <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`${name} 大图预览`} onClick={() => setZoom(false)}>
        <img src={url} alt={name} onClick={event => event.stopPropagation()} />
        <button className="plain image-lightbox-close" aria-label="关闭大图预览" onClick={() => setZoom(false)}>×</button>
      </div>,
      document.body,
    )}
  </>;
}

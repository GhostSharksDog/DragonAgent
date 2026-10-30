import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Popover({ anchor, close, children, label, width = 320, dialog = false, align = 'start' }: {
  anchor: HTMLElement; close(): void; children: React.ReactNode; label: string; width?: number; dialog?: boolean; align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: window.innerHeight - 16, visible: false });
  const dismiss = () => { close(); if (anchor.isConnected) anchor.focus(); };
  useLayoutEffect(() => {
    const node = ref.current!;
    const place = () => {
      const r = anchor.getBoundingClientRect(), h = node.getBoundingClientRect().height;
      const above = r.top - 16, below = window.innerHeight - r.bottom - 16;
      const up = above >= Math.min(h, 260) || above >= below;
      const maxHeight = Math.max(80, up ? above : below);
      setPosition({ left: Math.max(8, Math.min(align === 'end' ? r.right - width : r.left, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8)), top: Math.max(8, up ? r.top - Math.min(h, maxHeight) - 8 : r.bottom + 8), maxHeight, visible: true });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(node);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    const outside = (e: PointerEvent) => { if (!node.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, [anchor, width, align]);
  useLayoutEffect(() => {
    if (!position.visible) return;
    const node = ref.current!;
    const target = node.querySelector<HTMLElement>('[aria-checked="true"]') ?? node.querySelector<HTMLElement>('input,button:not(:disabled)');
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
  }, [position.visible, dialog]);
  return createPortal(<div ref={ref} className="floating-menu" role={dialog ? 'dialog' : 'menu'} aria-label={label} style={{ width, left: position.left, top: position.top, maxHeight: position.maxHeight, visibility: position.visible ? 'visible' : 'hidden' }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); }
    if (e.key === 'Tab') {
      if (!dialog) { close(); anchor.focus(); return; }
      const items = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]')];
      const current = items.indexOf(document.activeElement as HTMLElement);
      if ((e.shiftKey && current <= 0) || (!e.shiftKey && current === items.length - 1)) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0]?.focus(); }
    }
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault(); const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>{children}</div>, document.body);
}

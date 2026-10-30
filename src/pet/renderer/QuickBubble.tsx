import type { ReactNode } from 'react';
export function QuickBubbleFrame({ title, close, actions, footer, children }: { title: string; close(): void; actions?: ReactNode; footer?: ReactNode; children: ReactNode; shape?: unknown; layout?: unknown; quota?: boolean }) {
  return <div className="quick-frame"><header><strong>{title}</strong><span>{actions}<button onClick={close} aria-label="收起气泡">×</button></span></header>{children}{footer}</div>;
}

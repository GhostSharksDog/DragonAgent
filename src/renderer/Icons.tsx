import React from 'react';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>, chat: <path d="M5 4h14a2 2 0 0 1 2 2v11H8l-5 4V6a2 2 0 0 1 2-2Z"/>,
    settings: <><path d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.3 1.7 1.7v2.3l-1.7 1.7 2.5 4.3 2.2-.7 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.7 2.5-4.3-1.7-1.7v-2.3l1.7-1.7-2.5-4.3-2.2.7-2-.9-.6-2.4Z" transform="translate(0 -1) scale(1 .95)"/><circle cx="12" cy="11.5" r="3"/></>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6"/>, folder: <path d="M3 7V5h6l3 3h9v12H3Z"/>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>,
    link: <><path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1) scale(.9)"/></>,
    book: <path d="M12 5c-3-2-7-2-10-1v15c4-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1v15"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    chevron: <path d="m8 10 4 4 4-4"/>, check: <path d="m5 12 4 4L19 6"/>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    auto: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m13 7-4 6h5l-3 5"/></>,
    unlock: <><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/></>,
    file: <><path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
    model: <><rect x="4" y="4" width="16" height="16" rx="5"/><path d="m9 9 3 3-3 3m5 0h2"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.spark}</svg>;
}

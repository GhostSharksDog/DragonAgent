import { WebLink } from './WebLink';
import {remarkEmphasis,copyProse} from './remark-emphasis';
import React, { useRef, useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { FileArtifact } from '../shared/contracts';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import './rich-text.css';
import { Icon } from './Icons';

export function CopyButton({ text, label = '复制', iconOnly=false, prose=false }: { text: string | (() => string); label?: string; iconOnly?:boolean; prose?:boolean }) {
  const [status, setStatus] = useState('');
  return <button className={`plain copy-button ${iconOnly?'icon-copy':''}`} aria-label={status||label} title={status||label} onClick={async () => {
    try { const value=typeof text==='function'?text():text;await navigator.clipboard.writeText(prose?copyProse(value):value); setStatus('已复制'); }
    catch { setStatus('复制失败'); }
  }}>{iconOnly?<><Icon name={status==='已复制'?'check':'copy'} size={16}/><span className="sr-only" role="status">{status}</span></>:status || label}</button>;
}
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  return <div className="code-card"><div className="code-toolbar"><span>代码</span><CopyButton label="复制代码" text={() => code.current?.textContent ?? ''}/></div><pre ref={code}>{children}</pre></div>;
}
export function RichText({ text, files=[], sessionId }: { text: string; files?:FileArtifact[]; sessionId?:string }) {
  const match=(href:string)=>{try{const normalized=decodeURIComponent(href).replace(/^file:\/\/\/?/i,'').replace(/^\/([a-z]:)/i,'$1').replace(/:\d+(?::\d+)?$/,'').replace(/\\/g,'/').toLowerCase();return files.find(f=>f.path.replace(/\\/g,'/').toLowerCase()===normalized);}catch{return undefined;}};
  return <div className="rich-text"><Markdown remarkPlugins={[remarkGfm,remarkEmphasis]} rehypePlugins={[rehypeHighlight]} urlTransform={url=>match(url)?url:defaultUrlTransform(url)} components={{
    pre: CodeBlock,
    a: ({ href, children }) => {const file=match(href??'');return file&&sessionId?<button className="plain file-link" onClick={()=>void window.dragon.action({type:'artifact.preview',sessionId,artifactId:file.id})}>{children}</button>:/^https?:\/\//i.test(href ?? '') ? <WebLink href={href!}>{children}</WebLink> : <span title={href}>{children}</span>;},
    img: ({ alt }) => <span className="hint">{alt ? `图片：${alt}` : '图片'}</span>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}

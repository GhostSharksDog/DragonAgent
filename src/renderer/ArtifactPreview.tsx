import React from 'react';
import type { Action, AgentSession, FileArtifact, Snapshot } from '../shared/contracts';
import { RichText, CopyButton } from './RichText';
import { ImageCard } from './ImageCard';
export function ArtifactCard({file,sessionId,act}:{file:FileArtifact;sessionId:string;act(a:Action):Promise<unknown>}) {
  return <article className="artifact-card"><button className="artifact-open" title={file.path} onClick={()=>void act({type:'artifact.preview',sessionId,artifactId:file.id})}><strong>{file.name}</strong><span>{file.mime} · {(file.size/1024).toFixed(1)} KB</span></button><div className="actions"><button className="plain" onClick={()=>void act({type:'artifact.save',sessionId,artifactId:file.id})}>另存</button><button className="plain" onClick={()=>void act({type:'artifact.reveal',sessionId,artifactId:file.id})}>定位</button></div></article>;
}
export function ArtifactPreview({state,session,act}:{state:Snapshot;session:AgentSession;act(a:Action):Promise<unknown>}) {
  const preview=state.artifactPreview, file=preview?.artifact;
  const visible=file&&session.artifacts?.some(a=>a.id===file.id)&&session.messages.some(m=>m.runId===file.runId);
  return <><div className="section-title"><strong>{visible?file.name:'文件预览'}</strong><button className="plain" aria-label="关闭文件预览" onClick={()=>void act({type:'layout.save',rightCollapsed:true})}>×</button></div>{!visible?<p className="hint">点击对话中的文件卡片，在这里查看内容。</p>:<>
    <div className="preview-actions"><button onClick={()=>void act({type:'artifact.save',sessionId:session.id,artifactId:file.id})}>另存</button><button onClick={()=>void act({type:'artifact.reveal',sessionId:session.id,artifactId:file.id})}>在文件夹中显示</button></div>
    {preview.pages&&<div className="preview-actions"><button disabled={(preview.page??1)<=1} onClick={()=>void act({type:'artifact.preview',sessionId:session.id,artifactId:file.id,page:(preview.page??1)-1})}>上一页</button><span>{preview.page} / {preview.pages}</span><button disabled={(preview.page??1)>=preview.pages} onClick={()=>void act({type:'artifact.preview',sessionId:session.id,artifactId:file.id,page:(preview.page??1)+1})}>下一页</button></div>}
    {(preview.offset||preview.nextOffset)!==undefined&&preview.text!==undefined&&<div className="preview-actions"><button disabled={!preview.offset} onClick={()=>void act({type:'artifact.preview',sessionId:session.id,artifactId:file.id})}>回到开头</button><span>{Math.floor((preview.offset??0)/1024)} KB 起</span><button disabled={preview.nextOffset===undefined} onClick={()=>void act({type:'artifact.preview',sessionId:session.id,artifactId:file.id,offset:preview.nextOffset})}>下一段</button></div>}
    {preview.url ? (file.mime.startsWith('image/')||file.mime==='application/pdf')?<ImageCard name={file.name} src={preview.url} size={file.size} open/>:<iframe key={preview.url} className="artifact-frame" title={file.name} sandbox="allow-scripts" src={preview.url}/>:preview.text!==undefined?<><CopyButton text={preview.text} label="复制预览内容"/>{file.mime==='text/markdown'?<RichText text={preview.text}/>:<pre className="artifact-text">{preview.text}</pre>}{preview.truncated&&<p className="hint">当前显示文件片段，可按需加载下一段或另存完整文件。</p>}</>:<p className="hint">此文件类型暂不支持内置预览。</p>}
  </>}</>;
}

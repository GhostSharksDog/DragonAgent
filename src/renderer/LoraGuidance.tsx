import React from 'react';
import {CopyButton} from './RichText';
import {WebLink} from './WebLink';
import type {Action} from '../shared/contracts';
import {workshopBusy,type WorkshopProject} from '../shared/workshop';
export function LoraGuidance({project,act}:{project:WorkshopProject;act(a:Action):Promise<unknown>}) {
  const lora=project.lora;if(!lora)return null;
  const positive=project.characterPrompt;
  return <details className="lora-guidance" open><summary>作者提供的角色资料</summary>
    {lora.sourceUrl&&<WebLink href={lora.sourceUrl}>查看此版本的作者页面</WebLink>}
    <p className="hint">选择与当前服装匹配的触发词；不同服装的标签不要全部叠加。添加后会直接出现在正面提示词中。</p>
    <div className="trigger-words">{lora.triggerWords.map(word=>{const included=positive.toLowerCase().includes(word.toLowerCase());return <button key={word} disabled={included||workshopBusy(project)} title={included?'已包含在正面提示词':'加入正面提示词'} onClick={()=>void act({type:'workshop.update',id:project.id,characterPrompt:`${word}, ${positive}`})}>{included?'✓ ': '＋ '}{word}</button>;})}</div>
    {lora.triggerWords.length>0?<CopyButton text={lora.triggerWords.join(', ')} label="复制作者触发词"/>:<p>当前文件没有关联作者触发词，请搜索对应的 Civitai 模型版本；不能仅凭文件名推断角色。</p>}
    {lora.authorNotes?<div className="lora-author-notes"><strong>作者说明（参考资料）</strong><p>{lora.authorNotes}</p><CopyButton text={lora.authorNotes}/></div>:<p className="hint">暂无作者说明。0.8 为应用缺省权重，不代表作者推荐值。</p>}
  </details>;
}

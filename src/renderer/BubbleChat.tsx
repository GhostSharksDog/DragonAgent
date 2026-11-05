import {useEffect,useRef,useState} from 'react';
import type {Action,Snapshot} from '../shared/contracts';
/** 单击桌宠只弹一个输入框：Enter 发送，Shift+Enter 换行。 */
export function BubbleChat({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}){
  const [draft,setDraft]=useState(state.petChat?.draft??'');
  const composing=useRef(false),focused=useRef(false),sending=useRef(false),box=useRef<HTMLTextAreaElement>(null);
  // 组合输入和聚焦时不回灌草稿，避免拼音被 IPC 往返的旧值截断。
  useEffect(()=>{if(composing.current||focused.current)return;setDraft(state.petChat?.draft??'');},[state.petChat?.draft]);
  useEffect(()=>{box.current?.focus();},[]);
  const send=async()=>{
    if(sending.current||!draft.trim())return;sending.current=true;
    try{if(await act({type:'pet.chat.send',text:draft,commandId:crypto.randomUUID()})===true){setDraft('');composing.current=false;focused.current=false;void act({type:'pet.view',view:'hidden'});}}
    finally{sending.current=false;}
  };
  return <div className="pet-quick">
    <textarea ref={box} aria-label="发送给龙娘的消息" placeholder="说点什么…" value={draft} rows={2}
      onFocus={()=>{focused.current=true;}} onBlur={()=>{focused.current=false;}}
      onCompositionStart={()=>{composing.current=true;}}
      onCompositionEnd={e=>{composing.current=false;setDraft(e.currentTarget.value);void act({type:'pet.chat.draft',text:e.currentTarget.value});}}
      onChange={e=>{setDraft(e.target.value);if(!composing.current&&!(e.nativeEvent as InputEvent).isComposing)void act({type:'pet.chat.draft',text:e.target.value});}}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/>
  </div>;
}

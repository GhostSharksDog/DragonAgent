import {useEffect,useRef,useState} from 'react';
import type {Action,Snapshot} from '../shared/contracts';
/** 单击桌宠只弹一个输入框：Enter 发送，Shift+Enter 换行。 */
export function BubbleChat({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}){
  const [draft,setDraft]=useState(state.petChat?.draft??'');
  const composing=useRef(false),sending=useRef(false),box=useRef<HTMLTextAreaElement>(null),echo=useRef<string[]>([state.petChat?.draft??'']);
  const remember=(text:string)=>{echo.current=[...echo.current.filter(v=>v!==text),text].slice(-40);};
  // 只忽略自己经 IPC 回传的旧草稿；外部设置（切换聊天、恢复草稿）仍然生效，组合输入期间保持不动。
  useEffect(()=>{if(composing.current)return;const next=state.petChat?.draft??'';if(echo.current.includes(next))return;echo.current=[next];setDraft(next);},[state.petChat?.draft]);
  useEffect(()=>{if(state.petView==='reply'||state.petView==='compose')box.current?.focus();},[state.petView]);
  const send=async()=>{
    if(sending.current||!draft.trim())return;sending.current=true;
    try{if(await act({type:'pet.chat.send',text:draft,commandId:crypto.randomUUID()})===true){setDraft('');remember('');composing.current=false;void act({type:'pet.view',view:'hidden'});}}
    finally{sending.current=false;}
  };
  return <div className="pet-quick">
    <textarea ref={box} aria-label="发送给龙娘的消息" placeholder="说点什么…" value={draft} rows={2}
      onCompositionStart={()=>{composing.current=true;}}
      onCompositionEnd={e=>{composing.current=false;const next=e.currentTarget.value;setDraft(next);remember(next);void act({type:'pet.chat.draft',text:next});}}
      onChange={e=>{const next=e.target.value;setDraft(next);if(!composing.current&&!(e.nativeEvent as InputEvent).isComposing){remember(next);void act({type:'pet.chat.draft',text:next});}}}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/>
  </div>;
}

import React, {useState} from 'react';
import {Icon} from './Icons';
export function WebLink({href,children}:{href:string;children:React.ReactNode}) {
  const [failed,setFailed]=useState(false);let host='';try{host=new URL(href).hostname;}catch{return <span>{children}</span>;}
  return <a className="web-link" href={href} title={href} onClick={e=>{e.preventDefault();void window.dragon.action({type:'external.open',url:href});}}>{failed?<Icon name="globe" size={14}/>:<img src={`site-icon://icon/${encodeURIComponent(host)}`} alt="" width={14} height={14} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}<span>{children}</span></a>;
}

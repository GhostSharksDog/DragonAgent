import React,{useEffect,useState} from 'react';
import type {Action,Snapshot} from '../shared/contracts';
import {QuotaBars} from './QuotaBars';
import {Icon} from './Icons';
export function BalanceBubble({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}){
  const [selected,setSelected]=useState('codex');
  const ids=state.settings.profiles.map(p=>p.id).join(',');
  useEffect(()=>{for(const p of state.settings.profiles)void act({type:'provider.balance.refresh',profileId:p.id});},[ids]);
  const profile=state.settings.profiles.find(p=>p.id===selected),balance=state.balances?.find(b=>b.profileId===selected);
  const codex=selected==='codex'||!profile;
  return <section className="balance-bubble"><header className="bubble-header"><strong>额度与余额</strong><div className="bubble-header-actions"><button className="bubble-control" aria-label="刷新当前账户" disabled={codex?state.quota.status==='loading':balance?.status==='loading'} onClick={()=>void act(codex?{type:'quota.refresh'}:{type:'provider.balance.refresh',profileId:selected,force:true})}><Icon name="refresh" size={20}/></button><button className="bubble-close" aria-label="收起气泡" title="收起气泡 · Esc" onClick={()=>void act({type:'pet.view',view:'hidden'})}><Icon name="close" size={20}/></button></div></header>
    <div className="balance-scroll"><label className="balance-selector">账户<select aria-label="选择额度或余额账户" value={codex?'codex':selected} onChange={e=>setSelected(e.target.value)}><option value="codex">Codex 额度</option>{state.settings.profiles.map(p=><option key={p.id} value={p.id}>{p.name} · API 余额</option>)}</select></label>
    {codex?<QuotaBars quota={state.quota}/>:<section className="balance-details"><h3>{profile?.name}</h3>{balance?.status==='unsupported'?<p>此供应商暂不支持余额查询</p>:<>{!balance?.balances.length&&<p>{balance?.status==='loading'?'正在查询…':'暂无余额数据'}</p>}{balance?.balances.map(b=><div className="balance-amount" key={b.currency}><small>总余额 · {b.currency}</small><strong>{b.total}</strong><p>赠送 {b.granted} · 充值 {b.toppedUp}</p></div>)}{balance?.error&&<p role="alert">{balance.error}{balance.updatedAt?' · 显示上次记录':''}</p>}{balance?.updatedAt&&<small>更新于 {new Date(balance.updatedAt).toLocaleString('zh-CN')}</small>}</>}</section>}
    </div><footer><button className="plain" onClick={()=>void act({type:'pet.view',view:'reply'})}>返回聊天</button></footer></section>;
}

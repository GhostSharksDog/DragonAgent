import React, { useEffect } from 'react';
import type { Action, Snapshot } from '../shared/contracts';
export function AccountBalances({state,act}:{state:Snapshot;act(a:Action):Promise<unknown>}) {
  const profileIds=state.settings.profiles.map(p=>p.id).join(',');
  useEffect(()=>{for(const p of state.settings.profiles)void act({type:'provider.balance.refresh',profileId:p.id});},[profileIds]);
  return <section className="settings-card"><h2>API 账户余额</h2>{state.settings.profiles.map(p=>{const b=state.balances?.find(v=>v.profileId===p.id);return <div className="setting-row" key={p.id}><div className="grow"><strong>{p.name}</strong>{b?.status==='unsupported'?<p>此供应商暂不支持余额查询</p>:<>{b?.balances.map(v=><p key={v.currency}>{v.currency} {v.total} · 赠送 {v.granted} · 充值 {v.toppedUp}</p>)}{!b?.balances.length&&<p>{b?.status==='loading'?'正在查询…':'暂无余额数据'}</p>}{b?.error&&<p role="alert">{b.error}{b.updatedAt?' · 显示上次记录':''}</p>}{b?.updatedAt&&<p>更新于 {new Date(b.updatedAt).toLocaleString('zh-CN')}</p>}</>}</div><button disabled={b?.status==='loading'} onClick={()=>void act({type:'provider.balance.refresh',profileId:p.id,force:true})}>刷新</button></div>;})}</section>;
}

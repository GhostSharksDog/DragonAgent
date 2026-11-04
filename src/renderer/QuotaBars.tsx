import React from 'react';
import type { QuotaSnapshot, QuotaWindow } from '../pet/shared/types';
function Bar({window,label}:{window:QuotaWindow|null;label:string}) {
  const minutes=window?.windowDurationMins;
  const period=minutes?minutes%1440===0?`${minutes/1440} 天`:minutes%60===0?`${minutes/60} 小时`:`${minutes} 分钟`:label;
  const value=window&&Number.isFinite(window.usedPercent)?Math.max(0,Math.min(100,100-window.usedPercent)):undefined;
  return <div className="quota-bar"><div><strong>{period}</strong><span>{value===undefined?'暂无':`剩余 ${Math.round(value)}%`}</span></div><div className="quota-track" role="progressbar" aria-label={`${period}剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{width:`${value??0}%`}}/></div><small>{window?.resetsAt?`重置于 ${new Date(window.resetsAt*1000).toLocaleString('zh-CN')}`:'重置时间暂无'}</small></div>;
}
export function QuotaBars({quota}:{quota:QuotaSnapshot}) {
  const buckets=quota.buckets.length?quota.buckets:[{id:'codex',name:'Codex',primary:null,secondary:null}];
  return <div className="quota-bars">{buckets.map(b=><section key={b.id}><strong>{b.name??b.id}</strong><Bar window={b.primary} label="主要周期"/><Bar window={b.secondary} label="其他周期"/></section>)}{quota.error&&<p role="alert">{quota.error}{quota.updatedAt?' · 显示上次记录':''}</p>}{quota.updatedAt&&<small>更新于 {new Date(quota.updatedAt).toLocaleString('zh-CN')}</small>}</div>;
}

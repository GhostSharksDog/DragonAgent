import type { ModelProfile } from './contracts';
import type { Usage } from '../../packages/agent-core/src/types';

export interface TokenPricing { currency:string; input:number; output:number; cacheRead?:number }
export function tokenCost(profile:ModelProfile, usage:Usage):{low:number;high:number;currency:string;basis:string}|undefined {
  if(usage.reported!==true || (usage.cacheRead??0)>usage.input)return;
  const manual=profile.pricing;
  if(manual){
    const read=usage.cacheRead??0;
    if(manual.cacheRead!==undefined&&usage.cacheRead===undefined)return;
    const amount=((usage.input-read)*manual.input+read*(manual.cacheRead??manual.input)+usage.output*manual.output)/1e6;
    return {low:amount,high:amount,currency:manual.currency,basis:'按当前自定义单价估算'};
  }
  let official=false;try{official=new URL(profile.baseUrl).hostname==='api.deepseek.com';}catch{}
  if(!official||usage.cacheRead===undefined)return;
  const flash=['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(profile.model);
  if(!flash&&profile.model!=='deepseek-v4-pro')return;
  const rates=flash?{read:.006,input:.3,output:1.2}:{read:.044,input:1.32,output:3.96};
  const high=((usage.input-usage.cacheRead)*rates.input+usage.cacheRead*rates.read+usage.output*rates.output)/1e6;
  return {low:high/2,high,currency:'USD',basis:'官方峰谷单价区间，核验日期 2026-11-05；仅模型 Token，不含搜索等服务'};
}

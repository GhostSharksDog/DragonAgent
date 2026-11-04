import type { ModelProfile, ProviderBalance } from '../shared/contracts';

export async function deepseekBalance(profile: ModelProfile, key: string, signal?: AbortSignal): Promise<ProviderBalance> {
  const source=new URL(profile.baseUrl);
  if(source.protocol!=='https:'||source.hostname!=='api.deepseek.com')return {profileId:profile.id,status:'unsupported',balances:[]};
  if(!key)throw Error('请先保存此模型的 API 密钥。');
  const response=await fetch('https://api.deepseek.com/user/balance',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});
  if(!response.ok)throw Error(`余额查询失败：HTTP ${response.status}`);
  const data=await response.json() as any;
  if(typeof data.is_available!=='boolean'||!Array.isArray(data.balance_infos))throw Error('余额接口返回了无法识别的数据。');
  const amount=(value:unknown)=>{if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value))throw Error('余额金额格式无效。');return value;};
  return {profileId:profile.id,status:'ready',available:data.is_available,updatedAt:Date.now(),balances:data.balance_infos.map((v:any)=>{
    if(!['CNY','USD'].includes(v.currency))throw Error('余额币种无法识别。');
    return {currency:v.currency,total:amount(v.total_balance),granted:amount(v.granted_balance),toppedUp:amount(v.topped_up_balance)};
  })};
}

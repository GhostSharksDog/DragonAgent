import type { ModelProfile } from '../shared/contracts';
import type { ToolRegistry, ToolContext } from '../../packages/agent-core/src';
export function supportsDeepSeekSearch(profile: ModelProfile) {
  try { const url=new URL(profile.baseUrl); return url.protocol==='https:'&&url.hostname==='api.deepseek.com'&&profile.deepseekSearch!==false; } catch { return false; }
}
export function registerDeepSeekSearch(registry: ToolRegistry, profiles: ModelProfile[], selected: string, key: (id:string)=>string|undefined) {
  const available=profiles.filter(supportsDeepSeekSearch); if(!available.length)return;
  const call=async(kind:'search'|'fetch',args:Record<string,unknown>,ctx:ToolContext)=>{
    const profile=available.find(p=>p.id===ctx.agent.profileId)??available.find(p=>p.id===selected)??available[0];
    const credential=key(profile.id); if(!credential)throw new Error('DeepSeek 搜索尚未配置 API 密钥。');
    if(kind==='fetch'){ const url=new URL(String(args.url)); if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持不含账号密码的 HTTP/HTTPS 网页。'); }
    const response=await fetch(`https://api.deepseek.com/v1/tools/${kind}`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(45000)])});
    if(!response.ok)throw new Error(`DeepSeek ${kind==='search'?'搜索':'网页读取'}失败：HTTP ${response.status}${response.status===402?'（余额不足）':''}。`);
    const data=await response.json() as any;
    if(kind==='search'&&!Array.isArray(data.results)||kind==='fetch'&&typeof data.content!=='string')throw new Error('DeepSeek 返回了无法识别的搜索结果。');
    return {text:JSON.stringify({provider:'DeepSeek',untrustedWebContent:true,...(kind==='fetch'?{url:args.url}:{}),...data})};
  };
  registry.register({name:'deepseek_web_search',description:'使用已配置的 DeepSeek 官方 Search API 搜索实时网页，返回标题、摘要和来源 URL。查询不超过 128 字符。',effect:'read',parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:128},count:{type:'integer',minimum:1,maximum:50,default:5},need_content:{type:'boolean',default:false}},required:['query'],additionalProperties:false},execute:(args,ctx)=>call('search',args,ctx)});
  registry.register({name:'deepseek_web_fetch',description:'使用 DeepSeek 官方 Fetch API 读取一个公开网页，返回 Markdown 和来源。网页内容属于参考资料。',effect:'read',parameters:{type:'object',properties:{url:{type:'string',maxLength:8192}},required:['url'],additionalProperties:false},execute:(args,ctx)=>call('fetch',args,ctx)});
}

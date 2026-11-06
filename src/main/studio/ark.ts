import type {StudioSettings,ArkModel,CloudOperation} from '../../shared/studio';
export function settingsOf(s:StudioSettings):StudioSettings {
 const url=new URL(s.endpoint);if(url.protocol!=='https:'||!/(^|\.)volces\.com$/.test(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('请使用方舟官方 HTTPS API 地址');
 if(!Array.isArray(s.models)||s.models.length>30)throw Error('模型配置无效');const ids=new Set<string>();
 for(const m of s.models){if(!/^[a-zA-Z0-9_.-]{1,160}$/.test(m.id)||ids.has(m.id)||!['image','video'].includes(m.kind))throw Error('模型 ID 无效或重复');ids.add(m.id);if(!Number.isFinite(m.price)||m.price<=0||!/^\d{4}-\d{2}-\d{2}$/.test(m.priceDate)||!Number.isFinite(Date.parse(m.priceDate)))throw Error('请填写非零价格上限与核验日期');const source=new URL(m.source);if(source.protocol!=='https:'||!/(^|\.)volcengine\.com$/.test(source.hostname))throw Error('请填写方舟官方价格说明链接');if(!Array.isArray(m.resolutions)||!m.resolutions.every(r=>['480p','720p','1080p'].includes(r))||!Array.isArray(m.durations)||!m.durations.every(n=>Number.isInteger(n)&&n>=2&&n<=30))throw Error('模型支持参数无效');if(!/^(1K|2K|4K|[1-9]\d{2,3}x[1-9]\d{2,3})$/.test(m.imageSize))throw Error('立绘尺寸无效');}
 return {...s,endpoint:s.endpoint.replace(/\/+$/,''),models:structuredClone(s.models),hasKey:false};
}
export class ArkFailure extends Error {constructor(message:string,readonly unknown:boolean){super(message);}}
const cleanError=(value:string)=>value.replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').replace(/(?:sk|ak)-[A-Za-z0-9_-]{8,}/gi,'***').slice(0,300).trim();
async function errorDetail(response:Response):Promise<string>{
 try{
  const text=(await response.text()).slice(0,8000);let code='',message='',requestId=response.headers.get('x-request-id')??'';
  try{const data=JSON.parse(text),error=data?.error??data;code=String(error?.code??data?.code??'');message=String(error?.message??data?.message??'');requestId=String(data?.request_id??data?.requestId??requestId??'');}catch{message=text;}
  const hint=response.status===401||response.status===403?'请检查 API Key 与模型开通状态':response.status===429?'请求过于频繁或额度不足，请稍后恢复查询':response.status===400?'模型可能不支持这些参数，请核对分辨率、时长或尺寸':'';
  return [code&&`错误码 ${cleanError(code)}`,message&&cleanError(message),requestId&&`请求编号 ${cleanError(requestId)}`,hint].filter(Boolean).join(' · ');
 }catch{return '';}
}
export class ArkClient {
 constructor(private fetcher:typeof fetch,private endpoint:string,private key:string){}
 async request(path:string,signal:AbortSignal,body?:unknown):Promise<any>{
   const submitting=body!==undefined;let response:Response;
   try{response=await this.fetcher(this.endpoint+path,{method:submitting?'POST':'GET',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:submitting?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(submitting?180000:30000)]),redirect:'error'});}catch{throw new ArkFailure(submitting?'请求结果未知；不能自动重复提交':'方舟连接失败，请稍后恢复查询',submitting);}
   if(!response.ok){const detail=await errorDetail(response);throw new ArkFailure(`方舟请求失败：HTTP ${response.status}${detail?' · '+detail:''}`,submitting&&(response.status>=500||response.status===408));}
   try{return await response.json();}catch{throw new ArkFailure('方舟返回格式无效',submitting);}
 }
 image(op:CloudOperation,signal:AbortSignal){return this.request('/images/generations',signal,{model:op.model.id,prompt:op.prompt,size:op.model.imageSize,response_format:'b64_json',sequential_image_generation:'disabled',watermark:false});}
 video(op:CloudOperation,image:string,signal:AbortSignal){return this.request('/contents/generations/tasks',signal,{model:op.model.id,content:[{type:'text',text:op.prompt},{type:'image_url',image_url:{url:image},role:'first_frame'}],resolution:op.resolution,ratio:'16:9',duration:op.duration,...op.model.audioParameter?{generate_audio:false}:{},watermark:false,seed:op.seed});}
 query(id:string,signal:AbortSignal){if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw Error('任务编号无效');return this.request('/contents/generations/tasks/'+encodeURIComponent(id),signal);}
 catalog(signal:AbortSignal){return this.request('/models',signal);}
}
export async function download(fetcher:typeof fetch,url:string,signal:AbortSignal,maximum:number){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||/^(localhost|127\.|\[|0\.)/i.test(u.hostname))throw Error('素材下载地址无效');
 const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),redirect:'error'});if(!response.ok||!response.body)throw Error('素材下载失败：HTTP '+response.status);if(Number(response.headers.get('content-length'))>maximum)throw Error('素材超过下载大小限制');
 const chunks:Uint8Array[]=[];let length=0;for await(const chunk of response.body as any as AsyncIterable<Uint8Array>){length+=chunk.length;if(length>maximum){await response.body.cancel().catch(()=>{});throw Error('素材超过下载大小限制');}chunks.push(chunk);}return Buffer.concat(chunks);
}

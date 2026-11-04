import { inspectLora, fileHash } from './safetensors';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, realpath, stat, unlink, copyFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { LoraCandidate } from '../../shared/workshop';

export class LoraLibrary {
  private jobs=new Map<string,{controller:AbortController;promise:Promise<string>;listeners:Set<(a:number,b:number)=>void>;received:number;total:number}>();
  async install(root:string,c:LoraCandidate,signal:AbortSignal,progress:(a:number,b:number)=>void=()=>{}) {
    signal.throwIfAborted();const key=(await realpath(root)).toLowerCase()+'|'+c.sha256;
    let job=this.jobs.get(key);
    if(!job){
      const controller=new AbortController();
      job={controller,promise:Promise.resolve(''),listeners:new Set(),received:0,total:c.sizeKB*1024};const current=job;
      job.promise=this.download(root,c,controller.signal,(a,b)=>{current.received=a;current.total=b;for(const listener of current.listeners)listener(a,b);}).finally(()=>{if(this.jobs.get(key)===current)this.jobs.delete(key);});
      this.jobs.set(key,job);
    }
    const active=job;active.listeners.add(progress);progress(active.received,active.total);
    return new Promise<string>((resolve,reject)=>{
      const release=()=>{signal.removeEventListener('abort',abort);active.listeners.delete(progress);if(!active.listeners.size)active.controller.abort();};
      const abort=()=>{release();reject(signal.reason??Error('下载已取消'));};signal.addEventListener('abort',abort,{once:true});
      active.promise.then(v=>{release();resolve(v);},e=>{release();reject(e);});if(signal.aborted)abort();
    });
  }
  private async preview(raw:string):Promise<string|undefined> {
    try{const url=new URL(raw);if(url.protocol!=='https:'||url.hostname!=='image.civitai.com')return;
      const r=await this.request(url,{signal:AbortSignal.timeout(8000)});if(!r.ok||!r.body)return;
      const reader=r.body.getReader(),parts:Uint8Array[]=[];let count=0;try{while(true){const {value,done}=await reader.read();if(done)break;count+=value.length;if(count>5*1024**2)throw Error('预览过大');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
      const png=await sharp(Buffer.concat(parts),{limitInputPixels:20000000}).resize(160,160,{fit:'inside'}).png().toBuffer();return 'data:image/png;base64,'+png.toString('base64');
    }catch{return undefined;}
  }
  constructor(private request: typeof fetch) {}
  async import(root:string,source:string,backend:'anima'|'animagine'='animagine') {
    if(!path.isAbsolute(root)||!source.toLowerCase().endsWith('.safetensors'))throw Error('请选择 models 目录和 SafeTensors LoRA。');
    const inspected=await inspectLora(source);if(inspected.backend!==backend)throw Error('无法确认该 LoRA 与所选立绘模型兼容。');
    const sha256=await fileHash(source);
    const base=await realpath(root),folder=path.join(base,'loras','DragonAgent');await mkdir(folder,{recursive:true});const actual=await realpath(folder);if(!actual.toLowerCase().startsWith((base+path.sep).toLowerCase()))throw Error('模型目录越界');
    const name=`local-${sha256}.safetensors`,target=path.join(actual,name),temp=target+'.'+randomUUID()+'.part';try{await copyFile(source,temp);if(await fileHash(temp)!==sha256)throw Error('导入期间源文件发生变化，请重试');if(await stat(target).catch(()=>null)){if(await fileHash(target)!==sha256)throw Error('已有文件校验失败');}else await rename(temp,target);}finally{await unlink(temp).catch(()=>undefined);}
    return {backend,file:`DragonAgent/${name}`,sha256,name:path.basename(source),strength:.8,triggerWords:[]};
  }
  async search(query:string,backend:'anima'|'animagine'='animagine'):Promise<LoraCandidate[]> {
    const url=new URL('https://civitai.com/api/v1/models');
    const link=query.match(/^https:\/\/civitai\.com\/models\/(\d+)/);
    if(link)url.pathname+=`/${link[1]}`;
    else {url.searchParams.set('query',query.slice(0,200));url.searchParams.set('types','LORA');url.searchParams.set('baseModels',backend==='anima'?'Anima':'SDXL 1.0');url.searchParams.set('limit','20');url.searchParams.set('nsfw','false');}
    const r=await this.request(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Civitai 搜索失败（${r.status}）`);
    const body=await r.json();const result:LoraCandidate[]=[];
    for(const m of link?[body]:body.items??[]) {
      if(m.type!=='LORA'||m.nsfw)continue;
      for(const v of (m.modelVersions??[]).slice(0,3)) {
        const f=v.files?.find((f:any)=>f.type==='Model'&&f.metadata?.format==='SafeTensor'&&/^[a-f\d]{64}$/i.test(f.hashes?.SHA256??''));if(!f||!Number.isFinite(f.sizeKB)||f.sizeKB<=0||f.sizeKB>2*1024**2||!Number.isSafeInteger(v.id))continue;
        const preview=v.images?.find((i:any)=>i.type!=='video'&&(i.nsfwLevel===1||i.nsfw==='None'||i.nsfw===false)&&typeof i.url==='string');
        const description = [...new Set([v.description,m.description].filter(x=>typeof x==='string'&&x))].join('\n').replace(/<[^>]*>/g,' ').slice(0,6000);
        // Only accept an explicit single author weight; ranges and unrelated numbers are not recommendations.
        const weight = description.match(/(?:recommended\s+)?(?:lora\s+)?weight\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)(?![\d.]|\s*(?:-|–|~|to)\s*\d)/i);
        const suggestedStrength = weight && Number(weight[1])>0 && Number(weight[1])<=2 ? Number(weight[1]) : undefined;
        result.push({backend,suggestedStrength,preview:preview&&result.length<6?await this.preview(preview.url):undefined,versionId:v.id,name:`${m.name} · ${v.name}`,author:m.creator?.username??'',baseModel:v.baseModel,triggerWords:(v.trainedWords??[]).filter((x:unknown)=>typeof x==='string'),description,url:`https://civitai.com/models/${m.id}?modelVersionId=${v.id}`,sizeKB:f.sizeKB,sha256:f.hashes.SHA256.toLowerCase(),downloadUrl:f.downloadUrl??v.downloadUrl,compatible:backend==='anima'?/^Anima(?:$|[ -])/i.test(v.baseModel??'')&&!/2[.]9\s*b|3[.]8\s*b/i.test(String(v.name)+' '+String(v.baseModel)):/^(SDXL 1\.0$|Animagine)/i.test(v.baseModel??'')});
      }
    }
    return result.sort((a,b)=>Number(b.compatible)-Number(a.compatible));
  }
  private async download(root:string,c:LoraCandidate,signal:AbortSignal,progress:(received:number,total:number)=>void=()=>{}) {
    if(!c.compatible)throw Error('该 LoRA 与当前立绘模型不兼容。');
    if(!path.isAbsolute(root))throw Error('请先填写 ComfyUI 的 models 目录。');
    const base=await realpath(root),folder=path.join(base,'loras','DragonAgent');await mkdir(folder,{recursive:true});
    const actual=await realpath(folder);if(!actual.toLowerCase().startsWith((base+path.sep).toLowerCase()))throw Error('LoRA 目录不能链接到模型目录外。');
    const name=`civitai-${c.versionId}-${c.sha256.slice(0,12)}.safetensors`,destination=path.join(actual,name);
    const digest=async(file:string)=>{const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');};
    if(await stat(destination).catch(()=>null)){if(await digest(destination)===c.sha256)return `DragonAgent/${name}`;throw Error('已有文件校验不符，未覆盖原文件。');}
    const url=new URL(c.downloadUrl);if(url.protocol!=='https:'||url.hostname!=='civitai.com'||!url.pathname.startsWith('/api/download/models/'))throw Error('下载地址不是 Civitai 官方模型接口。');
    const temp=destination+'.part';
    try {
      const r=await this.request(url,{signal});if(!r.ok||!r.body)throw Error(`下载失败（${r.status}），可能需要登录 Civitai。`);
      if(/text\/html|application\/json/i.test(r.headers.get('content-type')??'')){await r.body.cancel();throw Error('Civitai 返回网页或认证信息，而非模型文件。请在设置填写 Civitai API Key，或检查网络验证后重试；也可导入已下载的本地 LoRA。');}
      let bytes=0,updated=0;const cap=Math.min(2*1024**3,Math.max(1024**2,c.sizeKB*1024*1.05));
      await pipeline(Readable.fromWeb(r.body as any),new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;if(Date.now()-updated>500){updated=Date.now();progress(bytes,c.sizeKB*1024);}done(bytes>cap?Error('文件超过声明大小或 2 GB 上限'):null,chunk);}}),createWriteStream(temp,{flags:'w'}),{signal});
      const actualHash=await digest(temp);
      if(actualHash!==c.sha256)throw Error(`LoRA SHA256 校验失败（收到 ${bytes} 字节，类型 ${r.headers.get('content-type')??'未知'}，实际哈希 ${actualHash}）。`);
      const inspected=await inspectLora(temp);if(inspected.backend&&inspected.backend!==c.backend)throw Error('文件中的模型体系与候选说明不一致。');
      signal.throwIfAborted();await rename(temp,destination);return `DragonAgent/${name}`;
    }finally{await unlink(temp).catch(()=>undefined);}
  }
}

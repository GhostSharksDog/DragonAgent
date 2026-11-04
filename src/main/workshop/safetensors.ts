import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CharacterBackend } from '../../shared/workshop';

export async function fileHash(file: string, signal?: AbortSignal) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)){signal?.throwIfAborted();hash.update(chunk);}
  return hash.digest('hex');
}
export async function inspectLora(file: string):Promise<{backend?:CharacterBackend;bytes:number}> {
  const info=await stat(file);if(!info.isFile()||info.size<10||info.size>2*1024**3)throw Error('LoRA 文件大小无效或超过 2 GB。');
  const handle=await open(file,'r');let header:Record<string,any>;let length=0;
  try {
    const prefix=Buffer.alloc(8);if((await handle.read(prefix,0,8,0)).bytesRead!==8)throw Error('SafeTensors 文件不完整。');
    length=Number(prefix.readBigUInt64LE());if(!Number.isSafeInteger(length)||length<2||length>16*1024**2||length>=info.size-8)throw Error('SafeTensors 文件头无效。');
    const bytes=Buffer.alloc(length);let offset=0;while(offset<length){const read=await handle.read(bytes,offset,length-offset,8+offset);if(!read.bytesRead)throw Error('SafeTensors 文件头不完整。');offset+=read.bytesRead;}
    header=JSON.parse(bytes.toString());
  }finally{await handle.close();}
  if(!header||Array.isArray(header)||typeof header!=='object')throw Error('SafeTensors 文件头无效。');
  const widths:Record<string,number>={BOOL:1,U8:1,I8:1,F8_E4M3:1,F8_E5M2:1,F8_E4M3FN:1,I16:2,U16:2,F16:2,BF16:2,I32:4,U32:4,F32:4,I64:8,U64:8,F64:8};
  const tensors=Object.entries(header).filter(([k])=>k!=='__metadata__');
  if(!tensors.some(([k])=>/lora_[AB]|lora_(up|down)/i.test(k)))throw Error('文件中没有可识别的 LoRA 张量。');
  const ranges=tensors.map(([,v])=>{
    if(!v||!Array.isArray(v.shape)||!v.shape.every((n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0)||!Array.isArray(v.data_offsets)||v.data_offsets.length!==2)throw Error('SafeTensors 张量信息无效。');
    const [start,end]=v.data_offsets,bytes=v.shape.reduce((n:number,x:number)=>n*x,1)*widths[v.dtype];
    if(!Number.isSafeInteger(bytes)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>info.size-8-length||end-start!==bytes)throw Error('SafeTensors 张量范围无效。');
    return [start,end];
  }).sort((a,b)=>a[0]-b[0]);
  let end=0;for(const range of ranges){if(range[0]!==end)throw Error('SafeTensors 张量范围重叠或有空洞。');end=range[1];}if(end!==info.size-8-length)throw Error('SafeTensors 数据长度不符。');
  const meta=header.__metadata__??{};
  const anima=meta.ss_base_model_version==='anima'||meta.ss_network_module==='networks.lora_anima'||/^anima(?:$|[/.])/i.test(meta['modelspec.architecture']??'');
  const sdxl=!anima&&(/sdxl|stable.diffusion.xl|animagine/i.test(JSON.stringify(meta))||tensors.some(([k,v])=>/attn2.*to_[kv]/.test(k)&&v.shape.includes(2048)));
  return {backend:anima?'anima':sdxl?'animagine':undefined,bytes:info.size};
}

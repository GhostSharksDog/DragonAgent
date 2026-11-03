import sharp, { type OverlayOptions } from 'sharp';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { QualityReport } from '../../shared/workshop';
import type { SkinAnimation } from '../../pet/shared/types';
import { inside } from './store';

sharp.cache({ memory: 64, files: 0, items: 64 }); sharp.concurrency(2);
export async function atomicFile(filename: string, bytes: string | Uint8Array) {
  await mkdir(path.dirname(filename), { recursive: true }); const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes); await rename(temporary, filename);
}
export async function importCharacter(root: string, file: string, source: Uint8Array) {
  if (source.length > 20 * 1024 * 1024) throw new Error('角色图片不能超过 20 MB。');
  const image = sharp(source, { limitInputPixels: 24_000_000, failOn: 'error' }), info = await image.metadata();
  if (!['png','jpeg','webp'].includes(info.format ?? '') || !info.width || !info.height || (info.pages ?? 1) > 1) throw new Error('请使用单张 PNG、JPEG 或 WebP 角色立绘。');
  if (info.width < 128 || info.height < 128) throw new Error('角色立绘至少需要 128×128 像素。');
  const bytes = await image.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).ensureAlpha().png().toBuffer();
  await atomicFile(inside(root,file), bytes); return { sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function referenceImage(root: string, file: string) {
  return sharp(await readFile(inside(root,file)), { limitInputPixels: 24_000_000 }).flatten({background:'#e8e4ec'}).resize(512,512,{fit:'contain',background:'#e8e4ec'}).png().toBuffer();
}
interface Descriptor { vector: Uint8Array; area: number; box: { left: number; top: number; right: number; bottom: number }; cx: number; cy: number; corners: number }
function descriptor(data: Uint8Array, width: number, height: number): Descriptor {
  let area=0, left=width, right=0, top=height, bottom=0, cx=0, cy=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>32){area++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);cx+=x;cy+=y;}
  const vector = new Uint8Array(data.length);
  for(let i=0;i<data.length;i+=4){const a=data[i+3]/255;vector[i]=Math.round(data[i]*a);vector[i+1]=Math.round(data[i+1]*a);vector[i+2]=Math.round(data[i+2]*a);vector[i+3]=data[i+3];}
  const corners=[[0,0],[width-1,0],[0,height-1],[width-1,height-1]].filter(([x,y])=>data[(y*width+x)*4+3]>16).length;
  return {vector,area,box:{left,top,right,bottom},cx:area?cx/area/width:.5,cy:area?cy/area/height:.5,corners};
}
function difference(a: Uint8Array,b: Uint8Array){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length/255;}
function velocityDifference(a:Uint8Array,b:Uint8Array,c:Uint8Array,d:Uint8Array){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs((b[i]-a[i])-(d[i]-c[i]));return sum/a.length/510;}

/** Fixed crop and scale across a clip preserve breathing and foot lifts; never fit each frame separately. */
export async function normalizeFrames(input: { root: string; files: string[]; output: string; loop: boolean }): Promise<{ frames: string[]; animation: SkinAnimation; quality: QualityReport }> {
  const {root,files,output,loop}=input;
  if(files.length<2||files.length>120)throw new Error('动画需要 2–120 帧。');
  const descriptors:Descriptor[]=[], dimensions:{width:number;height:number}[]=[];
  for(const file of files){
    const image=sharp(await readFile(inside(root,file)),{limitInputPixels:16_000_000,failOn:'error'}), meta=await image.metadata();
    if(!meta.width||!meta.height||!meta.hasAlpha)throw new Error('抠图结果缺少透明通道。请确认 BiRefNet 使用 Alpha 背景。');
    dimensions.push({width:meta.width,height:meta.height});
    descriptors.push(descriptor(await image.ensureAlpha().resize(64,64,{fit:'fill'}).raw().toBuffer(),64,64));
  }
  if(dimensions.some(d=>d.width!==dimensions[0].width||d.height!==dimensions[0].height))throw new Error('动作帧尺寸不一致。');
  const emptyFrames=descriptors.filter(d=>d.area<12).length, clippedFrames=descriptors.filter(d=>d.area>0&&(d.box.left===0||d.box.top===0||d.box.right===63||d.box.bottom===63)).length;
  let positionJump=0,alphaFlicker=0,motion=0;
  for(let i=1;i<descriptors.length;i++){const a=descriptors[i-1],b=descriptors[i];positionJump=Math.max(positionJump,Math.hypot(a.cx-b.cx,a.cy-b.cy));alphaFlicker=Math.max(alphaFlicker,Math.abs(a.area-b.area)/Math.max(1,a.area,b.area));motion+=difference(a.vector,b.vector);}
  motion/=Math.max(1,descriptors.length-1);
  let start=0,end=files.length,seam:number|undefined;
  if(loop&&files.length>=18){
    let best=Infinity;
    for(let i=0;i<files.length-16;i++)for(let j=i+16;j<files.length;j++){
      const similarity=difference(descriptors[i].vector,descriptors[j].vector), velocity=velocityDifference(descriptors[i].vector,descriptors[i+1].vector,descriptors[j-1].vector,descriptors[j].vector);
      const score=similarity+velocity*.4+.003*(1-(j-i)/files.length);
      if(score<best){best=score;start=i;end=j;seam=similarity;}
    }
  }
  const chosen=files.slice(start,end), boxes=descriptors.slice(start,end).filter(d=>d.area>0).map(d=>d.box);
  if(!boxes.length)throw new Error('抠图结果全部为空，未创建桌宠动画。');
  const width=dimensions[0].width,height=dimensions[0].height;
  const left=Math.max(0,Math.floor((Math.min(...boxes.map(b=>b.left))-1)/64*width)), top=Math.max(0,Math.floor((Math.min(...boxes.map(b=>b.top))-1)/64*height));
  const right=Math.min(width,Math.ceil((Math.max(...boxes.map(b=>b.right))+2)/64*width)), bottom=Math.min(height,Math.ceil((Math.max(...boxes.map(b=>b.bottom))+2)/64*height));
  // All 512px source clips use the same scale. Fitting each clip's silhouette would
  // shrink the character whenever a gesture opens its arms or wings.
  const scale=Math.min(248/width,252/height), w=Math.max(1,Math.round((right-left)*scale)),h=Math.max(1,Math.round((bottom-top)*scale));
  const frames:string[]=[],composites:OverlayOptions[]=[];const columns=Math.ceil(Math.sqrt(chosen.length)),rows=Math.ceil(chosen.length/columns);
  for(let i=0;i<chosen.length;i++){
    const picture=await sharp(await readFile(inside(root,chosen[i])),{limitInputPixels:16_000_000}).extract({left,top,width:right-left,height:bottom-top}).resize(w,h).png().toBuffer();
    const bytes=await sharp({create:{width:272,height:272,channels:4,background:'#00000000'}}).composite([{input:picture,left:Math.round((272-w)/2),top:264-h}]).png().toBuffer();
    const frame=`${output}/frames/${String(i).padStart(3,'0')}.png`;await atomicFile(inside(root,frame),bytes);frames.push(frame);
    composites.push({input:bytes,left:i%columns*272,top:Math.floor(i/columns)*272});
  }
  const atlas=`${output}/atlas.png`;
  await atomicFile(inside(root,atlas),await sharp({create:{width:272*columns,height:272*rows,channels:4,background:'#00000000'}}).composite(composites).png().toBuffer());
  const warnings:string[]=[];
  if(emptyFrames)warnings.push(`${emptyFrames} 帧角色为空或过小`);
  if(clippedFrames>Math.max(1,files.length*.1))warnings.push(`${clippedFrames} 帧角色接近画面边界，可能发生裁切`);
  const opaqueCorners=descriptors.filter(d=>d.corners>0).length;
  if(opaqueCorners)warnings.push(`${opaqueCorners} 帧边角不透明，请检查抠图`);
  if(positionJump>.075)warnings.push('角色位置存在明显跳变');
  if(alphaFlicker>.28)warnings.push('透明轮廓面积变化较大，请检查边缘闪烁或角色变形');
  if(seam!==undefined&&seam>.035)warnings.push('循环首尾仍有明显差异');
  if(motion<.0007)warnings.push('动作变化很小，可能接近静止图片');
  const quality:QualityReport={passed:!warnings.length,warnings,frameCount:chosen.length,emptyFrames,clippedFrames,opaqueCorners,positionJump,alphaFlicker,seam,motion};
  return {frames,animation:{frames:[atlas],fps:24,loop,atlas:{columns,rows,indices:chosen.map((_,i)=>i)}},quality};
}

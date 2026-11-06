import {spawn} from 'node:child_process';
import {readFile,mkdir,readdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {normalizeFrames} from '../workshop/images';
import {inside} from '../workshop/store';
import type {MatteOptions} from '../../shared/studio';
export function matteOptions(raw:MatteOptions):MatteOptions {
  if(!/^#[a-f\d]{6}$/i.test(raw.color)||![raw.similarity,raw.blend,raw.start].every(Number.isFinite)||raw.similarity<.01||raw.similarity>1||raw.blend<0||raw.blend>1||raw.start<0||raw.start>30||raw.end!==undefined&&(!Number.isFinite(raw.end)||raw.end<=raw.start||raw.end>30))throw Error('抠像参数或循环区间无效');return {...raw};
}
export async function mediaBinary(root:string,name:'ffmpeg'|'ffprobe',dev=false) {
  const bundled=path.join(root,'runtime/media',name+'.exe');try{await access(bundled);return bundled;}catch{}
  // 开发环境回退到 PATH；发行包必须带经过校验的媒体工具，不能依赖系统安装，也不能靠路径猜测运行环境。
  if(dev)return name;
  throw Error('发行包缺少媒体处理工具（ffmpeg/ffprobe），请重新安装完整版本。');
}
/** 从动作视频取首帧，作为视频型桌宠的库内缩略图。 */
export async function videoThumbnail(root:string,videoRelative:string,outputRelative:string,binaries:string,dev:boolean,signal:AbortSignal){
  const ffmpeg=await mediaBinary(binaries,'ffmpeg',dev);
  await runMedia(ffmpeg,['-v','error','-nostdin','-y','-i',inside(root,videoRelative),'-frames:v','1','-vf','scale=272:272:force_original_aspect_ratio=decrease,format=rgba',inside(root,outputRelative)],signal);
}
export function runMedia(executable:string,args:string[],signal:AbortSignal):Promise<string> {
  return new Promise((resolve,reject)=>{signal.throwIfAborted();const p=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>p.kill(),180000);let output='',error='';const stop=()=>p.kill();signal.addEventListener('abort',stop,{once:true});p.stdout.on('data',v=>output=(output+v).slice(-1000000));p.stderr.on('data',v=>error=(error+v).slice(-8000));p.on('error',e=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(e);});p.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',stop);if(signal.aborted)reject(Error('处理已取消'));else if(code!==0)reject(Error('媒体处理失败：'+error));else resolve(output);});});
}
export async function processClip(root:string,relative:string,output:string,options:MatteOptions,loop:boolean,binaries:string,dev:boolean,signal:AbortSignal){
  const started=Date.now(),matte=matteOptions(options),ffmpeg=await mediaBinary(binaries,'ffmpeg',dev),ffprobe=await mediaBinary(binaries,'ffprobe',dev);
  const metadata=JSON.parse(await runMedia(ffprobe,['-v','error','-show_streams','-show_format','-of','json',inside(root,relative)],signal));
  const video=metadata.streams?.find((s:any)=>s.codec_type==='video');if(!video||Number(metadata.format?.duration)>30||video.width>4096||video.height>4096)throw Error('源视频必须在 30 秒及 4096px 以内');
  await mkdir(inside(root,output+'/keyed'),{recursive:true});
  await runMedia(ffmpeg,['-v','error','-nostdin','-y','-threads','2','-i',inside(root,relative),'-ss',String(matte.start),'-t',String(Math.min(5,(matte.end??Number(metadata.format.duration))-matte.start)),'-an','-vf',`fps=24,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=${matte.color},format=rgba,colorkey=0x${matte.color.slice(1)}:${matte.similarity}:${matte.blend},despill=type=${matte.color.toLowerCase()==='#0000ff'?'blue':'green'}`,'-frames:v','120',inside(root,output+'/keyed/%03d.png')],signal);
  const files=(await readdir(inside(root,output+'/keyed'))).filter(f=>/^\d+\.png$/.test(f)).sort().map(f=>output+'/keyed/'+f);signal.throwIfAborted();
  const normalized=await normalizeFrames({root,files,output:output+'/prepared',loop});signal.throwIfAborted();
  await mkdir(inside(root,output+'/sequence'),{recursive:true});for(let i=0;i<normalized.frames.length;i++){signal.throwIfAborted();await copyFile(inside(root,normalized.frames[i]),inside(root,output+'/sequence/'+String(i).padStart(3,'0')+'.png'));}
  const result=output+'/animation.webm';await runMedia(ffmpeg,['-v','error','-nostdin','-y','-threads','2','-framerate','24','-i',inside(root,output+'/sequence/%03d.png'),'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','0','-crf','28','-an',inside(root,result)],signal);
  const check=JSON.parse(await runMedia(ffprobe,['-v','error','-show_streams','-of','json',inside(root,result)],signal));if(!check.streams?.some((s:any)=>s.codec_name==='vp9'&&s.tags?.alpha_mode==='1'))throw Error('输出缺少透明视频标记');
  return {...normalized,result,elapsedMs:Date.now()-started};
}

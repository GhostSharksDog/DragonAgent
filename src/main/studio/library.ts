import {readFile,writeFile,mkdir,readdir,realpath,stat,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {unzip} from 'fflate';
import {ZipFile} from 'yazl';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {loadSkin} from '../../pet/main/skin';
import {inside} from '../workshop/store';
import {atomicFile} from '../workshop/images';
import {studioUrl,type StudioSkin} from '../../shared/studio';
import type {SkinManifest} from '../../pet/shared/types';
export function skinFiles(m:SkinManifest){return [...new Set(['skin.json',...Object.values(m.animations).flatMap(a=>a.frames),...Object.values(m.videos??{}).map(v=>v.file),...Object.values(m.rig?.views??{}).flatMap(v=>v?.layers.map(l=>l.file)??[])])];}
export async function importSkin(root:string,source:string,kind:'directory'|'zip',origin:StudioSkin['source']='imported'):Promise<StudioSkin>{
  const id=randomUUID(),target=inside(root,'skins/'+id);await mkdir(target,{recursive:true});
  try{
    let base=source;
    if(kind==='zip'){
      if((await stat(source)).size>128*1024*1024)throw Error('压缩包超过 128 MB');const bytes=await readFile(source);let total=0,count=0;const seen=new Set<string>();
      const files=await new Promise<Record<string,Uint8Array>>((resolve,reject)=>unzip(bytes,{filter:file=>{if(file.name.endsWith('/'))return false;if(seen.has(file.name))throw Error('压缩包包含重复路径');seen.add(file.name);inside(target,file.name);if(++count>5000||(total+=file.originalSize)>512*1024*1024||file.originalSize>32*1024*1024)throw Error('素材包解压大小超出限制');if(!/\.(json|png|webp|webm)$/i.test(file.name))return false;return true;}},(error,data)=>error?reject(error):resolve(data)));
      for(const [name,data]of Object.entries(files)){await mkdir(path.dirname(inside(target,name)),{recursive:true});await writeFile(inside(target,name),data);}
      base=target;if(!files['skin.json']){const manifests=Object.keys(files).filter(f=>f.endsWith('/skin.json'));if(manifests.length!==1)throw Error('压缩包需包含唯一 skin.json');base=path.dirname(inside(target,manifests[0]));}
    }
    const data=await loadSkin(path.join(base,'skin.json')),files=skinFiles(data.manifest);let total=0;
    const realBase=await realpath(base);
    for(const relative of files){const input=await realpath(inside(base,relative));if(!input.startsWith(realBase+path.sep))throw Error('素材不能链接到包外');total+=(await stat(input)).size;if(total>512*1024*1024)throw Error('素材总大小超过 512 MB');const dest=inside(target,relative);if(input!==dest){await mkdir(path.dirname(dest),{recursive:true});await copyFile(input,dest);}}
    await loadSkin(path.join(target,'skin.json'));
    // 仅清理 ZIP 内部的顶层包装目录；目录导入的 source 是用户素材，绝不能删。
    const resolvedBase=path.resolve(base),resolvedTarget=path.resolve(target);
    if(kind==='zip'&&resolvedBase!==resolvedTarget&&resolvedBase.startsWith(resolvedTarget+path.sep))await rm(resolvedBase,{recursive:true,force:true});
    return {id,name:data.manifest.name,source:origin,manifest:data.manifest,baseUrl:studioUrl('skins/'+id+'/'),thumbnail:data.manifest.animations.idle?.frames[0]?studioUrl('skins/'+id+'/'+data.manifest.animations.idle.frames[0]):undefined};
  }catch(error){await rm(target,{recursive:true,force:true});throw error;}
}
export async function exportSkin(root:string,skin:StudioSkin,destination:string){
 const base=inside(root,'skins/'+skin.id),zip=new ZipFile(),temporary=destination+'.'+randomUUID()+'.tmp';const stream=createWriteStream(temporary),done=pipeline(zip.outputStream,stream);zip.on('error',e=>(zip.outputStream as Readable).destroy(e));
 try{for(const f of skinFiles(skin.manifest))zip.addFile(inside(base,f),f);try{await stat(path.join(base,'provenance.json'));zip.addFile(path.join(base,'provenance.json'),'provenance.json');}catch{}zip.end();await done;await (await import('node:fs/promises')).rename(temporary,destination);}catch(e){(zip.outputStream as Readable).destroy();await done.catch(()=>{});await rm(temporary,{force:true});throw e;}
}
export async function saveSkin(root:string,skin:StudioSkin){await atomicFile(inside(root,'skins/'+skin.id+'/skin.json'),JSON.stringify(skin.manifest,null,2));}

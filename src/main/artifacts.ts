import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, FileArtifact, ArtifactPreview } from '../shared/contracts';
import { contained, validatePath } from '../pet/main/tools/policy';

const types:Record<string,string>={'.html':'text/html','.htm':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.md':'text/markdown','.txt':'text/plain','.ts':'text/plain','.tsx':'text/plain','.py':'text/plain','.csv':'text/plain','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.pdf':'application/pdf'};
export const artifactDefinition={name:'pet_artifact_publish',description:'登记本次任务实际生成的文件，显示为可预览的文件卡片。传入绝对路径；HTML 的相关图片、CSS 和 JS 也需一并登记。',inputSchema:{type:'object',properties:{paths:{type:'array',items:{type:'string'},minItems:1,maxItems:32}},required:['paths'],additionalProperties:false}};
export class Artifacts {
  private previews=new Map<string,{sessionId:string;files:Map<string,FileArtifact>}>();
  async register(s:AgentSession, filenames:string[], roots:string[], allFolders=false) {
    const canonicalRoots=await Promise.all(roots.map(root=>realpath(root)));
    const result:FileArtifact[]=[];
    for(const file of filenames){const filename=await realpath(validatePath(file));if(!allFolders&&!canonicalRoots.some(root=>contained(root,filename)))throw Error('文件产物超出授权目录。');
      const info=await stat(filename);if(!info.isFile())throw Error('仅支持登记普通文件。');
      result.push({id:randomUUID(),name:path.basename(filename),path:filename,size:info.size,mime:types[path.extname(filename).toLowerCase()]??'application/octet-stream',createdAt:Date.now(),runId:s.runId!,modifiedAt:info.mtimeMs});
    }
    s.artifacts??=[];for(const item of result){const old=s.artifacts.find(a=>a.path===item.path&&a.runId===item.runId);if(old){item.id=old.id;Object.assign(old,item);}else s.artifacts.push(item);}return result;
  }
  async resolve(s:AgentSession,id:string) {
    const item=s.artifacts?.find(a=>a.id===id);if(!item)throw Error('此文件不属于当前聊天。');
    const canonical=await realpath(item.path);if(canonical.toLowerCase()!==item.path.toLowerCase())throw Error('文件路径已改变，请重新登记。');
    const info=await stat(canonical);if(!info.isFile())throw Error('文件已不可用。');
    if(info.size!==item.size||info.mtimeMs!==item.modifiedAt)throw Error('文件内容已改变，请让 Agent 重新登记后预览。');return item;
  }
  async preview(s:AgentSession,id:string,offset=0,page=1):Promise<ArtifactPreview> {
    const item=await this.resolve(s,id);
    if(!Number.isSafeInteger(offset)||offset<0||offset>item.size||!Number.isInteger(page)||page<1)throw Error('预览位置无效。');
    if(item.mime==='application/pdf') {
      if(item.size>32*1024*1024)throw Error('PDF 超过 32 MB，请使用本机 PDF 阅读器打开。');
      const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(await readFile(item.path))});
      try {const result=await parser.getScreenshot({partial:[page],desiredWidth:900,imageDataUrl:true,imageBuffer:false});const image=result.pages[0];if(!image)throw Error('PDF 页码不存在。');return {artifact:item,url:image.dataUrl,page,pages:result.total};}finally{await parser.destroy();}
    }
    if(item.mime==='text/html'||item.mime.startsWith('image/')){
      const token=randomUUID(),root=path.dirname(item.path),files=new Map<string,FileArtifact>();
      for(const file of s.artifacts??[])if(file.runId===item.runId&&contained(root,file.path))files.set(path.relative(root,file.path).split(path.sep).join('/'),file);
      this.previews.set(token,{sessionId:s.id,files});if(this.previews.size>32)this.previews.delete(this.previews.keys().next().value!);
      return {artifact:item,url:`artifact://${token}/${encodeURIComponent(item.name)}`};
    }
    if(item.mime.startsWith('text/')||item.mime==='application/json'){
      const file=await open(item.path,'r');try{const buffer=Buffer.alloc(Math.min(item.size-offset,256*1024+4));const {bytesRead}=await file.read(buffer,0,buffer.length,offset);let end=Math.min(bytesRead,256*1024);while(end>0&&end<bytesRead&&(buffer[end]&0xc0)===0x80)end--;const next=offset+end;return {artifact:item,text:buffer.subarray(0,end).toString('utf8'),offset,nextOffset:next<item.size?next:undefined,truncated:offset>0||next<item.size};}finally{await file.close();}
    }
    return {artifact:item};
  }
  async resource(url:string,sessions:AgentSession[]) {
    const u=new URL(url),preview=this.previews.get(u.hostname),name=decodeURIComponent(u.pathname.slice(1));
    if(!preview||u.search||name.includes('\\')||name.split('/').includes('..'))throw Error('预览资源无效。');
    const s=sessions.find(v=>v.id===preview.sessionId),item=preview.files.get(name);if(!s||!item)throw Error('预览资源未登记。');
    await this.resolve(s,item.id);return item;
  }
}

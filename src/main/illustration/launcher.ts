import { readFile, stat, mkdir, writeFile, open } from 'node:fs/promises';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import type { ComfyLaunchConfig } from '../../shared/illustration';
import { localEndpoint } from '../workshop/comfy';

const exists = async (file: string) => (await stat(file).catch(() => undefined))?.isFile() === true;
let torchInfo='';
async function hasTorch(python:string):Promise<boolean>{
  return new Promise(resolve=>execFile(python,['-c','import torch; print(torch.__version__, torch.cuda.is_available())'],{windowsHide:true,timeout:60000,maxBuffer:8192},(error,stdout)=>{torchInfo=error?(error.message||'').slice(0,200):String(stdout||'').trim();resolve(!error&&/True$/.test(torchInfo));}));
}
export async function discoverComfy(appData: string): Promise<ComfyLaunchConfig[]> {
  const records = JSON.parse(await readFile(path.join(appData,'Comfy Desktop/installations.json'),'utf8').catch(()=>'[]'));
  if (!Array.isArray(records)) throw Error('ComfyUI 安装记录格式无效，请手动配置启动路径。');
  const found: ComfyLaunchConfig[] = [];
  for (const row of records) {
    if (row.status !== 'installed' || typeof row.installPath !== 'string' || !path.isAbsolute(row.installPath)) continue;
    const root = row.installPath, entry = path.join(root,'ComfyUI/main.py');
    const pythonCandidates = [path.join(root,'ComfyUI/.venv/Scripts/python.exe'),path.join(root,'.venv/Scripts/python.exe'),path.join(root,'standalone-env/python.exe')];
    let python:string|undefined;
    for(const candidate of pythonCandidates)if(await exists(candidate)&&await hasTorch(candidate)){python=candidate;break;}
    if (!python || !await exists(entry)) continue;
    const shared = path.resolve(root,'../../ComfyUI-Shared');
    const sharedModels = path.join(shared,'models');
    found.push({ endpoint:'http://127.0.0.1:8188',python,entry,modelsRoot:path.join(root,'ComfyUI/models'),output:path.join(root,'ComfyUI/output'),source:'desktop',extraModels:(await stat(sharedModels).catch(()=>undefined))?.isDirectory()?[sharedModels]:[] });
  }
  return found;
}

/** One start promise per endpoint; never kills a service belonging to Comfy Desktop. */
export class ComfyLauncher {
  private starts = new Map<string, Promise<void>>();
  private children = new Map<string, ChildProcess>();
  constructor(private root: string, private update: (state:'starting'|'ready'|'error',message:string)=>void) {}
  async ready(endpoint: string): Promise<boolean> {
    try {
      const r = await fetch(localEndpoint(endpoint)+'/system_stats',{signal:AbortSignal.timeout(2000),redirect:'error'});
      if (!r.ok) return false;
      const body = await r.json(); return Array.isArray(body.devices) && typeof body.system === 'object';
    } catch { return false; }
  }
  ensure(config: ComfyLaunchConfig): Promise<void> {
    const endpoint = localEndpoint(config.endpoint);
    const existing = this.starts.get(endpoint); if (existing) return existing;
    const promise = this.start(structuredClone(config)).finally(()=>this.starts.delete(endpoint));
    this.starts.set(endpoint,promise); return promise;
  }
  private async start(config: ComfyLaunchConfig) {
    const endpoint = localEndpoint(config.endpoint);
    try {
      if (await this.ready(endpoint)) { this.update('ready','已连接本机 ComfyUI'); return; }
      if (this.children.has(endpoint)) throw Error('ComfyUI 进程仍在启动或收尾，请查看启动日志后重试。');
      const u = new URL(endpoint), port = Number(u.port || 80);
      const occupied = await new Promise<boolean>(resolve=>{
        const socket=createConnection({host:u.hostname.replace(/[\[\]]/g,''),port});
        const done=(value:boolean)=>{socket.destroy();resolve(value);};
        socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(1000,()=>done(true));
      });
      if (occupied) throw Error(`端口 ${port} 已被占用，但未返回 ComfyUI 状态；请检查地址或端口。`);
      for (const file of [config.python,config.entry]) if (!path.isAbsolute(file) || !await exists(file)) throw Error(`启动文件不存在：${file}`);
      if (!await hasTorch(config.python)) throw Error(`这个 Python 没有可用的 torch/CUDA：${config.python}（${torchInfo||'无输出'}）。请换成 ComfyUI 自带的 .venv 解释器，或先完成依赖安装。`);
      for (const dir of [config.modelsRoot,...config.extraModels??[]]) if (!path.isAbsolute(dir) || !(await stat(dir).catch(()=>undefined))?.isDirectory()) throw Error(`模型目录不存在：${dir}`);
      if (!path.isAbsolute(config.output)) throw Error('输出目录必须为绝对路径。');
      await mkdir(this.root,{recursive:true}); await mkdir(config.output,{recursive:true});
      const modelPaths: Record<string,Record<string,string>> = {};
      [config.modelsRoot,...config.extraModels??[]].forEach((base,index)=>{
        modelPaths['dragon_'+index]={base_path:base,...Object.fromEntries(['checkpoints','diffusion_models','text_encoders','vae','loras','embeddings'].map(name=>[name,name]))};
      });
      // JSON is a YAML subset; paths are escaped instead of interpolated into a shell.
      const modelConfig=path.join(this.root,'model-paths.json');await writeFile(modelConfig,JSON.stringify(modelPaths));
      const logPath=path.join(this.root,'comfy-start.log'),log=await open(logPath,'a');
      this.update('starting','正在启动本机 ComfyUI…');
      const args=[config.entry,'--listen','127.0.0.1','--port',String(port),'--output-directory',config.output,'--extra-model-paths-config',modelConfig];
      await log.write(`\n===== ${new Date().toLocaleString('zh-CN')} 启动 ComfyUI =====\npython: ${config.python}\nargs: ${args.join(' ')}\n`);
      const child=spawn(config.python,args,{cwd:path.dirname(config.entry),windowsHide:true,shell:false,stdio:['ignore',log.fd,log.fd]});
      this.children.set(endpoint,child);let failure:string|undefined;
      child.once('error',e=>{failure=e.message;this.children.delete(endpoint);});
      child.once('exit',code=>{failure=`ComfyUI 进程已退出（${code}），请查看 ${logPath}`;this.children.delete(endpoint);});
      await log.close();
      const deadline=Date.now()+180000;
      while (Date.now()<deadline) {
        if (failure) throw Error(failure);
        if (await this.ready(endpoint)) {this.update('ready','ComfyUI 已就绪');return;}
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw Error(`启动超时，进程可能仍在加载；请查看 ${logPath}。重试不会重复启动。`);
    } catch(e) {this.update('error',(e as Error).message);throw e;}
  }
}

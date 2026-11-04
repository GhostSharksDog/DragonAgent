import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { contained, validatePath } from '../pet/main/tools/policy';
import type { ToolContext, ToolRegistry } from '../../packages/agent-core/src';

const string={type:'string',minLength:1,maxLength:4096};
async function allowedPath(value:unknown,ctx:ToolContext) {
  const target=await realpath(validatePath(value));
  const roots=await Promise.all(ctx.agent.grant.folders.map(root=>realpath(root)));
  if(!ctx.agent.grant.allFolders&&!roots.some(root=>contained(root,target)))throw Error('路径超出当前任务授权目录。');
  ctx.signal.throwIfAborted();return target;
}
export function registerBasicTools(registry:ToolRegistry) {
  registry.register({name:'local_time',description:'读取当前时间或将 ISO 时间转换到 IANA 时区，例如 Asia/Shanghai。',effect:'read',parameters:{type:'object',properties:{timezone:string,instant:string},additionalProperties:false},execute:async args=>{
    const now=args.instant?new Date(String(args.instant)):new Date();if(!Number.isFinite(now.getTime()))throw Error('时间格式无效，请使用带时区的 ISO 时间。');
    const timezone=String(args.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone);
    return {text:JSON.stringify({utc:now.toISOString(),timezone,local:new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,dateStyle:'full',timeStyle:'long'}).format(now)})};
  }});
  registry.register({name:'local_git_read',description:'只读查看本地 Git 仓库状态、最近提交、差异或分支。依赖系统 Git；不执行仓库脚本、外部 diff 或写操作。',effect:'read',parameters:{type:'object',properties:{directory:string,operation:{enum:['status','log','diff','branches']}},required:['directory','operation'],additionalProperties:false},execute:async(args,ctx)=>{
    const cwd=await allowedPath(args.directory,ctx);if(!(await stat(cwd)).isDirectory())throw Error('请提供仓库目录。');
    const commands:Record<string,string[]>={status:['status','--short','--branch','--untracked-files=normal'],log:['log','-30','--format=%h %ad %s','--date=iso-strict'],diff:['diff','--no-ext-diff','--no-textconv','--stat','--patch','--'],branches:['branch','--list','--format=%(refname:short) %(objectname:short)']};
    return new Promise((resolve,reject)=>{
      const child=spawn('git',['--no-optional-locks','--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','submodule.recurse=false',...commands[String(args.operation)]],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}});
      let output='',cut=false,timeout=false;const collect=(b:Buffer)=>{output+=b.toString();if(output.length>128000){output=output.slice(0,128000);cut=true;child.kill();}};
      child.stdout.on('data',collect);child.stderr.on('data',collect);
      const abort=()=>child.kill(),timer=setTimeout(()=>{timeout=true;abort();},15000);ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)abort();
      const clean=()=>{clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);};
      child.on('error',(error:NodeJS.ErrnoException)=>{clean();reject(Error(error.code==='ENOENT'?'未找到系统 Git，请从 https://git-scm.com/download/win 安装。':error.message));});
      child.on('close',code=>{clean();if(ctx.signal.aborted)return reject(ctx.signal.reason);resolve({text:JSON.stringify({exitCode:code,output,truncated:cut,timedOut:timeout}),isError:timeout||code!==0&&!cut});});
    });
  }});
  registry.register({name:'sqlite_read',description:'只读查看 SQLite 表结构或执行单条 SELECT/WITH 查询。最多返回 200 行、256 KB，3 秒超时。禁止修改、扩展加载和连接其他数据库。',effect:'read',parameters:{type:'object',properties:{path:string,query:{type:'string',maxLength:16000}},required:['path'],additionalProperties:false},execute:async(args,ctx)=>{
    const filename=await allowedPath(args.path,ctx);if(!(await stat(filename)).isFile())throw Error('请选择 SQLite 文件。');
    const query=String(args.query??"SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name");
    if(!/^\s*(SELECT|WITH)\b/i.test(query)||/;|\b(ATTACH|DETACH|PRAGMA|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|LOAD_EXTENSION|WRITEFILE|READFILE)\b/i.test(query))throw Error('仅允许一条不含数据库修改、文件函数或扩展操作的 SELECT/WITH 查询。');
    return new Promise((resolve,reject)=>{
      const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');let db;try{db=new DatabaseSync(workerData.filename,{readOnly:true,allowExtension:false});db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');const stmt=db.prepare(workerData.query);stmt.setReadBigInts(true);const rows=[];let bytes=0,truncated=false;for(const row of stmt.iterate()){const value=JSON.parse(JSON.stringify(row,(_,v)=>typeof v==='bigint'?v.toString():v));bytes+=JSON.stringify(value).length;if(rows.length===200||bytes>262144){truncated=true;break;}rows.push(value);}parentPort.postMessage({text:JSON.stringify({rows,truncated})});}catch(e){parentPort.postMessage({text:e.message,isError:true});}finally{db?.close();}`,{eval:true,workerData:{filename,query},resourceLimits:{maxOldGenerationSizeMb:64}});
      let settled=false;const finish=(error?:Error,value?:{text:string;isError?:boolean})=>{if(settled)return;settled=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value!);};
      const abort=()=>finish(Error('数据库查询已取消。')),timer=setTimeout(()=>finish(Error('数据库查询超过 3 秒，已停止。')),3000);
      ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)abort();
      worker.once('message',value=>finish(undefined,value));worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(Error(`查询进程退出（${code}）。`));});
    });
  }});
}

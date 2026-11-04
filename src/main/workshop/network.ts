import {net} from 'electron';

function allowed(url:URL){return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(url.hostname==='civitai.com'||url.hostname.endsWith('.civitai.com')||url.hostname.endsWith('.cloudflarestorage.com'));}
// Electron fetch cancels manual redirects. Surface ClientRequest redirects explicitly,
// then start a new request so authorization never follows a redirect to a CDN.
export function civitaiNetwork(key:()=>Promise<string>):typeof fetch {
  return async(input,init)=>{
    if(init?.body||init?.method&&init.method!=='GET')throw Error('模型服务只接受读取请求。');
    let url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
    for(let i=0;i<6;i++){
      if(!allowed(url))throw Error('Civitai 返回了不支持的下载地址。');
      const headers=new Headers(init?.headers);headers.delete('authorization');
      if(url.hostname==='civitai.com'){const secret=await key();if(secret)headers.set('Authorization',`Bearer ${secret}`);}
      const result=await request(url.href,headers,init?.signal??undefined);
      const location=result.headers.get('location');if(result.status>=300&&result.status<400&&location){await result.body?.cancel();url=new URL(location,url);continue;}
      return result;
    }
    throw Error('Civitai 重定向次数过多。');
  };
}
function request(url:string,headers:Headers,signal?:AbortSignal):Promise<Response>{
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const req=net.request({url,method:'GET',redirect:'manual',headers:Object.fromEntries(headers.entries())});
    let closed=false,controller:ReadableStreamDefaultController<Uint8Array>|undefined;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const fail=(error:unknown)=>{if(closed)return;closed=true;cleanup();controller?.error(error);reject(error);req.abort();};
    const abort=()=>fail(signal?.reason??Error('请求已取消'));
    let timer=setTimeout(()=>fail(Error('Civitai 请求超时，请重试。')),30000);
    signal?.addEventListener('abort',abort,{once:true});
    req.on('redirect',(status,_method,location)=>{if(closed)return;closed=true;cleanup();resolve(new Response(null,{status,headers:{location}}));req.abort();});
    req.on('error',fail);
    req.on('response',response=>{
      if(closed)return;
      const resultHeaders=new Headers();for(const [name,value]of Object.entries(response.headers))resultHeaders.set(name,Array.isArray(value)?value.join(', '):value);
      const body=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel(){if(!closed){closed=true;cleanup();req.abort();}}},{highWaterMark:65536,size:chunk=>chunk.byteLength});
      response.on('end',()=>{if(!closed){closed=true;cleanup();controller!.close();}});
      response.on('error',fail);response.on('aborted',()=>fail(Error('Civitai 下载连接中断，请重试。')));
      response.on('data',chunk=>{if(closed)return;clearTimeout(timer);timer=setTimeout(()=>fail(Error('Civitai 下载超时，请重试。')),30000);if((controller!.desiredSize??0)<-16*1024**2){fail(Error('下载写入速度不足，请稍后重试。'));return;}controller!.enqueue(new Uint8Array(chunk));});
      resolve(new Response(body,{status:response.statusCode,headers:resultHeaders}));
    });
    if(signal?.aborted){abort();return;}req.end();
  });
}

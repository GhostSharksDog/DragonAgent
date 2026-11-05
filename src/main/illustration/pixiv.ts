import { BrowserWindow, session } from 'electron';
import type { IllustrationReference } from '../../shared/illustration';

function pixivUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.pixiv.net','accounts.pixiv.net'].includes(url.hostname)) throw Error('请使用 Pixiv 官方作品或搜索链接。');
  return url;
}
// Authentication providers navigate between their own HTTPS endpoints. This browser
// has no app preload/IPC, and artwork extraction still requires a Pixiv origin.
function browserUrl(input: string) {
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('登录浏览窗口只允许 HTTPS 网页。');
  return url.href;
}

/** User-controlled browsing, without an app preload or access to app IPC. */
export class PixivBrowser {
  private window?: BrowserWindow;
  private metadataWindow?:BrowserWindow;
  private tail: Promise<unknown> = Promise.resolve();
  private async navigate(win:BrowserWindow,url:string){
    await new Promise<void>((resolve,reject)=>{
      const finish=(error?:Error)=>{clearTimeout(timer);if(!win.isDestroyed())win.webContents.removeListener('dom-ready',ready);error?reject(error):resolve();};
      const ready=()=>finish();
      const timer=setTimeout(()=>finish(Error('Pixiv 页面加载超时，请检查网络或在浏览窗口手动打开作品。')),20000);
      win.webContents.once('dom-ready',ready);void win.loadURL(url).then(()=>finish(),e=>finish(e));
    });
  }
  private browser() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const partition = session.fromPartition('persist:dragon-illustration-pixiv');
    partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    partition.setPermissionCheckHandler(()=>false);
    partition.on('will-download',event=>event.preventDefault());
    const win = new BrowserWindow({width:1100,height:820,title:'Pixiv · 选择插画参考',autoHideMenuBar:true,webPreferences:{partition:'persist:dragon-illustration-pixiv',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    win.webContents.setWindowOpenHandler(({url})=>{try{browserUrl(url);return {action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{partition:'persist:dragon-illustration-pixiv',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,preload:undefined}}};}catch{return {action:'deny'};}});
    win.webContents.on('will-navigate',(event,url)=>{try{browserUrl(url);}catch{event.preventDefault();}});
    this.window=win;win.on('closed',()=>{if(this.window===win)this.window=undefined;});return win;
  }
  private serial<T>(work:()=>Promise<T>):Promise<T> {
    const job=this.tail.then(work,work);this.tail=job.catch(()=>undefined);return job;
  }
  async open(query?: string,artistId?:string) {
    const win=this.browser();win.show();win.focus();
    if(artistId&&!/^\d+$/.test(artistId))throw Error('画师 ID 应为 Pixiv 数字用户编号');
    const url=artistId?`https://www.pixiv.net/users/${artistId}/artworks`:query?`https://www.pixiv.net/tags/${encodeURIComponent(query.slice(0,160))}/artworks`:'https://www.pixiv.net/';
    await this.serial(()=>this.navigate(win,url));
  }
  /** Read only visible artwork links. More results require the user to scroll/load the page. */
  async candidates(excluded:string[]=[]): Promise<{id:string;url:string}[]> {
    return this.serial(async()=>{
      const win=this.browser();const url=pixivUrl(win.webContents.getURL());
      if(url.hostname!=='www.pixiv.net')throw Error('请先在 Pixiv 窗口完成登录，然后返回读取作品。');
      const data:unknown=await win.webContents.executeJavaScript(`(() => {
        if (/captcha|challenge/i.test(location.pathname) || document.querySelector('iframe[src*="captcha"]')) return null;
        return [...new Set([...document.querySelectorAll('a[href]')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.href))].slice(0,300);
      })()`);
      if(!Array.isArray(data))throw Error('Pixiv 正在要求验证，请在浏览窗口完成后重试。');
      const found:{id:string;url:string}[]=[];
      for(const raw of data) {
        if(typeof raw!=='string')continue;
        try {if(pixivUrl(raw).hostname!=='www.pixiv.net')continue;}catch{continue;}
        const id=raw.match(/\/artworks\/(\d+)/)?.[1];if(!id||excluded.includes(id))continue;
        found.push({id,url:`https://www.pixiv.net/artworks/${id}`});if(found.length===18)break;
      }
      return found;
    });
  }
  private metadataBrowser(){
    this.browser(); // Install permission denial on the shared isolated session.
    if(this.metadataWindow&&!this.metadataWindow.isDestroyed())return this.metadataWindow;
    const win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{partition:'persist:dragon-illustration-pixiv',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{try{pixivUrl(url);}catch{event.preventDefault();}});
    this.metadataWindow=win;win.on('closed',()=>{if(this.metadataWindow===win)this.metadataWindow=undefined;});return win;
  }
  private async hydratedMetadata(win:BrowserWindow,script:string):Promise<unknown>{
    const deadline=Date.now()+12000;
    while(!win.isDestroyed()){
      const current=pixivUrl(win.webContents.getURL());
      if(current.hostname!=='www.pixiv.net')throw Error('请先在 Pixiv 窗口完成登录或验证');
      const result=await win.webContents.executeJavaScript(script);if(result||Date.now()>=deadline)return result;
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    throw Error('Pixiv 资料窗口已关闭');
  }
  async artwork(input: string): Promise<IllustrationReference & {imageUrl?:string}> {
    const url=pixivUrl(input),id=url.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/)?.[1];
    if(url.hostname!=='www.pixiv.net'||!id)throw Error('请输入 Pixiv 作品链接。');
    return this.serial(async()=>{
      const win=this.metadataBrowser();await this.navigate(win,`https://www.pixiv.net/artworks/${id}`);
      const raw:unknown=await this.hydratedMetadata(win,`(() => {
        const meta=document.querySelector('meta#meta-preload-data');
        try { const data=meta?JSON.parse(meta.content):{};const art=data.illust?.[${JSON.stringify(id)}];
          if(!art){
            const title=document.querySelector('h1')?.textContent?.trim();
            const author=[...document.querySelectorAll('h2 a[href*="/users/"]')].find(a=>a.textContent.trim());
            const authorUrl=author?new URL(author.href):null;
            const artistId=authorUrl?.hostname==='www.pixiv.net'?authorUrl.pathname.split('/users/')[1]?.split('/')[0]:undefined;
            const image=[...document.querySelectorAll('main img')].find(i=>{try{const u=new URL(i.currentSrc||i.src);return u.hostname.endsWith('.pximg.net')&&u.pathname.split('/').at(-1)?.startsWith(${JSON.stringify(id+'_p0_')})&&i.naturalWidth>300&&i.naturalHeight>300;}catch{return false;}});
            if(!title||!author||!artistId||!image)return null;
            return {id:${JSON.stringify(id)},title,artist:author.textContent.trim(),artistId,tags:[...document.querySelectorAll('main a[href*="/tags/"]')].slice(0,30).map(a=>a.textContent.trim()),imageUrl:image.currentSrc||image.src,thumbnail:image.currentSrc||image.src};
          }
          return {id:art.id,title:art.title,artist:art.userName,artistId:art.userId,tags:art.tags?.tags?.map(t=>t.tag),imageUrl:art.urls?.regular,thumbnail:art.urls?.small};
        }catch{return null;}
      })()`);
      if(!raw||typeof raw!=='object')throw Error('无法读取当前作品资料。可能需要登录、验证，或作品不可访问；请在浏览窗口检查。');
      const data=raw as Record<string,unknown>;
      if(String(data.id)!==id||typeof data.title!=='string'||typeof data.artist!=='string'||!/^\d+$/.test(String(data.artistId)))throw Error('Pixiv 作品资料不完整，未建立候选。');
      const image=(value:unknown)=>{if(typeof value!=='string')return;try{const u=new URL(value);if(u.protocol==='https:'&&u.hostname.endsWith('.pximg.net')&&!u.username&&!u.password&&!u.port)return u.href;}catch{return;}};
      return {id,url:`https://www.pixiv.net/artworks/${id}`,title:data.title.slice(0,300),artist:data.artist.slice(0,100),artistId:String(data.artistId),tags:Array.isArray(data.tags)?data.tags.filter((v):v is string=>typeof v==='string').slice(0,60):[],thumbnail:image(data.thumbnail),imageUrl:image(data.imageUrl),selected:false,fetchedAt:Date.now()};
    });
  }
  close(){if(this.window&&!this.window.isDestroyed())this.window.close();if(this.metadataWindow&&!this.metadataWindow.isDestroyed())this.metadataWindow.close();}
}

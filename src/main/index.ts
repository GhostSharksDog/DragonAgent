import { IllustrationManager } from './illustration/manager';
import type { IllustrationAction } from '../shared/illustration';
import { siteIcon } from './favicon';
import { civitaiNetwork } from './workshop/network';
import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, Tray, nativeImage, globalShortcut, screen, nativeTheme } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, importLegacy } from './store';
import { Secrets } from './secrets';
import { Runtime } from './runtime';
import { loadSkin } from '../pet/main/skin';
import type { Action } from '../shared/contracts';
import { isBusy } from '../shared/contracts';
import { WorkshopManager } from './workshop/manager';
import { copyFile, readFile } from 'node:fs/promises';
import type { WorkshopAction } from '../shared/workshop';

protocol.registerSchemesAsPrivileged(['pet-skin', 'workshop', 'artifact', 'site-icon', 'illustration'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, ...(scheme === 'pet-skin' ? { stream: true } : {}) } })));
if (process.env.DRAGON_DATA_DIR) app.setPath('userData', path.resolve(process.env.DRAGON_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'DragonAgent'));
let runtime: Runtime, workbench: BrowserWindow, pet: BrowserWindow, bubble: BrowserWindow, tray: Tray;
let workshop: WorkshopManager;
let illustration: IllustrationManager;
let quitting = false;
const windows = new Set<BrowserWindow>();
const root = path.resolve(__dirname, '..');
const branding = path.join(root, 'assets/branding');
async function open(url: string) { const value = new URL(url); if (!['https:', 'http:'].includes(value.protocol)) throw new Error('只允许打开网页链接。'); await shell.openExternal(value.href); }
function createWindow(kind: 'workbench' | 'pet' | 'bubble') {
  const transparent = kind !== 'workbench';
  const theme = runtime.view.resolvedTheme, colors = theme === 'dark' ? { background: '#1e1b25', symbol: '#e4ddef' } : { background: '#f6f7f9', symbol: '#20242e' };
  const win = new BrowserWindow({ ...(transparent ? {} : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: 36 } }), icon: path.join(branding, 'dragon.ico'), width: kind === 'workbench' ? 1260 : kind === 'pet' ? 272 : 390, height: kind === 'workbench' ? 850 : kind === 'pet' ? 296 : 460, minWidth: kind === 'workbench' ? 850 : undefined, minHeight: kind === 'workbench' ? 600 : undefined, title: 'DragonAgent', show: false, frame: !transparent, transparent, backgroundColor: transparent ? '#00000000' : colors.background, resizable: !transparent, hasShadow: !transparent, skipTaskbar: transparent, alwaysOnTop: transparent, autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'main/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  windows.add(win); win.on('closed', () => windows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-frame-navigate', event => { if (!event.isMainFrame && !event.url.startsWith('artifact:')) event.preventDefault(); });
  void win.loadFile(path.join(root, 'renderer/index.html'), { query: { view: kind, theme } });
  return win;
}
let appliedTheme: string | undefined;
function syncTheme() {
  const configured = runtime.state.settings.theme;
  runtime.view.resolvedTheme = configured === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : configured;
  const dark = runtime.view.resolvedTheme === 'dark';
  if (workbench && !workbench.isDestroyed() && appliedTheme !== runtime.view.resolvedTheme) { appliedTheme = runtime.view.resolvedTheme; workbench.setBackgroundColor(dark ? '#1e1b25' : '#f6f7f9'); workbench.setTitleBarOverlay({ color: dark ? '#1e1b25' : '#f6f7f9', symbolColor: dark ? '#e4ddef' : '#20242e', height: 36 }); }
}
/** 工坊快照附带“是否已保存 Civitai 密钥”，让界面能显示真实状态，而不是靠输入框是否为空来猜。 */
function syncWorkshop() {
  runtime.view.workshop = { ...workshop.snapshot(), civitaiKeySaved: runtime.secrets.has('workshop:civitai') };
  runtime.changed(false);
}
function moveBubble() {
  if (!pet || pet.isDestroyed() || !bubble || bubble.isDestroyed() || quitting) return;
  const r = pet.getBounds(), area = screen.getDisplayMatching(r).workArea;
  const b = bubble.getBounds(); const left = r.x - b.width - 12 >= area.x;
  bubble.setPosition(Math.round(left ? r.x - b.width - 12 : Math.min(area.x + area.width - b.width, r.x + r.width + 12)), Math.round(Math.max(area.y, Math.min(area.y + area.height - b.height, r.y + r.height - b.height))));
}
function syncWindows() {
  if (!pet || pet.isDestroyed() || !bubble || bubble.isDestroyed() || quitting) return;
  const config = runtime.state.settings.pet;
  const size = Math.round(272 * config.scale), height = Math.round(296 * config.scale);
  if (pet.getBounds().width !== size) pet.setSize(size, height);
  pet.setAlwaysOnTop(config.alwaysOnTop, 'floating'); bubble.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  if (config.visible) pet.showInactive(); else pet.hide();
  const quota = runtime.view.petView === 'quota', wantWidth = quota ? 390 : 360, wantHeight = quota ? 460 : 100;
  if (bubble.getBounds().height !== wantHeight || bubble.getBounds().width !== wantWidth) {
    // Windows locks min/max bounds on non-resizable windows; unlock only for this programmatic resize.
    bubble.setResizable(true); bubble.setSize(wantWidth, wantHeight); bubble.setResizable(false);
  }
  moveBubble();
  if (config.visible && runtime.view.petView !== 'hidden') bubble.showInactive(); else bubble.hide();
}
function prepareWorkbench() {
  const win = createWindow('workbench');
  win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
  win.once('ready-to-show', () => { if (!quitting && !win.isDestroyed()) { win.show(); win.focus(); } });
  return win;
}
function showWorkbench() {
  if (quitting || !runtime) return;
  if (!workbench || workbench.isDestroyed()) { workbench = prepareWorkbench(); return; }
  workbench.show(); if (workbench.isMinimized()) workbench.restore(); workbench.focus();
}
function togglePet() { runtime.state.settings.pet.visible = !runtime.state.settings.pet.visible; runtime.changed(); syncWindows(); }
function menu() { Menu.buildFromTemplate([{ label: '打开 DragonAgent', click: showWorkbench }, { label: runtime.state.settings.pet.visible ? '收起龙娘' : '召唤龙娘', click: togglePet }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]).popup(); }
async function action(value: Action) {
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') throw new Error('无效操作。');
  if(value.type==='window.exit'){app.quit();return;}
  if(value.type==='illustration.lora.import'){const result=await dialog.showOpenDialog(workbench,{title:'选择角色 LoRA',properties:['openFile'],filters:[{name:'SafeTensors',extensions:['safetensors']}]});if(!result.canceled)return illustration.importLora(value.id,result.filePaths[0]);return;}
  if(value.type==='illustration.save'){const p=illustration.state.projects.find(p=>p.id===value.id),run=p?.runs.find(r=>r.id===value.runId);if(!run?.file)throw Error('图片尚未生成');const source=await illustration.asset(run.file);const result=await dialog.showSaveDialog(workbench,{defaultPath:p!.name.replace(/[<>:"/\\|?*]/g,'_')+'.png'});if(result.filePath&&!result.canceled)await copyFile(source,result.filePath);return;}
  if(value.type.startsWith('illustration.'))return illustration.action(value as IllustrationAction);
  switch (value.type) {
    case 'pet.chat.pickFiles': {const result=await dialog.showOpenDialog(bubble,{title:'给龙娘添加参考文件',properties:['openFile','multiSelections']});if(!result.canceled)return runtime.action({type:'pet.chat.attach',files:result.filePaths.map(file=>({path:file,name:path.basename(file)}))});return;}
    case 'artifact.reveal': {const item=await runtime.artifacts.resolve(runtime.session(value.sessionId),value.artifactId);shell.showItemInFolder(item.path);return true;}
    case 'artifact.save': {
      const item=await runtime.artifacts.resolve(runtime.session(value.sessionId),value.artifactId);
      const result=await dialog.showSaveDialog(workbench,{defaultPath:item.name});
      if(result.canceled||!result.filePath)return false;
      await runtime.artifacts.resolve(runtime.session(value.sessionId),value.artifactId);
      if(path.resolve(result.filePath).toLowerCase()!==item.path.toLowerCase())await copyFile(item.path,result.filePath);return true;
    }
    case 'workshop.civitai.key': {
      const apiKey=value.apiKey.trim();
      await runtime.secrets.set('workshop:civitai',apiKey);
      if(await runtime.secrets.get('workshop:civitai')!==apiKey)throw new Error('密钥保存后无法读回，请重试。');
      syncWorkshop();return true;
    }
    case 'workshop.civitai.clear': runtime.secrets.remove('workshop:civitai');syncWorkshop();return true;
    case 'workshop.lora.import': {
      const result=await dialog.showOpenDialog(workbench,{title:'选择 SDXL 角色 LoRA',properties:['openFile'],filters:[{name:'SafeTensors',extensions:['safetensors']}]});
      if(!result.canceled)return workshop.importLora(value.id,result.filePaths[0]);return false;
    }
    case 'workshop.upload': {
      const result = await dialog.showOpenDialog(workbench, { title: '选择完整角色立绘', properties: ['openFile'], filters: [{ name: '角色图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (!result.canceled) return workshop.upload(value.id, result.filePaths[0]); return false;
    }
    case 'workshop.export': {
      const project = workshop.state.projects.find(p => p.id === value.id);
      if (!project) throw new Error('制作项目不存在。');
      const result = await dialog.showSaveDialog(workbench, { title: '导出桌宠动画包', defaultPath: `${project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.zip`, filters: [{ name: '桌宠动画包', extensions: ['zip'] }] });
      if (!result.canceled && result.filePath) return workshop.export(value.id, result.filePath); return false;
    }
    case 'window.workbench': if (value.page) { runtime.view.workbenchPage = value.page; runtime.view.workbenchPageRevision = (runtime.view.workbenchPageRevision ?? 0) + 1; runtime.changed(false); } showWorkbench(); return;
    case 'window.menu': menu(); return;
    case 'external.open': return open(value.url);
    case 'pet.toggle': togglePet(); return;
    case 'pet.view': runtime.view.petView = value.view; runtime.changed(false); syncWindows(); if (value.view === 'compose') { bubble.show(); bubble.focus(); } if (value.view === 'quota') void runtime.codex.quota().catch(() => undefined); return;
    case 'pet.drag': {
      if (!Number.isFinite(value.dx) || !Number.isFinite(value.dy)) return;
      const b = pet.getBounds(), area = screen.getDisplayMatching(b).workArea;
      const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - b.width, b.x + value.dx))), y = Math.round(Math.max(area.y, Math.min(area.y + area.height - b.height, b.y + value.dy)));
      pet.setPosition(x, y); runtime.state.settings.pet.x = x; runtime.state.settings.pet.y = y; moveBubble(); runtime.changed(); return;
    }
    case 'session.workspace': {
      const s = runtime.session(value.id); if (isBusy(s) || s.nativeId) throw new Error('已开始的会话固定工作目录，请创建新会话选择其他目录。');
      const result = await dialog.showOpenDialog(workbench, { title: '选择此会话可操作的文件夹', properties: ['openDirectory'] });
      if (!result.canceled) { s.workspace = result.filePaths[0]; runtime.changed(); } return;
    }
    case 'session.attachFiles': {
      const s=runtime.session(value.id); if(s.readOnly)throw new Error('当前不能添加文件。');
      const result=await dialog.showOpenDialog(workbench,{title:'给龙娘添加参考文件',properties:['openFile','multiSelections'],filters:[{name:'文档、图片与代码',extensions:['txt','md','pdf','docx','csv','json','ts','js','tsx','jsx','html','css','png','jpg','jpeg','webp','gif']},{name:'所有文件',extensions:['*']}]});
      if(!result.canceled)await runtime.attachFiles(s.id,result.filePaths); return;
    }
    case 'legacy.import': {
      const result = await dialog.showOpenDialog(workbench, { title: '选择 Legacy SQLite 数据库（只读导入）', filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }], properties: ['openFile'] });
      if (result.canceled) return; const imported = importLegacy(result.filePaths[0], runtime.state); runtime.changed(); return imported;
    }
    default: { if (value.type.startsWith('workshop.') || value.type === 'skin.select') return workshop.action(value as WorkshopAction); const result = await runtime.action(value); if (value.type === 'settings.save' || value.type === 'pet.chatMode') syncWindows(); return result; }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (workbench) showWorkbench(); });
  void app.whenReady().then(async () => {
    const home = app.getPath('userData');
    const store = new Store(home);
    runtime = new Runtime(store, new Secrets(store), { home, version: app.getVersion(), workerPath: path.join(root, 'main/agent-worker.cjs'), open });
    await runtime.cleanDeletedSessions().catch(() => console.warn('已删除对话的缓存清理尚未完成，将在下次启动重试。'));
    syncTheme();
    nativeTheme.on('updated', () => { syncTheme(); runtime.changed(false); });
    if (!runtime.state.settings.codexPath && app.isPackaged) runtime.state.settings.codexPath = path.join(root, 'runtime/codex/bin/codex.exe');
    let skins = path.join(root, 'assets/skins/blue-fish');
    try { await loadSkin(path.join(skins, 'skin.json')); } catch { skins = path.join(root, 'assets/skins/silver-dragon-frames'); }
    runtime.view.skin = await loadSkin(path.join(skins, 'skin.json'));
    const civitaiFetch=civitaiNetwork(()=>runtime.secrets.get('workshop:civitai'));
    workshop = new WorkshopManager({ home, fetch: civitaiFetch, workerPath: path.join(root, 'main/workshop-worker.cjs'), bundledSkin: path.join(root, 'assets/skins/silver-dragon-frames/skin.json'),
      changed: () => syncWorkshop(),
      skin: skin => { runtime.view.skin = skin; runtime.view.animationStartedAt = Date.now(); },
      preferences: () => runtime.state.settings.assistant, profiles: () => runtime.state.settings.profiles, key: id => runtime.secrets.get(id),
    });
    syncWorkshop();
    await workshop.init();
    illustration=new IllustrationManager({workerPath:path.join(root,'main/illustration-worker.cjs'),home,appData:app.getPath('appData'),fetch:civitaiFetch,loras:()=>workshop.state.projects,profiles:()=>runtime.state.settings.profiles,key:id=>runtime.secrets.get(id),changed:()=>{runtime.view.illustration=illustration.state;runtime.changed(false);}});
    runtime.view.illustration=illustration.state;
    runtime.illustration={list:()=>illustration.state.projects.map(p=>({id:p.id,name:p.name,status:p.status})),create:async(description,commandId)=>{const id=await illustration.action({type:'illustration.create',description,commandId});runtime.view.workbenchPage='illustration';runtime.view.workbenchPageRevision=(runtime.view.workbenchPageRevision??0)+1;runtime.changed(false);showWorkbench();return {id,status:'project-created',message:'已创建插画项目，尚未生成图片'};}};
    protocol.handle('illustration',async request=>{try{const u=new URL(request.url);if(u.hostname!=='asset')throw Error('无效素材');return await net.fetch(pathToFileURL(await illustration.asset(decodeURIComponent(u.pathname.slice(1)))).href);}catch{return new Response('素材不可用',{status:404});}});
    protocol.handle('site-icon',async request=>{const u=new URL(request.url);if(u.hostname!=='icon')return new Response('',{status:404});const image=await siteIcon(decodeURIComponent(u.pathname.slice(1)));return image?new Response(new Uint8Array(image),{headers:{'Content-Type':'image/png','Cache-Control':'max-age=300'}}):new Response('',{status:404});});
    protocol.handle('workshop', async request => {
      try { const u = new URL(request.url); return await net.fetch(pathToFileURL(await workshop.asset(u.hostname, u.pathname)).href); }
      catch { return new Response('Asset not found', { status: 404 }); }
    });
    protocol.handle('artifact',async request=>{
      try {const item=await runtime.artifacts.resource(request.url,runtime.state.sessions);
        if(item.size>64*1024*1024)return new Response('文件过大，请另存或在系统中打开',{status:413});
        return new Response(new Uint8Array(await readFile(item.path)),{headers:{'Content-Type':item.mime,'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Content-Security-Policy':"default-src 'none'; script-src artifact: 'unsafe-inline'; style-src artifact: 'unsafe-inline'; img-src artifact: data:; font-src artifact:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts"}});
      }catch{return new Response('文件已改变、移动或未登记',{status:404});}
    });
    protocol.handle('pet-skin', async request => {
      const u = new URL(request.url), relative = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const target = path.resolve(skins, relative);
      if (u.hostname !== 'asset' || !target.startsWith(path.resolve(skins) + path.sep)) return new Response('Forbidden', { status: 403 });
      // webm 需要显式 MIME 与长度，file:// 推断出的类型会让 <video> 拒绝加载。
      if (/\.webm$/i.test(target)) {
        const data = await fs.readFile(target);
        return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'video/webm', 'Content-Length': String(data.byteLength), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
      }
      return net.fetch(pathToFileURL(target).href);
    });
    workbench = prepareWorkbench(); pet = createWindow('pet'); bubble = createWindow('bubble');
    const area = screen.getPrimaryDisplay().workArea, config = runtime.state.settings.pet;
    pet.setPosition(Math.round(Math.max(area.x, Math.min(config.x ?? area.x + area.width - 300, area.x + area.width - 272))), Math.round(Math.max(area.y, Math.min(config.y ?? area.y + area.height - 320, area.y + area.height - 296))));
    pet.on('move', moveBubble);
    pet.once('ready-to-show', syncWindows);
    const icon = nativeImage.createFromPath(path.join(branding, 'dragon-avatar.png')).resize({ width: 32, height: 32 });
    tray = new Tray(icon); tray.setToolTip('DragonAgent · 龙娘工作台'); tray.on('click', showWorkbench); tray.on('right-click', menu);
    globalShortcut.register(config.shortcut, togglePet);
    runtime.on('change', () => { syncTheme(); const state = runtime.snapshot(); for (const win of windows) if (!win.isDestroyed()) win.webContents.send('dragon:state', state); });
    const valid = (sender: Electron.WebContents) => [...windows].some(w => w.webContents === sender);
    ipcMain.handle('dragon:snapshot', event => { if (!valid(event.sender)) throw new Error('未知窗口。'); return runtime.snapshot(); });
    ipcMain.handle('dragon:action', (event, value: Action) => { if (!valid(event.sender)) throw new Error('未知窗口。'); return action(value); });
    if (process.env.DRAGON_SMOKE === '1') { await runtime.dragon.start(); console.log('DRAGON_DESKTOP_READY'); setTimeout(() => app.quit(), 2000); }
    if (process.argv.includes('--verify-online')) {
      if (runtime.state.sessions.some(isBusy)) throw new Error('存在执行中的任务，未启动在线验收。');
      const { runLiveChecks } = await import('../../scripts/live-check');
      const directory = path.resolve(process.env.DRAGON_VERIFY_DIR || path.join(home, 'validation'));
      await runLiveChecks({ home, settings: runtime.state.settings, key: id => runtime.secrets.get(id), directory, output: path.join(directory, 'live-acceptance.json') });
      app.quit();
    }
  }).catch(error => { console.error(error); dialog.showErrorBox('DragonAgent 启动失败', String(error.message)); app.exit(1); });
}
app.on('window-all-closed', () => undefined);
app.on('before-quit', event => { if (quitting) return; event.preventDefault(); quitting = true; globalShortcut.unregisterAll(); void (async () => { try { await illustration?.close(); await workshop?.dispose(); } finally { await runtime?.dispose(); } })().finally(() => { tray?.destroy(); app.quit(); }); });


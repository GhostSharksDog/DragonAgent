import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, Tray, nativeImage, globalShortcut, screen, nativeTheme } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, importLegacy } from './store';
import { Secrets } from './secrets';
import { Runtime } from './runtime';
import { loadSkin } from '../pet/main/skin';
import type { Action } from '../shared/contracts';
import { isBusy } from '../shared/contracts';

protocol.registerSchemesAsPrivileged([{ scheme: 'pet-skin', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.DRAGON_DATA_DIR) app.setPath('userData', path.resolve(process.env.DRAGON_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'DragonAgent'));
let runtime: Runtime, workbench: BrowserWindow, pet: BrowserWindow, bubble: BrowserWindow, tray: Tray;
let quitting = false;
const windows = new Set<BrowserWindow>();
const root = path.resolve(__dirname, '..');
const branding = path.join(root, 'assets/branding');
async function open(url: string) { const value = new URL(url); if (!['https:', 'http:'].includes(value.protocol)) throw new Error('只允许打开网页链接。'); await shell.openExternal(value.href); }
function createWindow(kind: 'workbench' | 'pet' | 'bubble') {
  const transparent = kind !== 'workbench';
  const theme = runtime.view.resolvedTheme, colors = theme === 'dark' ? { background: '#24212d', symbol: '#e4ddef' } : { background: '#fcfbfe', symbol: '#353143' };
  const win = new BrowserWindow({ ...(transparent ? {} : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: 48 } }), icon: path.join(branding, 'dragon.ico'), width: kind === 'workbench' ? 1260 : kind === 'pet' ? 272 : 390, height: kind === 'workbench' ? 850 : kind === 'pet' ? 296 : 460, minWidth: kind === 'workbench' ? 850 : undefined, minHeight: kind === 'workbench' ? 600 : undefined, title: 'DragonAgent', show: false, frame: !transparent, transparent, backgroundColor: transparent ? '#00000000' : colors.background, resizable: !transparent, hasShadow: !transparent, skipTaskbar: transparent, alwaysOnTop: transparent, autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'main/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  windows.add(win); win.on('closed', () => windows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  void win.loadFile(path.join(root, 'renderer/index.html'), { query: { view: kind, theme } });
  return win;
}
let appliedTheme: string | undefined;
function syncTheme() {
  const configured = runtime.state.settings.theme;
  runtime.view.resolvedTheme = configured === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : configured;
  const dark = runtime.view.resolvedTheme === 'dark';
  if (workbench && !workbench.isDestroyed() && appliedTheme !== runtime.view.resolvedTheme) { appliedTheme = runtime.view.resolvedTheme; workbench.setBackgroundColor(dark ? '#24212d' : '#fcfbfe'); workbench.setTitleBarOverlay({ color: dark ? '#24212d' : '#fcfbfe', symbolColor: dark ? '#e4ddef' : '#353143', height: 48 }); }
}
function moveBubble() {
  const r = pet.getBounds(), area = screen.getDisplayMatching(r).workArea;
  const b = bubble.getBounds(); const left = r.x - b.width - 12 >= area.x;
  bubble.setPosition(Math.round(left ? r.x - b.width - 12 : Math.min(area.x + area.width - b.width, r.x + r.width + 12)), Math.round(Math.max(area.y, Math.min(area.y + area.height - b.height, r.y + r.height - b.height))));
}
function syncWindows() {
  const config = runtime.state.settings.pet;
  const size = Math.round(272 * config.scale), height = Math.round(296 * config.scale);
  if (pet.getBounds().width !== size) pet.setSize(size, height);
  pet.setAlwaysOnTop(config.alwaysOnTop, 'floating'); bubble.setAlwaysOnTop(config.alwaysOnTop, 'floating');
  if (config.visible) pet.showInactive(); else pet.hide();
  const bubbleHeight = runtime.view.petView === 'quota' || config.chatMode === 'detailed' ? 460 : 184;
  if (bubble.getBounds().height !== bubbleHeight) {
    // Windows locks min/max bounds on non-resizable windows; unlock only for this programmatic resize.
    bubble.setResizable(true); bubble.setSize(390, bubbleHeight); bubble.setResizable(false);
  }
  moveBubble();
  if (config.visible && runtime.view.petView !== 'hidden') bubble.showInactive(); else bubble.hide();
}
function showWorkbench() { workbench.show(); if (workbench.isMinimized()) workbench.restore(); workbench.focus(); }
function togglePet() { runtime.state.settings.pet.visible = !runtime.state.settings.pet.visible; runtime.changed(); syncWindows(); }
function menu() { Menu.buildFromTemplate([{ label: '打开 DragonAgent', click: showWorkbench }, { label: runtime.state.settings.pet.visible ? '收起龙娘' : '召唤龙娘', click: togglePet }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]).popup(); }
async function action(value: Action) {
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') throw new Error('无效操作。');
  switch (value.type) {
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
      const s=runtime.session(value.id); if(isBusy(s)||s.readOnly)throw new Error('当前不能添加文件。');
      const result=await dialog.showOpenDialog(workbench,{title:'给龙娘添加参考文件',properties:['openFile','multiSelections'],filters:[{name:'文档、图片与代码',extensions:['txt','md','pdf','docx','csv','json','ts','js','tsx','jsx','html','css','png','jpg','jpeg','webp','gif']},{name:'所有文件',extensions:['*']}]});
      if(!result.canceled)await runtime.attachFiles(s.id,result.filePaths); return;
    }
    case 'legacy.import': {
      const result = await dialog.showOpenDialog(workbench, { title: '选择 Legacy SQLite 数据库（只读导入）', filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }], properties: ['openFile'] });
      if (result.canceled) return; const imported = importLegacy(result.filePaths[0], runtime.state); runtime.changed(); return imported;
    }
    default: { const result = await runtime.action(value); if (value.type === 'settings.save' || value.type === 'pet.chatMode') syncWindows(); return result; }
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
    const skins = path.join(root, 'assets/skins/silver-dragon-frames');
    runtime.view.skin = await loadSkin(path.join(skins, 'skin.json'));
    protocol.handle('pet-skin', request => {
      const u = new URL(request.url), relative = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const target = path.resolve(skins, relative);
      if (u.hostname !== 'asset' || !target.startsWith(path.resolve(skins) + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    workbench = createWindow('workbench'); pet = createWindow('pet'); bubble = createWindow('bubble');
    const area = screen.getPrimaryDisplay().workArea, config = runtime.state.settings.pet;
    pet.setPosition(Math.round(Math.max(area.x, Math.min(config.x ?? area.x + area.width - 300, area.x + area.width - 272))), Math.round(Math.max(area.y, Math.min(config.y ?? area.y + area.height - 320, area.y + area.height - 296))));
    pet.on('move', moveBubble);
    workbench.on('close', event => { if (!quitting) { event.preventDefault(); workbench.hide(); } });
    workbench.once('ready-to-show', showWorkbench);
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
app.on('before-quit', event => { if (quitting) return; event.preventDefault(); quitting = true; globalShortcut.unregisterAll(); void runtime?.dispose().finally(() => { tray?.destroy(); app.quit(); }); });

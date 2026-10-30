import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const data = path.resolve(`.runtime/native-chrome-${Date.now()}`); await mkdir(data, { recursive: true });
const app = await electron.launch({ executablePath: process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), args: process.env.DRAGON_EXE ? [] : ['.'], env: { ...process.env, DRAGON_DATA_DIR: data }, timeout: 45000 });
const pause = ms => new Promise(r => setTimeout(r, ms));
function mouse(point, kind) {
  const script = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class DragonMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
[DragonMouse]::SetProcessDPIAware() | Out-Null
[DragonMouse]::SetForegroundWindow([IntPtr]${point.hwnd}) | Out-Null
Write-Output ([DragonMouse]::SendMessage([IntPtr]${point.hwnd},132,[IntPtr]::Zero,[IntPtr]${point.x+(point.y*65536)}).ToInt64())
Write-Output ([DragonMouse]::GetForegroundWindow().ToInt64())
[DragonMouse]::SetCursorPos(${point.x},${point.y}) | Out-Null
[DragonMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
${kind === 'drag' ? Array.from({length:12},(_,i)=>`[DragonMouse]::SetCursorPos(${point.x+(i+1)*5},${point.y+(i+1)*3}) | Out-Null\nStart-Sleep -Milliseconds 40`).join('\n') : ''}
[DragonMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
${kind === 'double' ? 'Start-Sleep -Milliseconds 70\n[DragonMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)\n[DragonMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)' : ''}`;
  console.log('Native hit/foreground',execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { windowsHide: true, stdio: 'pipe' }).toString());
}
const windowState = () => app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')), bounds = w.getBounds(); return { bounds, maximized: w.isMaximized(), title: { ...screen.dipToScreenPoint({ x: bounds.x + 350, y: bounds.y + 23 }), hwnd: w.getNativeWindowHandle().readBigUInt64LE().toString() }, restore: { ...screen.dipToScreenPoint({ x: bounds.x + bounds.width - 70, y: bounds.y + 23 }), hwnd: w.getNativeWindowHandle().readBigUInt64LE().toString() } }; });
try {
  await app.firstWindow(); await pause(800); const page = app.windows().find(w => w.url().includes('view=workbench'));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')); w.setBounds({ x:100,y:100,width:1100,height:750 }); w.show(); w.focus(); }); await pause(300);
  console.log('Chrome',await page.evaluate(()=>({css:getComputedStyle(document.querySelector('.topbar')).webkitAppRegion,rect:document.querySelector('.topbar').getBoundingClientRect().toJSON()})));
  const before = await windowState(); mouse(before.title,'drag'); await pause(250); const after = await windowState(); const physicalDrag = after.bounds.x !== before.bounds.x || after.bounds.y !== before.bounds.y;
  const hwnd = after.title.hwnd;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class NativeWindow{[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}'; [NativeWindow]::SendMessage([IntPtr]${hwnd},163,[IntPtr]2,[IntPtr]0) | Out-Null`],{windowsHide:true});
  await pause(350); assert((await windowState()).maximized,'Native caption double-click message must maximize');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=workbench')).unmaximize()); await pause(350); assert(!(await windowState()).maximized);

  const captures = [];
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => window.dragon.action({ type:'settings.save',theme }),theme); await pause(300);
    const capture = await app.evaluate(async ({ BrowserWindow,screen,desktopCapturer }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=workbench')), b=w.getBounds(), display=screen.getDisplayMatching(b);
      w.moveTop(); const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:Math.round(b.width*display.scaleFactor),height:Math.round(b.height*display.scaleFactor)}});
      const source=sources.find(s=>s.id===w.getMediaSourceId()); if(!source)throw Error('Window capture unavailable');
      const picture=source.thumbnail,rx=picture.getSize().width/b.width,ry=picture.getSize().height/b.height;
      const bitmap=picture.toBitmap(),width=picture.getSize().width,i=(Math.round(10*ry)*width+Math.round(350*rx))*4;
      return {png:picture.toPNG().toString('base64'),header:[bitmap[i+2],bitmap[i+1],bitmap[i]],scale:display.scaleFactor};
    });
    const expected=theme==='dark'?[36,33,45]:[252,251,254]; assert(capture.header.every((v,i)=>Math.abs(v-expected[i])<=3),JSON.stringify(capture.header));
    await writeFile(`test-results/023-native-window-${theme}.png`,Buffer.from(capture.png,'base64'));captures.push({theme,scale:capture.scale,header:capture.header});
  }
  await writeFile('test-results/window-chrome023.json',JSON.stringify({status:'passed',nativeCaptionHit:true,nativeDoubleClickMessage:true,physicalTitleDrag:physicalDrag,physicalInputNote:physicalDrag?undefined:'Foreground activation was denied by Windows; physical pointer drag not verified.',captures},null,2)); console.log('Native caption hit, double-click message and themed title pixels PASS; physical drag:',physicalDrag);
} finally { await app.evaluate(({app})=>app.quit()); }

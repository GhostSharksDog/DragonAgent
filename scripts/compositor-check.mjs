import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const data = path.resolve(`.runtime/compositor-${Date.now()}`); await mkdir(data, { recursive: true });
const app = await electron.launch({ executablePath: process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: { ...process.env, DRAGON_DATA_DIR: data }, timeout: 45000 });
try {
  await app.firstWindow(); await new Promise(r => setTimeout(r, 1000));
  const pet = app.windows().find(w => w.url().includes('view=pet'));
  await pet.waitForFunction(() => document.querySelector('.sprite-canvas')?.getAttribute('data-ready') === 'true');
  await pet.evaluate(() => window.dragon.action({ type: 'pet.toggle' }));
  for (const [theme, color, rgb] of [['light','#edf2f7',[237,242,247]], ['dark','#172334',[23,35,52]]]) {
    await pet.evaluate(theme => window.dragon.action({ type: 'settings.save', theme }), theme);
    await app.evaluate(async ({ BrowserWindow, screen }, color) => {
      const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet'));
      const area = screen.getPrimaryDisplay().workArea; pet.setPosition(area.x + 420, area.y + 180);
      const b = pet.getBounds(), backdrop = new BrowserWindow({ x:b.x-20,y:b.y-20,width:b.width+40,height:b.height+40,frame:false,show:false,backgroundColor:color,hasShadow:false,alwaysOnTop:true,webPreferences:{sandbox:true} });
      backdrop.setTitle('DragonAgent transparency test backdrop');
      await backdrop.loadURL(`data:text/html,<html style="background:${color}"><body></body></html>`);
      backdrop.showInactive(); pet.moveTop();
    }, color);
    await new Promise(r => setTimeout(r, 700));
    const picture = await app.evaluate(async ({ BrowserWindow, screen, desktopCapturer }) => {
      const pet = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=pet')), b = pet.getBounds(), display = screen.getDisplayMatching(b);
      const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:display.size.width*display.scaleFactor, height:display.size.height*display.scaleFactor } });
      const source = sources.find(s => s.display_id === String(display.id)); if (!source) throw new Error('Display capture unavailable');
      const size = source.thumbnail.getSize(), rx=size.width/display.size.width, ry=size.height/display.size.height;
      // Only the controlled test rectangle leaves this function; never save the desktop capture.
      const image = source.thumbnail.crop({x:Math.round((b.x-display.bounds.x)*rx),y:Math.round((b.y-display.bounds.y)*ry),width:Math.round(b.width*rx),height:Math.round(b.height*ry)});
      const bitmap=image.toBitmap(),{width,height}=image.getSize();
      const corners=[[2,2],[width-3,2],[2,height-3],[width-3,height-3]].map(([x,y])=>{const i=(y*width+x)*4;return [bitmap[i+2],bitmap[i+1],bitmap[i]];});
      return {corners,png:image.toPNG().toString('base64')};
    });
    assert(picture.corners.every(c => c.every((v,i) => Math.abs(v-rgb[i])<=3)), `${theme}: ${JSON.stringify(picture.corners)}`);
    await writeFile(`test-results/pet-desktop-${theme}.png`,Buffer.from(picture.png,'base64'));
    await app.evaluate(({ BrowserWindow }) => { for(const w of BrowserWindow.getAllWindows()) if(w.getTitle()==='DragonAgent transparency test backdrop')w.destroy(); });
    console.log(`${theme} Windows compositor PASS: ${JSON.stringify(picture.corners)}`);
  }
} finally { await app.evaluate(({ app }) => app.quit()); }

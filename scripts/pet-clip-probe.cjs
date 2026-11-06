// 在 Electron 里真正解码每个 webm，采集尺寸、时长、透明覆盖率与首尾帧差异。
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(process.env.CLIP_ROOT || 'assets/skins');

// 必须在使用前声明 stream，否则 <video> 会以 URL safety check 拒绝自定义协议。
protocol.registerSchemesAsPrivileged([
  { scheme: 'clip', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.webm$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const probe = `
window.__probe = async (url) => {
  const video = document.createElement('video');
  video.muted = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.src = url;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('加载超时')), 15000);
    video.onloadeddata = () => { clearTimeout(timer); resolve(); };
    video.onerror = () => { clearTimeout(timer); reject(new Error('解码失败 ' + (video.error && video.error.code))); };
  });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const grab = async (time) => {
    const target = Math.min(Math.max(0, time), Math.max(0, (video.duration || 0) - 0.02));
    if (Math.abs(video.currentTime - target) > 0.001) {
      await new Promise(resolve => {
        const done = () => { video.removeEventListener('seeked', done); resolve(); };
        video.addEventListener('seeked', done);
        video.currentTime = target;
      });
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const analyze = (data) => {
    let solid = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 16) {
        solid++;
        const index = i / 4, x = index % canvas.width, y = (index / canvas.width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      alphaRatio: Number((solid / (canvas.width * canvas.height)).toFixed(3)),
      box: solid ? { left: minX, top: minY, right: maxX, bottom: maxY } : null,
    };
  };
  const first = await grab(0);
  const last = await grab((video.duration || 0) - 0.04);
  const middle = await grab((video.duration || 0) / 2);
  let diff = 0;
  for (let i = 0; i < first.length; i += 4) {
    if (Math.abs(first[i] - last[i]) > 24 || Math.abs(first[i + 1] - last[i + 1]) > 24
      || Math.abs(first[i + 2] - last[i + 2]) > 24 || Math.abs(first[i + 3] - last[i + 3]) > 24) diff++;
  }
  const mid = analyze(middle), start = analyze(first);
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number((video.duration || 0).toFixed(2)),
    alphaRatio: mid.alphaRatio,
    box: mid.box,
    startBox: start.box,
    loopDiff: Number((diff / (canvas.width * canvas.height)).toFixed(3)),
  };
};
true;
`;

app.whenReady().then(async () => {
  protocol.handle('clip', async request => {
    const u = new URL(request.url);
    const relative = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (u.hostname !== 'asset' || !target.startsWith(path.resolve(root) + path.sep)) return new Response('Forbidden', { status: 403 });
    const data = await fsp.readFile(target);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'video/webm', 'Content-Length': String(data.byteLength), 'Access-Control-Allow-Origin': '*' },
    });
  });

  const win = new BrowserWindow({ show: false, width: 320, height: 200 });
  await win.loadURL('data:text/html,<html><body></body></html>');
  await win.webContents.executeJavaScript(probe);

  const results = [];
  for (const file of walk(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const url = 'clip://asset/' + relative.split('/').map(encodeURIComponent).join('/');
    try {
      const info = await win.webContents.executeJavaScript(`window.__probe(${JSON.stringify(url)})`);
      results.push({ file: relative, bytes: fs.statSync(file).size, ...info });
    } catch (error) {
      results.push({ file: relative, bytes: fs.statSync(file).size, error: String(error && error.message || error) });
    }
  }
  console.log('CLIP_JSON:' + JSON.stringify(results));
  app.quit();
}).catch(error => {
  console.error('CLIP_PROBE_FAILED', error);
  app.exit(1);
});

// 外观收尾回归：自定义强调色可读、输入栏始终不透明、主题跟随、窗口尺寸与缩放不横向溢出。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = path.resolve('.runtime/appearance-check-' + Date.now());
await mkdir(home, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
const report = { passed: false, checks: [] };
const errors = [];
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().includes('view=workbench')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  assert(page);
  page.on('pageerror', e => errors.push(e.message));
  const act = a => page.evaluate(a => window.dragon.action(a), a);
  await act({ type: 'session.create', backend: 'dragon' });
  await act({ type: 'window.workbench', page: 'chat' });
  await page.locator('.composer').waitFor();

  const luminance = hex => {
    const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    return .2126 * f(parseInt(m[1], 16)) + .7152 * f(parseInt(m[2], 16)) + .0722 * f(parseInt(m[3], 16));
  };
  const accent = async color => {
    await act({ type: 'appearance.save', values: { customAccent: color } });
    await page.waitForTimeout(150);
    return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--purple').trim());
  };
  assert.ok(luminance(await accent('#ffff00')) <= .53, '亮黄色强调色必须收敛到可读范围');
  await act({ type: 'settings.save', theme: 'dark' });
  await page.waitForTimeout(200);
  assert.ok(luminance(await accent('#000000')) >= .29, '暗色主题下黑色强调色必须提亮');
  await act({ type: 'settings.save', theme: 'light' });
  await act({ type: 'appearance.save', values: { customAccent: undefined } });
  report.checks.push('自定义强调色在亮/暗主题下保持可读');

  const composer = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.composer'));
    return { background: style.backgroundColor, opacity: style.opacity };
  });
  assert.match(composer.background, /^rgb\(/, '输入栏背景必须是实色');
  assert.equal(composer.background.includes('rgba'), false, '输入栏不得透出壁纸');
  assert.equal(composer.opacity, '1');
  report.checks.push('输入栏背景始终不透明');

  await act({ type: 'settings.save', theme: 'system' });
  await page.waitForTimeout(200);
  const themeState = await page.evaluate(async () => ({ resolved: (await window.dragon.snapshot()).resolvedTheme, shown: document.documentElement.dataset.theme }));
  assert.equal(themeState.shown, themeState.resolved, '跟随系统时页面主题应与解析结果一致');
  report.checks.push('跟随系统主题与页面一致');
  await act({ type: 'settings.save', theme: 'light' });

  for (const [width, height] of [[1440, 900], [1100, 800], [900, 760]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find(v => v.webContents.getURL().includes('view=workbench'))?.setSize(w, h), [width, height]);
    await page.waitForTimeout(400);
    const layout = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth, scrollH: document.documentElement.scrollHeight, innerH: innerHeight }));
    assert.ok(layout.scrollW <= layout.innerW + 1, `${width}px 出现横向溢出：${layout.scrollW}/${layout.innerW}`);
    assert.ok(layout.scrollH <= layout.innerH + 1, `${width}px 文档纵向溢出`);
    await page.screenshot({ path: `test-results/appearance-${width}.png` });
  }
  report.checks.push('900/1100/1440px 布局无横向溢出、文档不滚动');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(v => v.webContents.getURL().includes('view=workbench'))?.setSize(1260, 850));
  for (const factor of [1.5, 2]) {
    await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows().find(v => v.webContents.getURL().includes('view=workbench'))?.webContents.setZoomFactor(f), factor);
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth }));
    assert.ok(layout.scrollW <= layout.innerW + 1, `${factor * 100}% 缩放出现横向溢出：${layout.scrollW}/${layout.innerW}`);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(v => v.webContents.getURL().includes('view=workbench'))?.webContents.setZoomFactor(1));
  report.checks.push('150%/200% 缩放无横向溢出');

  assert.deepEqual(errors, [], `页面异常：${errors.join('; ')}`);
  report.passed = true;
  console.log('Appearance matrix PASS');
} finally {
  await writeFile('test-results/appearance-check.json', JSON.stringify(report, null, 2));
  await app.close();
}

// Run after npm run build: node --import tsx scripts/compact-bubble-check.mjs
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { placeCompactBubble } from '../src/shared/compact-bubble.ts';

function assertInside(bounds, area) {
  assert(bounds.x >= area.x && bounds.y >= area.y);
  assert(bounds.x + bounds.width <= area.x + area.width);
  assert(bounds.y + bounds.height <= area.y + area.height);
}

const negative = { x: -1600, y: -240, width: 1600, height: 860 };
for (const x of [-1600, -856, -112]) {
  for (const y of [-240, 490]) {
    const { bounds, layout } = placeCompactBubble({ x, y, width: 112, height: 130 }, negative);
    assertInside(bounds, negative);
    assert.equal(layout.tailEdge, x <= -856 ? 'left' : 'right');
  }
}
const narrow = { x: -450, y: -100, width: 450, height: 460 };
for (const [y, edge] of [[-100, 'top'], [230, 'bottom']]) {
  const { bounds, layout } = placeCompactBubble({ x: -280, y, width: 112, height: 130 }, narrow);
  assertInside(bounds, narrow);
  assert.equal(layout.tailEdge, edge);
}

await mkdir('test-results', { recursive: true });
const server = createServer(async (request, response) => {
  for await (const _chunk of request) { /* Drain the fixture request. */ }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, DRAGON_DATA_DIR: path.resolve(`.runtime/compact-bubble-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
  await app.firstWindow();
  const windows = app.windows();
  const find = kind => windows.find(win => win.url().includes(`view=${kind}`));
  const workbench = find('workbench'), pet = find('pet'), bubble = find('bubble');
  assert(workbench && pet && bubble);
  const act = action => workbench.evaluate(action => window.dragon.action(action), action);
  const waitView = view => workbench.waitForFunction(async view => (await window.dragon.snapshot()).petView === view, view);
  const textbox = bubble.getByRole('textbox', { name: '发送给龙娘的消息' });
  const shell = bubble.locator('.bubble-shell');
  const clickPet = () => pet.locator('.pet-button').click();
  const movePet = (side, vertical) => app.evaluate(({ BrowserWindow, screen }, { side, vertical }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=pet'));
    const area = screen.getPrimaryDisplay().workArea, { width, height } = win.getBounds();
    const x = side === 'left' ? area.x + 8 : area.x + area.width - width - 8;
    const y = vertical === 'top' ? area.y + 8 : area.y + area.height - height - 8;
    win.setPosition(x, y);
  }, { side, vertical });
  const nativeBounds = () => app.evaluate(({ BrowserWindow, screen }) => {
    const get = view => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(`view=${view}`));
    const pet = get('pet').getBounds(), bubble = get('bubble').getBounds();
    return { pet, bubble, area: screen.getDisplayMatching(pet).workArea, focused: get('bubble').isFocused() };
  });
  const waitEdge = edge => bubble.waitForFunction(edge => document.querySelector('.bubble-shell')?.getAttribute('data-tail-edge') === edge, edge);

  await act({ type: 'settings.save', pet: { visible: true } });
  for (const side of ['left', 'right']) {
    for (const vertical of ['top', 'bottom']) {
      await movePet(side, vertical);
      await clickPet(); await waitView('reply'); await waitEdge(side);
      const actual = await nativeBounds();
      assertInside(actual.bubble, actual.area);
      assert(side === 'left' ? actual.bubble.x > actual.pet.x + actual.pet.width : actual.bubble.x + actual.bubble.width < actual.pet.x);
      assert.equal(await bubble.locator('.compact-bubble-outline path').getAttribute('stroke-width'), '3');
      await clickPet(); await waitView('hidden');
    }
  }

  await movePet('left', 'top'); await clickPet(); await waitEdge('left');
  await textbox.fill('草稿');
  await textbox.press('Shift+Enter');
  await textbox.press('A');
  const draft = await textbox.inputValue();
  assert.equal(draft, '草稿\nA');
  await textbox.evaluate(el => { window.compactTestInput = el; });
  await movePet('right', 'bottom'); await waitEdge('right');
  assert(await textbox.evaluate(el => window.compactTestInput === el && document.activeElement === el));
  assert.equal(await textbox.inputValue(), draft);
  assert((await nativeBounds()).focused);
  await bubble.screenshot({ path: 'test-results/compact-bubble-light.png' });

  await act({ type: 'settings.save', theme: 'dark' });
  await bubble.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=bubble')).webContents.setZoomFactor(1.5));
  await movePet('left', 'top'); await waitEdge('left');
  assertInside((await nativeBounds()).bubble, (await nativeBounds()).area);
  assert(await bubble.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await bubble.screenshot({ path: 'test-results/compact-bubble-dark.png' });
  await textbox.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.equal((await workbench.evaluate(() => window.dragon.snapshot())).petView, 'reply');
  await textbox.press('Escape'); await waitView('hidden');

  await act({ type: 'profile.save', profile: { id: 'fixture', name: '本地模拟', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', contextWindow: 32768, maxOutput: 4096, hasKey: false } });
  await clickPet(); await waitView('reply');
  await textbox.fill('桌宠气泡发送测试');
  await textbox.press('Enter'); await waitView('hidden');
  const snapshot = await workbench.evaluate(() => window.dragon.snapshot());
  assert(snapshot.sessions.some(session => session.messages.some(message => message.role === 'user' && message.text === '桌宠气泡发送测试')));

  await act({ type: 'pet.chatMode', mode: 'detailed' });
  await clickPet(); await waitView('reply');
  assert.equal(await shell.getAttribute('data-tail-edge'), null);
  assert.equal((await nativeBounds()).bubble.width, 300);
  await pet.locator('.pet-button').dblclick({ delay: 60 }); await waitView('quota');
  assert.equal(await shell.getAttribute('data-tail-edge'), null);
  assert.equal((await nativeBounds()).bubble.width, 340);
  console.log('Compact bubble geometry, native clicks, focus, keyboard, themes, and legacy views passed.');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

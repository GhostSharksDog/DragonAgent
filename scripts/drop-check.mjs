// Verifies that files dropped onto the composer reach the attachment pipeline.
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strict as assert } from 'node:assert';

await mkdir('test-results', { recursive: true });
const dataDir = path.resolve(`.runtime/drop-check-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = { ...process.env, DRAGON_DATA_DIR: dataDir, DRAGON_SMOKE: '' };
if (process.env.DRAGON_EXE) {
  for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
  environment.Path = [process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
}
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const errors = [];
app.process().stderr.on('data', data => { const text = data.toString(); if (!/DevTools listening|Debugger attached|sqlite|ExperimentalWarning|GPU|cache/.test(text)) console.log(text); });
try {
  await app.firstWindow();
  await new Promise(resolve => setTimeout(resolve, 1500));
  const page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });

  // The bridge must expose a path helper; a synthetic File has no real path, so this also documents the byte fallback.
  const bridge = await page.evaluate(() => typeof window.dragon.filePath);
  assert.equal(bridge, 'function', 'dragon.filePath bridge missing');
  const sessionId = await page.evaluate(() => window.dragon.action({ type: 'session.create', backend: 'dragon' }));
  await page.locator('.composer textarea').waitFor({ timeout: 15000 });

  // A real file picked through a file input still exposes its absolute path to the main process.
  const probeFile = path.join(dataDir, 'probe.png');
  await writeFile(probeFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'drop-probe'; document.body.append(input); });
  await page.setInputFiles('#drop-probe', probeFile);
  const resolvedPath = await page.evaluate(() => window.dragon.filePath(document.getElementById('drop-probe').files[0]));
  console.log('filePath bridge resolves real file to:', JSON.stringify(resolvedPath));
  await page.evaluate(() => document.getElementById('drop-probe').remove());

  // Hover a picture over the composer: the drop hint must appear before the file is released.
  await page.evaluate(() => {
    const host = document.querySelector('.composer textarea');
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dragon-drop.png', { type: 'image/png' }));
    window.__drop = transfer;
    const fire = type => host.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    fire('dragenter'); fire('dragover');
  });
  await page.waitForFunction(() => document.querySelector('.composer')?.classList.contains('dragging'), null, { timeout: 5000 });
  assert.equal(await page.locator('.drop-overlay').count(), 1, 'drop hint must show while a file hovers');
  const hint = await page.evaluate(() => {
    const host = document.querySelector('.composer').getBoundingClientRect(), node = document.querySelector('.drop-overlay'), box = node.getBoundingClientRect();
    return { covers: Math.abs(box.width - host.width) < 3 && Math.abs(box.height - host.height) < 3, pointer: getComputedStyle(node).pointerEvents };
  });
  assert(hint.covers, 'drop hint must cover the whole composer');
  assert.equal(hint.pointer, 'none', 'drop hint must not swallow drag events');
  await page.screenshot({ path: 'test-results/drop-hover.png' });

  await page.evaluate(() => document.querySelector('.composer textarea').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__drop })));
  await page.locator('.composer .attachment-chip').waitFor({ timeout: 15000 });
  const chip = await page.locator('.composer .attachment-chip').first().innerText();
  assert(chip.includes('dragon-drop.png'), `unexpected chip text: ${chip}`);
  assert.equal(await page.evaluate(() => document.querySelector('.drop-overlay')), null, 'drop hint must clear after release');
  await page.screenshot({ path: 'test-results/drop-imported.png' });

  const snapshot = await page.evaluate(() => window.dragon.snapshot());
  const session = snapshot.sessions.find(s => s.id === sessionId);
  const attachment = session.draftAttachments[0];
  assert.equal(session.draftAttachments.length, 1, 'expected one draft attachment');
  assert.equal(attachment.mime, 'image/png', `expected normalized png, got ${attachment.mime}`);
  assert(attachment.size > 0, 'stored image is empty');
  const stored = await readFile(path.join(dataDir, 'attachments', sessionId, `${attachment.id}.bin`));
  assert.deepEqual([...stored.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'stored file is not a PNG');

  // The same route must accept a pasted picture.
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'pasted-shot.png', { type: 'image/png' }));
    document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.composer .attachment-chip').length === 2, null, { timeout: 15000 });
  const afterPaste = await page.evaluate(id => window.dragon.snapshot().then(s => s.sessions.find(x => x.id === id).draftAttachments.map(a => a.name)), sessionId);
  assert.deepEqual(afterPaste, ['dragon-drop.png', 'pasted-shot.png'], `unexpected attachments: ${afterPaste}`);

  // Dropping a huge file is rejected in the renderer with a visible note instead of a silent no-op.
  await page.evaluate(() => {
    const host = document.querySelector('.composer textarea');
    const transfer = new DataTransfer();
    const file = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 40 * 1024 * 1024 });
    transfer.items.add(file);
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.locator('.composer-drop-error').waitFor({ timeout: 5000 });
  console.log('oversized drop note:', await page.locator('.composer-drop-error').innerText());

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('Drag-and-drop picture import PASS');
} finally {
  await app.close();
}

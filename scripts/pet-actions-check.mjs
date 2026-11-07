import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';

/**
 * 蓝鱼桌宠动作接入验收：真实启动 Electron，用本地模拟模型驱动会话状态，
 * 逐项读取 pet 窗口 .video-canvas[data-animation]，确认每个动作都被实际播放过。
 *
 * 用法：node scripts/pet-actions-check.mjs
 */
await mkdir('test-results', { recursive: true });
const dataDir = path.resolve(`.runtime/pet-actions-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fixture = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw || '{}');
  const messages = body.messages ?? [];
  const userText = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const text = typeof userText === 'string' ? userText : '';
  const toolDone = messages.at(-1)?.role === 'tool';
  const behavior = text.includes('会出错') ? 'error' : text.includes('要批准') ? 'approve' : text.includes('要提问') ? 'question' : text.includes('慢思考') ? 'slow' : 'plain';
  if (behavior === 'error') {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fixture 模型故意失败' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'pet-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const send = delta => res.write(chunk(delta));
  const finish = reason => res.end(chunk({}, reason) + 'data: [DONE]\n\n');
  if (behavior === 'approve' && !toolDone) {
    send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_approve', type: 'function', function: { name: 'pet_files_write', arguments: JSON.stringify({ path: path.join(dataDir, 'approved.txt'), content: 'ok' }) } }] });
    finish('tool_calls');
    return;
  }
  if (behavior === 'question' && !toolDone) {
    send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_question', type: 'function', function: { name: 'pet_memory_save', arguments: JSON.stringify({ text: '动作验收临时记忆', tags: ['fixture'] }) } }] });
    finish('tool_calls');
    return;
  }
  if (behavior === 'slow' && !toolDone) {
    await sleep(1200);
    send({ role: 'assistant', content: '第一段，' });
    await sleep(900);
    send({ content: '第二段。' });
    finish('stop');
    return;
  }
  send({ role: 'assistant', content: '好的。' });
  finish('stop');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${fixture.address().port}/v1`;

const executablePath = process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const environment = { ...process.env, DRAGON_DATA_DIR: dataDir, DRAGON_SMOKE: '', DRAGON_PET_SLEEP_MS: '900', DRAGON_PET_ROAM_MS: '600000', DRAGON_PET_ROAM_GAP_MS: '600000' };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env: environment, timeout: 45000 });
const errors = [];
const results = [];
const record = (action, trigger, seen) => { results.push({ action, trigger, seen, at: new Date().toISOString() }); return seen; };

try {
  await app.firstWindow();
  await sleep(1500);
  const page = app.windows().find(w => w.url().includes('view=workbench')) ?? app.windows()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今天，想一起完成什么？' }).waitFor({ timeout: 30000 });

  await page.evaluate(profile => window.dragon.action({ type: 'profile.save', profile, apiKey: 'fixture-only-not-a-real-secret' }), {
    id: 'pet-fixture', name: '动作验收', provider: 'custom', protocol: 'openai-completions', baseUrl, model: 'fixture', contextWindow: 65536, maxOutput: 4096, hasKey: false,
  });
  const sessionId = await page.evaluate(dir => window.dragon.action({ type: 'session.create', backend: 'dragon', profileId: 'pet-fixture', workspace: dir }), dataDir);
  if (typeof sessionId !== 'string') throw new Error('创建会话失败：' + String(sessionId));
  await page.evaluate(id => window.dragon.action({ type: 'pet.chat.bind', id, pinned: true }), sessionId);

  // 桌宠默认隐藏，先点工作台的召唤按钮让它出现。
  await page.getByRole('button', { name: '召唤龙娘', exact: false }).first().click();
  await sleep(700);
  const pet = app.windows().find(w => w.url().includes('view=pet'));
  if (!pet) throw new Error('找不到桌宠窗口');
  await pet.waitForFunction(() => document.querySelector('.video-canvas')?.getAttribute('data-ready') === 'true', null, { timeout: 30000 });

  const readAnimation = () => pet.evaluate(() => document.querySelector('.video-canvas')?.getAttribute('data-animation') ?? null);
  const waitAnimation = async (expected, timeout = 8000, trigger = '') => {
    const deadline = Date.now() + timeout;
    let last = await readAnimation();
    while (Date.now() < deadline) {
      if (last === expected) return record(expected, trigger || expected, true);
      await sleep(80);
      last = await readAnimation();
    }
    record(expected, trigger || expected, false);
    throw new Error(`等待动作 ${expected} 超时，最后看到 ${last}`);
  };
  const sessionState = () => page.evaluate(async () => {
    const state = await window.dragon.snapshot();
    const session = state.sessions.find(s => s.id === state.selectedSessionId);
    return { status: session?.status ?? null, pending: session?.pending?.map(p => ({ id: p.id, kind: p.kind })) ?? [] };
  });
  const waitStatus = async (expected, timeout = 25000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await sessionState();
      if (state.status === expected) return state;
      await sleep(120);
    }
    throw new Error(`等待会话状态 ${expected} 超时`);
  };
  const waitPending = async (kind, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await sessionState();
      const pending = state.pending.find(p => p.kind === kind);
      if (pending) return pending;
      await sleep(120);
    }
    throw new Error(`等待 ${kind} 待处理项超时`);
  };
  const send = text => page.evaluate(([id, text]) => window.dragon.action({ type: 'session.send', id, text, commandId: crypto.randomUUID() }), [sessionId, text]);

  // 1. 睡眠三段：空闲 900ms 后入睡，指针按下时播收尾动作，唤醒后重新入睡验证起手式。
  await waitAnimation('sleep-loop', 30000, '空闲 900ms');
  const box = await pet.locator('.pet-button').boundingBox();
  const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
  await pet.mouse.move(centerX, centerY);
  await pet.mouse.down();
  await waitAnimation('sleep-end', 6000, '睡眠中按下');
  await pet.mouse.up();
  await waitAnimation('click', 6000, '单击');
  await waitAnimation('idle', 26000, '一次性动作结束回到待机');
  await waitAnimation('sleep-start', 8000, '唤醒后重新入睡');
  await waitAnimation('sleep-loop', 25000, '起手式播完');

  // 2. 拖动。
  await pet.mouse.move(centerX, centerY);
  await pet.mouse.down();
  await pet.mouse.move(centerX + 16, centerY + 8, { steps: 4 });
  await waitAnimation('drag', 6000, '按住拖动');
  await pet.mouse.up();
  await sleep(600);

  // 3. 方向键行走与 Shift 跑动。
  await pet.locator('.pet-button').focus();
  await pet.keyboard.down('ArrowRight');
  await waitAnimation('walking-right', 5000, '按住 →');
  await pet.keyboard.up('ArrowRight');
  await sleep(300);
  await pet.keyboard.down('ArrowLeft');
  await waitAnimation('walking-left', 5000, '按住 ←');
  await pet.keyboard.up('ArrowLeft');
  await sleep(300);
  await pet.keyboard.down('Shift');
  await pet.keyboard.down('ArrowLeft');
  await waitAnimation('running-left', 5000, 'Shift + 按住 ←');
  await pet.keyboard.up('ArrowLeft');
  await pet.keyboard.up('Shift');
  await sleep(300);
  await pet.keyboard.down('Shift');
  await pet.keyboard.down('ArrowRight');
  await waitAnimation('running-right', 5000, 'Shift + 按住 →');
  await pet.keyboard.up('ArrowRight');
  await pet.keyboard.up('Shift');
  await sleep(600);

  // 4. 思考 → 说话 → 成功（流式输出）。
  await send('慢思考');
  await waitAnimation('thinking', 5000, '运行中且尚无输出');
  await waitAnimation('speaking', 6000, 'assistant 消息流式输出');
  await waitAnimation('success', 9000, '任务完成 8s 窗口');
  await waitStatus('completed');
  await sleep(500);

  // 5. 等待批准。
  await send('要批准');
  const approval = await waitPending('approval');
  await waitAnimation('awaiting-approval', 6000, 'pending 里有 approval');
  await page.evaluate(([sessionId, id]) => window.dragon.action({ type: 'request.answer', sessionId, id, value: true }), [sessionId, approval.id]);
  await waitStatus('completed');
  await waitAnimation('success', 9000, '批准后完成');

  // 6. 等待回答。
  await send('要提问');
  const question = await waitPending('question');
  await waitAnimation('awaiting-input', 6000, 'pending 里有 question');
  await page.evaluate(([sessionId, id]) => window.dragon.action({ type: 'request.answer', sessionId, id, value: { save: '不保存' } }), [sessionId, question.id]);
  await waitStatus('completed');
  await sleep(600);

  // 7. 出错。
  await send('会出错');
  await waitAnimation('error', 12000, '会话进入 error');
  await waitStatus('error');

  const failed = results.filter(item => !item.seen);
  const report = { ok: failed.length === 0, dataDir, results, failed, rendererErrors: errors };
  await writeFile('test-results/pet-actions.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('渲染进程错误：' + errors.join(' | '));
  if (failed.length) throw new Error('未触达动作：' + failed.map(item => item.action).join(', '));
  console.log('PET ACTIONS PASS: ' + results.map(item => item.action).join(', '));
} catch (error) {
  const probe = await app.windows().find(w => w.url().includes('view=workbench'))?.evaluate(async () => {
    const state = await window.dragon.snapshot();
    const session = state.sessions.find(s => s.id === state.selectedSessionId);
    return { status: session?.status, error: session?.error, pending: session?.pending?.map(p => ({ kind: p.kind, title: p.title })), tools: session?.tools?.slice(-4).map(t => ({ name: t.name, status: t.status })), messages: session?.messages?.slice(-4).map(m => ({ role: m.role, text: m.text.slice(0, 60), partial: m.partial })) };
  }).catch(() => null);
  console.log('session-probe', JSON.stringify(probe, null, 2));
  for (const [index, page] of app.windows().entries()) {
    console.log('diagnostic', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
    await page.screenshot({ path: `test-results/pet-action-failure-${index}.png` }).catch(() => undefined);
  }
  await writeFile('test-results/pet-actions.json', JSON.stringify({ ok: false, dataDir, results, error: String(error), rendererErrors: errors }, null, 2));
  throw error;
} finally {
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  fixture.close();
}

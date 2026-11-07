// 0.7 计划模式端到端：菜单开启 → 只读工具可见性 → plan_submit → 确认执行 → 执行后限制解除 → 重复确认/过期/待决问题拦截。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const planA = {
  goal: '整理工作目录', background: '用户要求整理并汇总工作目录。',
  requirements: ['只读调查'], constraints: [], assumptions: [], questions: [],
  checks: ['目录清单已核对'],
  steps: [
    { id: 'step-1', title: '列出目录', instructions: '只读列出目录内容', dependsOn: [], outputs: ['清单'], checks: ['清单已核对'] },
    { id: 'step-2', title: '汇总报告', instructions: '根据清单写汇总', dependsOn: ['step-1'], outputs: ['报告'], checks: ['报告已生成'] },
  ],
};
const planB = { ...planA, goal: '再次整理', questions: ['需要确认要整理的文件夹'] };
const requests = [];
let planASent = false, planBSent = false;
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const system = body.messages?.find(m => m.role === 'system')?.content ?? '';
  const planMode = String(system).includes('当前为计划模式');
  const lastUserIndex = (body.messages ?? []).findLastIndex(m => m.role === 'user');
  const toolDone = (body.messages ?? []).slice(lastUserIndex + 1).some(m => m.role === 'tool');
  const lastUser = [...(body.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? '';
  requests.push({ planMode, toolDone, tools: (body.tools ?? []).map(t => t.function?.name), system: String(system), lastUser: String(lastUser) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const plan = lastUser.includes('再计划一次') ? planB : planA;
  if (planMode && !toolDone && (lastUser.includes('整理工作目录') || lastUser.includes('再计划一次'))) {
    send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_plan_${requests.length}`, type: 'function', function: { name: 'plan_submit', arguments: JSON.stringify(plan) } }] } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  } else {
    const text = planMode ? '计划已提交，请确认后执行。' : '执行完成，结果已核对。';
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  }
  res.end('data: [DONE]\n\n');
});
const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const home = path.resolve('.runtime/planning-ui-' + Date.now());
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
  page.on('pageerror', error => errors.push(error.message));
  const act = a => page.evaluate(a => window.dragon.action(a), a), snap = () => page.evaluate(() => window.dragon.snapshot());
  const session = async id => (await snap()).sessions.find(s => s.id === id);
  const waitFor = async (fn, label) => { for (let i = 0; i < 300; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('等待超时：' + label); };

  await act({ type: 'profile.save', profile: { id: 'plan', name: '计划测试', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'deepseek-chat', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  const id = await act({ type: 'session.create', backend: 'dragon', profileId: 'plan' });
  await act({ type: 'window.workbench', page: 'chat' });
  await page.locator('.composer textarea').waitFor();

  // 从输入栏“＋”菜单进入计划模式。
  await page.locator('.plus-button').click();
  await page.getByRole('menuitemcheckbox', { name: '计划模式' }).click();
  await waitFor(async () => (await session(id)).mode === 'plan', '切换计划模式');
  await page.locator('.plan-indicator').waitFor();
  report.checks.push('输入栏“＋”菜单可进入计划模式并显示“计划中”标记');

  await page.locator('.composer textarea').fill('请制定计划：整理工作目录');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await session(id)).plans?.length === 1, '计划提交');
  await page.locator('.conversation .dragon-plan-card').waitFor();
  assert.equal(await page.locator('.plan-banner').count(), 0, '计划不应再占用对话上方的独立摘要条');
  const afterAssistant = await page.locator('.conversation > .timeline-entry').evaluateAll(entries => {
    let seenAssistant = false;
    for (const entry of entries) {
      if (entry.querySelector('.message.assistant')) seenAssistant = true;
      if (entry.querySelector('.dragon-plan-card')) return seenAssistant;
    }
    return false;
  });
  assert(afterAssistant, '计划卡片应排在本轮回答之后');
  assert.ok((await page.locator('.app-shell').getAttribute('class') ?? '').includes('right-collapsed'), '提交计划不应自动打开右侧栏');
  await page.screenshot({ path: 'test-results/planning-card.png' });
  await page.locator('.dragon-plan-card .dragon-plan-icon[aria-label="在右侧查看完整计划"]').click();
  await page.locator('.plan-inspector').waitFor();
  assert.ok((await page.locator('.app-shell').getAttribute('class') ?? '').includes('right-collapsed') === false, '点击计划卡片应展开右侧栏');
  report.checks.push('计划以回答流内嵌卡片显示，点击卡片可展开右侧完整计划');
  const planRequest = requests.find(r => r.planMode && !r.toolDone);
  assert(planRequest, '缺少计划模式请求');
  assert.ok(planRequest.tools.includes('plan_submit'), '计划模式应暴露 plan_submit');
  assert.ok(planRequest.tools.includes('pet_files_read'), '计划模式应暴露只读文件工具');
  assert.ok(!planRequest.tools.includes('pet_terminal') && !planRequest.tools.includes('pet_files_write'), '计划模式不得暴露写入/终端工具');
  report.checks.push('计划模式只暴露只读工具与 plan_submit，隐藏终端/写入工具');

  // 确认执行，并检查执行请求的系统提示与工具已解除计划限制。
  await page.locator('.dragon-plan-card').getByRole('button', { name: '按此计划执行' }).click();
  await waitFor(async () => (await session(id)).mode === 'execute', '进入执行模式');
  await waitFor(async () => ['completed', 'error', 'cancelled'].includes((await session(id)).status), '执行结束');
  const executed = await session(id);
  assert(executed.messages.some(m => m.role === 'user' && m.text.includes('执行以下已确认计划')));
  const executeRequest = requests.find(r => !r.planMode);
  assert(executeRequest, '缺少执行模式请求');
  assert.ok(executeRequest.system.includes('当前为执行模式'));
  assert.ok(executeRequest.tools.includes('pet_files_write') && executeRequest.tools.includes('pet_terminal'), '执行模式应恢复写入/终端工具');
  assert.equal(executeRequest.lastUser.includes('执行以下已确认计划'), true);
  report.checks.push('确认执行后系统提示切换为执行模式，写入/终端工具恢复');
  await page.screenshot({ path: 'test-results/planning-executed.png' });

  // 重复确认：同 commandId 幂等；换 commandId 必须拒绝。
  const version = executed.plans.at(-1);
  const same = await page.evaluate(async ({ id, versionId, commandId }) => window.dragon.action({ type: 'session.plan.execute', id, versionId, commandId }), { id, versionId: version.id, commandId: version.execution.commandId });
  assert.equal(same, true);
  const duplicate = await page.evaluate(async ({ id, versionId }) => { try { await window.dragon.action({ type: 'session.plan.execute', id, versionId, commandId: 'another-window' }); return ''; } catch (error) { return String(error); } }, { id, versionId: version.id });
  assert.match(duplicate, /请确认最新完整计划/);
  report.checks.push('重复确认同一 commandId 幂等，第二次执行被拒绝');

  // 待决问题与过期计划不能执行。
  await act({ type: 'session.mode', id, mode: 'plan' });
  await page.locator('.composer textarea').fill('再计划一次');
  await page.keyboard.press('Enter');
  try {
    await waitFor(async () => (await session(id)).plans?.length === 2, '第二版计划');
  } catch (error) {
    const state = await session(id);
    console.log('DEBUG_STATE ' + JSON.stringify({ mode: state?.mode, status: state?.status, error: state?.error, plans: state?.plans?.length, draft: state?.draft, lastTools: (state?.tools ?? []).slice(-3).map(t => ({ name: t.name, status: t.status })), requests: requests.slice(-3).map(r => ({ planMode: r.planMode, toolDone: r.toolDone })) }));
    throw error;
  }
  await page.waitForTimeout(300);
  const questionPlan = (await session(id)).plans.at(-1);
  assert.ok(questionPlan.plan.questions.length > 0);
  const blocked = await page.evaluate(async ({ id, versionId }) => { try { await window.dragon.action({ type: 'session.plan.execute', id, versionId, commandId: 'question-plan' }); return ''; } catch (error) { return String(error); } }, { id, versionId: questionPlan.id });
  assert.match(blocked, /请确认最新完整计划/);
  report.checks.push('存在待决问题时拒绝执行');

  await page.locator('.composer textarea').fill('再补一句讨论');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await session(id)).status !== 'running', '讨论结束');
  const stale = (await session(id)).plans.at(-1);
  assert.equal(stale.stale, true);
  const staleBlocked = await page.evaluate(async ({ id, versionId }) => { try { await window.dragon.action({ type: 'session.plan.execute', id, versionId, commandId: 'stale-plan' }); return ''; } catch (error) { return String(error); } }, { id, versionId: stale.id });
  assert.match(staleBlocked, /请确认最新完整计划/);
  report.checks.push('后续讨论会把计划标记为待修订并拒绝执行');

  // 计划模式只对下一轮生效：提交计划后不执行，直接再发一条普通消息，必须回到执行模式。
  const id2 = await act({ type: 'session.create', backend: 'dragon', profileId: 'plan' });
  await page.locator('.composer-wrap[data-session-id="' + id2 + '"]').waitFor();
  await act({ type: 'session.mode', id: id2, mode: 'plan' });
  await page.locator('.composer textarea').fill('请制定计划：整理工作目录');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await session(id2)).plans?.length === 1, '一次性计划提交');
  await page.locator('.composer textarea').fill('继续讨论，不要再计划');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await session(id2)).status !== 'running', '一次性计划后续结束');
  const once = await session(id2);
  assert.equal(once.mode, 'execute', '计划模式不应黏到下一条消息');
  const follow = [...requests].reverse().find(r => r.lastUser.includes('继续讨论'));
  assert(follow, '缺少后续消息请求');
  assert.equal(follow.planMode, false, '后续消息不应再带计划系统提示');
  assert.ok(follow.tools.includes('pet_files_write') && follow.tools.includes('pet_terminal'), '后续消息应恢复正常工具');
  report.checks.push('计划模式仅下一条消息生效，后续消息恢复执行模式');

  // 用户明确写“先制定计划再执行”时，即使未点开关，本轮也进入计划模式。
  const id3 = await act({ type: 'session.create', backend: 'dragon', profileId: 'plan' });
  await page.locator('.composer-wrap[data-session-id="' + id3 + '"]').waitFor();
  await page.locator('.composer textarea').fill('请先制定计划，再执行：整理工作目录');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await session(id3)).plans?.length === 1, '提示词触发的计划');
  const prompted = [...requests].reverse().find(r => r.lastUser.includes('请先制定计划'));
  assert(prompted, '缺少提示词触发的计划请求');
  assert.equal(prompted.planMode, true, '明确要求计划时应自动进入计划模式');
  report.checks.push('提示词明确要求先计划时自动进入计划模式');

  assert.deepEqual(errors, [], `页面异常：${errors.join('; ')}`);
  report.passed = true;
  report.requests = requests.map(r => ({ planMode: r.planMode, toolDone: r.toolDone, tools: r.tools.length }));
  console.log('Planning mode PASS');
} finally {
  await writeFile('test-results/planning-ui.json', JSON.stringify(report, null, 2));
  await app.close();
  await new Promise(resolve => server.close(resolve));
}

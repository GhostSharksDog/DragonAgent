// Real Codex -> Dragon worker -> Tavily -> bubble approval, with the app's original key context.
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const fixture = path.resolve(`.runtime/codex-mcp-live-${Date.now()}`); await mkdir(fixture, { recursive: true });
const env = { ...process.env }; delete env.DRAGON_DATA_DIR; delete env.ELECTRON_RUN_AS_NODE; delete env.DRAGON_SMOKE;
const app = await electron.launch({ executablePath: process.env.DRAGON_EXE || path.resolve('node_modules/electron/dist/electron.exe'), args: process.env.DRAGON_EXE ? [] : ['.'], cwd: process.cwd(), env, timeout: 45000 });
let page, sessionId, initialPetVisible, initialSelected;
const report = { version, status: 'running', approvals: 0, greetings: false, resumed: false, searched: false };
async function waitForTurn(approveSearch = false) {
  const answered = new Set();
  for (const deadline = Date.now() + 180000; Date.now() < deadline;) {
    const state = await page.evaluate(() => window.dragon.snapshot());
    const session = state.sessions.find(s => s.id === sessionId);
    if (session.status === 'error') throw new Error(session.error);
    for (const request of session.pending) {
      if (answered.has(request.id)) continue;
      const allowed = approveSearch && request.kind === 'approval' && (request.title === 'pet_task_scope' || request.title.includes('tavily_search') && request.details.includes('Model Context Protocol official specification'));
      if (!allowed) { await page.evaluate(a => window.dragon.action(a), { type: 'request.answer', sessionId, id: request.id, value: false }); throw new Error('模型请求了验收范围以外的操作，已拒绝。'); }
      const bubble = app.windows().find(w => w.url().includes('view=bubble'));
      await bubble.getByRole('button', { name: '允许本次操作', exact: true }).click();
      answered.add(request.id); report.approvals++;
    }
    if (session.status === 'completed') return session;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Codex 真实 MCP 验收超时。');
}
try {
  await app.firstWindow(); await new Promise(r => setTimeout(r, 700));
  page = app.windows().find(w => w.url().includes('view=workbench')); assert(page);
  const state = await page.evaluate(() => window.dragon.snapshot());
  assert.equal(state.version, version); assert(!state.sessions.some(s => ['running','waiting','stopping'].includes(s.status)));
  initialPetVisible = state.settings.pet.visible;
  initialSelected = state.selectedSessionId;
  if (!initialPetVisible) await page.evaluate(() => window.dragon.action({ type:'pet.toggle' }));
  await page.evaluate(() => window.dragon.action({ type:'pet.view', view:'compose' }));
  await page.evaluate(() => window.dragon.action({ type:'mcp.connect' }));
  const connected = await page.evaluate(() => window.dragon.snapshot());
  assert(connected.mcp.some(m => m.id === 'tavily' && m.state === 'connected'), '真实 Tavily 未连接，不能以无 MCP 工具的会话代替本验收。');
  sessionId = await page.evaluate(workspace => window.dragon.action({ type:'session.create', backend:'codex', workspace }), fixture);
  await page.evaluate(a => window.dragon.action(a), { type:'session.send', id:sessionId, text:'你好。这是一条连通性验收消息，只回复“你好”，不调用任何工具。', commandId:`codex-mcp-greeting-${Date.now()}` });
  const greeting = await waitForTurn();
  assert(greeting.messages.some(m => m.role === 'assistant' && m.text.includes('你好'))); report.greetings = true;
  const nativeId = greeting.nativeId; assert(nativeId);
  await page.evaluate(a => window.dragon.action(a), { type:'session.send', id:sessionId, text:'继续只读验收：先查看 pet_task_scope，然后调用工具列表中的 Tavily 搜索工具，query 必须是 Model Context Protocol official specification，max_results=2，search_depth=basic。请只执行这一次搜索，等待审批并给出至少一个来源链接。不要写文件、运行命令或调用其他 MCP 工具。', commandId:`codex-mcp-search-${Date.now()}` });
  const result = await waitForTurn(true);
  assert.equal(result.nativeId, nativeId); report.resumed = true;
  const search = result.tools.filter(t => t.name === 'mcp__tavily__tavily_search');
  assert(search.some(t => t.status === 'completed' && /https?:\/\//.test(t.result ?? '')));
  assert(result.messages.some(m => m.role === 'assistant' && /https?:\/\//.test(m.text)));
  assert(report.approvals >= 1); report.searched = true; report.status = 'passed';
  report.backend = result.backend; report.tool = search[0].name;
  await page.screenshot({ path:`test-results/codex-mcp-${version}.png` });
} catch(error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  if (page && sessionId) {
    await page.evaluate(async id => { const s=(await window.dragon.snapshot()).sessions.find(s=>s.id===id); if(s && ['running','waiting','stopping'].includes(s.status)) await window.dragon.action({type:'session.stop',id}); }, sessionId).catch(()=>{});
    await page.evaluate(id=>window.dragon.action({type:'session.archive',id}), sessionId).catch(()=>{});
  }
  if (page && initialPetVisible !== undefined) await page.evaluate(visible=>window.dragon.action({type:'settings.save',pet:{visible}}), initialPetVisible).catch(()=>{});
  if (page && initialSelected) await page.evaluate(id=>window.dragon.action({type:'session.select',id}), initialSelected).catch(()=>{});
  await writeFile(`test-results/codex-mcp-live-${version}.json`, JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  await app.evaluate(({app})=>app.quit());
}

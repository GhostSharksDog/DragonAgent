// 端到端校验：内置「整理提示词」Agent 真的收到了创作人设，并且可以只聊天、只更新部分字段。
// 用本地假模型服务回放 SSE，不访问真实 API。
import { _electron as electron } from '../node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PROMPT_AGENT_PERSONA } from '../src/shared/illustration.ts';

const port = await new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); }); });
const requests = [];
let reply = '可以。先把姿态和光线定下来：她正面躺着、双臂向上，光从窗边斜进来，整体偏暖。\n\n```prompt\n{"positive":"masterpiece, best quality, silver hair, purple eyes, lying on bed, arms up, warm light","negative":"low quality"}\n```';
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  requests.push({ url: req.url, body });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

const home = path.resolve('.runtime/illustration-agent-' + Date.now());
await mkdir(home, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DRAGON_DATA_DIR: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['.'], env, timeout: 45000 });
const report = { passed: false, checks: [] };
try {
  await app.firstWindow();
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find(p => p.url().includes('view=workbench')); if (!page) await new Promise(r => setTimeout(r, 100)); }
  assert(page);
  const act = a => page.evaluate(a => window.dragon.action(a), a), snap = () => page.evaluate(() => window.dragon.snapshot());
  await act({ type: 'profile.save', profile: { id: 'mock', name: '本地假模型', provider: 'custom', protocol: 'openai-completions', baseUrl: `http://127.0.0.1:${port}`, model: 'mock-model', contextWindow: 65536, maxOutput: 4096, hasKey: false, deepseekSearch: false }, apiKey: 'test-key' });
  const id = await act({ type: 'illustration.create', commandId: 'agent-one', description: '银白龙娘躺在床上，午后暖光' });

  const waitIdle = async (expectedMessages) => {
    for (let i = 0; i < 200; i++) {
      const project = (await snap()).illustration.projects.find(v => v.id === id);
      if (project.status === 'idle' && project.messages.length >= expectedMessages) return project;
      if (project.status === 'needs-attention') throw Error('Agent 失败：' + project.error);
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error('等待 Agent 回复超时');
  };

  await act({ type: 'illustration.assistant', id, text: '我想要她正面躺着，双臂向上，暖暖的午后光线', profileId: 'mock' });
  const first = await waitIdle(2);
  assert.equal(first.messages.at(-1).role, 'assistant');
  assert.match(first.messages.at(-1).text, /先把姿态和光线/);
  assert.ok(!first.messages.at(-1).text.includes('```'), '隐藏的 prompt 代码块不应出现在对话里');
  assert.match(first.parameters.positive, /lying on bed/);
  assert.match(first.parameters.positive, /warm light/);
  report.checks.push('Agent 像聊天一样回答，回答里的 prompt 代码块被隐藏并写进草稿');

  const system = requests[0].body.messages.find(m => m.role === 'system').content;
  for (const line of PROMPT_AGENT_PERSONA.split('\n\n').filter(Boolean)) assert.ok(system.includes(line), '系统提示缺少内置创作人设段落：' + line.slice(0, 20));
  assert.match(system, /像平常聊天一样/);
  assert.ok(!system.includes('只输出一个 JSON 对象'), '不应再强迫模型只输出 JSON');
  const user = requests[0].body.messages.at(-1).content;
  assert.ok(user.startsWith('我想要她正面躺着，双臂向上，暖暖的午后光线'), '用户消息应保持原话');
  assert.match(user, /当前项目资料/);
  report.checks.push('请求里带回完整内置创作人设、当前草稿和多轮上下文');

  const before = (await snap()).illustration.projects.find(v => v.id === id).parameters.positive;
  reply = '还差一个设定：她的龙角是银色还是淡紫色？';
  await act({ type: 'illustration.assistant', id, text: '龙角什么颜色好？', profileId: 'mock' });
  const second = await waitIdle(4);
  assert.equal(second.messages.at(-1).text, reply);
  assert.equal(second.parameters.positive, before);
  const history = requests[1].body.messages;
  assert.equal(history[1].role, 'user');
  assert.equal(history[2].role, 'assistant');
  assert.match(history[2].content, /先把姿态和光线/);
  report.checks.push('Agent 可以只聊天追问，不改写提示词；多轮对话按真实角色传入');

  reply = '好，补一点逆光。\n\n```prompt\n{"positive":"masterpiece, best quality, silver hair, purple eyes, lying on bed, arms up, warm light, backlight"}\n```';
  const requestCount = requests.length;
  await act({ type: 'illustration.assistant', id, text: '再加一点逆光', profileId: 'mock' });
  const third = await waitIdle(6);
  assert.match(third.parameters.positive, /backlight/);
  assert.equal(third.parameters.negative, 'low quality');
  assert.equal(requests.length, requestCount + 1);
  assert.equal(third.messages.at(-1).text, '好，补一点逆光。');
  report.checks.push('只返回部分字段时按字段更新，未提供的字段保持原样');

  reply = '已经整理好了，草稿里是最新版本。\n\n```prompt\n{"positive":"masterpiece, best quality, silver hair, purple eyes, lying on bed, arms up, warm light, backlight","negative":"low quality"}\n```';
  await act({ type: 'illustration.assistant', id, text: '', profileId: 'mock', organize: true });
  const fourth = await waitIdle(8);
  assert.equal(fourth.messages.at(-2).text, '（整理提示词）');
  assert.match(fourth.messages.at(-1).text, /已经整理好了/);
  assert.match(requests[3].body.messages.at(-1).content, /请根据以上要求/);
  report.checks.push('「整理提示词」按钮使用独立的整理指令，对话里只留简短标记');

  assert.deepEqual(requests.map(r => r.url), Array(requests.length).fill('/chat/completions'));
  report.passed = true;
  console.log('Illustration prompt agent PASS');
  await act({ type: 'window.workbench', page: 'illustration' });
  await page.getByRole('heading', { name: '角色插画', exact: true }).waitFor();
  await page.locator('.illustration-messages article').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/illustration-agent.png' });
} finally {
  await writeFile('test-results/illustration-agent.json', JSON.stringify(report, null, 2));
  await app.close();
  await new Promise(resolve => server.close(resolve));
}

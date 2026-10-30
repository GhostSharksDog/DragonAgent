// Node 24+, no Electron. Default uses a loopback HTTP model fixture; --live uses only explicit environment settings.
import { createServer } from 'node:http';
import { AgentRuntime, HttpModelAdapter, MemorySessionStore, ToolRegistry } from '../packages/agent-core/dist/index.js';
const live = process.argv.includes('--live');
let fixture, requests = 0, effects = 0;
if (!live) {
  fixture = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk; const body = JSON.parse(data); requests++;
    const results = body.messages.filter(m => m.role === 'tool');
    const call = results.length < 2 ? { index: 0, id: `sum-${results.length}`, type: 'function', function: { name: 'add', arguments: JSON.stringify({ a: results.length ? 5 : 2, b: 3 }) } } : undefined;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: call ? { tool_calls: [call] } : { content: '两次计算完成，结果为 8。' }, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  }); await new Promise(r => fixture.listen(0, '127.0.0.1', r));
}
const profile = { id: 'example', model: process.env.DRAGON_MODEL || 'fixture', protocol: process.env.DRAGON_PROTOCOL || 'openai-completions', baseUrl: live ? process.env.DRAGON_BASE_URL : `http://127.0.0.1:${fixture.address().port}/v1`, contextWindow: Number(process.env.DRAGON_CONTEXT || 65536), maxOutput: 4096 };
if (!profile.baseUrl) throw new Error('Set DRAGON_BASE_URL, DRAGON_MODEL and DRAGON_API_KEY for --live.');
const tools = new ToolRegistry();
tools.register({ name: 'add', description: 'Add two numbers.', effect: 'read', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false }, execute: async ({ a, b }) => { effects++; return { text: String(Number(a) + Number(b)) }; } });
const runtime = new AgentRuntime({ profiles: () => [profile], key: async () => process.env.DRAGON_API_KEY, adapter: new HttpModelAdapter(), tools, store: new MemorySessionStore(), approve: async () => false, question: async () => ({}) });
try {
  const grant = { folders: [], origins: [], browserInput: false, terminal: false };
  const first = await runtime.run({ sessionId: 'example', profileId: profile.id, prompt: '先用工具计算 2+3，再用工具计算其结果加 3。', grant });
  if (first.status !== 'completed') throw new Error(first.error);
  const second = await runtime.run({ sessionId: 'example', profileId: profile.id, prompt: '概括刚才的结果。', grant });
  if (second.status !== 'completed') throw new Error(second.error);
  if (!live && (requests !== 4 || effects !== 2)) throw new Error('Fixture did not complete the multi-turn loop.');
  console.log(second.result); console.log(`PASS: standalone Node, two conversation turns, ${effects} tools, ${requests || 'live'} HTTP requests.`);
} finally { await runtime.dispose(); fixture?.closeAllConnections(); if (fixture) await new Promise(r => fixture.close(r)); }

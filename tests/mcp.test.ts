import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { McpManager, ToolRegistry, type ToolContext, type McpConnectionState } from '../packages/agent-core/src';
const context = (signal = new AbortController().signal): ToolContext => ({ agent: {} as any, signal, approve: async () => true, question: async () => ({}) });
test('stdio MCP discovers tools, approval denial does not execute, and failures are visible', async () => {
  const registry = new ToolRegistry(), states: McpConnectionState[] = [];
  const manager = new McpManager(registry, s => states.push(s), process.cwd(), { connect: 1500, call: 500 });
  try {
    await manager.configure([{ id: 'local', name: 'Fixture', enabled: true, transport: 'stdio', command: process.execPath, args: [path.resolve('tests/fixtures/mcp.mjs')] }]);
    assert.equal(states.at(-1)!.state, 'connected'); assert.equal(registry.schemas().length, 1);
    const result = await registry.call('mcp__local__echo', { text: 'hello' }, context()); assert.equal(result.text, 'MCP:hello');
    const denied = await registry.call('mcp__local__echo', { text: 'denied' }, { ...context(), approve: async () => false }); assert(denied.isError);
    await manager.configure([{ id: 'bad', name: 'Missing', enabled: true, transport: 'stdio', command: 'Z:\\missing-dragon-fixture.exe' }]);
    assert.equal(states.at(-1)!.state, 'error'); assert.equal(registry.schemas().length, 0);
  } finally { await manager.dispose(); }
});
test('Streamable HTTP MCP recovers after malformed results, timeout, disconnect and cancellation without replay', async () => {
  let calls = 0, initializes = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = ''; for await (const data of req) raw += data;
    const message = JSON.parse(raw);
    if (message.id === undefined) { res.writeHead(202).end(); return; }
    let result: any;
    if (message.method === 'initialize') { initializes++; result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } }; }
    else if (message.method === 'tools/list') result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
    else if (message.method === 'tools/call') {
      calls++; const text = message.params.arguments.text;
      if (text === 'hang') return;
      if (text === 'disconnect') { req.socket.destroy(); return; }
      result = text === 'malformed' ? { content: 'invalid' } : { content: [{ type: 'text', text }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const registry = new ToolRegistry(), states: McpConnectionState[] = [];
  const manager = new McpManager(registry, s => states.push(s), process.cwd(), { connect: 1500, call: 100 });
  const run = (text: string, ctx = context()) => registry.call('mcp__http__echo', { text }, ctx);
  try {
    await manager.configure([{ id: 'http', name: 'HTTP fixture', enabled: true, transport: 'streamable-http', url: `http://127.0.0.1:${(server.address() as any).port}/mcp` }]);
    assert.equal(states.at(-1)!.state, 'connected');
    for (const failure of ['malformed', 'hang', 'disconnect']) {
      const before = calls; assert((await run(failure)).isError); assert.equal(calls, before + 1); assert.equal(states.at(-1)!.state, 'error');
      assert.equal((await run('recovered')).text, 'recovered');
    }
    const controller = new AbortController(); const pending = run('hang', context(controller.signal)); setTimeout(() => controller.abort(), 25); await assert.rejects(pending);
    assert.equal((await run('after cancel')).text, 'after cancel'); assert(initializes >= 4);
  } finally { await manager.dispose(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

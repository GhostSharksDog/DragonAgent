// Local native protocol regression: no login or model request.
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { CodexBackend } from '../src/main/codex';
import { CodexToolBindings } from '../src/main/codex-tools';
const backend = new CodexBackend({ home: path.resolve(`.runtime/codex-tool-names-${Date.now()}`), executable: () => path.resolve('dist/runtime/codex/bin/codex.exe'), tools: {} as any, state: () => {}, account: () => {}, quota: () => {}, open: async () => {} });
try {
  const { rpc } = await backend.start();
  const original = [{ name: 'mcp__tavily__tavily_search', description: 'Search the web.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }];
  await assert.rejects(rpc.request('thread/start', { ephemeral: true, dynamicTools: original }), /dynamic tool name is reserved/);
  const bindings = new CodexToolBindings(original);
  const started: any = await rpc.request('thread/start', { ephemeral: true, dynamicTools: bindings.definitions });
  assert(started.thread.id);
  // A new thread has no resumable rollout before its first turn. The live UI test covers resume.
  const result = { reservedNameReproduced: true, aliasAccepted: true, original: original[0].name, alias: bindings.definitions[0].name, inferenceRequests: 0 };
  await writeFile('test-results/codex-tool-names.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await backend.dispose(); }

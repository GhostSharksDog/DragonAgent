import path from 'node:path';
import { CodexBackend } from '../src/main/codex';
const backend = new CodexBackend({ home: path.resolve('.runtime/codex-check'), executable: () => path.resolve('dist/runtime/codex/bin/codex.exe'), tools: {} as any, state: v => console.log(v), account: v => console.log('Account:', v), quota: v => console.log('Quota:', v.status), open: async () => {} });
try { await backend.start(); console.log('Codex native app-server initialize + account/read PASSED; no login or model request.'); }
finally { await backend.dispose(); }

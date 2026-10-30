import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentSession, AppSettings, MemoryFact } from '../shared/contracts';

export interface PersistentState { settings: AppSettings; sessions: AgentSession[]; selectedSessionId: string | null; memory: MemoryFact[]; imports: string[]; pendingSessionDeletes?: string[] }
export function initialState(): PersistentState {
  return {
    settings: { profiles: [], selectedProfile: '', codexPath: '', theme: 'light', limits: { concurrency: 3, children: 12, requests: 64 },
      pet: { visible: false, scale: 1, alwaysOnTop: true, shortcut: 'CommandOrControl+Alt+D' },
      mcp: [{ id: 'tavily', name: 'Tavily 网页搜索', enabled: false, transport: 'streamable-http', url: 'https://mcp.tavily.com/mcp/', hasKey: false }] },
    sessions: [], selectedSessionId: null, memory: [], imports: [],
  };
}
export class Store {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'dragonagent.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, encrypted BLOB NOT NULL);');
  }
  load(): PersistentState {
    const row = this.db.prepare('SELECT version,json FROM app_state WHERE id=1').get();
    if (!row) return initialState();
    if (row.version !== 1 && row.version !== 2) throw new Error('数据版本不受支持，请使用匹配版本的 DragonAgent。');
    if (row.version === 1) {
      const filename = this.db.prepare('PRAGMA database_list').get()!.file as string;
      this.db.prepare('VACUUM INTO ?').run(`${filename}.v1-${Date.now()}.bak`);
    }
    const state = JSON.parse(String(row.json)) as PersistentState;
    state.settings.limits ??= { concurrency: 3, children: 12, requests: 64 };
    for (const session of state.sessions) {
      session.permissionMode ??= 'ask'; session.draftAttachments ??= [];
      if ((session.backend as string) === 'dsh') { session.backend = 'dragon'; session.sourceEngine = 'dsh'; session.readOnly = true; delete session.nativeId; }
      if (['running', 'waiting', 'stopping'].includes(session.status)) {
        session.status = 'interrupted'; session.error = '上次任务被中断，已完成的操作保留。请核对结果后继续。';
        for (const tool of session.tools) if (tool.status === 'running') tool.status = 'unknown';
      }
      session.pending = []; // Permissions are never replayed after a restart.
      for (const task of session.tasks ?? []) if (['queued', 'running', 'waiting'].includes(task.status)) task.status = 'interrupted';
    }
    if (row.version === 1) this.save(state);
    return state;
  }
  save(state: PersistentState) { this.db.prepare('INSERT INTO app_state VALUES(1,2,?) ON CONFLICT(id) DO UPDATE SET version=2,json=excluded.json').run(JSON.stringify(state)); }
  secret(id: string): Uint8Array | undefined { return this.db.prepare('SELECT encrypted FROM secrets WHERE id=?').get(id)?.encrypted as Uint8Array | undefined; }
  setSecret(id: string, value: Uint8Array) { this.db.prepare('INSERT INTO secrets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted').run(id, value); }
  removeSecret(id: string) { this.db.prepare('DELETE FROM secrets WHERE id=?').run(id); }
  close() { this.db.close(); }
}

/** The selected database is opened read-only. No legacy environment/config/secrets are read. */
export function importLegacy(filename: string, state: PersistentState): { sessions: number; memory: number } {
  const db = new DatabaseSync(filename, { readOnly: true });
  const result = { sessions: 0, memory: 0 };
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)));
    if (!tables.has('sessions') && !tables.has('memory_facts')) throw new Error('所选文件不包含 Legacy 会话或记忆。');
    if (tables.has('sessions') && tables.has('turns')) {
      for (const row of db.prepare('SELECT id,title,created_at,updated_at FROM sessions').all()) {
        const source = `legacy:session:${row.id}`;
        if (state.imports.includes(source)) continue;
        const id = randomUUID();
        const turns = db.prepare('SELECT seq,user,assistant,tool_summary FROM turns WHERE session_id=? ORDER BY seq').all(String(row.id));
        const createdAt = parseTime(row.created_at);
        state.sessions.push({ id, title: `[Legacy] ${row.title || '历史会话'}`, backend: 'dragon', sourceEngine: 'legacy', readOnly: true, workspace: '', profileId: state.settings.selectedProfile,
          draft: '', createdAt, updatedAt: parseTime(row.updated_at), status: 'idle', tools: [], pending: [], origins: [], browserInput: false, terminalEnabled: false,
          messages: turns.flatMap(t => [
            { id: randomUUID(), role: 'user' as const, text: String(t.user ?? ''), createdAt },
            { id: randomUUID(), role: 'assistant' as const, text: String(t.assistant ?? ''), createdAt },
          ]).filter(m => m.text),
        });
        state.imports.push(source); result.sessions++;
      }
    }
    if (tables.has('memory_facts')) for (const row of db.prepare('SELECT id,text,tags,ts FROM memory_facts').all()) {
      const source = `legacy:memory:${row.id}`;
      if (state.imports.includes(source)) continue;
      let tags: string[] = []; try { const parsed = JSON.parse(String(row.tags)); if (Array.isArray(parsed)) tags = parsed.filter(v => typeof v === 'string'); } catch { /* Invalid historical tags do not erase the fact. */ }
      state.memory.push({ id: randomUUID(), text: String(row.text), tags, createdAt: parseTime(row.ts), source });
      state.imports.push(source); result.memory++;
    }
    return result;
  } finally { db.close(); }
}
function parseTime(input: unknown): number {
  if (typeof input === 'number') return input < 100_000_000_000 ? input * 1000 : input;
  const parsed = Date.parse(String(input)); return Number.isFinite(parsed) ? parsed : 0;
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentRecord, SessionStore } from './types.js';
export class SqliteSessionStore implements SessionStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true }); this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,content TEXT NOT NULL);');
    for (const row of this.db.prepare('SELECT id,json FROM agents').all()) {
      const a: AgentRecord = JSON.parse(String(row.json));
      if (['running', 'waiting', 'queued'].includes(a.status)) { a.status = 'interrupted'; a.error = '上次执行已中断；没有确认结果的操作不会自动重放。'; this.db.prepare('UPDATE agents SET json=? WHERE id=?').run(JSON.stringify(a), a.id); }
    }
  }
  async getAgent(id: string): Promise<AgentRecord | undefined> { const row = this.db.prepare('SELECT json FROM agents WHERE id=?').get(id); return row ? JSON.parse(String(row.json)) : undefined; }
  async putAgent(a: AgentRecord) { this.db.prepare('INSERT INTO agents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(a.id, a.sessionId, JSON.stringify(a)); }
  async listAgents(id: string): Promise<AgentRecord[]> { return this.db.prepare('SELECT json FROM agents WHERE session_id=?').all(id).map(r => JSON.parse(String(r.json))); }
  async append(e: AgentEvent) { this.db.prepare('INSERT INTO events(session_id,json) VALUES(?,?)').run(e.sessionId, JSON.stringify(e)); }
  async history(id: string): Promise<AgentEvent[]> { return this.db.prepare('SELECT seq,json FROM events WHERE session_id=? ORDER BY seq').all(id).map(r => ({ ...JSON.parse(String(r.json)), seq: Number(r.seq) })); }
  async putAttachment(sessionId: string, text: string) { const id = randomUUID(); this.db.prepare('INSERT INTO attachments VALUES(?,?,?)').run(id, sessionId, text); return id; }
  async readAttachment(sessionId: string, id: string, offset: number, limit: number) { const row = this.db.prepare('SELECT substr(content,?,?) AS content FROM attachments WHERE id=? AND session_id=?').get(offset + 1, limit, id, sessionId); if (!row) throw new Error('附件不存在或不属于此会话。'); return String(row.content); }
  close() { this.db.close(); }
}

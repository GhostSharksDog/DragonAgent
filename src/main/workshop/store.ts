import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_WORKSHOP_SETTINGS, type WorkshopProject, type WorkshopSettings, type WorkshopSkin } from '../../shared/workshop';

/** Workshop data is isolated from chats and model secrets. Large assets are files, never IPC blobs. */
export class WorkshopStore {
  private db: DatabaseSync;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'workshop.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS skins (id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,time INTEGER NOT NULL,type TEXT NOT NULL,json TEXT NOT NULL);');
    const version = this.value<number>('version', 1); if (version !== 1) throw new Error('创作工坊数据版本不受支持。');
    this.setValue('version', 1);
  }
  value<T>(id: string, fallback: T): T { const row = this.db.prepare('SELECT json FROM metadata WHERE id=?').get(id); return row ? JSON.parse(String(row.json)) : fallback; }
  setValue(id: string, value: unknown) { this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id, JSON.stringify(value)); }
  settings(): WorkshopSettings { return { ...DEFAULT_WORKSHOP_SETTINGS, ...this.value<Partial<WorkshopSettings>>('settings', {}) }; }
  projects(): WorkshopProject[] { return this.db.prepare('SELECT json FROM projects').all().map(row => JSON.parse(String(row.json))).sort((a,b) => b.createdAt - a.createdAt); }
  skins(): WorkshopSkin[] { return this.db.prepare('SELECT json FROM skins').all().map(row => JSON.parse(String(row.json))); }
  save(project: WorkshopProject) { this.db.prepare('INSERT INTO projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(project.id, JSON.stringify(project)); }
  skin(skin: WorkshopSkin) { this.db.prepare('INSERT INTO skins VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(skin.id, JSON.stringify(skin)); }
  remove(id: string) { this.db.prepare('DELETE FROM projects WHERE id=?').run(id); }
  event(id: string, type: string, value: unknown) { this.db.prepare('INSERT INTO events(project_id,time,type,json) VALUES(?,?,?,?)').run(id, Date.now(), type, JSON.stringify(value)); }
  close() { this.db.close(); }
}

export function inside(root: string, relative: string): string {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('素材路径无效。');
  const target = path.resolve(root, relative), base = path.resolve(root);
  if (!target.startsWith(base + path.sep)) throw new Error('素材必须位于工作流目录内。');
  return target;
}

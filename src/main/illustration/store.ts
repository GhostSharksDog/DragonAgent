import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { IllustrationProject } from '../../shared/illustration';

/** Separate from animation projects. Runs preserve submitted parameters and uncertain results. */
export class IllustrationStore {
  private db: DatabaseSync;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'illustration.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS metadata(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,command_id TEXT UNIQUE NOT NULL,json TEXT NOT NULL);');
    const version = this.get('version', 1);
    if (version !== 1 && version !== 2) { this.db.close(); throw Error('插画项目数据版本不受支持。'); }
    if(version===1)this.db.prepare('VACUUM INTO ?').run(path.join(root,'illustration.db.v1-'+Date.now()+'.bak'));
    this.set('version', 2);
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT json FROM metadata WHERE id=?').get(key);
    return row ? JSON.parse(String(row.json)) : fallback;
  }
  set(key: string, value: unknown) {
    this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(key, JSON.stringify(value));
  }
  unset(key: string) { this.db.prepare('DELETE FROM metadata WHERE id=?').run(key); }
  list(): IllustrationProject[] {
    return this.db.prepare('SELECT json FROM projects').all().map(r => JSON.parse(String(r.json))).sort((a,b) => b.updatedAt-a.updatedAt);
  }
  save(project: IllustrationProject) {
    this.db.prepare('INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(project.id, project.commandId, JSON.stringify(project));
  }
  delete(id: string) { this.db.prepare('DELETE FROM projects WHERE id=?').run(id); }
  recover() {
    for (const p of this.list()) {
      if (!['searching','analyzing','generating'].includes(p.status)) continue;
      p.activeJob=undefined;
      p.status = 'needs-attention';
      p.error = '上次操作被中断。恢复生成时将先核对原任务，不会自动重复提交。';
      for (const run of p.runs) if (['preparing','submitted'].includes(run.state)) run.state = 'unknown';
      this.save(p);
    }
  }
  close() { this.db.close(); }
}

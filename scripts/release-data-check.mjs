// Read-only release safeguard. Records hashes and counts, never plaintext or encrypted secrets.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = path.join(process.env.APPDATA, 'DragonAgent');
const filename = path.join(home, 'dragonagent.db');
assert(existsSync(filename), 'Existing application database was not found.');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const db = new DatabaseSync(filename, { readOnly: true });
let snapshot;
try {
  const state = JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  assert(!(state.sessions ?? []).some(s => ['running', 'waiting', 'stopping'].includes(s.status)), 'Finish existing chat tasks before replacement.');
  const secrets = db.prepare('SELECT id,encrypted FROM secrets ORDER BY id').all();
  snapshot = {
    fingerprints: { profiles: hash(state.settings.profiles), memory: hash(state.memory), sessions: hash(state.sessions), secrets: hash(secrets) },
    counts: { profiles: state.settings.profiles.length, memory: state.memory.length, sessions: state.sessions.length, secrets: secrets.length },
  };
} finally { db.close(); }
const workshopFile = path.join(home, 'workshop/workshop.db');
if (existsSync(workshopFile)) {
  const workshop = new DatabaseSync(workshopFile, { readOnly: true });
  try {
    const projects = workshop.prepare('SELECT json FROM projects').all().map(row => JSON.parse(row.json));
    assert(!projects.some(p => ['character', 'queued', 'running', 'stopping'].includes(p.status) || p.operation), 'Finish or resolve workshop tasks before replacement.');
  } finally { workshop.close(); }
}
await mkdir('test-results', { recursive: true });
if (process.argv[2] === 'snapshot') {
  await writeFile('test-results/release-data-before.json', JSON.stringify(snapshot));
  console.log(JSON.stringify({ idle: true, counts: snapshot.counts }));
} else if (process.argv[2] === 'verify') {
  const before = JSON.parse(await readFile('test-results/release-data-before.json', 'utf8'));
  assert.deepEqual(snapshot, before, 'Protected application data changed during release replacement.');
  const report = { passed: true, checkedAt: new Date().toISOString(), profilesPreserved: true, encryptedSecretsPreserved: true, memoryPreserved: true, sessionsPreserved: true, counts: snapshot.counts };
  await writeFile('test-results/release-data-preservation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} else throw new Error('Use snapshot or verify.');

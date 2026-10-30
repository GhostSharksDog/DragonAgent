// Read-only comparison with the automatic pre-migration backup; never output secret values.
import { DatabaseSync } from 'node:sqlite';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const home = path.join(process.env.APPDATA, 'DragonAgent');
const backups = await Promise.all((await readdir(home)).filter(n => /^dragonagent\.db\.v1-\d+\.bak$/.test(n)).map(async n => ({ name:n, modified:(await stat(path.join(home,n))).mtimeMs })));
backups.sort((a,b) => b.modified-a.modified);
assert(backups.length, 'The automatic v1 backup must exist.');
const current = new DatabaseSync(path.join(home,'dragonagent.db'), { readOnly:true });
const previous = new DatabaseSync(path.join(home,backups[0].name), { readOnly:true });
try {
  const beforeRow = previous.prepare('SELECT version,json FROM app_state WHERE id=1').get();
  const afterRow = current.prepare('SELECT version,json FROM app_state WHERE id=1').get();
  const before = JSON.parse(beforeRow.json), after = JSON.parse(afterRow.json);
  assert.equal(beforeRow.version,1); assert.equal(afterRow.version,2);
  assert.deepEqual(after.settings.profiles,before.settings.profiles);
  assert.deepEqual(after.memory,before.memory);
  assert.deepEqual(current.prepare('SELECT id,encrypted FROM secrets ORDER BY id').all(),previous.prepare('SELECT id,encrypted FROM secrets ORDER BY id').all());
  const oldSessions = before.sessions.filter(s => s.backend === 'dsh');
  for (const old of oldSessions) { const s=after.sessions.find(s=>s.id===old.id); assert(s?.readOnly && s.sourceEngine==='dsh' && s.backend==='dragon'); assert.deepEqual(s.messages,old.messages); }
  const result = { schema:2, profilesPreserved:after.settings.profiles.length, memoriesPreserved:after.memory.length, encryptedSecretsPreserved:current.prepare('SELECT count(*) AS count FROM secrets').get().count, oldDshSessionsReadOnly:oldSessions.length, automaticBackup:backups[0].name, status:'passed' };
  await writeFile('test-results/data-preservation021.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { current.close(); previous.close(); }

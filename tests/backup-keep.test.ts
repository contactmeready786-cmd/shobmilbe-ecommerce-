// 🗂️ owner, 2026-11-13: only the running day's and the day before's backups are kept — the server's nightly copies too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('the server folder keeps the newest 2 database copies, other files untouched', async () => {
  const auto = await import('../lib/services/autobackup');
  assert.equal(auto.KEEP, 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  days.forEach((d, i) => { const f = path.join(dir, `db-${d}.dump`); fs.writeFileSync(f, 'x'); const t = new Date(Date.now() - (days.length - i) * 864e5); fs.utimesSync(f, t, t); });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
  assert.equal(auto.pruneLocal(dir), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['db-2026-11-12.dump', 'db-2026-11-13.dump', 'notes.txt']);
  assert.equal(auto.pruneLocal(path.join(dir, 'missing')), -1);
});

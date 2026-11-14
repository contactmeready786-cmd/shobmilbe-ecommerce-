// 🗄️ The database pool (lib/pg.ts, 2026-11-14): on the VPS many visitors' queries must not wait in one line.
//  • slow queries asked at the same time run side by side (on one connection they took turns)
//  • a transaction keeps its own connection: what it hasn't committed is not seen outside, and its inner queries
//    go into it
//  • the pool never opens more connections than its limit, and closeConnection() closes them all
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection, poolStats } from '../lib/pg';

after(() => closeConnection());

test('queries asked together run side by side, within the pool\'s limit', { skip }, async () => {
  await db.ensureReady();
  const t = Date.now();
  const pids = await Promise.all(Array.from({ length: 12 }, () => db.one<{ pid: number }>('SELECT pg_backend_pid()::int AS pid, pg_sleep(0.3)')));
  const took = Date.now() - t;
  const used = new Set(pids.map((r) => r!.pid)).size;
  const s = poolStats();
  assert.ok(used > 1, 'more than one connection did the work');
  assert.ok(used <= s.max && s.open <= s.max, `never more than the limit (${s.max})`);
  assert.ok(took < 12 * 300, `12 × 0.3 s one after another would be 3.6 s — took ${took} ms`);
  assert.ok(s.queries >= 12 && s.slow >= 12, 'the queries and the slow ones are counted');
});

test('a transaction has its own connection: nothing is seen outside before it commits', { skip }, async () => {
  await db.ensureReady();
  const key = `pool_test_${Date.now()}`;
  await db.tx(async () => {
    await db.q('INSERT INTO settings(key, value) VALUES($1, $2)', [key, 'inside']); // routed into the transaction
    const mine = await db.one<{ value: string }>('SELECT value FROM settings WHERE key=$1', [key]);
    assert.equal(mine?.value, 'inside', 'the transaction sees its own row');
  });
  assert.equal((await db.one<{ value: string }>('SELECT value FROM settings WHERE key=$1', [key]))?.value, 'inside', 'committed');
  await assert.rejects(db.tx(async () => {
    await db.q('UPDATE settings SET value=$2 WHERE key=$1', [key, 'undone']);
    throw new Error('stop');
  }), /stop/);
  assert.equal((await db.one<{ value: string }>('SELECT value FROM settings WHERE key=$1', [key]))?.value, 'inside', 'rolled back');
  await db.q('DELETE FROM settings WHERE key=$1', [key]);
});

test('closeConnection closes every connection of the pool', { skip }, async () => {
  await db.ensureReady();
  await Promise.all([db.q('SELECT pg_sleep(0.05)'), db.q('SELECT pg_sleep(0.05)'), db.q('SELECT pg_sleep(0.05)')]);
  assert.ok(poolStats().open >= 1);
  closeConnection();
  assert.equal(poolStats().open, 0);
  assert.equal((await db.one<{ n: number }>('SELECT 1 AS n'))?.n, 1, 'and the next query opens a new one');
});

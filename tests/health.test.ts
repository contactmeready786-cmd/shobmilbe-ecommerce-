// 🩺 Server & database health (lib/services/health.ts): when the owner is warned, and what about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../lib/services/health';

const MB = 1024 * 1024;
const base = (over: Partial<H.Health> = {}): H.Health => ({
  dbBytes: 100 * MB, limitBytes: 500 * MB, share: 0.2, dbLevel: 'ok',
  tables: [{ name: 'page_views', bytes: 40 * MB, rows: 120000 }, { name: 'orders', bytes: 5 * MB, rows: 900 }],
  pingMs: 4, pingLevel: 'ok', connections: 5, maxConnections: 60, connLevel: 'ok',
  backupAt: new Date(), backupDays: 0.3, backupLevel: 'ok', checkedAt: new Date(), ...over,
});

test('limit: Supabase free plan by default, owner can set another', () => {
  assert.equal(H.limitBytes({} as never), 500 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: '8192' } as never), 8192 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: 'abc' } as never), 500 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: '5' } as never), 500 * MB); // nonsense values ignored
});

test('levels: warn at 80 %, bad at 90 %', () => {
  assert.equal(H.levelFor(0.5), 'ok');
  assert.equal(H.levelFor(0.8), 'warn');
  assert.equal(H.levelFor(0.89), 'warn');
  assert.equal(H.levelFor(0.9), 'bad');
});

test('all fine: no warnings', () => {
  assert.deepEqual(H.warnings(base()), []);
});

test('database filling up: one warning naming the biggest tables', () => {
  const w = H.warnings(base({ dbBytes: 420 * MB, share: 0.84, dbLevel: 'warn' }));
  assert.equal(w.length, 1);
  assert.equal(w[0].key, 'db');
  assert.match(w[0].title, /৮৪%/);
  assert.match(w[0].text, /ভিজিটর অ্যানালিটিক্স/);
});

test('no backup for days, and connections nearly used up', () => {
  const w = H.warnings(base({ backupDays: 3.2, backupLevel: 'warn', connections: 57, connLevel: 'bad' }));
  assert.deepEqual(w.map((x) => x.key).sort(), ['backup', 'conn']);
  assert.match(w.find((x) => x.key === 'backup')!.title, /৩|3/);
});

test('MB formatting', () => {
  assert.equal(H.mb(85.4 * MB), '85.4');
  assert.equal(H.mb(512 * MB), '512');
});

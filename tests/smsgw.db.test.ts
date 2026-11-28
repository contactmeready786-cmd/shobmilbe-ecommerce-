// 📱 The shop's own SMS app (services/smsgw.ts, android-sms/), end to end on a throw-away Postgres:
// pairing with the 6-digit code, the main phone and the backup, reporting, retries, expiry.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import * as cache from '../lib/cache';
import { closeConnection } from '../lib/pg';
import * as SMS from '../lib/services/sms';
import * as GW from '../lib/services/smsgw';
import type { Settings } from '../lib/types';

const fresh = async () => { cache.clearAll(); return { ...(await db.getSettings()) } as Settings; };
const on = async () => ({ ...(await fresh()), sms_on: '1', sms_provider: 'ownapp' }) as Settings;
const logOf = (id?: string) => db.one<{ ok: boolean; detail: string }>('SELECT l.ok, l.detail FROM sms_log l JOIN sms_outbox o ON o.log_id=l.id WHERE o.id=$1', [id]);
let moto = 0; let xiaomi = 0; let motoKey = '';

before(async () => {
  if (skip) return;
  await db.ensureReady();
  await db.q('DELETE FROM sms_outbox');
  await GW.unpair();
});
after(() => { closeConnection(); });

test('pairing: only the fresh 6-digit code works, once; the key is never stored; the first phone is the main one', { skip }, async () => {
  const code = await GW.newPairCode();
  assert.equal(await GW.pair(code === '000000' ? '111111' : '000000', 'x'), null);
  motoKey = (await GW.pair(code, 'Motorola G75'))!;
  assert.ok(motoKey && motoKey.length >= 32);
  assert.equal(await GW.pair(code, 'again'), null, 'a code works only once');
  moto = (await GW.phoneFor(motoKey))!;
  assert.ok(moto);
  assert.equal(await GW.phoneFor(motoKey + 'x'), null);
  const s = await fresh();
  assert.equal(s.smsgw_phones, '1');
  assert.equal(Number(s.smsgw_main), moto);
  assert.ok(!JSON.stringify(await db.q('SELECT * FROM sms_phones')).includes(motoKey));
  // a second phone joins as a backup
  const k2 = (await GW.pair(await GW.newPairCode(), 'Xiaomi Max 2'))!;
  xiaomi = (await GW.phoneFor(k2))!;
  assert.equal((await fresh()).smsgw_phones, '2');
  assert.equal(Number((await fresh()).smsgw_main), moto);
});

test('an old code stops working after 15 minutes', { skip }, async () => {
  const code = await GW.newPairCode();
  const [h] = String((await fresh()).smsgw_pair).split('|');
  await db.setMany({ smsgw_pair: `${h}|${Date.now() - 1000}` });
  assert.equal(await GW.pair(code, 'x'), null);
  await db.setMany({ smsgw_pair: '' });
});

test('the main phone takes an SMS at once and reports it; the log says which phone', { skip }, async () => {
  const s = await on();
  assert.equal(SMS.ready(s).ok, true);
  const t0 = Date.now();
  const waiting = GW.pull(moto, { battery: 80, charging: true, model: 'Motorola G75', app: '1.1' }, 8000);
  await new Promise((r) => setTimeout(r, 300));
  const r = await SMS.send(s, '01712345678', 'সবমিলবে: আপনার কোড 1234', { kind: 'test' });
  assert.equal(r.ok, true);
  const got = await waiting;
  assert.ok(Date.now() - t0 < 4000, 'woken at once');
  assert.deepEqual(got.map((m) => m.phone), ['+8801712345678']);
  assert.equal((await SMS.smsState(s, r.id))!.state, 'Processed');
  await GW.report(moto, [{ id: got[0].id, state: 'sent' }]);
  await GW.report(moto, [{ id: got[0].id, state: 'delivered' }]);
  await GW.report(moto, [{ id: got[0].id, state: 'failed', error: 'late' }]); // a finished SMS can't turn into failed
  assert.equal((await SMS.smsState(s, r.id))!.state, 'Delivered');
  const log = await logOf(r.id);
  assert.equal(log!.ok, true);
  assert.match(log!.detail, /পৌঁছেছে.*Motorola/);
});

test('backup: waits while the main phone is connected, takes it after 8 s; at once when the main phone is away', { skip }, async () => {
  const s = await on();
  await GW.pull(moto, {}, 0); // the main phone was here just now
  const a = await SMS.send(s, '01812345678', 'a', { kind: 'test' });
  assert.equal((await GW.pull(xiaomi, {}, 0)).length, 0, 'the backup leaves a fresh SMS to the main phone');
  await db.q("UPDATE sms_outbox SET created_at = now() - interval '9 seconds' WHERE id=$1", [a.id]);
  assert.deepEqual((await GW.pull(xiaomi, {}, 0)).map((m) => m.id), [a.id], 'not taken by the main phone in 8 s → backup');
  await GW.report(xiaomi, [{ id: a.id, state: 'sent' }]);
  // the main phone silent for a minute → the backup takes a new SMS at once
  await db.q("UPDATE sms_phones SET last_seen = now() - interval '1 minute' WHERE id=$1", [moto]);
  const b = await SMS.send(s, '01812345679', 'b', { kind: 'test' });
  assert.deepEqual((await GW.pull(xiaomi, {}, 0)).map((m) => m.id), [b.id]);
  await GW.report(xiaomi, [{ id: b.id, state: 'sent' }]);
  // the owner makes the Xiaomi the main phone: now it takes everything at once, the Motorola is the backup
  assert.ok(await GW.setMain(xiaomi));
  await GW.pull(xiaomi, {}, 0);
  const c = await SMS.send(await on(), '01812345670', 'c', { kind: 'test' });
  assert.equal((await GW.pull(moto, {}, 0)).length, 0);
  assert.deepEqual((await GW.pull(xiaomi, {}, 0)).map((m) => m.id), [c.id]);
  await GW.report(xiaomi, [{ id: c.id, state: 'sent' }]);
  assert.ok(await GW.setMain(moto));
});

test('a phone that could not send: the other connected phone tries once; then it is failed in the log', { skip }, async () => {
  const s = await on();
  await GW.pull(xiaomi, {}, 0); // both phones connected
  const a = await SMS.send(s, '01912345678', 'x', { kind: 'test' });
  assert.deepEqual((await GW.pull(moto, {}, 0)).map((m) => m.id), [a.id]);
  await GW.report(moto, [{ id: a.id, state: 'failed', error: 'SIM-এ ব্যালান্স নেই' }]);
  assert.equal((await GW.pull(moto, {}, 0)).length, 0, 'never back to the phone that failed');
  await db.q("UPDATE sms_outbox SET created_at = now() - interval '9 seconds' WHERE id=$1", [a.id]);
  assert.deepEqual((await GW.pull(xiaomi, {}, 0)).map((m) => m.id), [a.id], 'the backup tries');
  await GW.report(xiaomi, [{ id: a.id, state: 'failed', error: 'নেটওয়ার্ক নেই' }]);
  assert.equal((await SMS.smsState(s, a.id))!.state, 'Failed');
  const log = await logOf(a.id);
  assert.equal(log!.ok, false);
  assert.match(log!.detail, /নেটওয়ার্ক/);
});

test('unreported SMS is tried again, at most 3 times; one no phone took expires after 10 minutes', { skip }, async () => {
  await GW.unpair(xiaomi);
  const s = await on();
  const b = await SMS.send(s, '01912345670', 'y', { kind: 'test' });
  for (let i = 1; i <= 3; i++) {
    assert.deepEqual((await GW.pull(moto, {}, 0)).map((m) => m.id), [b.id], `try ${i}`);
    await db.q("UPDATE sms_outbox SET taken_at = now() - interval '4 minutes' WHERE id=$1", [b.id]);
  }
  assert.equal((await GW.pull(moto, {}, 0)).length, 0);
  assert.equal((await SMS.smsState(s, b.id))!.state, 'Failed');
  const c = await SMS.send(s, '01612345678', 'z', { kind: 'test' });
  await db.q("UPDATE sms_outbox SET created_at = now() - interval '11 minutes' WHERE id=$1", [c.id]);
  await GW.tidy(); // the 5-minute job alone (no phone asking) marks it too
  assert.equal((await SMS.smsState(s, c.id))!.state, 'Failed');
  assert.equal((await logOf(c.id))!.ok, false);
});

test('removing the main phone makes the one left main; none left: SMS not ready, keys dead', { skip }, async () => {
  const k2 = (await GW.pair(await GW.newPairCode(), 'Xiaomi Max 2'))!;
  const x2 = (await GW.phoneFor(k2))!;
  await GW.unpair(moto);
  assert.equal(Number((await fresh()).smsgw_main), x2);
  assert.equal(await GW.phoneFor(motoKey), null);
  assert.equal((await SMS.phoneStatus(await on())).model, 'Xiaomi Max 2');
  await GW.unpair();
  const s = await on();
  assert.equal(SMS.ready(s).ok, false);
  assert.equal(await GW.phoneFor(k2), null);
  assert.equal((await SMS.phoneStatus(s)).phoneLevel, 'bad');
});

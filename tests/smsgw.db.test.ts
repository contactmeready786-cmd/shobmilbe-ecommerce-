// 📱 The shop's own SMS app (services/smsgw.ts, android-sms/), end to end on a throw-away Postgres:
// pairing with the 6-digit code, the phone taking an SMS the shop hands over, reporting it, retries, expiry.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as SMS from '../lib/services/sms';
import * as GW from '../lib/services/smsgw';
import type { Settings } from '../lib/types';

import * as cache from '../lib/cache';
const fresh = async () => { cache.clearAll(); return { ...(await db.getSettings()) } as Settings; };
let key = '';

before(async () => {
  if (skip) return;
  await db.ensureReady();
  await db.q('DELETE FROM sms_outbox');
  await GW.unpair();
});
after(() => { closeConnection(); });

test('pairing: only the fresh 6-digit code works, once; the key is never stored', { skip }, async () => {
  const code = await GW.newPairCode();
  let s = await fresh();
  assert.equal(await GW.pair('000000' === code ? '111111' : '000000', 'Moto'), null);
  key = (await GW.pair(code, 'Motorola G75'))!;
  assert.ok(key && key.length >= 32);
  s = await fresh();
  assert.equal(await GW.pair(code, 'again'), null, 'a code works only once');
  assert.ok(GW.keyOk(s, key));
  assert.ok(!GW.keyOk(s, key + 'x'));
  assert.ok(!String(s.smsgw_token_hash).includes(key));
  assert.equal((await GW.phone())!.model, 'Motorola G75');
});

test('an old code stops working after 15 minutes', { skip }, async () => {
  const code = await GW.newPairCode();
  const [h] = String((await fresh()).smsgw_pair).split('|');
  await db.setMany({ smsgw_pair: `${h}|${Date.now() - 1000}` });
  assert.equal(await GW.pair(code, 'x'), null);
  await db.setMany({ smsgw_pair: '' });
});

test('the shop hands an SMS over, the phone takes it at once and reports it', { skip }, async () => {
  const s = { ...(await fresh()), sms_on: '1', sms_provider: 'ownapp' } as Settings;
  assert.equal(SMS.ready(s).ok, true);
  // the phone is already waiting when the SMS comes in: it must get it well before the 25 seconds are up
  const t0 = Date.now();
  const waiting = GW.pull({ battery: 80, charging: true, model: 'Motorola G75', app: '1.0' }, 8000);
  await new Promise((r) => setTimeout(r, 300));
  const r = await SMS.send(s, '01712345678', 'সবমিলবে: আপনার কোড 1234', { kind: 'test' });
  assert.equal(r.ok, true);
  const got = await waiting;
  assert.ok(Date.now() - t0 < 4000, 'woken at once');
  assert.equal(got.length, 1);
  assert.equal(got[0].phone, '+8801712345678');
  assert.equal((await SMS.androidState(s, r.id))!.state, 'Processed');
  assert.equal(await GW.report([{ id: got[0].id, state: 'sent' }]), 1);
  assert.equal((await SMS.androidState(s, r.id))!.state, 'Sent');
  await GW.report([{ id: got[0].id, state: 'delivered' }]);
  await GW.report([{ id: got[0].id, state: 'failed', error: 'late' }]); // a finished SMS can't turn into failed
  assert.equal((await SMS.androidState(s, r.id))!.state, 'Delivered');
  const log = await db.one<{ ok: boolean; detail: string }>('SELECT l.ok, l.detail FROM sms_log l JOIN sms_outbox o ON o.log_id=l.id WHERE o.id=$1', [r.id]);
  assert.equal(log!.ok, true);
  assert.match(log!.detail, /পৌঁছেছে/);
  const st = await SMS.phoneStatus(s);
  assert.equal(st.phoneLevel, 'ok');
  assert.equal(st.battery, 80);
});

test('a failed SMS shows as failed in the log; an unreported one is tried again, at most 3 times', { skip }, async () => {
  const s = { ...(await fresh()), sms_on: '1', sms_provider: 'ownapp' } as Settings;
  const a = await SMS.send(s, '01812345678', 'x', { kind: 'test' });
  let got = await GW.pull({}, 0);
  await GW.report([{ id: a.id, state: 'failed', error: 'SIM-এ ব্যালান্স নেই' }]);
  const log = await db.one<{ ok: boolean; detail: string }>('SELECT l.ok, l.detail FROM sms_log l JOIN sms_outbox o ON o.log_id=l.id WHERE o.id=$1', [a.id]);
  assert.equal(log!.ok, false);
  assert.match(log!.detail, /ব্যালান্স/);

  const b = await SMS.send(s, '01912345678', 'y', { kind: 'test' });
  for (let i = 1; i <= 3; i++) {
    got = await GW.pull({}, 0);
    assert.deepEqual(got.map((m) => m.id), [b.id], `try ${i}`);
    await db.q("UPDATE sms_outbox SET taken_at = now() - interval '4 minutes' WHERE id=$1", [b.id]);
  }
  got = await GW.pull({}, 0);
  assert.equal(got.length, 0);
  assert.equal((await SMS.androidState(s, b.id))!.state, 'Failed');
});

test('an SMS the phone never took expires after 10 minutes (an old code is no use)', { skip }, async () => {
  const s = { ...(await fresh()), sms_on: '1', sms_provider: 'ownapp' } as Settings;
  const c = await SMS.send(s, '01612345678', 'z', { kind: 'test' });
  await db.q("UPDATE sms_outbox SET created_at = now() - interval '11 minutes' WHERE id=$1", [c.id]);
  assert.equal((await GW.pull({}, 0)).length, 0);
  assert.equal((await SMS.androidState(s, c.id))!.state, 'Failed');
});

test('unpaired: SMS is not ready and the old key stops working', { skip }, async () => {
  await GW.unpair();
  const s = { ...(await fresh()), sms_on: '1', sms_provider: 'ownapp' } as Settings;
  assert.equal(SMS.ready(s).ok, false);
  assert.ok(!GW.keyOk(s, key));
  assert.equal((await SMS.phoneStatus(s)).phoneLevel, 'bad');
});

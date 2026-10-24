// 🔐 Checkout OTP, end to end, on a real (throw-away) Postgres database — the code that stops fake orders.
// GitHub runs this on every change (.github/workflows/tests.yml) with an empty test database; the SMS is a fake,
// so no real SMS is sent. It NEVER runs against the shop's real database (see the guard below).
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as OTP from '../lib/models/checkoutotp';
import * as SMS from '../lib/services/sms';
import * as customers from '../lib/models/customers';

type Sent = { phone: string; text: string };
let sent: Sent[] = [];
let smsWorks = true;
let base: Record<string, string> = {};
const req = { headers: {} };
// SMS on (through the fake), OTP on, no daily cap
const S = (over: Record<string, string> = {}) => ({ ...base, co_otp_on: '1', sms_on: '1', sms_provider: 'custom', sms_custom_url: 'https://sms.example.com/?to={to}&m={message}', co_otp_daily_cap: '0', ...over }) as never;
const codeIn = (t: string) => (t.match(/\b(\d{4})\b/) || [])[1];
let n = 0;
const newPhone = () => `0171${String(Date.now() % 1000000).padStart(6, '0').slice(0, 4)}${String(++n).padStart(3, '0')}`.slice(0, 11);

before(async () => {
  if (skip) return;
  await db.ensureReady();
  base = (await db.getSettings()) as never;
  SMS.setFakeSender(async (phone, text) => {
    sent.push({ phone, text });
    return smsWorks ? { ok: true, msg: 'fake: sent' } : { ok: false, msg: 'fake: SIM has no balance' };
  });
});
after(() => { SMS.setFakeSender(null); closeConnection(); });
beforeEach(async () => {
  if (skip) return;
  sent = [];
  smsWorks = true;
  await db.q('DELETE FROM rate_limits');
});

test('a 4-digit code goes by SMS; the right code gives a pass the order accepts', { skip }, async () => {
  const phone = newPhone();
  const r = await OTP.sendCode(req, S(), phone, '10.0.0.1');
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, phone);
  const code = codeIn(sent[0].text)!;
  assert.match(code, /^\d{4}$/);
  assert.ok(sent[0].text.includes(base.store_name || ''), 'the SMS names the shop');
  // stored only as a hash, never the code itself
  const row = await db.one('SELECT code_hash FROM checkout_otps WHERE phone=$1 ORDER BY id DESC LIMIT 1', [phone]);
  // (a 64-letter hash can contain 4 digits in a row by chance — about 1 run in 1,000 — so only its shape is checked)
  assert.ok(row && String(row.code_hash) !== code && /^[0-9a-f]{64}$/.test(String(row.code_hash)));

  const v = await OTP.verifyCode(S(), phone, code);
  assert.equal(v.phone, phone);
  assert.deepEqual(await OTP.checkOrder(req, S(), phone, v.token), { ok: true, how: 'otp' });
  // the pass belongs to that number only
  assert.equal((await OTP.checkOrder(req, S(), newPhone(), v.token)).ok, false);
  // no pass at all: no order
  assert.equal((await OTP.checkOrder(req, S(), phone, '')).ok, false);
  assert.equal((await OTP.checkOrder(req, S(), phone, 'forged.token')).ok, false);
});

test('a code works once only', { skip }, async () => {
  const phone = newPhone();
  await OTP.sendCode(req, S(), phone, '10.0.0.2');
  const code = codeIn(sent[0].text)!;
  await OTP.verifyCode(S(), phone, code);
  await assert.rejects(OTP.verifyCode(S(), phone, code), (e: Error & { expired?: boolean }) => e.expired === true);
});

test('Bangla digits are accepted', { skip }, async () => {
  const phone = newPhone();
  await OTP.sendCode(req, S(), phone, '10.0.0.3');
  const code = codeIn(sent[0].text)!;
  const bnCode = code.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
  const v = await OTP.verifyCode(S(), phone.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]), bnCode);
  assert.equal(v.phone, phone);
});

test('5 wrong tries and the code is dead, even the right one', { skip }, async () => {
  const phone = newPhone();
  await OTP.sendCode(req, S(), phone, '10.0.0.4');
  const code = codeIn(sent[0].text)!;
  const wrong = code === '1111' ? '2222' : '1111';
  for (let i = 1; i <= 4; i++) {
    await assert.rejects(OTP.verifyCode(S(), phone, wrong), /মেলেনি/);
  }
  await assert.rejects(OTP.verifyCode(S(), phone, wrong), (e: Error & { expired?: boolean }) => e.expired === true);
  await assert.rejects(OTP.verifyCode(S(), phone, code), (e: Error & { expired?: boolean }) => e.expired === true);
});

test('an expired code (over 10 minutes) is refused', { skip }, async () => {
  const phone = newPhone();
  await OTP.sendCode(req, S(), phone, '10.0.0.5');
  const code = codeIn(sent[0].text)!;
  await db.q("UPDATE checkout_otps SET expires_at = now() - interval '1 minute' WHERE phone=$1", [phone]);
  await assert.rejects(OTP.verifyCode(S(), phone, code), (e: Error & { expired?: boolean }) => e.expired === true);
});

test('asking again within a minute sends no second SMS; a new code replaces the old one', { skip }, async () => {
  const phone = newPhone();
  await OTP.sendCode(req, S(), phone, '10.0.0.6');
  const again = await OTP.sendCode(req, S(), phone, '10.0.0.6');
  assert.equal(again.again, true);
  assert.equal(sent.length, 1);
  const first = codeIn(sent[0].text)!;
  // a minute later: a new code, and the first one stops working
  await db.q("UPDATE checkout_otps SET created_at = now() - interval '2 minutes' WHERE phone=$1", [phone]);
  await OTP.sendCode(req, S(), phone, '10.0.0.6');
  assert.equal(sent.length, 2);
  const second = codeIn(sent[1].text)!;
  if (first !== second) await assert.rejects(OTP.verifyCode(S(), phone, first));
  assert.equal((await OTP.verifyCode(S(), phone, second)).phone, phone);
});

test('one number: at most 3 codes in 10 minutes (each costs an SMS)', { skip }, async () => {
  const phone = newPhone();
  for (let i = 0; i < 3; i++) {
    await OTP.sendCode(req, S(), phone, `10.1.0.${i}`);
    await db.q("UPDATE checkout_otps SET created_at = now() - interval '2 minutes' WHERE phone=$1", [phone]);
  }
  await assert.rejects(OTP.sendCode(req, S(), phone, '10.1.0.9'), /১০ মিনিট/);
  assert.equal(sent.length, 3);
});

test('one connection: at most 8 codes an hour', { skip }, async () => {
  for (let i = 0; i < 8; i++) await OTP.sendCode(req, S(), newPhone(), '10.2.0.1');
  await assert.rejects(OTP.sendCode(req, S(), newPhone(), '10.2.0.1'), /অনেকবার/);
});

test('a blocked number gets no code', { skip }, async () => {
  const phone = newPhone();
  await customers.block('phone', phone, 'test', null);
  await assert.rejects(OTP.sendCode(req, S(), phone, '10.0.0.7'));
  assert.equal(sent.length, 0);
});

test('wrong numbers are refused before any SMS', { skip }, async () => {
  await assert.rejects(OTP.sendCode(req, S(), '01212345678', '10.0.0.8'), /সঠিক মোবাইল/);
  await assert.rejects(OTP.sendCode(req, S(), '12345', '10.0.0.8'), /সঠিক মোবাইল/);
  assert.equal(sent.length, 0);
});

test('SMS not working: the customer is told plainly, and the owner\'s alarm counts it', { skip }, async () => {
  smsWorks = false;
  for (let i = 0; i < 3; i++) {
    await assert.rejects(OTP.sendCode(req, S(), newPhone(), `10.3.0.${i}`), /কোড পাঠানো যাচ্ছে না/);
  }
  const st = await SMS.phoneStatus(S());
  assert.ok(st.failed6h >= 3);
  // this test database has had successful codes too, so check the rule on the counts the alarm uses
  assert.equal(SMS.sendLevelFor(3, 0), 'bad');
  // SMS switched off: no code can go, and the switch-on rule stays strict (no order without the code)
  await assert.rejects(OTP.sendCode(req, S({ sms_on: '0' }), newPhone(), '10.3.1.1'), /কোড পাঠানো যাচ্ছে না/);
});

test('OTP switched off: orders go in without a code', { skip }, async () => {
  assert.deepEqual(await OTP.checkOrder(req, S({ co_otp_on: '0' }), newPhone(), ''), { ok: true, how: '' });
});

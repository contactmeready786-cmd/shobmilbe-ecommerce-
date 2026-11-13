// 🔑 After ENCRYPTION_KEY is changed, Admin → নিরাপত্তা warns ("ENCRYPTION_KEY বদলে গেছে") for as long as something
// locked with the old key is left. Once nothing is, the saved fingerprint (enc_key_fp) must follow the new key by
// itself, so the warning goes away. Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
process.env.SHOP_CACHE = '0'; // every read straight from the database
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import * as security from '../lib/security';
import { closeConnection } from '../lib/pg';

const OLD_KEY = 'the-old-test-key-long-enough-1234';
const NEW_KEY = 'the-new-test-key-long-enough-5678';
const SECRET = 'redx_token'; // a saved secret this test locks with the old key
const USER = `fp-staff-${Date.now()}`;
const envKey = process.env.ENCRYPTION_KEY;
const put = (key: string, value: string) =>
  db.q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]);
const savedFp = async () => (await db.one<{ value: string }>("SELECT value FROM settings WHERE key='enc_key_fp'"))?.value || '';

before(async () => {
  if (skip) return;
  delete process.env.ENCRYPTION_KEY; // the shared test database is prepared without a key, as in every other test
  await db.ensureReady();
});
after(async () => {
  if (!skip) {
    await db.q("DELETE FROM settings WHERE key IN ('enc_key_fp', $1)", [SECRET]);
    await db.q('DELETE FROM staff WHERE username=$1', [USER]);
  }
  if (envKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = envKey;
  await closeConnection();
});

test('enc_key_fp follows a changed key by itself once nothing locked with the old key is left', { skip }, async () => {
  process.env.ENCRYPTION_KEY = OLD_KEY;
  const oldFp = security.keyFingerprint();
  await put('enc_key_fp', oldFp);
  await put(SECRET, security.encrypt('locked-with-the-old-key'));
  await db.q("INSERT INTO staff(name, username, password, role, totp_on, totp_secret) VALUES('চাবি পরীক্ষা', $1, 'x', 'staff', true, $2)",
    [USER, security.encrypt('JBSWY3DPEHPK3PXP')]);

  process.env.ENCRYPTION_KEY = NEW_KEY;
  const newFp = security.keyFingerprint();
  assert.notEqual(newFp, oldFp);

  // a saved password can't be read: the old fingerprint stays, the page keeps warning
  let s = await db.getSettings();
  assert.ok(String(s.__secrets_locked_keys).split(',').includes(SECRET));
  assert.equal(s.enc_key_fp, oldFp);
  assert.equal(await savedFp(), oldFp);

  // the password is gone, but a staff member's authenticator code is still locked with the old key
  await db.q('DELETE FROM settings WHERE key=$1', [SECRET]);
  assert.deepEqual(await db.staffCodesLocked(), ['চাবি পরীক্ষা']);
  s = await db.getSettings();
  assert.equal(s.__secrets_locked, '');
  assert.equal(s.enc_key_fp, oldFp);
  assert.equal(await savedFp(), oldFp);

  // nothing unreadable is left: the fingerprint of the new key is saved, so the warning is gone
  await db.q("UPDATE staff SET totp_on=false, totp_secret='' WHERE username=$1", [USER]);
  s = await db.getSettings();
  assert.equal(s.enc_key_fp, newFp);
  assert.equal(await savedFp(), newFp);
});

test('enc_key_fp is left alone when the key is the same, and when there is no key', { skip }, async () => {
  process.env.ENCRYPTION_KEY = NEW_KEY;
  const fp = security.keyFingerprint();
  await put('enc_key_fp', fp);
  assert.equal((await db.getSettings()).enc_key_fp, fp);
  delete process.env.ENCRYPTION_KEY;
  await put('enc_key_fp', 'fp-of-a-key-that-is-gone');
  assert.equal((await db.getSettings()).enc_key_fp, 'fp-of-a-key-that-is-gone');
  assert.equal(await savedFp(), 'fp-of-a-key-that-is-gone');
});

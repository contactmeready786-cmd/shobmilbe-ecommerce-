// 🛡️ The shop's locks (lib/security.ts, passwords, signed cookies, two-step codes, hacking-attempt detection,
// the database certificate). If any of these ever stops working, this file fails before the change goes live.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as security from '../lib/security';
import * as U from '../lib/util';
import * as totp from '../lib/services/totp';
import * as guard from '../lib/services/guard';
import { isCertError } from '../lib/pg';
import { SUPABASE_ROOT_CA } from '../lib/data/supabase-ca';
import * as delcode from '../lib/services/delcode';

test('saved secrets: AES-256-GCM, unreadable without the key, tamper-proof', () => {
  const old = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = 'test-key-that-is-long-enough-123';
    const e = security.encrypt('bkash-secret-password');
    assert.ok(security.isEncrypted(e));
    assert.ok(!e.includes('bkash-secret-password'));
    assert.notEqual(security.encrypt('bkash-secret-password'), e); // a fresh random IV every time
    assert.equal(security.decrypt(e), 'bkash-secret-password');
    assert.equal(security.encrypt(e), e); // never locked twice
    // one changed letter in the stored text → refused, not garbage
    const broken = e.slice(0, -4) + (e.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    assert.equal(security.decrypt(broken), '');
    // another key can't read it
    process.env.ENCRYPTION_KEY = 'a-completely-different-key-456789';
    assert.equal(security.decrypt(e), '');
    // no key at all: stored as is (the security page warns), and nothing crashes
    delete process.env.ENCRYPTION_KEY;
    assert.equal(security.hasKey(), false);
    assert.equal(security.encrypt('x'), 'x');
  } finally {
    if (old === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = old;
  }
});

test('links typed in the admin can never run code', () => {
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com', 'file:///etc/passwd']) {
    assert.equal(security.safeUrl(bad), '#', bad);
  }
  assert.equal(security.safeUrl('https://shobmilbe.com/p/x'), 'https://shobmilbe.com/p/x');
  assert.equal(security.safeUrl('/category/ic'), '/category/ic');
  assert.equal(security.safeUrl('facebook.com/shobmilbe'), 'https://facebook.com/shobmilbe');
  assert.equal(security.safeUrl('tel:01712345678'), 'tel:01712345678');
});

test('uploads: only real pictures, whatever the file name says', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(security.imageKind(png), 'image/png');
  assert.equal(security.imageKind(jpg), 'image/jpeg');
  assert.equal(security.imageKind(Buffer.from('<?php system($_GET["c"]); ?>')), null);
  assert.equal(security.imageKind(Buffer.from('<svg onload=alert(1)>      ')), null); // SVG can carry scripts
  assert.equal(security.imageKind(Buffer.from('MZ\x90\x00 windows virus....')), null);
  assert.equal(security.imageKind(null), null);
});

test('admin forms only from this site', () => {
  const req = (h: Record<string, string>) => ({ headers: { host: 'shobmilbe.com', ...h } }) as never;
  assert.equal(security.sameSite(req({ origin: 'https://shobmilbe.com' })), true);
  assert.equal(security.sameSite(req({ origin: 'https://evil.com' })), false);
  assert.equal(security.sameSite(req({ referer: 'https://shobmilbe.com.evil.com/x' })), false);
  assert.equal(security.sameSite(req({ origin: 'not a url' })), false);
});

test('admin script rule: a fresh nonce per page, no inline handlers, never weaker than before', () => {
  const csp = security.adminCsp('abc123');
  assert.match(csp, /script-src 'self' 'nonce-abc123'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'scripts must not allow unsafe-inline');
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.equal(security.adminCsp(''), security.ADMIN_CSP); // no nonce → the old rule, never a broken page
  assert.equal(security.cspNonce(), ''); // outside a request
});

test('admin passwords: scrypt, salted, checked in constant time', () => {
  const h = U.hashPassword('Correct-Horse-9');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(U.hashPassword('Correct-Horse-9'), h); // salted
  assert.equal(U.verifyPassword('Correct-Horse-9', h), true);
  assert.equal(U.verifyPassword('correct-horse-9', h), false);
  assert.equal(U.verifyPassword('', h), false);
  assert.equal(U.verifyPassword('x', 'garbage'), false);
  assert.ok(U.passwordProblem('1234567')); // too short
  assert.equal(security.safeEqual('a', 'a'), true);
  assert.equal(security.safeEqual('a', 'b'), false);
  assert.equal(security.safeEqual('', ''), false); // empty never matches
});

test('signed cookies can not be forged or edited', () => {
  const v = U.sign('cov:01712345678:otp:123', 'secret-1');
  assert.equal(U.unsign(v, 'secret-1'), 'cov:01712345678:otp:123');
  assert.equal(U.unsign(v.replace('01712345678', '01812345678'), 'secret-1'), null);
  assert.equal(U.unsign(v, 'other-secret'), null);
  assert.equal(U.unsign('no-dot', 'secret-1'), null);
  assert.equal(U.unsign(v, ''), null);
});

test('two-step login codes (Google Authenticator)', () => {
  const secret = totp.newSecret();
  const step = totp.stepNow();
  const code = totp.codeAt(secret, step);
  assert.match(code, /^\d{6}$/);
  assert.equal(totp.check(secret, code, 0), step);
  assert.equal(totp.check(secret, totp.codeAt(secret, step - 1), 0), step - 1); // phone clock 30 s behind
  assert.equal(totp.check(secret, totp.codeAt(secret, step - 5), 0), null); // too old
  assert.equal(totp.check(secret, code, step), null); // the same code can't be used twice
  // RFC 6238 test vector (SHA-1, secret "12345678901234567890", time 59 s → 94287082, last 6 digits)
  const rfc = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeAt(rfc, 1), '287082');
});

test('hacking attempts in an address are recognised, normal product links are not', () => {
  for (const p of ['/wp-login.php', '/.env', '/phpmyadmin/', '/.git/config', '/backup.sql', '/cgi-bin/x', '/index.php']) assert.ok(guard.PROBE_RE.test(p), p);
  for (const p of ['/p/power-backup-ups', '/p/shell-case', '/category/env-sensor', '/p/php-book', '/']) assert.ok(!guard.PROBE_RE.test(p), p);
  for (const q of ["1' union select password from staff", '<script>alert(1)</script>', '../../../etc/passwd', '${jndi:ldap://x}', 'sleep(5)']) assert.ok(guard.ATTACK_RE.test(q), q);
  for (const q of ['arduino uno', 'select switch 3 pin', 'esp32 + oled']) assert.ok(!guard.ATTACK_RE.test(q), q);
});

test('database certificate: the bundled Supabase root is genuine and still valid', () => {
  const cert = new crypto.X509Certificate(SUPABASE_ROOT_CA);
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  const daysLeft = (new Date(cert.validTo).getTime() - Date.now()) / 864e5;
  assert.ok(daysLeft > 0, 'the Supabase root certificate has expired — download the new one from Supabase');
  if (daysLeft < 180) console.warn(`⚠️ Supabase root certificate expires in ${Math.round(daysLeft)} days — replace lib/data/supabase-ca.ts`);
  // only certificate problems switch to the safety net; a wrong password or a network fault never does
  assert.equal(isCertError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), true);
  assert.equal(isCertError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), true);
  assert.equal(isCertError({ code: 'CERT_HAS_EXPIRED' }), true);
  assert.equal(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }), true);
  assert.equal(isCertError({ code: '28P01' }), false); // wrong password
  assert.equal(isCertError({ code: 'ECONNREFUSED' }), false);
  assert.equal(isCertError(new Error('x')), false);
});

test('permanent-delete / key codes go only to the shop Gmail, shown masked', () => {
  assert.equal(delcode.masked('contact.shobmilbe@gmail.com'), 'co••••••be@gmail.com');
  assert.ok(!delcode.masked().includes('contact.shobmilbe'));
  assert.ok(delcode.ACTIONS.trash_empty && delcode.ACTIONS.show_key);
});

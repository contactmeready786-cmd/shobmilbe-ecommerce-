'use strict';
// Two-step login codes (TOTP, RFC 6238) — the 6-digit code that changes every 30 seconds in
// Google Authenticator / Microsoft Authenticator / Authy. Works without internet on the phone.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0; let val = 0; let out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let val = 0; const out = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32(crypto.randomBytes(20)); // 160 bits, as the standard recommends
const STEP = 30;
const stepNow = (t = Date.now()) => Math.floor(t / 1000 / STEP);

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Accepts the code of this 30-second window or the one before/after (phone clock a little off).
// Returns the matched step (so the same code can't be used twice), or null.
function check(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/\D/g, '');
  if (!secret || c.length !== 6) return null;
  const now = stepNow();
  for (const s of [now, now - 1, now + 1]) {
    if (s <= Number(lastStep || 0)) continue;
    const want = codeAt(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return s;
  }
  return null;
}

// The link the authenticator app reads (shown as a QR code).
function uri(secret, account, issuer) {
  const iss = String(issuer || 'Shop').replace(/:/g, '');
  return `otpauth://totp/${encodeURIComponent(iss)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(iss)}&algorithm=SHA1&digits=6&period=${STEP}`;
}
// "JBSW Y3DP EHPK …" — easier to type by hand
const pretty = (secret) => String(secret).replace(/(.{4})/g, '$1 ').trim();

module.exports = { newSecret, check, codeAt, stepNow, uri, pretty, base32, unbase32 };

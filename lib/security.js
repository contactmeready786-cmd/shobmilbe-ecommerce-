'use strict';
// Security helpers used across the site:
//  - real visitor IP (can't be faked with a header)
//  - attack limits stored in the database, so they work across every Vercel server at once
//  - AES-256-GCM encryption for saved passwords / API keys (when ENCRYPTION_KEY is set in Vercel)
//  - safe links (no "javascript:" tricks), image file checks, security headers, same-site form check
const crypto = require('crypto');

// ---------------------------------------------------------------- visitor IP
// On Vercel the platform itself writes x-real-ip / x-vercel-forwarded-for, so a visitor can't fake them.
function clientIp(req) {
  const h = req.headers || {};
  const v = h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '';
  return String(v).split(',')[0].trim().slice(0, 64) || 'unknown';
}

// ---------------------------------------------------------------- attack limits
// limit('login:ip:1.2.3.4', 10, 900) -> true while under 10 tries per 15 minutes.
// Kept in Postgres (table rate_limits) so the count is shared by all server instances.
let lastCleanup = 0;
async function hit(db, key, max, windowSec) {
  try {
    const row = await db.one(`INSERT INTO rate_limits(k, n, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
      ON CONFLICT (k) DO UPDATE SET
        n = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.n + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < now() THEN excluded.reset_at ELSE rate_limits.reset_at END
      RETURNING n`, [String(key).slice(0, 200), windowSec]);
    if (Date.now() - lastCleanup > 10 * 60e3) {
      lastCleanup = Date.now();
      db.q("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => {});
    }
    return row.n <= max;
  } catch (e) {
    console.error('rate limit', e.message);
    return true; // never lock real customers out because of a database hiccup
  }
}
// Only checks (does not count) — used before a password check so a correct login isn't counted.
async function blocked(db, key, max) {
  try {
    const row = await db.one('SELECT n FROM rate_limits WHERE k=$1 AND reset_at > now()', [String(key).slice(0, 200)]);
    return !!row && row.n >= max;
  } catch (_) { return false; }
}
async function clear(db, key) { try { await db.q('DELETE FROM rate_limits WHERE k=$1', [String(key).slice(0, 200)]); } catch (_) { /* ignore */ } }

// ---------------------------------------------------------------- encryption of saved secrets
// Key comes from the ENCRYPTION_KEY environment variable in Vercel (never stored in the database),
// so even a full copy of the database can't reveal payment / courier passwords.
const PREFIX = 'enc:v1:';
function key() {
  const k = String(process.env.ENCRYPTION_KEY || '').trim();
  return k.length >= 16 ? crypto.createHash('sha256').update(k).digest() : null;
}
function hasKey() { return !!key(); }
function keyFingerprint() { const k = key(); return k ? crypto.createHash('sha256').update(k).update('fp').digest('hex').slice(0, 12) : ''; }
function encrypt(text) {
  const k = key();
  const s = String(text ?? '');
  if (!k || !s || s.startsWith(PREFIX)) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function isEncrypted(v) { return typeof v === 'string' && v.startsWith(PREFIX); }
function decrypt(v) {
  if (!isEncrypted(v)) return v;
  const k = key();
  if (!k) return '';
  try {
    const buf = Buffer.from(v.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch (_) {
    return ''; // wrong key: behave as "not set" instead of crashing
  }
}

// ---------------------------------------------------------------- safe links
// Links typed in the admin (menus, banners, social pages) may only be normal web links.
function safeUrl(u, fallback = '#') {
  const s = String(u ?? '').trim();
  if (!s) return fallback;
  const plain = s.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  if (/^(javascript|data|vbscript|file|blob):/.test(plain)) return fallback;
  if (/^(https?:\/\/|\/(?!\/)|#|\?|tel:|mailto:|sms:|whatsapp:|fb-messenger:|viber:)/i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s; // "facebook.com/page" -> https://
  return fallback;
}

// ---------------------------------------------------------------- uploaded images
// Checks the file's real first bytes, so a virus or script renamed to .jpg is refused.
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

// ---------------------------------------------------------------- headers
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  // Store pages: allow the marketing tools (Facebook, TikTok, Google, chat), but no plugins, no other site framing us,
  // and forms may only send data to this site or the payment gateways.
  'Content-Security-Policy': "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self' https://*.sslcommerz.com https://*.bka.sh; upgrade-insecure-requests",
};
// Admin pages: much stricter — scripts only from this site, data can only be sent back to this site.
const ADMIN_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
  + "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; "
  + "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

// Forms in the admin must come from this same site (stops other websites from submitting forms as you).
function sameSite(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const from = req.headers.origin || req.headers.referer || '';
  if (!from) return true; // old browsers / privacy tools send neither; the SameSite cookie still protects them
  try { return new URL(from).host.toLowerCase() === host; } catch (_) { return false; }
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(x, y) && String(a ?? '').length > 0;
}

module.exports = {
  clientIp, hit, blocked, clear, encrypt, decrypt, isEncrypted, hasKey, keyFingerprint,
  safeUrl, imageKind, BASE_HEADERS, ADMIN_CSP, sameSite, safeEqual,
};

// Security helpers used across the site:
//  - real visitor IP (can't be faked with a header)
//  - attack limits stored in the database, so they work across every Vercel server at once
//  - AES-256-GCM encryption for saved passwords / API keys (when ENCRYPTION_KEY is set in Vercel)
//  - safe links (no "javascript:" tricks), image file checks, security headers, same-site form check

// ---------------------------------------------------------------- visitor IP
// On Vercel the platform itself writes x-real-ip / x-vercel-forwarded-for, so a visitor can't fake them.
import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbRow, Param } from './pg';
import type { RateLimitsRow } from './data/rows';

/** The two query helpers of lib/db (passed in, so this file doesn't import the database module). */
type Db = { one: <R extends DbRow = DbRow>(sql: string, params?: Param[]) => Promise<R | null>; q: <R extends DbRow = DbRow>(sql: string, params?: Param[]) => Promise<R[]> };
type Req = { headers: Record<string, string | undefined>; socket?: { remoteAddress?: string } | null };

function clientIp(req: Req): string {
  const h = req.headers || {};
  const v = h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '';
  return String(v).split(',')[0].trim().slice(0, 64) || 'unknown';
}

// ---------------------------------------------------------------- attack limits
// limit('login:ip:1.2.3.4', 10, 900) -> true while under 10 tries per 15 minutes.
// Kept in Postgres (table rate_limits) so the count is shared by all server instances.
let lastCleanup = 0;
async function hit(db: Db, key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const row = await db.one<{ n: number }>(`INSERT INTO rate_limits(k, n, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
      ON CONFLICT (k) DO UPDATE SET
        n = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.n + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < now() THEN excluded.reset_at ELSE rate_limits.reset_at END
      RETURNING n`, [String(key).slice(0, 200), windowSec]);
    if (Date.now() - lastCleanup > 10 * 60e3) {
      lastCleanup = Date.now();
      db.q("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => {});
    }
    return !!row && row.n <= max;
  } catch (e) {
    console.error('rate limit', (e as Error).message);
    return true; // never lock real customers out because of a database hiccup
  }
}
// Only checks (does not count) — used before a password check so a correct login isn't counted.
async function blocked(db: Db, key: string, max: number): Promise<boolean> {
  try {
    const row = await db.one<{ n: number }>('SELECT n FROM rate_limits WHERE k=$1 AND reset_at > now()', [String(key).slice(0, 200)]);
    return !!row && row.n >= max;
  } catch (_) { return false; }
}
async function clear(db: Db, key: string): Promise<void> { try { await db.q('DELETE FROM rate_limits WHERE k=$1', [String(key).slice(0, 200)]); } catch (_) { /* ignore */ } }

// ---------------------------------------------------------------- encryption of saved secrets
// Key comes from the ENCRYPTION_KEY environment variable in Vercel (never stored in the database),
// so even a full copy of the database can't reveal payment / courier passwords.
const PREFIX = 'enc:v1:';
function key(): Buffer | null {
  const k = String(process.env.ENCRYPTION_KEY || '').trim();
  return k.length >= 16 ? crypto.createHash('sha256').update(k).digest() : null;
}
function hasKey(): boolean { return !!key(); }
function keyFingerprint(): string { const k = key(); return k ? crypto.createHash('sha256').update(k).update('fp').digest('hex').slice(0, 12) : ''; }
function encrypt(text: unknown): string {
  const k = key();
  const s = String(text ?? '');
  if (!k || !s || s.startsWith(PREFIX)) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function isEncrypted(v: unknown): v is string { return typeof v === 'string' && v.startsWith(PREFIX); }
function decrypt<T>(v: T): T | string {
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
function safeUrl(u: unknown, fallback = '#'): string {
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
function imageKind(buf: Buffer | null | undefined): string | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

// ---------------------------------------------------------------- headers
const BASE_HEADERS: Record<string, string> = {
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
const ADMIN_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
  + "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; "
  + "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

// Admin pages, stricter still (owner, 2026-10-17): no 'unsafe-inline' for scripts. Each admin page gets a fresh random
// "nonce"; only the <script> tags our own templates write carry it (nonce="${cspNonce()}"), so a script someone
// managed to slip into a product name, an order note or a review would not run even if escaping ever missed it.
// Inline onclick="…" attributes are not allowed either — use data-print / data-autosubmit / data-back (client/admin/page-actions.ts).
// tests/csp.test.ts checks every admin template for a <script> without the nonce and for on…= attributes.
const nonceStore = new AsyncLocalStorage<{ nonce: string }>();
/** Starts a nonce for this request (admin only); the rest of the request sees it through cspNonce(). */
function startNonce(): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  nonceStore.enterWith({ nonce });
  return nonce;
}
/** The current admin page's nonce ('' outside an admin request). */
function cspNonce(): string { return nonceStore.getStore()?.nonce || ''; }
function adminCsp(nonce: string): string {
  if (!nonce) return ADMIN_CSP; // never break a page because no nonce was made
  return ADMIN_CSP.replace("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`) + "; script-src-attr 'none'; report-uri /api/csp-report";
}

/** Runs fn with this request's admin nonce current (Next.js admin pages: the nonce proxy.ts made). */
function withNonce<T>(nonce: string, fn: () => T): T { return nonceStore.run({ nonce }, fn); }
/** The extra headers of every admin page (on top of BASE_HEADERS): the script rule, no search engines, the camera. */
function adminHeaders(nonce: string): Record<string, string> {
  return { 'Content-Security-Policy': adminCsp(nonce), 'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex', 'Referrer-Policy': 'same-origin',
    // the admin may use the camera (barcode scanning); the shop pages never can
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), payment=(self)' };
}

// Forms in the admin must come from this same site (stops other websites from submitting forms as you).
function sameSite(req: Req): boolean {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const from = req.headers.origin || req.headers.referer || '';
  if (!from) return true; // old browsers / privacy tools send neither; the SameSite cookie still protects them
  try { return new URL(from).host.toLowerCase() === host; } catch (_) { return false; }
}

function safeEqual(a: unknown, b: unknown): boolean {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(x, y) && String(a ?? '').length > 0;
}

export { startNonce, cspNonce, withNonce, adminHeaders, adminCsp, clientIp, hit, blocked, clear, encrypt, decrypt, isEncrypted, hasKey, keyFingerprint, safeUrl, imageKind, BASE_HEADERS, ADMIN_CSP, sameSite, safeEqual };

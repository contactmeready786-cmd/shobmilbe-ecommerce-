import * as crypto from 'node:crypto';
import type { Body, Form, Settings, ShopRequest } from './types';

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Ready-made HTML (the shop's own, never visitor text): raw('<b>…</b>'). React pages show it with <RawHtml>/<Val>;
// text pages (print frames, scripts) use its text (.s).
class Raw { s: string; constructor(s: string) { this.s = s; } toString() { return this.s; } }
function raw(s: unknown): Raw { return new Raw(s == null ? '' : String(s)); }

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function bn(n: unknown): string { return String(n ?? '').replace(/\d/g, (d) => BN_DIGITS[Number(d)]); }
// ৳১২০ for whole taka, ৳০.২৫ / ৳১০.৫০ when there are paisa.
function money(n: unknown): string {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const a = Math.abs(v);
  const whole = Math.abs(a - Math.round(a)) < 0.005;
  const txt = whole ? Math.round(a).toLocaleString('en-IN') : a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + '৳' + bn(txt);
}
// money amount typed in a form (keeps paisa, never negative): "০.২৫" -> 0.25
function amount(v: unknown, fallback = 0): number {
  const n = num(v, NaN);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : fallback;
}
const round2 = (n: unknown): number => Math.round(Number(n || 0) * 100) / 100;
// A product price as the shop keeps it: below ৳10 paisa stay (৳0.25, ৳1.75); from ৳10 up any paisa go UP
// to the next whole taka (৳10.04 → ৳11, ৳10.50 → ৳11). Used for typed, imported, bulk-changed and sale prices.
function shopPrice(v: unknown): number {
  const n = Math.max(0, round2(v) || 0); // not a number (e.g. "৳") → 0, never NaN
  return n >= 10 ? Math.ceil(n - 1e-9) : n;
}
// An order total in whole taka: paisa are dropped as a rounding discount (৳123.50 → ৳123), never added.
function wholeTaka(v: unknown): number { return Math.max(0, Math.floor((round2(v) || 0) + 1e-9)); }
// The words for the rounding line on checkout, order page and invoice.
function roundOffLabel(r: number): string { return r > 0 ? 'রাউন্ড ফিগার' : 'রাউন্ড ফিগারের জন্য ছাড়'; }
// The order total is rounded to whole taka; this is the difference (e.g. +0.25 or -0.25), 0 when none.
type Totals = { total?: unknown; subtotal?: unknown; discount?: unknown; points_discount?: unknown; delivery?: unknown };
function roundOff(o: Totals): number { return round2(Number(o.total) - (Number(o.subtotal) - Number(o.discount || 0) - Number(o.points_discount || 0) + Number(o.delivery || 0))); }
function pct(n: unknown, digits = 1): string { return bn((Number(n) || 0).toFixed(digits)) + '%'; }

function slugify(s: unknown): string {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9ঀ-৿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'item';
}

function randomCode(len = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* bad cookie */ }
    }
  });
  return out;
}

/** The body text that came with the request (read once from the Web Request by lib/site.ts / lib/next/api.ts).
 * A caller that gives a limit gets an error for a bigger body. */
function readBody(req: ShopRequest, limit?: number): Promise<string> {
  const text = req.__body ?? '';
  if (limit !== undefined && Buffer.byteLength(text) > limit) return Promise.reject(new Error('Body too large'));
  return Promise.resolve(text);
}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Form bodies: repeated keys (checkbox lists, item rows) become arrays.
/** The sent form or JSON. The fields named in K are read as text (what an HTML form sends for one field). */
async function parseBody<K extends string = never>(req: ShopRequest): Promise<Form<K>> { return (await parseSent(req)) as Form<K>; }
async function parseSent(req: ShopRequest): Promise<Body> {
  const text = await readBody(req);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') {
    try {
      const v = JSON.parse(text || '{}', (k, val) => (BAD_KEYS.has(k) ? undefined : val));
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(text)) {
    // names that could change how every object behaves are thrown away (a form never needs them)
    if (BAD_KEYS.has(k.replace(/\[\]$/, ''))) continue;
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      const prev = Object.hasOwn(out, key) ? out[key] : undefined;
      (out[key] = Array.isArray(prev) ? prev : []).push(v);
    } else if (Object.hasOwn(out, k)) {
      out[k] = ([] as string[]).concat(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- form values: one or many
function list(v: unknown): any[] { return v === undefined || v === null || v === '' ? [] : ([] as unknown[]).concat(v); }

// Passwords: scrypt with random salt
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw: unknown, stored: unknown): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

// Strong-password rule for every admin account. Returns the problem in Bangla, or null when the password is fine.
const COMMON_PASSWORDS = new Set(('12345678 123456789 1234567890 87654321 11111111 00000000 12341234 11223344 123123123 qwertyui qwerty123 '
  + 'password password1 password123 passw0rd iloveyou admin123 admin1234 administrator welcome1 welcome123 letmein1 abc12345 abcd1234 '
  + '1q2w3e4r 1qaz2wsx zaq12wsx asdfghjk asdf1234 bangladesh bangladesh1 dhaka123 dhaka1234 shobmilbe shobmilbe1 shobmilbe123 sobmilbe '
  + 'bismillah bismillah1 allahuakbar 01700000000 01711111111 superman football cricket123 sunshine princess monkey123 dragon123').split(' '));
function passwordProblem(pw: unknown, { username = '', name = '' }: { username?: unknown; name?: unknown } = {}): string | null {
  const p = String(pw || '');
  if (p.length < 8) return 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।';
  if (p.length > 128) return 'পাসওয়ার্ড ১২৮ অক্ষরের বেশি হতে পারবে না।';
  const low = p.toLowerCase();
  if (COMMON_PASSWORDS.has(low)) return 'এই পাসওয়ার্ডটা খুব সাধারণ — হ্যাকাররা প্রথমেই এগুলো চেষ্টা করে। অন্য একটা দিন।';
  if (/^(.)\1+$/.test(p)) return 'একই অক্ষর বারবার দিয়ে পাসওয়ার্ড হবে না।';
  if (/^\d+$/.test(p) && ('01234567890123456789'.includes(p) || '98765432109876543210'.includes(p))) return '১২৩৪৫৬৭৮ এর মতো ক্রমিক সংখ্যা পাসওয়ার্ড হবে না।';
  if (/^01[3-9]\d{8}$/.test(p.replace(/^\+?88/, ''))) return 'মোবাইল নম্বর পাসওয়ার্ড হিসেবে দেবেন না — অনেকেই এটা জানে।';
  const u = String(username || '').toLowerCase().trim();
  if (u.length >= 3 && low.includes(u)) return 'পাসওয়ার্ডে ইউজারনেম রাখবেন না।';
  const n = String(name || '').toLowerCase().replace(/\s+/g, '');
  if (n.length >= 4 && low.replace(/\s+/g, '') === n) return 'শুধু নিজের নাম পাসওয়ার্ড হবে না।';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (kinds < 2 && p.length < 12) return 'অক্ষর আর সংখ্যা মিলিয়ে দিন (যেমন: Rahim#2025), অথবা অন্তত ১২ অক্ষরের লম্বা পাসওয়ার্ড দিন।';
  return null;
}

function sign(value: string, secret: string): string {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}
function unsign(signed: string | null | undefined, secret: string | null | undefined): string | null {
  if (!signed || !secret) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = sign(value, secret);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}
function sha256(s: unknown): string { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

const TZ = 'Asia/Dhaka';
function fmtDate(d: string | number | Date | null | undefined, withTime = true): string {
  if (!d) return '';
  const date = new Date(d);
  const opts: Intl.DateTimeFormatOptions = { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return bn(date.toLocaleString('en-GB', opts));
}
// YYYY-MM-DD in Dhaka time
function ymd(d: string | number | Date = new Date()): string {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}
function validYmd(s: unknown): string | null { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }

// A date range from query (?from=YYYY-MM-DD&to=YYYY-MM-DD or ?days=N), as Dhaka calendar days.
function dateRange(query: URLSearchParams, defaultDays = 30): { from: string; to: string } {
  let to = validYmd(query.get('to'));
  let from = validYmd(query.get('from'));
  const days = parseInt(query.get('days') || '', 10);
  if (!to) to = ymd();
  if (!from) {
    const n = days > 0 ? days : defaultDays;
    const t = new Date(to + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - (n - 1));
    from = t.toISOString().slice(0, 10);
  }
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function int(v: unknown, fallback = 0): number {
  const n = parseInt(String(v ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = parseFloat(String(v ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, max = 200): string { return String(v ?? '').trim().slice(0, max); }
/** `v` when it is one of the allowed words, else `fallback` (an address or form value checked against a list). */
function oneOf<T extends string, F>(list: readonly T[], v: unknown, fallback: F): T | F {
  return (list as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
/** `v` when `table` has a (non-empty) entry for it, else `fallback`: a value checked against a lookup table. */
function ifKey<F>(table: Record<string, unknown>, v: unknown, fallback: F): string | F {
  return table[String(v)] ? (v as string) : fallback;
}

/** `v` as an object whose fields are still unchecked (JSON a browser sent), or null when it isn't an object. */
function fields(v: unknown): Record<string, unknown> | null { return v && typeof v === 'object' ? (v as Record<string, unknown>) : null; }

function normalizePhone(p: unknown): string {
  let d = String(p || '').replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.startsWith('88')) d = d.slice(2);
  return d;
}
function validPhone(p: string): boolean { return /^01[3-9]\d{8}$/.test(p); }

function csv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

// fetch with a timeout; returns { ok, status, data, text }
/** fetchJson's answer: data is the parsed JSON (null when the answer was not JSON); the caller says what it expects. */
export type FetchResult<T = unknown> = { ok: boolean; status: number; data: T | null; text: string };
async function fetchJson<T = unknown>(url: string | URL, opts: RequestInit = {}, timeoutMs = 12000): Promise<FetchResult<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data: T | null = null;
    try { data = JSON.parse(text) as T; } catch (_) { /* not json */ }
    return { ok: res.ok, status: res.status, data, text };
  } catch (e) {
    const err = e as Error;
    return { ok: false, status: 0, data: null, text: err.name === 'AbortError' ? 'Request timed out' : err.message };
  } finally {
    clearTimeout(t);
  }
}

// Extract the 11-char video id from any YouTube URL form.
// Accepts every common YouTube link: watch?v=, youtu.be/, shorts/, live/, embed/, m.youtube.com, music.youtube.com,
// links with extra bits like ?si=… or &t=30s, and even a full <iframe> embed code copied from YouTube.
function youtubeId(url: unknown): string | null {
  const s = String(url || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  if (!/youtu\.?be|youtube/i.test(s)) return null;
  const m = s.match(/(?:[?&;]v=|youtu\.be\/|\/(?:embed|shorts|live|v|e)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i);
  return m ? m[1] : null;
}

// Contact numbers the shop shows to customers (each can be switched off in Admin → সেটিংস).
function contact(s: Settings) {
  const phone = s.show_phone !== '0' ? String(s.phone || '').trim() : '';
  const wa = String(s.whatsapp || '').replace(/\D/g, '').replace(/^0/, '880').replace(/^(?=1\d{9}$)/, '880');
  return { phone, wa, waButton: s.pp_whatsapp !== '0' && wa.length >= 11 ? wa : '', maxQty: Math.max(1, Number(s.max_qty_per_item) || 10) };
}

// How many pieces of one product a customer may order online.
// Cheap parts (price up to small_max_price, e.g. ৳0.25-৳5) must be bought for at least small_min_value (e.g. ৳10),
// so a ৳0.50 part needs 20 pieces and a ৳5 part needs 2. They may go up to small_max_value worth (or the normal limit, if larger).
// How many pieces of one product a web customer may order. Every product can be bought from 1 piece
// (the shop's minimum is on the whole order — Admin → সেটিংস → "সর্বনিম্ন অর্ডার", e.g. ৳10 in total).
// Cheap parts (price up to small_max_price) may be bought in bigger numbers: up to small_max_value worth.
function qtyRule(s: Settings, price: unknown) {
  const maxQty = Math.max(1, Number(s.max_qty_per_item) || 10);
  const p = Number(price) || 0;
  const on = s.small_qty_on !== '0';
  const cap = Number(s.small_max_price) || 5;
  const maxVal = Number(s.small_max_value) || 100;
  if (!on || p <= 0 || p > cap + 1e-9) return { min: 1, max: maxQty, small: false, cheap: false };
  return { min: 1, max: Math.max(maxQty, Math.floor(maxVal / p + 1e-9)), small: false, cheap: true };
}
// The smallest order (goods, without delivery) a web customer may place, e.g. ৳10.
// 🏷️ The shop sells only products priced ৳0.50 – ৳2000 (the price the customer sees). Returns a message, or null.
const PRICE_MIN = 0.5;
const PRICE_MAX = 2000;
function priceProblem(price: unknown, what = 'দাম'): string | null {
  const v = Number(price);
  if (!(v > 0)) return `${what} দিন।`;
  if (v < PRICE_MIN) return `${what} কমপক্ষে ৳০.৫০ হতে হবে।`;
  if (v > PRICE_MAX) return `${what} ৳২০০০ এর বেশি — দোকানে ৳০.৫০ থেকে ৳২০০০ পর্যন্ত দামের পণ্যই রাখা হয়।`;
  return null;
}
function minOrder(s: Settings | null | undefined): number { return Math.max(0, Number(s && s.min_order) || 0); }

function pageNum(query: URLSearchParams): number { return Math.max(1, int(query.get('page'), 1)); }

export { fields, oneOf, ifKey, PRICE_MIN, PRICE_MAX, priceProblem, contact, qtyRule, amount, round2, roundOff, shopPrice, wholeTaka, roundOffLabel, esc, raw, Raw, bn, money, pct, slugify, randomCode, parseCookies, parseBody, readBody, list, hashPassword, verifyPassword, passwordProblem, sign, unsign, sha256, fmtDate, ymd, validYmd, dateRange, int, num, str, minOrder, normalizePhone, validPhone, csv, fetchJson, youtubeId, pageNum, TZ };

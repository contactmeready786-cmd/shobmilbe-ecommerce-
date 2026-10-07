'use strict';
const crypto = require('crypto');

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tagged template that escapes interpolated values, except values wrapped with raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
function raw(s) { return new Raw(s == null ? '' : String(s)); }
function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v instanceof Raw) out += v.s;
    else if (v === false || v === null || v === undefined) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function bn(n) { return String(n ?? '').replace(/\d/g, (d) => BN_DIGITS[d]); }
function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? '-' : '') + '৳' + bn(Math.abs(Math.round(v)).toLocaleString('en-IN'));
}
function pct(n, digits = 1) { return bn((Number(n) || 0).toFixed(digits)) + '%'; }

function slugify(s) {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9ঀ-৿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'item';
}

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) { /* bad cookie */ }
    }
  });
  return out;
}

// Vercel's Node runtime reads the request body before our handler runs and
// exposes it as req.body, so the stream is already empty. Turn that back into
// text so parseBody works the same everywhere.
function vercelBodyText(req) {
  let b;
  try { b = req.body; } catch (_) { return ''; } // malformed JSON throws on access
  if (b === null || b === undefined) return '';
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (typeof b === 'string') return b;
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') return JSON.stringify(b);
  return require('querystring').stringify(b);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  if (req.__body !== undefined) return Promise.resolve(req.__body);
  if (process.env.VERCEL && 'body' in req) {
    req.__body = vercelBodyText(req);
    return Promise.resolve(req.__body);
  }
  if (req.readableEnded) { req.__body = ''; return Promise.resolve(''); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { req.__body = Buffer.concat(chunks).toString('utf8'); resolve(req.__body); });
    req.on('error', reject);
  });
}

// Form bodies: repeated keys (checkbox lists, item rows) become arrays.
async function parseBody(req) {
  const text = await readBody(req);
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') {
    try { return JSON.parse(text || '{}'); } catch (_) { return {}; }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] = out[key] || []).push(v);
    } else if (k in out) {
      out[k] = [].concat(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function list(v) { return v === undefined || v === null || v === '' ? [] : [].concat(v); }

// Passwords: scrypt with random salt
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function sign(value, secret) {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}
function unsign(signed, secret) {
  if (!signed || !secret) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = sign(value, secret);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

const TZ = 'Asia/Dhaka';
function fmtDate(d, withTime = true) {
  if (!d) return '';
  const date = new Date(d);
  const opts = { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return bn(date.toLocaleString('en-GB', opts));
}
// YYYY-MM-DD in Dhaka time
function ymd(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}
function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null; }

// A date range from query (?from=YYYY-MM-DD&to=YYYY-MM-DD or ?days=N), as Dhaka calendar days.
function dateRange(query, defaultDays = 30) {
  let to = validYmd(query.get('to'));
  let from = validYmd(query.get('from'));
  const days = parseInt(query.get('days'), 10);
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

function int(v, fallback = 0) {
  const n = parseInt(String(v ?? '').replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d)).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
function num(v, fallback = 0) {
  const n = parseFloat(String(v ?? '').replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d)).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
function str(v, max = 200) { return String(v ?? '').trim().slice(0, max); }

function normalizePhone(p) {
  let d = String(p || '').replace(/[০-৯]/g, (c) => BN_DIGITS.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.startsWith('88')) d = d.slice(2);
  return d;
}
function validPhone(p) { return /^01[3-9]\d{8}$/.test(p); }

function csv(rows) {
  return '﻿' + rows.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

// fetch with a timeout; returns { ok, status, data, text }
async function fetchJson(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* not json */ }
    return { ok: res.ok, status: res.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: e.name === 'AbortError' ? 'Request timed out' : e.message };
  } finally {
    clearTimeout(t);
  }
}

// Extract the 11-char video id from any YouTube URL form.
// Accepts every common YouTube link: watch?v=, youtu.be/, shorts/, live/, embed/, m.youtube.com, music.youtube.com,
// links with extra bits like ?si=… or &t=30s, and even a full <iframe> embed code copied from YouTube.
function youtubeId(url) {
  const s = String(url || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  if (!/youtu\.?be|youtube/i.test(s)) return null;
  const m = s.match(/(?:[?&;]v=|youtu\.be\/|\/(?:embed|shorts|live|v|e)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i);
  return m ? m[1] : null;
}

// Contact numbers the shop shows to customers (each can be switched off in Admin → সেটিংস).
function contact(s) {
  const phone = s.show_phone !== '0' ? String(s.phone || '').trim() : '';
  const wa = String(s.whatsapp || '').replace(/\D/g, '').replace(/^0/, '880').replace(/^(?=1\d{9}$)/, '880');
  return { phone, wa, waButton: s.pp_whatsapp !== '0' && wa.length >= 11 ? wa : '', maxQty: Math.max(1, Number(s.max_qty_per_item) || 10) };
}

function pageNum(query) { return Math.max(1, int(query.get('page'), 1)); }

module.exports = {
  contact,
  esc, html, raw, Raw, bn, money, pct, slugify, randomCode, parseCookies, parseBody, readBody, list,
  hashPassword, verifyPassword, sign, unsign, sha256, fmtDate, ymd, validYmd, dateRange, int, num, str,
  normalizePhone, validPhone, csv, fetchJson, youtubeId, pageNum, TZ,
};

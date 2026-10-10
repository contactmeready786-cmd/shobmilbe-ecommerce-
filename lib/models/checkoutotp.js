'use strict';
// 🔐 চেকআউট OTP — the customer proves the mobile number before an order goes in.
//
// At checkout, under the mobile number: a small box + "OTP পাঠান". A 4-digit code goes by SMS; when it is typed
// the box turns green ("✅ নম্বর যাচাই হয়েছে") and the order can be placed. Someone typing another person's number
// can't get the code, so fake orders stop.
//
// One switch in Admin decides everything (the owner's rule):
//  • OFF → no box at checkout, orders go in as before;
//  • ON  → no order without the code — strictly, even when SMS isn't working (the owner sorts out the SMS company).
// Easier for real customers: a number checked once is remembered in that browser (Admin chooses how many days),
// a logged-in customer ordering to the account's own number needs no code, codes work 10 minutes, a new code after
// 60 seconds, Bangla digits are fine, and when SMS can't go the shop's phone number is shown so they can call.
//
// Abuse limits (each code costs an SMS): 3 codes / 10 min and 6 / day per number, 8 / hour per connection,
// a daily total for the whole shop, 5 wrong tries per code. Blocked numbers get no code.
const crypto = require('crypto');
const db = require('../db');
const security = require('../security');
const { str, int, normalizePhone, validPhone, sign, unsign, parseCookies, bn } = require('../util');

const CODE_LEN = 4;
const CODE_MIN = 10;       // a code works for 10 minutes
const RESEND_SEC = 60;     // a new code after 60 seconds
const TRIES = 5;           // wrong tries per code
const TOKEN_MIN = 60;      // after the code is right, the order can be placed within 60 minutes
const COOKIE = 'sm_vph';   // numbers checked in this browser
const DEF_SMS = '{shop}: অর্ডার যাচাই কোড {code}। কাউকে বলবেন না।';

class OtpError extends Error {
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); }
}

const on = (s) => s.co_otp_on === '1';
const smsReady = (s) => require('../services/sms').ready(s).ok;
// is the box shown at checkout? — whenever the switch is on
const active = (s) => on(s);
const rememberDays = (s) => Math.max(0, Math.min(365, int(s.co_otp_remember_days)));
const bnDigits = (v) => String(v || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const hashCode = (phone, code, secret) => crypto.createHmac('sha256', String(secret)).update(`co:${phone}:${code}`).digest('hex');

// ---------- signed proofs: "this number was checked" (sent with the order) ----------
// kind: otp = code typed
function token(s, phone, kind) { return sign(`cov:${phone}:${kind}:${Date.now()}`, s.session_secret); }
function readToken(s, t) {
  const v = unsign(String(t || ''), s.session_secret);
  if (!v) return null;
  const [k, phone, kind, at] = v.split(':');
  if (k !== 'cov' || !validPhone(phone) || kind !== 'otp' || Date.now() - Number(at) > TOKEN_MIN * 60e3) return null;
  return { phone, kind };
}
// ---------- the browser's list of checked numbers ----------
function remembered(req, s) {
  const days = rememberDays(s);
  if (!days) return [];
  const v = unsign(parseCookies(req.headers.cookie)[COOKIE], s.session_secret);
  if (!v) return [];
  return v.split('.').map((x) => x.split('-')).filter(([p, t]) => validPhone(p) && Date.now() - Number(t) * 1000 < days * 864e5).map(([p, t]) => ({ phone: p, t: Number(t) }));
}
function rememberCookie(req, s, phone) {
  const days = rememberDays(s);
  if (!days) return null;
  const list = [{ phone, t: Math.floor(Date.now() / 1000) }, ...remembered(req, s).filter((r) => r.phone !== phone)].slice(0, 5);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(sign(list.map((r) => `${r.phone}-${r.t}`).join('.'), s.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure}`;
}

// Does this number still need a code here? → null (no) or the reason it doesn't: 'account' / 'remembered'
async function noNeedWhy(req, s, phone) {
  const A = require('./accounts');
  const cu = await A.current(req, s).catch(() => null);
  if (cu && cu.phone === phone) return 'account';
  if (remembered(req, s).some((r) => r.phone === phone)) return 'remembered';
  return null;
}

// ---------- send a code ----------
// → { sent: true, wait } — or throws OtpError with a message for the customer
async function sendCode(req, s, phone, ip, site = '') {
  const SMS = require('../services/sms');
  const ph = normalizePhone(phone);
  if (!validPhone(ph)) throw new OtpError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
  if (await require('./customers').isBlocked(ph, ip)) throw new OtpError(s.block_message || 'এই নম্বরে অর্ডার নেওয়া যাচ্ছে না। আমাদের সাথে যোগাযোগ করুন।');
  // a code sent less than a minute ago: tell how long to wait (no new SMS)
  const last = await db.one(`SELECT extract(epoch FROM now() - created_at)::int AS ago FROM checkout_otps WHERE phone=$1 AND sent_ok ORDER BY id DESC LIMIT 1`, [ph]);
  if (last && last.ago < RESEND_SEC) return { sent: true, wait: RESEND_SEC - last.ago, again: true };
  if (!(await security.hit(db, 'coo:ip:' + ip, 8, 3600))) throw new OtpError('অনেকবার কোড চাওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা আমাদের কল করুন।');
  if (!(await security.hit(db, 'coo:ph10:' + ph, 3, 600))) throw new OtpError('এই নম্বরে কিছুক্ষণ আগেই কোড পাঠানো হয়েছে। SMS দেখুন, অথবা ১০ মিনিট পর আবার চান।');
  if (!(await security.hit(db, 'coo:phday:' + ph, 6, 86400))) throw new OtpError('আজ এই নম্বরে অনেকবার কোড পাঠানো হয়েছে। অর্ডার করতে আমাদের কল করুন।');

  // SMS can't go: say so plainly (the box shows the shop's phone number) and log it for Admin
  const NOSEND = 'এই মুহূর্তে কোড পাঠানো যাচ্ছে না। একটু পরে আবার চেষ্টা করুন, অথবা আমাদের কল করে অর্ডার দিন।';
  const cannotSend = async () => {
    await db.q(`INSERT INTO checkout_otps(phone, code_hash, expires_at, sent_ok, ip) VALUES($1,'', now(), false, $2)`, [ph, str(ip, 60)]).catch(() => {});
    throw new OtpError(NOSEND);
  };
  if (!smsReady(s)) return cannotSend();
  const cap = int(s.co_otp_daily_cap);
  if (cap > 0) {
    const today = await db.one(`SELECT count(*)::int AS n FROM checkout_otps WHERE sent_ok AND created_at > now() - interval '1 day'`);
    if (today.n >= cap) return cannotSend();
  }

  const code = String(crypto.randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
  let text = (String(s.co_otp_sms || '').trim() || DEF_SMS).replace(/\{shop\}/g, s.store_name || '').replace(/\{code\}/g, code).replace(/\{min\}/g, bn(CODE_MIN));
  if (!text.includes(code)) text = `${text} ${code}`; // the owner's text forgot {code}
  // Android Chrome can fill the code in by itself when the SMS ends with "@domain #code"
  if (s.co_otp_webotp === '1' && site) { try { text += `\n\n@${new URL(site).host} #${code}`; } catch (_) { /* no domain */ } }

  const row = await db.one(`INSERT INTO checkout_otps(phone, code_hash, expires_at, ip) VALUES($1,$2, now() + make_interval(mins => $3), $4) RETURNING id`,
    [ph, hashCode(ph, code, s.session_secret), CODE_MIN, str(ip, 60)]);
  const r = await SMS.send(s, ph, text, { kind: 'checkout_otp' });
  if (!r.ok) {
    await db.q('UPDATE checkout_otps SET sent_ok=false, used=true WHERE id=$1', [row.id]);
    throw new OtpError(NOSEND);
  }
  // older codes for this number stop working (only the newest counts)
  await db.q('UPDATE checkout_otps SET used=true WHERE phone=$1 AND id<>$2 AND NOT used', [ph, row.id]);
  db.q("DELETE FROM checkout_otps WHERE created_at < now() - interval '60 days'").catch(() => {});
  return { sent: true, wait: RESEND_SEC };
}

// ---------- check a code ----------
// → the proof token for the order (and the "remember" cookie) — or throws OtpError
async function verifyCode(s, phone, code) {
  const ph = normalizePhone(phone);
  const c = bnDigits(code).replace(/\D/g, '');
  if (!validPhone(ph)) throw new OtpError('সঠিক মোবাইল নম্বর দিন।');
  if (c.length !== CODE_LEN) throw new OtpError(`SMS-এ আসা ${bn(CODE_LEN)} অঙ্কের কোডটা লিখুন।`);
  const row = await db.one(`SELECT id, code_hash, tries FROM checkout_otps WHERE phone=$1 AND sent_ok AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1`, [ph]);
  if (!row) throw new OtpError('কোডের মেয়াদ শেষ হয়ে গেছে। "আবার পাঠান" চাপুন।', { expired: true });
  if (row.tries >= TRIES) {
    await db.q('UPDATE checkout_otps SET used=true WHERE id=$1', [row.id]);
    throw new OtpError('অনেকবার ভুল কোড দেওয়া হয়েছে। "আবার পাঠান" চেপে নতুন কোড নিন।', { expired: true });
  }
  const a = Buffer.from(hashCode(ph, c, s.session_secret)); const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await db.q('UPDATE checkout_otps SET tries=tries+1 WHERE id=$1', [row.id]);
    const left = TRIES - row.tries - 1;
    throw new OtpError(left > 0 ? `কোডটা মেলেনি — SMS দেখে আবার লিখুন (আর ${bn(left)} বার চেষ্টা করা যাবে)।` : 'অনেকবার ভুল কোড দেওয়া হয়েছে। "আবার পাঠান" চেপে নতুন কোড নিন।', { expired: left <= 0 });
  }
  await db.q('UPDATE checkout_otps SET used=true, verified_at=now() WHERE id=$1', [row.id]);
  return { token: token(s, ph, 'otp'), phone: ph };
}

// ---------- when the order is placed ----------
// → { ok: true, how } with how = otp / account / remembered ('' when switched off)  —  or { ok: false, error }
// Switched on = strict: no checked number, no order.
async function checkOrder(req, s, phone, tok) {
  if (!on(s)) return { ok: true, how: '' };
  const t = readToken(s, tok);
  if (t && t.phone === phone) return { ok: true, how: 'otp' };
  const why = await noNeedWhy(req, s, phone);
  if (why) return { ok: true, how: why };
  return { ok: false, error: 'মোবাইল নম্বর যাচাই করুন: "OTP পাঠান" চেপে SMS-এ আসা কোডটা বসান।' };
}

// ---------- for Admin ----------
async function stats() {
  return db.one(`SELECT
      count(*) FILTER (WHERE sent_ok AND created_at > now() - interval '1 day')::int AS sent24,
      count(*) FILTER (WHERE verified_at > now() - interval '1 day')::int AS ok24,
      count(*) FILTER (WHERE NOT sent_ok AND created_at > now() - interval '1 day')::int AS fail24,
      count(*) FILTER (WHERE sent_ok AND created_at > now() - interval '30 days')::int AS sent30,
      count(*) FILTER (WHERE verified_at > now() - interval '30 days')::int AS ok30,
      count(DISTINCT phone) FILTER (WHERE sent_ok AND verified_at IS NULL AND created_at > now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM checkout_otps c2 WHERE c2.phone=checkout_otps.phone AND c2.verified_at IS NOT NULL))::int AS never30,
      (SELECT json_object_agg(phone_check, n) FROM (SELECT phone_check, count(*)::int AS n FROM orders WHERE source='web' AND created_at > now() - interval '30 days' GROUP BY phone_check) x) AS orders30
    FROM checkout_otps`);
}
async function recent(limit = 30) {
  return db.q(`SELECT phone, sent_ok, verified_at, tries, created_at, (verified_at IS NULL AND NOT sent_ok) AS failed FROM checkout_otps ORDER BY id DESC LIMIT $1`, [limit]);
}
// the pill shown on orders in Admin
const LABELS = {
  otp: ['✅ OTP যাচাই', 'কাস্টমার SMS-এর কোড দিয়ে নম্বর যাচাই করেছেন'],
  remembered: ['✅ আগে যাচাই', 'এই ব্রাউজারে আগে এই নম্বর OTP দিয়ে যাচাই হয়েছিল'],
  account: ['✅ লগইন', 'কাস্টমার নিজের অ্যাকাউন্টে লগইন করা (লগইনেই নম্বর যাচাই হয়েছে)'],
  skipped: ['⚠️ OTP ছাড়া', 'SMS যায়নি — অর্ডার কোড ছাড়া নেওয়া হয়েছিল (আগের নিয়মে)'],
};

module.exports = { OtpError, on, active, smsReady, sendCode, verifyCode, checkOrder, noNeedWhy, rememberCookie, readToken, stats, recent, LABELS,
  CODE_LEN, CODE_MIN, RESEND_SEC, DEF_SMS };

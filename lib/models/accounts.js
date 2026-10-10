'use strict';
// Customer accounts: log in with the mobile number and a one-time SMS code (OTP) — no password to remember.
// Logged in, a customer sees all their orders (and can order the same again), keeps delivery addresses,
// and checkout fills itself in. Admin → কাস্টমার অ্যাকাউন্ট switches it on (it needs SMS).
const crypto = require('crypto');
const db = require('../db');
const { str, int, normalizePhone, validPhone, sign, unsign, parseCookies, bn } = require('../util');

const CODE_MIN = 5;          // a code works for 5 minutes
const CODE_TRIES = 5;        // wrong tries per code
const SESSION_DAYS = 90;

class AccountError extends Error {}

const on = (s) => s.acct_on === '1';
function hashCode(phone, code, secret) { return crypto.createHmac('sha256', String(secret)).update(`${phone}:${code}`).digest('hex'); }

// Send a login code by SMS. Limits: 3 codes / 10 minutes and 8 / day per number, 10 / hour per connection.
async function sendCode(settings, phone, ip) {
  const SMS = require('../services/sms');
  const security = require('../security');
  const ph = normalizePhone(phone);
  if (!validPhone(ph)) throw new AccountError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
  if (!SMS.ready(settings).ok) throw new AccountError('এখন লগইন কোড পাঠানো যাচ্ছে না। কিছুক্ষণ পর চেষ্টা করুন, অথবা লগইন ছাড়াই অর্ডার করুন।');
  const blocked = await require('./customers').isBlocked(ph, ip);
  if (blocked) throw new AccountError('এই নম্বরে লগইন করা যাচ্ছে না। আমাদের সাথে যোগাযোগ করুন।');
  if (!(await security.hit(db, 'otp:ip:' + ip, 10, 3600))) throw new AccountError('অনেকবার চেষ্টা হয়েছে। এক ঘণ্টা পর আবার চেষ্টা করুন।');
  if (!(await security.hit(db, 'otp:ph10:' + ph, 3, 600))) throw new AccountError('এই নম্বরে কিছুক্ষণ আগেই কোড পাঠানো হয়েছে। SMS দেখুন, অথবা ১০ মিনিট পর আবার চান।');
  if (!(await security.hit(db, 'otp:phday:' + ph, 8, 86400))) throw new AccountError('আজ এই নম্বরে অনেকবার কোড পাঠানো হয়েছে। কাল আবার চেষ্টা করুন।');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.q(`UPDATE customer_otps SET used=true WHERE phone=$1 AND NOT used`, [ph]);
  await db.q(`INSERT INTO customer_otps(phone, code_hash, expires_at, ip) VALUES($1,$2, now() + make_interval(mins => $3), $4)`,
    [ph, hashCode(ph, code, settings.session_secret), CODE_MIN, str(ip, 60)]);
  const tpl = String(settings.acct_otp_sms || '').trim() || '{shop}: আপনার লগইন কোড {code}। {min} মিনিট কাজ করবে। কাউকে বলবেন না।';
  const text = tpl.replace(/\{shop\}/g, settings.store_name || '').replace(/\{code\}/g, code).replace(/\{min\}/g, bn(CODE_MIN));
  const r = await SMS.send(settings, ph, text, { kind: 'otp' });
  if (!r.ok) throw new AccountError('SMS পাঠানো যায়নি। একটু পরে আবার চেষ্টা করুন।');
  return { phone: ph };
}

// Check the code; on success the customer (made now if new) is returned.
async function verifyCode(settings, phone, code) {
  const ph = normalizePhone(phone);
  const c = String(code || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/\D/g, '');
  if (!validPhone(ph) || c.length !== 6) throw new AccountError('৬ অঙ্কের কোডটা দিন।');
  const row = await db.one(`SELECT id, code_hash, tries FROM customer_otps WHERE phone=$1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1`, [ph]);
  if (!row) throw new AccountError('কোডের মেয়াদ শেষ। আবার কোড চান।');
  if (row.tries >= CODE_TRIES) { await db.q('UPDATE customer_otps SET used=true WHERE id=$1', [row.id]); throw new AccountError('অনেকবার ভুল হয়েছে। আবার কোড চান।'); }
  const a = Buffer.from(hashCode(ph, c, settings.session_secret)); const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await db.q('UPDATE customer_otps SET tries=tries+1 WHERE id=$1', [row.id]);
    throw new AccountError(`কোডটা মেলেনি। আবার দেখে লিখুন (${bn(CODE_TRIES - row.tries - 1)} বার চেষ্টা বাকি)।`);
  }
  // used up at once: if two tries race, only one wins
  const won = await db.one('UPDATE customer_otps SET used=true WHERE id=$1 AND NOT used RETURNING id', [row.id]);
  if (!won) throw new AccountError('আবার কোড চান।');
  await db.q('DELETE FROM customer_otps WHERE created_at < now() - interval \'2 days\'').catch(() => {});
  const cu = await db.one(`INSERT INTO customers(name, phone) VALUES('', $1) ON CONFLICT (phone) DO UPDATE SET last_login=now() RETURNING *`, [ph]);
  await db.q('UPDATE customers SET last_login=now() WHERE id=$1', [cu.id]);
  return cu;
}

// ---------- the login cookie: signed customer id + a version (bumped by "log out everywhere") ----------
function cookieFor(req, settings, cu) {
  const v = sign(`cu:${cu.id}:${cu.session_ver || 1}:${Date.now()}`, settings.session_secret);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_cust=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
const CLEAR = 'sm_cust=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
async function current(req, settings) {
  if (!on(settings)) return null;
  const v = unsign(parseCookies(req.headers.cookie).sm_cust, settings.session_secret);
  if (!v) return null;
  const [k, id, ver, at] = v.split(':');
  if (k !== 'cu' || !/^\d+$/.test(id) || Date.now() - Number(at) > SESSION_DAYS * 864e5) return null;
  const cu = await db.one('SELECT * FROM customers WHERE id=$1', [int(id)]);
  if (!cu || String(cu.session_ver || 1) !== ver) return null;
  return cu;
}
async function logoutEverywhere(id) { await db.q('UPDATE customers SET session_ver = session_ver + 1 WHERE id=$1', [int(id)]); }

// ---------- what the account page shows ----------
async function ordersOf(cu, limit = 50) {
  return db.q(`SELECT o.id, o.code, o.status, o.total, o.created_at, o.paid_amount, o.payment,
      (SELECT json_agg(json_build_object('id', i.product_id, 'qty', i.qty, 'name', i.name, 'kind', i.kind) ORDER BY i.id) FROM order_items i WHERE i.order_id=o.id) AS items
    FROM orders o WHERE o.phone=$1 OR o.customer_id=$2 ORDER BY o.created_at DESC LIMIT $3`, [cu.phone, cu.id, limit]);
}
async function addresses(customerId) {
  return db.q('SELECT * FROM customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC, id DESC', [int(customerId)]);
}
async function saveAddress(customerId, b) {
  const O = require('./orders');
  const dist = O.findDistrict(str(b.district, 60));
  if (!dist) throw new AccountError('জেলা বাছাই করুন।');
  const thana = str(b.thana, 60);
  if (!dist.areas.some((a) => a[0] === thana)) throw new AccountError('থানা / উপজেলা বাছাই করুন।');
  const address = str(b.address, 400);
  if (address.length < 5) throw new AccountError('পূর্ণ ঠিকানা লিখুন।');
  const phone = b.phone ? normalizePhone(b.phone) : '';
  if (phone && !validPhone(phone)) throw new AccountError('মোবাইল নম্বর ঠিক নেই।');
  const count = (await db.one('SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id=$1', [customerId])).n;
  const id = int(b.id);
  if (!id && count >= 10) throw new AccountError('সর্বোচ্চ ১০টা ঠিকানা রাখা যায় — পুরোনো একটা মুছুন।');
  const isDefault = !!b.is_default || count === 0;
  return db.tx(async (t) => {
    if (isDefault) await t.query('UPDATE customer_addresses SET is_default=false WHERE customer_id=$1', [customerId]);
    if (id) {
      await t.query(`UPDATE customer_addresses SET label=$1, name=$2, phone=$3, district=$4, thana=$5, address=$6, is_default=$7 WHERE id=$8 AND customer_id=$9`,
        [str(b.label, 30), str(b.name, 80), phone, dist.en, thana, address, isDefault, id, customerId]);
      return id;
    }
    return (await t.query(`INSERT INTO customer_addresses(customer_id, label, name, phone, district, thana, address, is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [customerId, str(b.label, 30), str(b.name, 80), phone, dist.en, thana, address, isDefault])).rows[0].id;
  });
}
async function deleteAddress(customerId, id) { await db.q('DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2', [int(id), int(customerId)]); }
async function saveProfile(cu, b) {
  const name = str(b.name, 80);
  if (name.length < 2) throw new AccountError('আপনার নাম লিখুন।');
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('ইমেইল ঠিক নেই (না দিলেও চলবে)।');
  await db.q('UPDATE customers SET name=$1, email=$2, updated_at=now() WHERE id=$3', [name, email, cu.id]);
}

module.exports = { AccountError, on, sendCode, verifyCode, cookieFor, CLEAR, current, logoutEverywhere, ordersOf, addresses, saveAddress, deleteAddress, saveProfile, CODE_MIN };

// @ts-nocheck — converted from JavaScript; types are added file by file.
// Customer accounts, two ways in:
//  • 📧 e-mail + password: sign up = e-mail + a password + a 6-digit code to the e-mail (sent free by the shop's Gmail),
//    asked once. After that the customer logs in with e-mail + password — no code. "Forgot password" = a new code.
//  • 📱 mobile: a 6-digit code goes by SMS → account made / logged in
// The code is asked ONCE: after that the customer stays logged in (90 days, renewed on every visit) and orders
// with no more codes — checkout OTP is skipped for a logged-in account (checkoutotp.noNeedWhy).
// A new account first gives its name (and, for e-mail accounts, a mobile number for delivery), then can order.
// Logged in, a customer sees all their orders (and can order the same again), keeps delivery addresses,
// and checkout fills itself in. Admin → কাস্টমার অ্যাকাউন্ট switches it on (it needs SMS or the shop's Gmail).
import * as crypto from 'node:crypto';
import * as db from '../db';
import { str, int, normalizePhone, validPhone, sign, unsign, parseCookies, bn, hashPassword, verifyPassword } from '../util';
import * as $services_sms from '../services/sms';
import * as $services_notify from '../services/notify';
import * as $security from '../security';
import * as $customers from './customers';
import * as $orders from './orders';

const CODE_MIN = 5;          // a code works for 5 minutes
const EMAIL_MIN = 10;        // an e-mail code works for 10 minutes (e-mail can be a little slow)
const CODE_TRIES = 5;        // wrong tries per code
const SESSION_DAYS = 90;

class AccountError extends Error {}

const on = (s) => s.acct_on === '1';
// which ways in are working right now (a tab is shown only for a way that works)
const phoneReady = (s) => $services_sms.ready(s).ok;
const emailReady = (s) => $services_notify.acctEmailConfig(s).ready;
const validEmail = (e) => $services_notify.validEmail(e);
const cleanEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);
// the number the shop delivers to / calls: the login number, or the one an e-mail account gave
const deliveryPhone = (cu) => (cu && (cu.phone || cu.contact_phone)) || '';
// a new account must first give its name (and an e-mail account a mobile number) before ordering
const needsProfile = (cu) => !!cu && (String(cu.name || '').trim().length < 2 || !validPhone(deliveryPhone(cu)));
function hashCode(phone, code, secret) { return crypto.createHmac('sha256', String(secret)).update(`${phone}:${code}`).digest('hex'); }

// Send a login code by SMS. Limits: 3 codes / 10 minutes and 8 / day per number, 10 / hour per connection.
async function sendCode(settings, phone, ip) {
  const SMS = $services_sms;
  const security = $security;
  const ph = normalizePhone(phone);
  if (!validPhone(ph)) throw new AccountError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
  if (!SMS.ready(settings).ok) throw new AccountError('এখন লগইন কোড পাঠানো যাচ্ছে না। কিছুক্ষণ পর চেষ্টা করুন, অথবা লগইন ছাড়াই অর্ডার করুন।');
  const blocked = await $customers.isBlocked(ph, ip);
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
  const cu = await db.one(`INSERT INTO customers(name, phone, login_via) VALUES('', $1, 'phone') ON CONFLICT (phone) DO UPDATE SET last_login=now() RETURNING *`, [ph]);
  await db.q(`UPDATE customers SET last_login=now(), login_via=CASE WHEN login_via='' THEN 'phone' ELSE login_via END WHERE id=$1`, [cu.id]);
  return cu;
}

// ---------- 📧 e-mail: a 6-digit code to the customer's e-mail (sent free by the shop's own Gmail) ----------
// Limits: 3 codes / 10 minutes and 8 / day per e-mail, 10 / hour per connection, and 400 a day for the whole shop
// (Gmail's own daily limit is about 500).
const ehash = (email, code, secret) => crypto.createHmac('sha256', String(secret)).update(`em:${email}:${code}`).digest('hex');
// a customer's password: 6+ characters, the same typed twice
function customerPasswordProblem(pw, pw2) {
  const p = String(pw || '');
  if (p.length < 6) return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।';
  if (p.length > 100) return 'পাসওয়ার্ড ১০০ অক্ষরের মধ্যে দিন।';
  if (pw2 !== undefined && p !== String(pw2 || '')) return 'দুইবার একই পাসওয়ার্ড লিখুন — দুটো মেলেনি।';
  return null;
}
const findEmailAccount = (em) => db.one('SELECT * FROM customers WHERE lower(email)=$1 AND email_verified ORDER BY id LIMIT 1', [em]);

// purpose 'signup' (new account) or 'reset' (forgot password). The new password waits, hashed, beside the code.
async function sendEmailCode(settings, email, ip, { purpose = 'signup', password, password2 } = {}) {
  const security = $security;
  const N = $services_notify;
  const em = cleanEmail(email);
  if (!validEmail(em)) throw new AccountError('সঠিক ইমেইল ঠিকানা দিন, যেমন name@gmail.com।');
  const pwBad = customerPasswordProblem(password, password2);
  if (pwBad) throw new AccountError(pwBad);
  const existing = await findEmailAccount(em);
  if (purpose === 'signup' && existing && existing.password_hash) throw new AccountError('এই ইমেইলে আগেই অ্যাকাউন্ট খোলা আছে। "লগইন" থেকে ইমেইল আর পাসওয়ার্ড দিয়ে ঢুকুন, পাসওয়ার্ড ভুলে গেলে "পাসওয়ার্ড ভুলে গেছেন?" চাপুন।');
  if (purpose === 'reset' && !existing) throw new AccountError('এই ইমেইলে কোনো অ্যাকাউন্ট নেই। "নতুন অ্যাকাউন্ট" থেকে খুলুন।');
  if (!emailReady(settings)) throw new AccountError('এখন ইমেইলে কোড পাঠানো যাচ্ছে না। মোবাইল নম্বর দিয়ে চেষ্টা করুন, অথবা লগইন ছাড়াই অর্ডার করুন।');
  if (!(await security.hit(db, 'eotp:ip:' + ip, 10, 3600))) throw new AccountError('অনেকবার চেষ্টা হয়েছে। এক ঘণ্টা পর আবার চেষ্টা করুন।');
  if (!(await security.hit(db, 'eotp:em10:' + em, 3, 600))) throw new AccountError('এই ইমেইলে কিছুক্ষণ আগেই কোড পাঠানো হয়েছে। ইমেইল (Spam ফোল্ডারও) দেখুন, অথবা ১০ মিনিট পর আবার চান।');
  if (!(await security.hit(db, 'eotp:emday:' + em, 8, 86400))) throw new AccountError('আজ এই ইমেইলে অনেকবার কোড পাঠানো হয়েছে। কাল আবার চেষ্টা করুন।');
  if (!(await security.hit(db, 'eotp:all', 400, 86400))) throw new AccountError('আজ আর ইমেইলে কোড পাঠানো যাচ্ছে না। মোবাইল নম্বর দিয়ে চেষ্টা করুন, অথবা লগইন ছাড়াই অর্ডার করুন।');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.q(`UPDATE customer_email_otps SET used=true WHERE email=$1 AND NOT used`, [em]);
  const row = await db.one(`INSERT INTO customer_email_otps(email, code_hash, expires_at, ip, pw_hash, purpose) VALUES($1,$2, now() + make_interval(mins => $3), $4, $5, $6) RETURNING id`,
    [em, ehash(em, code, settings.session_secret), EMAIL_MIN, str(ip, 60), hashPassword(String(password)), purpose === 'reset' ? 'reset' : 'signup']);
  const shop = settings.store_name || 'সবমিলবে';
  const text = `${shop}: আপনার যাচাই কোড ${code}\n\nকোডটা ${bn(EMAIL_MIN)} মিনিট কাজ করবে। কাউকে বলবেন না — ${shop} কখনো ফোনে এই কোড চায় না।\n\nআপনি কোড না চেয়ে থাকলে এই ইমেইলটা উপেক্ষা করুন।`;
  const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px">
<h2 style="margin:0 0 8px;font-size:18px">${N.escapeHtml(shop)}</h2>
<p style="font-size:15px;margin:0 0 14px">আপনার অ্যাকাউন্টের যাচাই কোড:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:0 0 14px;color:#111">${code}</p>
<p style="font-size:14px;color:#555;margin:0">কোডটা ${bn(EMAIL_MIN)} মিনিট কাজ করবে। কাউকে বলবেন না।<br>আপনি কোড না চেয়ে থাকলে এই ইমেইলটা উপেক্ষা করুন।</p></div>`;
  try {
    await N.sendAcctEmail(settings, `${shop}: যাচাই কোড ${code}`, text, htmlBody, em);
  } catch (e) {
    await db.q('UPDATE customer_email_otps SET used=true WHERE id=$1', [row.id]).catch(() => {});
    db.logIntegration && db.logIntegration('acct-email', 'code', false, String(e.message || e).slice(0, 200)).catch(() => {});
    throw new AccountError('ইমেইল পাঠানো যায়নি। ঠিকানাটা ঠিক আছে কিনা দেখে আবার চেষ্টা করুন, অথবা মোবাইল নম্বর দিয়ে ঢুকুন।');
  }
  db.q('DELETE FROM customer_email_otps WHERE created_at < now() - interval \'2 days\'').catch(() => {});
  return { email: em, purpose };
}

// Check the e-mail code; on success the e-mail account (made now if new) is returned.
async function verifyEmailCode(settings, email, code) {
  const em = cleanEmail(email);
  const c = String(code || '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/\D/g, '');
  if (!validEmail(em) || c.length !== 6) throw new AccountError('ইমেইলে আসা ৬ অঙ্কের কোডটা দিন।');
  const row = await db.one(`SELECT id, code_hash, tries, pw_hash FROM customer_email_otps WHERE email=$1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1`, [em]);
  if (!row) throw new AccountError('কোডের মেয়াদ শেষ। আবার কোড চান।');
  if (row.tries >= CODE_TRIES) { await db.q('UPDATE customer_email_otps SET used=true WHERE id=$1', [row.id]); throw new AccountError('অনেকবার ভুল হয়েছে। আবার কোড চান।'); }
  const a = Buffer.from(ehash(em, c, settings.session_secret)); const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await db.q('UPDATE customer_email_otps SET tries=tries+1 WHERE id=$1', [row.id]);
    throw new AccountError(`কোডটা মেলেনি। ইমেইল দেখে আবার লিখুন (${bn(CODE_TRIES - row.tries - 1)} বার চেষ্টা বাকি)।`);
  }
  const won = await db.one('UPDATE customer_email_otps SET used=true WHERE id=$1 AND NOT used RETURNING id', [row.id]);
  if (!won) throw new AccountError('আবার কোড চান।');
  // only an e-mail someone has already PROVED opens that account (an e-mail typed into a profile proves nothing)
  // the code proved the e-mail: the password chosen with it is now the account's password
  const cu = await findEmailAccount(em);
  if (cu) {
    // a new password logs every other phone/computer out (session_ver), in case someone else had got in
    return db.one(`UPDATE customers SET last_login=now(), password_hash=CASE WHEN $2 <> '' THEN $2 ELSE password_hash END,
      session_ver = CASE WHEN $2 <> '' AND password_hash <> '' THEN session_ver + 1 ELSE session_ver END WHERE id=$1 RETURNING *`, [cu.id, row.pw_hash || '']);
  }
  return db.one(`INSERT INTO customers(name, phone, email, email_verified, login_via, last_login, password_hash) VALUES('', NULL, $1, true, 'email', now(), $2) RETURNING *`, [em, row.pw_hash || '']);
}

// 📧 e-mail + password, no code. Limits: 10 wrong tries / hour per e-mail, 20 / hour per connection.
async function loginWithPassword(email, password, ip) {
  const security = $security;
  const em = cleanEmail(email);
  if (!validEmail(em)) throw new AccountError('সঠিক ইমেইল ঠিকানা দিন।');
  if (!String(password || '')) throw new AccountError('পাসওয়ার্ড দিন।');
  if (!(await security.hit(db, 'elogin:ip:' + ip, 20, 3600)) || !(await security.hit(db, 'elogin:em:' + em, 10, 3600))) {
    throw new AccountError('অনেকবার ভুল হয়েছে। এক ঘণ্টা পর চেষ্টা করুন, অথবা "পাসওয়ার্ড ভুলে গেছেন?" চাপুন।');
  }
  const cu = await findEmailAccount(em);
  if (cu && !cu.password_hash) throw new AccountError('এই অ্যাকাউন্টে এখনো পাসওয়ার্ড দেওয়া হয়নি। "পাসওয়ার্ড ভুলে গেছেন?" চেপে একটা পাসওয়ার্ড ঠিক করে নিন।');
  if (!cu || !verifyPassword(String(password), cu.password_hash)) throw new AccountError('ইমেইল বা পাসওয়ার্ড মেলেনি। আবার দেখে লিখুন।');
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
    FROM orders o WHERE (o.phone=$1 AND $1 <> '') OR o.customer_id=$2 OR o.account_id=$2 ORDER BY o.created_at DESC LIMIT $3`, [cu.phone || '', cu.id, limit]);
}
async function addresses(customerId) {
  return db.q('SELECT * FROM customer_addresses WHERE customer_id=$1 ORDER BY is_default DESC, id DESC', [int(customerId)]);
}
async function saveAddress(customerId, b) {
  const O = $orders;
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
  if (cu.email_verified) {
    // an e-mail account: the e-mail is its login (stays), the mobile number is for delivery and calls
    const ph = normalizePhone(b.contact_phone);
    if (!validPhone(ph)) throw new AccountError('ডেলিভারির জন্য সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
    await db.q('UPDATE customers SET name=$1, contact_phone=$2, updated_at=now() WHERE id=$3', [name, ph, cu.id]);
    return;
  }
  const email = str(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('ইমেইল ঠিক নেই (না দিলেও চলবে)।');
  await db.q('UPDATE customers SET name=$1, email=$2, updated_at=now() WHERE id=$3', [name, email, cu.id]);
}

export { AccountError, on, phoneReady, emailReady, deliveryPhone, needsProfile, sendEmailCode, verifyEmailCode, loginWithPassword, EMAIL_MIN, sendCode, verifyCode, cookieFor, CLEAR, current, logoutEverywhere, ordersOf, addresses, saveAddress, deleteAddress, saveProfile, CODE_MIN };

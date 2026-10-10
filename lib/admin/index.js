'use strict';
const crypto = require('crypto');
// Admin panel: login, sessions, permissions and routing to the page modules.
const db = require('../db');
const staffModel = require('../models/staff');
const catalog = require('../models/catalog');
const { html, parseCookies, parseBody, verifyPassword, passwordProblem, sign, unsign, int, str, bn } = require('../util');
const { adminLayout, MENU, allowed, visible } = require('./layout');
const ui = require('./ui');
const security = require('../security');
const lockView = require('./loginlock');
const recovery = require('./recovery');
const lock = require('../models/loginlock');
const notify = require('../services/notify');
const sessions = require('../models/sessions');
const totp = require('../services/totp');

const MODULES = ['dashboard', 'orders', 'import', 'morepics', 'watermark', 'research', 'trash', 'growth', 'toggles', 'products', 'inventory', 'customers', 'marketing', 'blog', 'design',
  'accounting', 'staff', 'reports', 'integrations', 'settings', 'visitors', 'live', 'feeds', 'navswitch', 'security', 'loginlock', 'notify', 'recovery', 'language', 'drafts', 'threats',
  'account', 'profile', 'audit', 'brands', 'promos', 'reviews', 'loyalty', 'sms', 'uiswitches', 'status', 'backup', 'homerows', 'reach', 'dns', 'autocall', 'vat', 'slider', 'labels', 'documents', 'handover',
  'qa', 'variants', 'custaccounts', 'returns', 'giftcards', 'shoppush', 'pos', 'warehouses', 'codsettle', 'supplierledger', 'fraud', 'checkoutotp'].map((m) => require('./' + m));
const ROUTES = MODULES.flatMap((m) => m.routes);

// ---------- sessions ----------
// The browser keeps only a random token (signed, HttpOnly); the login itself lives in the admin_sessions table,
// so any device can be logged out from the admin, and a stolen cookie stops working after "logout".
function pwTag(user) { return String(user.password || '').slice(-12); }
function secureFlag(req) { return (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : ''; }
function cookieFor(req, settings, user, token) {
  const value = sign(`v2:${token}:${pwTag(user)}`, settings.session_secret);
  return `sm_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessions.MAX_DAYS * 86400}${secureFlag(req)}`;
}
// verified = the owner passed the second check (fingerprint / passkey / face) for this login
async function startSession(req, settings, user, verified = false) {
  const token = await sessions.create(req, user.id, { verified, ip: security.clientIp(req) });
  return cookieFor(req, settings, user, token);
}
const CLEAR_ADMIN = 'sm_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
function cookieToken(req, settings) {
  const value = unsign(parseCookies(req.headers.cookie).sm_admin, settings.session_secret);
  if (!value) return null;
  const [ver, token, tag] = value.split(':');
  return ver === 'v2' && token ? { token, tag } : null;
}
async function currentUser(req, settings) {
  const c = cookieToken(req, settings);
  if (!c) return null; // also every old-style login cookie (before the server-side logins): log in once more
  const sess = await sessions.find(c.token, settings);
  if (!sess) return null;
  const user = await staffModel.getStaff(sess.staff_id);
  if (!user || !user.active || pwTag(user) !== c.tag) return null;
  // Owner login lock on: a login that skipped the fingerprint / face step is not accepted.
  if (user.role === 'owner' && lock.isOn(settings) && !sess.verified) return null;
  user.__verified = !!sess.verified;
  user.__token = c.token;
  user.__session = sess.id;
  return user;
}

// ---------- staff two-step login (authenticator app code) ----------
const twoFactorOn = (user) => user.role !== 'owner' && user.totp_on && !!user.totp_secret;
function tfaCookie(req, settings, user) {
  const value = sign(`tfa:${user.id}:${Date.now()}:${pwTag(user)}`, settings.session_secret);
  return `sm_tfa=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=600${secureFlag(req)}`;
}
const CLEAR_TFA = 'sm_tfa=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict';
async function tfaUser(req, settings) {
  const value = unsign(parseCookies(req.headers.cookie).sm_tfa, settings.session_secret);
  if (!value) return null;
  const [kind, id, issued, tag] = value.split(':');
  if (kind !== 'tfa' || !/^\d+$/.test(id) || Date.now() - Number(issued) > 600e3) return null;
  const user = await staffModel.getStaff(Number(id));
  return user && user.active && pwTag(user) === tag && twoFactorOn(user) ? user : null;
}

// ---------- owner login lock: the half-way login (password done, second check not yet) ----------
const PRE_MINUTES = 10;
function preCookie(req, settings, user, passed) {
  const value = sign(`pre:${user.id}:${Date.now()}:${pwTag(user)}:${passed.passkey ? 'p' : ''}${passed.face ? 'f' : ''}`, settings.session_secret);
  return `sm_pre=${encodeURIComponent(value)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${PRE_MINUTES * 60}${secureFlag(req)}`;
}
const CLEAR_PRE = 'sm_pre=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict';
async function preUser(req, settings) {
  const value = unsign(parseCookies(req.headers.cookie).sm_pre, settings.session_secret);
  if (!value) return null;
  const [kind, id, issued, tag, flags = ''] = value.split(':');
  if (kind !== 'pre' || !/^\d+$/.test(id) || Date.now() - Number(issued) > PRE_MINUTES * 60e3) return null;
  const user = await staffModel.getStaff(Number(id));
  if (!user || !user.active || user.role !== 'owner' || pwTag(user) !== tag) return null;
  return { user, passed: { passkey: flags.includes('p'), face: flags.includes('f') } };
}
function challengeCookie(req, settings, value) {
  return `sm_ch=${encodeURIComponent(sign(value, settings.session_secret))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=300${secureFlag(req)}`;
}
function challengeValue(req, settings) { return unsign(parseCookies(req.headers.cookie).sm_ch, settings.session_secret); }
const CLEAR_CH = 'sm_ch=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict';

// Password-guessing protection, counted in the database so it holds across every server:
// 8 wrong tries from one connection → 15 minutes locked; 15 wrong tries on one username (from anywhere) → 1 hour locked.
const IP_MAX = 8;
const IP_WINDOW = 15 * 60;
const USER_MAX = 15;
const USER_WINDOW = 60 * 60;
let currentDb = null;
async function tooMany(ip, login) {
  if (await security.blocked(currentDb, 'login:ip:' + ip, IP_MAX)) return true;
  return !!login && security.blocked(currentDb, 'login:user:' + String(login).toLowerCase().trim().slice(0, 60), USER_MAX);
}
async function failed(ip, login) {
  require('../services/guard').record({ ip, kind: 'login_fail', detail: login ? 'ইউজারনেম: ' + String(login).slice(0, 40) : 'রিসেট কোড' }).catch(() => {});
  await security.hit(currentDb, 'login:ip:' + ip, IP_MAX, IP_WINDOW);
  if (login) await security.hit(currentDb, 'login:user:' + String(login).toLowerCase().trim().slice(0, 60), USER_MAX, USER_WINDOW);
}

function firstAllowed(user) {
  for (const g of MENU) for (const it of g.items) if (visible(user, it[2])) return it[0];
  return '/admin/account';
}

function authPage({ settings, mode, error, values = {} }) {
  const setup = mode === 'setup';
  return html`<div class="auth-card panel">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  ${setup ? html`
  <h1>প্রথমবার: মালিকের অ্যাকাউন্ট তৈরি করুন</h1>
  <p class="muted">এই অ্যাকাউন্টে সব অনুমতি থাকবে। পরে "স্টাফ" মেনু থেকে কর্মচারীদের আলাদা অ্যাকাউন্ট দিতে পারবেন।</p>
  <form method="post" action="/admin/setup" class="form">
    ${ui.field('আপনার নাম', ui.input('name', values.name || '', { required: true, maxlength: 80 }))}
    ${ui.field('ইউজারনেম (লগইনের জন্য)', ui.input('username', values.username || 'admin', { required: true, maxlength: 40, autocapitalize: 'none' }), 'ইংরেজি ছোট হাতের অক্ষর বা সংখ্যা')}
    ${ui.field('পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর। কোথাও লিখে রাখুন।')}
    ${ui.field('আবার পাসওয়ার্ড', ui.input('password2', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block btn-lg">অ্যাকাউন্ট তৈরি করুন</button>
  </form>` : html`
  <h1>Admin লগইন</h1>
  <form method="post" action="/admin/login" class="form">
    ${ui.field('ইউজারনেম বা মোবাইল নম্বর', ui.input('login', values.login || '', { required: true, autocomplete: 'username', autocapitalize: 'none', autofocus: true }))}
    ${ui.field('পাসওয়ার্ড', ui.input('password', '', { type: 'password', required: true, autocomplete: 'current-password' }))}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block btn-lg">লগইন</button>
  </form>
  <p class="muted small">আগের পাসওয়ার্ড দিয়ে ঢুকতে চাইলে ইউজারনেম লিখুন: <b>admin</b></p>
  <p class="small"><a href="/admin/reset">পাসওয়ার্ড ভুলে গেছেন?</a></p>`}
  <p class="center small"><a href="/">দোকানে ফিরে যান</a></p>
</div>`;
}

// ---------- emergency owner password reset ----------
// Works only when ADMIN_RESET_CODE is set in Vercel (Settings → Environment Variables).
// Whoever knows that code can set a new owner username + password; everyone gets logged out.
// One-time code given to the owner in chat (only its SHA-256 is stored here). Works once, then is burned.
const ONE_TIME_RESET_HASH = 'b689694c3b1c99c5ef95dd8fd993f6eefb6df06d1e1712da5282200548760aed';
function resetCode() { return String(process.env.ADMIN_RESET_CODE || '').trim(); }
function hashCode(c) { return crypto.createHash('sha256').update(String(c).trim().toUpperCase()).digest('hex'); }
async function oneTimeAvailable() {
  return !!ONE_TIME_RESET_HASH && !(await db.one('SELECT 1 AS x FROM settings WHERE key=$1', ['reset_used_' + ONE_TIME_RESET_HASH.slice(0, 16)]));
}
function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function resetPage({ settings, error, done, values = {}, enabled, mailMsg }) {
  const mail = notify.emailConfig(settings);
  return html`<div class="auth-card panel">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>মালিকের পাসওয়ার্ড রিসেট</h1>
  ${done ? html`
  <p>পাসওয়ার্ড বদলানো হয়েছে। সবাইকে লগআউট করে দেওয়া হয়েছে।</p>
  <p class="muted small">এই রিসেট কোড আর কাজ করবে না।</p>
  <a class="btn btn-block btn-lg" href="/admin/login">লগইন করুন</a>` : html`
  <h2 class="h3">১) ইমেইলে রিসেট লিংক (সবচেয়ে সহজ)</h2>
  ${mailMsg ? html`<p class="flash flash-success">${mailMsg}</p>` : mail.ready ? html`
  <p class="muted small">পাসওয়ার্ড ভুলে গেলে: <b>${notify.maskEmail(mail.to)}</b> ঠিকানায় একটা লিংক যাবে, সেটা ৩০ মিনিটের মধ্যে খুলে নতুন পাসওয়ার্ড দিন। (আঙুল/মুখ যাচাই চালু থাকলে সেটা চালুই থাকবে।)</p>
  <form method="post" action="/admin/reset/email-send" class="form"><button class="btn btn-block btn-outline">📧 ইমেইলে রিসেট লিংক পাঠান</button></form>`
    : html`<p class="muted small">ইমেইল এখনো সেটআপ করা হয়নি (Admin → নোটিফিকেশন)।</p>`}
  <h2 class="h3">২) গোপন রিসেট কোড দিয়ে (জরুরি অবস্থা)</h2>
  <p class="muted small">ফোন হারিয়েছে, ক্যামেরা নষ্ট, বা ইমেইলেও ঢুকতে পারছেন না — তখন কাগজে লিখে রাখা <b>জরুরি রিকভারি কোড</b> দিয়ে পাসওয়ার্ড আর আঙুল/মুখ যাচাই দুটোই রিসেট করা যায়।</p>
  ${!enabled ? html`
  <p class="muted">কোড দিয়ে রিসেট এখন বন্ধ আছে। অ্যাডমিনে ঢুকে <b>নিরাপত্তা → জরুরি রিকভারি কোড</b> থেকে কোড বানিয়ে কাগজে লিখে রাখুন।</p>` : html`
  <form method="post" action="/admin/reset" class="form">
    ${ui.field('গোপন রিসেট কোড', ui.input('code', '', { required: true, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }), 'কাগজে লেখা রিকভারি কোড (যেমন ABCD-EFGH-JKLM)। প্রতিটা কোড একবারই কাজ করে।')}
    ${ui.field('নতুন ইউজারনেম', ui.input('username', values.username || 'admin', { required: true, maxlength: 40, autocapitalize: 'none' }), 'ইংরেজি ছোট হাতের অক্ষর বা সংখ্যা')}
    ${ui.field('নতুন পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর। কোথাও লিখে রাখুন।')}
    ${ui.field('আবার নতুন পাসওয়ার্ড', ui.input('password2', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))}
    ${ui.check('lock_staff', values.lock_staff !== undefined ? !!values.lock_staff : true, 'বাকি সব স্টাফ অ্যাকাউন্ট বন্ধ করে দিন (পরে "স্টাফ" মেনু থেকে আবার চালু করা যাবে)')}
    ${lock.isOn(settings) ? ui.check('unlock_owner', !!values.unlock_owner, 'আঙুলের ছাপ / মুখ যাচাই বন্ধ করে দিন (ফোন হারালে বা ক্যামেরা নষ্ট হলে টিক দিন)') : ''}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block btn-lg">পাসওয়ার্ড রিসেট করুন</button>
  </form>`}`}
  <p class="center small"><a href="/admin/login">লগইন পেজে ফিরে যান</a></p>
</div>`;
}

// ---------- "forgot password" by e-mail ----------
// A random 32-byte link token; only its SHA-256 + expiry is saved (encrypted). Works once, for 30 minutes.
// Resets the owner's password only — the fingerprint / face lock (if on) stays on.
const MAIL_TOKEN_MIN = 30;
function mailTokenOk(settings, token) {
  const [hash, exp] = String(settings.reset_mail_token || '').split(':');
  if (!hash || !exp || Date.now() > Number(exp) || !/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) return false;
  return sameSecret(crypto.createHash('sha256').update(String(token)).digest('hex'), hash);
}
function baseUrl(req, settings) {
  if (settings.site_url) return settings.site_url.replace(/\/+$/, '');
  if (settings.custom_domain) return 'https://' + String(settings.custom_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}`;
}
function mailResetPage({ settings, token, error, done }) {
  return html`<div class="auth-card panel">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>নতুন পাসওয়ার্ড দিন</h1>
  ${done ? html`<p>পাসওয়ার্ড বদলানো হয়েছে। নিরাপত্তার জন্য সবাইকে লগআউট করা হয়েছে।</p>
  <a class="btn btn-block btn-lg" href="/admin/login">লগইন করুন</a>` : !token ? html`
  <p class="form-error">${error || 'লিংকটা আর কাজ করছে না (মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে)।'}</p>
  <a class="btn btn-block" href="/admin/reset">আবার লিংক নিন</a>` : html`
  <form method="post" action="/admin/reset/email" class="form">
    <input type="hidden" name="t" value="${token}">
    ${ui.field('নতুন পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', autofocus: true }), 'কমপক্ষে ৮ অক্ষর। কোথাও লিখে রাখুন।')}
    ${ui.field('আবার নতুন পাসওয়ার্ড', ui.input('password2', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block btn-lg">পাসওয়ার্ড সেভ করুন</button>
  </form>`}
</div>`;
}

// Second step of a staff login: the 6-digit code from Google Authenticator (or a similar app).
function tfaPage({ settings, user, error, blocked }) {
  return html`<div class="auth-card panel">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>🔐 যাচাই কোড দিন</h1>
  <p class="muted small"><b translate="no">${user.name}</b>, ফোনের <b>Google Authenticator</b> (বা যে অ্যাপে সেটআপ করেছিলেন) খুলুন — "${settings.store_name}" এর পাশে যে ৬ অঙ্কের কোড দেখাচ্ছে সেটা লিখুন। কোড প্রতি ৩০ সেকেন্ডে বদলায়।</p>
  ${error ? html`<p class="form-error">${error}</p>` : ''}
  ${blocked ? '' : html`<form method="post" action="/admin/2fa" class="form">
    ${ui.field('৬ অঙ্কের কোড', ui.input('code', '', { required: true, inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9০-৯ ]{6,7}', maxlength: 7, autofocus: true, class: 'code-input' }))}
    <button class="btn btn-block btn-lg">যাচাই করে ঢুকুন</button>
  </form>`}
  <p class="muted small">ফোন হারিয়েছেন বা অ্যাপ মুছে গেছে? মালিককে বলুন — তিনি "স্টাফ" পেজ থেকে আপনার দুই ধাপের লগইন রিসেট করে দেবেন।</p>
  <form method="post" action="/admin/logout"><button class="link-btn small">← অন্য অ্যাকাউন্টে লগইন</button></form>
</div>`;
}

async function handle(base) {
  const { req, res, path, method, query, send, redirect, json } = base;
  let { settings } = base;
  const ip = security.clientIp(req);
  currentDb = db;
  const bare = (title, body, status = 200) => send(res, status, adminLayout({ settings, title, body, bare: true }));

  // Every form sent to the admin must come from this same website.
  // (Stops a trick page on another site from submitting forms using your login.)
  if (method !== 'GET' && method !== 'HEAD' && !security.sameSite(req)) {
    // logged once per 15 minutes per connection, so an attack can't flood the log
    if (await security.hit(db, 'log:xsite:' + ip, 1, 900)) await db.logActivity(null, 'blocked', 'security', null, `অন্য সাইট থেকে ফর্ম পাঠানোর চেষ্টা: ${path} (${ip})`).catch(() => {});
    return send(res, 403, 'অনুমতি নেই: এই ফর্ম অন্য ওয়েবসাইট থেকে পাঠানো হয়েছে।', 'text/plain; charset=utf-8');
  }

  // ----- public: setup, login, logout -----
  const staffCount = await staffModel.countStaff();
  if (path === '/admin/setup' || (path === '/admin/login' && !staffCount)) {
    if (staffCount) return redirect(res, '/admin/login');
    if (method === 'POST' && path === '/admin/setup') {
      if (!(await security.hit(db, 'setup:' + ip, 10, 3600))) return bare('অ্যাকাউন্ট তৈরি', authPage({ settings, mode: 'setup', error: 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পর আবার চেষ্টা করুন।' }), 429);
      const b = await parseBody(req);
      const username = staffModel.cleanUsername(b.username);
      const error = !str(b.name) ? 'আপনার নাম লিখুন।'
        : username.length < 3 ? 'ইউজারনেম কমপক্ষে ৩ অক্ষরের দিন।'
          : passwordProblem(b.password, { username, name: b.name })
            || (b.password !== b.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null);
      if (error) return bare('অ্যাকাউন্ট তৈরি', authPage({ settings, mode: 'setup', error, values: b }), 400);
      const id = await staffModel.createOwner({ name: b.name, username, password: b.password });
      const user = await staffModel.getStaff(id);
      await db.logActivity(id, 'login', 'staff', id, 'প্রথম সেটআপ');
      await sessions.record(req, { staffId: id, login: username, event: 'login', ok: true, ip, detail: 'প্রথম সেটআপ' });
      return redirect(res, '/admin', { 'Set-Cookie': await startSession(req, settings, user) });
    }
    return bare('অ্যাকাউন্ট তৈরি', authPage({ settings, mode: 'setup' }));
  }
  if (path === '/admin/reset/email-send' && method === 'POST') {
    const mail = notify.emailConfig(settings);
    const enabledCode = resetCode().length >= 12 || await oneTimeAvailable() || (await recovery.available()) > 0;
    const okMsg = `রিসেট লিংক ${notify.maskEmail(mail.to)} ঠিকানায় পাঠানো হয়েছে। Inbox (না পেলে Spam) দেখুন — লিংক ${bn(MAIL_TOKEN_MIN)} মিনিট কাজ করবে।`;
    if (!mail.ready) return bare('রিসেট', resetPage({ settings, enabled: enabledCode }));
    // 3 links per hour from one connection, 6 per day in total — nobody can flood your inbox
    if (!(await security.hit(db, 'resetmail:' + ip, 3, 3600)) || !(await security.hit(db, 'resetmail:all', 6, 86400))) {
      return bare('রিসেট', resetPage({ settings, enabled: enabledCode, mailMsg: 'কিছুক্ষণ আগেই লিংক পাঠানো হয়েছে। ইমেইল দেখুন, অথবা ১ ঘণ্টা পর আবার চেষ্টা করুন।' }), 429);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await db.setSetting('reset_mail_token', crypto.createHash('sha256').update(token).digest('hex') + ':' + (Date.now() + MAIL_TOKEN_MIN * 60e3));
    const link = `${baseUrl(req, settings)}/admin/reset/email?t=${token}`;
    try {
      await notify.sendEmail(settings, `🔑 ${settings.store_name} অ্যাডমিন পাসওয়ার্ড রিসেট`,
        `কেউ (সম্ভবত আপনি) অ্যাডমিনের পাসওয়ার্ড রিসেট করতে চেয়েছেন।

নতুন পাসওয়ার্ড দিতে এই লিংক খুলুন (${MAIL_TOKEN_MIN} মিনিট কাজ করবে, একবারই):
${link}

আপনি না চাইলে এই মেইল উপেক্ষা করুন — লিংক না খুললে কিছুই বদলাবে না।
অনুরোধ এসেছে: ${ip}`,
        `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6"><h2>🔑 অ্যাডমিন পাসওয়ার্ড রিসেট</h2>
<p>কেউ (সম্ভবত আপনি) ${notify.escapeHtml(settings.store_name)} অ্যাডমিনের পাসওয়ার্ড রিসেট করতে চেয়েছেন।</p>
<p><a href="${notify.escapeHtml(link)}" style="display:inline-block;background:#0a7d3b;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">নতুন পাসওয়ার্ড দিন</a></p>
<p style="color:#666;font-size:13px">লিংকটা ${MAIL_TOKEN_MIN} মিনিট কাজ করবে, একবারই। আপনি না চাইলে এই মেইল উপেক্ষা করুন — কিছুই বদলাবে না।<br>অনুরোধ এসেছে: ${notify.escapeHtml(ip)}</p></div>`);
      await db.logActivity(null, 'reset_mail', 'security', null, `ইমেইলে রিসেট লিংক পাঠানো (${ip})`);
    } catch (e) {
      await db.logIntegration('notify-email', 'reset link', false, e.message);
      return bare('রিসেট', resetPage({ settings, enabled: enabledCode, mailMsg: 'ইমেইল পাঠানো যায়নি। নিচের গোপন রিসেট কোড দিয়ে চেষ্টা করুন।' }), 502);
    }
    return bare('রিসেট', resetPage({ settings, enabled: enabledCode, mailMsg: okMsg }));
  }
  if (path === '/admin/reset/email') {
    if (method === 'POST') {
      const b = await parseBody(req);
      if (await tooMany(ip)) return bare('রিসেট', mailResetPage({ settings, error: 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।' }), 429);
      if (!mailTokenOk(settings, b.t)) { await failed(ip); return bare('রিসেট', mailResetPage({ settings }), 400); }
      const owner = await db.one("SELECT id, username, name FROM staff WHERE role='owner' ORDER BY id LIMIT 1");
      if (!owner) return redirect(res, '/admin/setup');
      const error = passwordProblem(b.password, owner) || (b.password !== b.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null);
      if (error) return bare('রিসেট', mailResetPage({ settings, token: b.t, error }), 400);
      await db.setSetting('reset_mail_token', ''); // the link works only once
      await db.q('UPDATE staff SET active=true WHERE id=$1', [owner.id]);
      await staffModel.setPassword(owner.id, b.password);
      await db.setSetting('session_secret', crypto.randomBytes(32).toString('hex')); // everyone logged out
      await sessions.revokeEveryone('মালিকের পাসওয়ার্ড রিসেট');
      await sessions.record(req, { staffId: owner.id, login: owner.username, event: 'reset', ok: true, ip, detail: 'ইমেইল লিংক' });
      await security.clear(db, 'login:ip:' + ip);
      await db.logActivity(owner.id, 'password_reset', 'staff', owner.id, `ইমেইল লিংক দিয়ে রিসেট (${ip})`);
      await notify.securityAlert(settings, 'ইমেইল লিংক দিয়ে মালিকের পাসওয়ার্ড বদলানো হয়েছে', `যেখান থেকে: ${ip}`);
      return bare('রিসেট', mailResetPage({ settings, done: true }));
    }
    const t = query.get('t');
    return bare('রিসেট', mailResetPage({ settings, token: mailTokenOk(settings, t) ? t : null }));
  }
  if (path === '/admin/reset') {
    if (method === 'POST') {
      const b = await parseBody(req);
      const vals = { username: b.username, lock_staff: b.lock_staff ? '1' : '', unlock_owner: b.unlock_owner ? '1' : '' };
      const code = resetCode();
      const envOk = code.length >= 12;
      const oneTime = await oneTimeAvailable();
      const recLeft = await recovery.available();
      if (!envOk && !oneTime && !recLeft) return bare('রিসেট', resetPage({ settings, enabled: false }), 403);
      if (await tooMany(ip)) return bare('রিসেট', resetPage({ settings, enabled: true, error: 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।', values: vals }), 429);
      const given = String(b.code || '').trim();
      const viaEnv = envOk && sameSecret(given, code);
      const viaOneTime = oneTime && sameSecret(hashCode(given), ONE_TIME_RESET_HASH);
      const viaRecovery = !viaEnv && !viaOneTime && recLeft > 0 && await recovery.check(given);
      if (!viaEnv && !viaOneTime && !viaRecovery) {
        await failed(ip);
        if (await security.hit(db, 'alert:resetfail', 1, 900)) await notify.securityAlert(settings, 'ভুল রিসেট কোড দিয়ে চেষ্টা', `কেউ ভুল গোপন রিসেট কোড দিয়ে মালিকের পাসওয়ার্ড বদলানোর চেষ্টা করেছে।\nযেখান থেকে: ${ip}`);
        return bare('রিসেট', resetPage({ settings, enabled: true, error: 'গোপন রিসেট কোড ভুল হয়েছে।', values: vals }), 401);
      }
      const username = staffModel.cleanUsername(b.username);
      const error = username.length < 3 ? 'ইউজারনেম কমপক্ষে ৩ অক্ষরের দিন (ইংরেজি ছোট হাতের অক্ষর/সংখ্যা)।'
        : passwordProblem(b.password, { username }) || (b.password !== b.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null);
      if (error) return bare('রিসেট', resetPage({ settings, enabled: true, error, values: vals }), 400);
      const owner = await db.one("SELECT id FROM staff WHERE role='owner' ORDER BY id LIMIT 1");
      if (!owner) return redirect(res, '/admin/setup');
      // a paper code works once: use it up now (if two tries race, only one wins)
      if (viaRecovery && !(await recovery.consume(given))) return bare('রিসেট', resetPage({ settings, enabled: true, error: 'এই কোড আগেই ব্যবহার হয়েছে। অন্য একটা কোড দিন।', values: vals }), 401);
      const clash = await db.one('SELECT id FROM staff WHERE lower(username)=$1 AND id<>$2', [username, owner.id]);
      if (clash) return bare('রিসেট', resetPage({ settings, enabled: true, error: 'এই ইউজারনেম অন্য একজন স্টাফের, অন্য একটা দিন।', values: vals }), 400);
      await db.q('UPDATE staff SET username=$1, active=true WHERE id=$2', [username, owner.id]);
      await staffModel.setPassword(owner.id, b.password);
      if (b.lock_staff) await db.q("UPDATE staff SET active=false WHERE role<>'owner'");
      if (b.unlock_owner) await db.setSetting('login_lock_mode', 'off');
      // New secret = every old login cookie stops working (owner's and staff's).
      await db.setSetting('session_secret', crypto.randomBytes(32).toString('hex'));
      await sessions.revokeEveryone('জরুরি রিসেট');
      await sessions.record(req, { staffId: owner.id, login: username, event: 'reset', ok: true, ip, detail: viaRecovery ? 'রিকভারি কোড' : 'গোপন রিসেট কোড' });
      if (viaOneTime) await db.setSetting('reset_used_' + ONE_TIME_RESET_HASH.slice(0, 16), new Date().toISOString());
      await security.clear(db, 'login:ip:' + ip);
      await db.logActivity(owner.id, 'password_reset', 'staff', owner.id, `ইমার্জেন্সি রিসেট${viaRecovery ? ' — রিকভারি কোড দিয়ে' : ''} (${ip})${b.lock_staff ? ', সব স্টাফ বন্ধ' : ''}${b.unlock_owner ? ', আঙুল/মুখ যাচাই বন্ধ' : ''}`);
      await notify.securityAlert(settings, 'গোপন কোড দিয়ে মালিকের পাসওয়ার্ড রিসেট হয়েছে', `নতুন ইউজারনেম: ${username}\nযেখান থেকে: ${ip}${b.lock_staff ? '\nসব স্টাফ অ্যাকাউন্ট বন্ধ করা হয়েছে' : ''}${b.unlock_owner ? '\nআঙুল/মুখ যাচাই বন্ধ করা হয়েছে' : ''}`);
      return bare('রিসেট', resetPage({ settings, done: true }));
    }
    return bare('রিসেট', resetPage({ settings, enabled: resetCode().length >= 12 || await oneTimeAvailable() || (await recovery.available()) > 0 }));
  }
  if (path === '/admin/login') {
    if (method === 'POST') {
      const b = await parseBody(req);
      if (await tooMany(ip, b.login)) {
        if (await security.hit(db, 'log:login:' + ip, 1, 900)) {
          await db.logActivity(null, 'blocked', 'security', null, `লগইন আটকানো (অনেকবার ভুল পাসওয়ার্ড): "${str(b.login, 40)}" (${ip})`).catch(() => {});
          if (await security.hit(db, 'alert:loginblock', 1, 3600)) await notify.securityAlert(settings, 'অনেকবার ভুল পাসওয়ার্ড — লগইন আটকানো হয়েছে', `কেউ অ্যাডমিনে বারবার ভুল পাসওয়ার্ড দিচ্ছিল, তাই তাকে আটকে দেওয়া হয়েছে।\nইউজারনেম চেষ্টা: ${str(b.login, 40)}\nযেখান থেকে: ${ip}`);
        }
        await sessions.record(req, { login: b.login, event: 'locked', ip });
        return bare('লগইন', authPage({ settings, error: 'অনেকবার ভুল হয়েছে, তাই নিরাপত্তার জন্য লগইন কিছুক্ষণ বন্ধ। ১৫ মিনিট থেকে ১ ঘণ্টা পর আবার চেষ্টা করুন।', values: b }), 429);
      }
      const user = await staffModel.findLogin(b.login);
      if (user && user.active && verifyPassword(b.password || '', user.password)) {
        await security.clear(db, 'login:ip:' + ip);
        // Owner with the login lock on: password is only half the way; the fingerprint / face step comes next.
        if (user.role === 'owner' && lock.isOn(settings)) {
          await db.logActivity(user.id, 'login_step', 'staff', user.id, `পাসওয়ার্ড ঠিক, এখন আঙুল/মুখ যাচাই (${ip})`);
          await sessions.record(req, { staffId: user.id, login: b.login, event: 'step', ok: true, ip, detail: 'আঙুল/মুখ যাচাই' });
          return redirect(res, '/admin/verify', { 'Set-Cookie': preCookie(req, settings, user, {}) });
        }
        // Staff with the authenticator code on: the 6-digit code comes next.
        if (twoFactorOn(user)) {
          await sessions.record(req, { staffId: user.id, login: b.login, event: 'step', ok: true, ip, detail: 'অথেনটিকেটর কোড' });
          return redirect(res, '/admin/2fa', { 'Set-Cookie': tfaCookie(req, settings, user) });
        }
        await staffModel.touchLogin(user.id);
        await db.logActivity(user.id, 'login', 'staff', user.id, ip);
        await sessions.record(req, { staffId: user.id, login: b.login, event: 'login', ok: true, ip });
        if (user.role === 'owner' && settings.notify_owner_login !== '0') await notify.securityAlert(settings, 'মালিকের অ্যাকাউন্টে লগইন হয়েছে', `যেখান থেকে: ${ip}\nডিভাইস: ${str(req.headers['user-agent'], 120)}`);
        return redirect(res, firstAllowed(user), { 'Set-Cookie': await startSession(req, settings, user) });
      }
      await failed(ip, b.login);
      await sessions.record(req, { staffId: user ? user.id : null, login: b.login, event: user && !user.active ? 'inactive' : 'fail', ip });
      const error = user && !user.active ? 'এই অ্যাকাউন্ট বন্ধ করা আছে। মালিকের সাথে কথা বলুন।' : 'ইউজারনেম বা পাসওয়ার্ড ভুল হয়েছে।';
      return bare('লগইন', authPage({ settings, error, values: b }), 401);
    }
    if (await currentUser(req, settings)) return redirect(res, '/admin');
    return bare('লগইন', authPage({ settings }));
  }
  if (path === '/admin/verify' || path.startsWith('/admin/verify/')) return verifyRoutes();
  if (path === '/admin/2fa') return twoFactorRoute();
  if (path === '/admin/logout' && method === 'POST') {
    const c = cookieToken(req, settings);
    if (c) {
      const me = await currentUser(req, settings).catch(() => null);
      await sessions.revoke(c.token, 'নিজে লগআউট');
      if (me) await sessions.record(req, { staffId: me.id, login: me.username, event: 'logout', ok: true, ip });
    }
    return redirect(res, '/admin/login', { 'Set-Cookie': [CLEAR_ADMIN, CLEAR_PRE, CLEAR_CH, CLEAR_TFA] });
  }

  // ----- staff two-step login: the 6-digit code from the authenticator app -----
  async function twoFactorRoute() {
    const u = await tfaUser(req, settings);
    if (!u) return redirect(res, '/admin/login', { 'Set-Cookie': CLEAR_TFA });
    const page = (error, status = 200) => bare('যাচাই কোড', tfaPage({ settings, user: u, error }), status);
    if (method !== 'POST') return page();
    if (await security.blocked(db, 'mfa:' + u.id, 8)) {
      return bare('যাচাই কোড', tfaPage({ settings, user: u, error: 'অনেকবার ভুল কোড দেওয়া হয়েছে। ১৫ মিনিট পর আবার পাসওয়ার্ড দিয়ে লগইন করুন।', blocked: true }), 429);
    }
    const b = await parseBody(req);
    const secret = security.decrypt(u.totp_secret);
    const step = totp.check(secret, b.code, u.totp_last_step);
    // the step is saved first — the same code can never be used twice, even by two tries at once
    const won = step && await db.one('UPDATE staff SET totp_last_step=$1 WHERE id=$2 AND totp_last_step < $1 RETURNING id', [step, u.id]);
    if (!won) {
      await security.hit(db, 'mfa:' + u.id, 8, 900);
      await sessions.record(req, { staffId: u.id, login: u.username, event: 'code_fail', ip });
      require('../services/guard').record({ ip, kind: 'login_fail', detail: 'ভুল যাচাই কোড: ' + u.username }).catch(() => {});
      return page('কোডটা মেলেনি। অ্যাপে এখন যে ৬ অঙ্কের কোড দেখাচ্ছে সেটা দিন (ফোনের সময় ঠিক আছে কি না দেখুন)।', 401);
    }
    await security.clear(db, 'mfa:' + u.id);
    await staffModel.touchLogin(u.id);
    await db.logActivity(u.id, 'login', 'staff', u.id, `${ip} · অথেনটিকেটর কোড`);
    await sessions.record(req, { staffId: u.id, login: u.username, event: 'login', ok: true, ip, detail: 'অথেনটিকেটর কোডসহ' });
    return redirect(res, firstAllowed(u), { 'Set-Cookie': [await startSession(req, settings, u), CLEAR_TFA] });
  }

  // ----- owner login lock: the second check after the password -----
  async function verifyRoutes() {
    const pre = await preUser(req, settings);
    const wantsJson = path !== '/admin/verify' && path !== '/admin/verify/code' && path !== '/admin/verify/cancel';
    if (path === '/admin/verify/cancel' && method === 'POST') return redirect(res, '/admin/login', { 'Set-Cookie': [CLEAR_PRE, CLEAR_CH] });
    if (!pre) {
      if (wantsJson) return json(res, 401, { error: 'সময় শেষ হয়ে গেছে। আবার পাসওয়ার্ড দিয়ে লগইন করুন।', to: '/admin/login' });
      return redirect(res, '/admin/login', { 'Set-Cookie': [CLEAR_PRE, CLEAR_CH] });
    }
    const { user: owner, passed } = pre;
    const fail = async (why, status = 400, extra = {}) => {
      await db.logActivity(owner.id, 'blocked', 'security', owner.id, `মালিকের লগইনে দ্বিতীয় যাচাই ব্যর্থ: ${why} (${ip})`).catch(() => {});
      return json(res, status, { error: why, ...extra });
    };
    // A finished check: either the next step, or the real login.
    const next = async (how) => {
      const need = lock.needs(settings, req, passed);
      if (need) return json(res, 200, { next: need }, { 'Set-Cookie': [preCookie(req, settings, owner, passed), CLEAR_CH] });
      await security.clear(db, 'mfa:' + owner.id);
      await staffModel.touchLogin(owner.id);
      await db.logActivity(owner.id, 'login', 'staff', owner.id, `${ip} · ${how}`);
      await sessions.record(req, { staffId: owner.id, login: owner.username, event: 'login', ok: true, ip, detail: how });
      if (settings.notify_owner_login !== '0') await notify.securityAlert(settings, 'মালিকের অ্যাকাউন্টে লগইন হয়েছে', `যেখান থেকে: ${ip} · ${how}\nডিভাইস: ${str(req.headers['user-agent'], 120)}`);
      return json(res, 200, { done: true, to: firstAllowed(owner) }, { 'Set-Cookie': [await startSession(req, settings, owner, true), CLEAR_PRE, CLEAR_CH] });
    };
    // Too many failed checks: the half-way login is thrown away.
    if (method === 'POST' && await security.blocked(db, 'mfa:' + owner.id, 10)) {
      const msg = 'অনেকবার ভুল হয়েছে। নিরাপত্তার জন্য ১৫ মিনিট পর আবার পাসওয়ার্ড দিয়ে লগইন করুন।';
      if (wantsJson) return json(res, 429, { error: msg, to: '/admin/login' }, { 'Set-Cookie': [CLEAR_PRE, CLEAR_CH] });
      return bare('যাচাই', lockView.verifyPage({ settings, error: msg, blocked: true }), 429);
    }
    const countFail = () => security.hit(db, 'mfa:' + owner.id, 10, 900);

    if (path === '/admin/verify' && method === 'GET') {
      const need = lock.needs(settings, req, passed);
      if (!need) {
        // the lock was switched off in the meantime
        await staffModel.touchLogin(owner.id);
        return redirect(res, firstAllowed(owner), { 'Set-Cookie': [await startSession(req, settings, owner, true), CLEAR_PRE] });
      }
      const keysHere = await lock.passkeysFor(owner.id, lock.rpId(req));
      const keysAll = await lock.passkeys(owner.id);
      const faceN = await lock.faceCount(owner.id);
      return bare('যাচাই', lockView.verifyPage({ settings, need, mode: lock.mode(settings), mobile: lock.isMobile(req), passed,
        hasPasskey: keysHere.length > 0, otherHosts: [...new Set(keysAll.map((k) => k.rp_id))].filter((h) => h !== lock.rpId(req)), hasFace: faceN > 0, error: query.get('err') }));
    }
    if (method !== 'POST') return json(res, 405, { error: 'POST' });

    if (path === '/admin/verify/passkey/options') {
      const ch = lock.newChallenge('get', owner.id);
      const opts = await lock.loginOptions(req, owner.id, ch.challenge);
      if (!opts.allowCredentials.length) return json(res, 400, { error: 'এই ঠিকানায় কোনো পাসকি সেভ করা নেই।' });
      return json(res, 200, opts, { 'Set-Cookie': challengeCookie(req, settings, ch.value) });
    }
    if (path === '/admin/verify/passkey') {
      const c = lock.readChallenge(challengeValue(req, settings), 'get', owner.id);
      if (!c) return json(res, 400, { error: 'সময় শেষ, আবার চাপুন।' });
      if (!(await lock.useOnce(db, c.challenge))) return json(res, 400, { error: 'এই উত্তর আগেই ব্যবহার হয়েছে, আবার চাপুন।' });
      const b = await parseBody(req);
      try {
        await lock.checkPasskey(req, owner.id, c.challenge, b);
      } catch (e) {
        await countFail();
        await sessions.record(req, { staffId: owner.id, login: owner.username, event: 'code_fail', ip, detail: 'পাসকি' });
        return fail('পাসকি: ' + e.message);
      }
      passed.passkey = true;
      return next('পাসকি/আঙুলের ছাপ');
    }
    if (path === '/admin/verify/face/options') {
      if (!(await lock.faceCount(owner.id))) return json(res, 400, { error: 'কোনো মুখের ছবি সেভ করা নেই।' });
      const steps = lock.faceSteps();
      const ch = lock.newChallenge('face', owner.id, steps.join(','));
      return json(res, 200, { nonce: ch.challenge, steps }, { 'Set-Cookie': challengeCookie(req, settings, ch.value) });
    }
    if (path === '/admin/verify/face') {
      const c = lock.readChallenge(challengeValue(req, settings), 'face', owner.id);
      const b = await parseBody(req);
      if (!c || c.challenge !== b.nonce) return json(res, 400, { error: 'সময় শেষ, আবার শুরু করুন।' });
      if (!(await lock.useOnce(db, c.challenge))) return json(res, 400, { error: 'আবার শুরু করুন।' });
      const r = await lock.judgeFace(owner.id, c.extra.split(','), b);
      if (!r.ok) {
        await countFail();
        await sessions.record(req, { staffId: owner.id, login: owner.username, event: 'code_fail', ip, detail: 'মুখ যাচাই' });
        return fail('মুখ যাচাই: ' + r.reason, 400, { retry: true });
      }
      passed.face = true;
      return next('মুখ যাচাই');
    }
    if (path === '/admin/verify/code') {
      const b = await parseBody(req);
      if (await lock.useCode(owner.id, b.code)) {
        passed.passkey = true; passed.face = true;
        await security.clear(db, 'mfa:' + owner.id);
        await staffModel.touchLogin(owner.id);
        await db.logActivity(owner.id, 'login', 'staff', owner.id, `${ip} · এক-বারের অনুমতি কোড`);
        await sessions.record(req, { staffId: owner.id, login: owner.username, event: 'login', ok: true, ip, detail: 'এক-বারের অনুমতি কোড' });
        return redirect(res, '/admin/security/login?msg=bridged', { 'Set-Cookie': [await startSession(req, settings, owner, true), CLEAR_PRE, CLEAR_CH] });
      }
      await countFail();
      await db.logActivity(owner.id, 'blocked', 'security', owner.id, `মালিকের লগইনে ভুল অনুমতি কোড (${ip})`).catch(() => {});
      return redirect(res, '/admin/verify?err=' + encodeURIComponent('কোডটা ভুল বা মেয়াদ শেষ।'));
    }
    return json(res, 404, { error: 'পাওয়া যায়নি' });
  }

  // ----- everything below needs a signed-in staff member -----
  const user = await currentUser(req, settings);
  if (!user) {
    if (path.startsWith('/admin/api/')) return json(res, 401, { error: 'আবার লগইন করুন।' });
    return redirect(res, '/admin/login');
  }
  user.permissions = Array.isArray(user.permissions) ? user.permissions : [];

  const ctx = {
    ...base,
    user,
    ip,
    can: (p) => allowed(user, p),
    flash: ui.flashFrom(query),
    body: () => parseBody(req),
    page: (title, body, active, opts = {}) => send(res, opts.status || 200, adminLayout({ settings: ctx.settings, user, title, body, active, readOnly: ctx.readOnly })),
    back: (to, msgKey) => redirect(res, to + (msgKey ? (to.includes('?') ? '&' : '?') + 'msg=' + msgKey : '')),
    fail: (to, text) => redirect(res, to + (to.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent(text)),
    log: (action, entity, entityId, detail) => db.logActivity(user.id, action, entity, entityId, detail),
    // every delete goes to the recycle bin (Admin → রিসাইকেল বিন), with who / when / from where
    trash: (kind, id) => require('../models/trash').move(kind, id, { id: user.id, name: user.name, ip,
      path: (() => { try { return new URL(req.headers.referer || '').pathname; } catch (_) { return path; } })() }),
    // this login passed the fingerprint / face step (the owner just set the lock up on this device)
    markVerified: () => db.q('UPDATE admin_sessions SET verified=true WHERE id=$1', [user.__session]),
    // a brand-new login for this device (after a password change: every other device is logged out)
    newSession: async (u) => { await sessions.revoke(user.__token, 'পাসওয়ার্ড বদল'); return startSession(req, settings, u, user.__verified); },
    reloadSettings: async () => { settings = await db.getSettings(); ctx.settings = settings; return settings; },
  };

  // The owner can make the authenticator code compulsory for staff: until a staff member sets it up,
  // the only page they can open is the set-up page.
  if (user.role !== 'owner' && settings.staff_2fa_required === '1' && !twoFactorOn(user) && !path.startsWith('/admin/account')) {
    if (path.startsWith('/admin/api/')) return json(res, 403, { error: 'আগে দুই ধাপের লগইন চালু করুন।' });
    return redirect(res, '/admin/account/2fa?need=1');
  }

  // image upload used by every image picker
  // 🔔 products that came back in stock: SMS the people waiting for them (at most every 2 minutes, in the background)
  if (method === 'GET' && !path.startsWith('/admin/api/') && await security.hit(db, 'restock-sweep', 1, 120)) {
    notify.later(require('../models/extras').restockSweep(settings).catch((e) => console.error('restock sweep', e.message)));
  }

  if (path === '/admin/api/media' && method === 'POST') {
    const b = await parseBody(req);
    // Product import copies many pictures at once, so it has its own (bigger) hourly allowance.
    const bulk = !!b.import && allowed(user, 'products');
    if (!(await security.hit(db, (bulk ? 'upload-imp:' : 'upload:') + user.id, bulk ? 6000 : 300, 3600))) return json(res, 429, { error: 'এক ঘণ্টায় অনেক বেশি ছবি আপলোড হয়েছে, একটু পরে চেষ্টা করুন।' });
    const m = String(b.data || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json(res, 400, { error: 'ছবিটি পড়া যায়নি। JPG, PNG বা WebP দিন।' });
    const data = Buffer.from(m[1], 'base64');
    if (data.length > 1.5 * 1024 * 1024) return json(res, 400, { error: 'ছবিটি অনেক বড়। ছোট ছবি দিন।' });
    // The file's real first bytes decide the type — a virus or script renamed to .jpg is refused.
    const mime = security.imageKind(data);
    if (!mime) return json(res, 400, { error: 'এটা আসল ছবির ফাইল না। শুধু JPG, PNG, WebP বা GIF ছবি দিন।' });
    const t = String(b.thumb || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    const thumb = t ? Buffer.from(t[1], 'base64') : null;
    const okThumb = thumb && thumb.length < 600 * 1024 && /^image\/(jpeg|png|webp)$/.test(security.imageKind(thumb) || '') ? thumb : null;
    const id = await catalog.saveMedia({ mime, data, thumb: okThumb, width: int(b.width), height: int(b.height), phash: b.phash, phashM: b.phash_m, keepPrivate: !!b.private });
    if (Math.random() < 0.05) catalog.cleanupMedia().catch(() => {});
    return json(res, 200, { id, url: `/media/${id}`, thumb: `/media/${id}/t` });
  }
  // Older product pictures have no fingerprint yet: the admin's browser makes them quietly in the background.
  if (path === '/admin/api/media/fingerprints' && allowed(user, 'products')) {
    if (method === 'GET') return json(res, 200, { ids: (await catalog.mediaWithoutHash(30)).map((r) => r.id) });
    if (method === 'POST') {
      const b = await parseBody(req);
      const items = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
      for (const it of items) await catalog.setMediaHash(it && it.id, it && it.phash, it && it.phash_m);
      return json(res, 200, { ok: true });
    }
  }

  // ----- module routes -----
  for (const r of ROUTES) {
    if (r.method !== '*' && r.method !== method) continue;
    let match = null;
    if (typeof r.path === 'string') { if (r.path !== path) continue; match = [path]; }
    else { match = path.match(r.path); if (!match) continue; }
    const perm = r.perm ? (typeof r.perm === 'function' ? r.perm(ctx) : r.perm) : null;
    // see / add / edit / delete: a staff member may open a page they can only see, but not change anything on it
    if (perm && !staffModel.routeAllows(user, perm, method, path)) {
      if (path.startsWith('/admin/api/')) return json(res, 403, { error: 'অনুমতি নেই।' });
      if (method === 'GET') {
        const to = firstAllowed(user);
        return redirect(res, (to === path ? '/admin/account' : to) + '?msg=noperm');
      }
      // a form they may not send: back to the page they were on, with "no permission"
      const back = (() => { try { const u = new URL(req.headers.referer || ''); return u.pathname.startsWith('/admin') ? u.pathname : ''; } catch (_) { return ''; } })();
      return redirect(res, (back || firstAllowed(user)) + '?msg=noperm');
    }
    ctx.readOnly = !!perm && staffModel.viewOnly(user, perm);
    return r.handler(ctx, match);
  }
  return ctx.page('পাওয়া যায়নি', html`<h1>পেজটি পাওয়া যায়নি</h1><p><a href="${firstAllowed(user)}">শুরুর পেজে ফিরে যান</a></p>`, '', { status: 404 });
}

module.exports = { handle, currentUser, twoFactorOn };

'use strict';
const crypto = require('crypto');
// Admin panel: login, sessions, permissions and routing to the page modules.
const db = require('../db');
const staffModel = require('../models/staff');
const catalog = require('../models/catalog');
const { html, parseCookies, parseBody, verifyPassword, sign, unsign, int, str } = require('../util');
const { adminLayout, MENU, allowed } = require('./layout');
const ui = require('./ui');
const security = require('../security');

const SESSION_DAYS = 30;
const MODULES = ['dashboard', 'orders', 'import', 'watermark', 'research', 'trash', 'growth', 'toggles', 'products', 'inventory', 'customers', 'marketing', 'blog', 'design',
  'accounting', 'staff', 'reports', 'integrations', 'settings', 'visitors', 'live', 'feeds', 'navswitch', 'security'].map((m) => require('./' + m));
const ROUTES = MODULES.flatMap((m) => m.routes);

// ---------- sessions ----------
function pwTag(user) { return String(user.password || '').slice(-12); }
function sessionCookie(req, settings, user) {
  const value = sign(`${user.id}:${Date.now()}:${pwTag(user)}`, settings.session_secret);
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
async function currentUser(req, settings) {
  const value = unsign(parseCookies(req.headers.cookie).sm_admin, settings.session_secret);
  if (!value) return null;
  const [id, issued, tag] = value.split(':');
  if (!/^\d+$/.test(id) || Date.now() - Number(issued) > SESSION_DAYS * 864e5) return null;
  const user = await staffModel.getStaff(Number(id));
  if (!user || !user.active || pwTag(user) !== tag) return null;
  return user;
}

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
  await security.hit(currentDb, 'login:ip:' + ip, IP_MAX, IP_WINDOW);
  if (login) await security.hit(currentDb, 'login:user:' + String(login).toLowerCase().trim().slice(0, 60), USER_MAX, USER_WINDOW);
}

function firstAllowed(user) {
  for (const g of MENU) for (const it of g.items) if (allowed(user, it[2])) return it[0];
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
function resetPage({ settings, error, done, values = {}, enabled }) {
  const code = resetCode();
  return html`<div class="auth-card panel">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>মালিকের পাসওয়ার্ড রিসেট</h1>
  ${done ? html`
  <p>পাসওয়ার্ড বদলানো হয়েছে। সবাইকে লগআউট করে দেওয়া হয়েছে।</p>
  <p class="muted small">এই রিসেট কোড আর কাজ করবে না।</p>
  <a class="btn btn-block btn-lg" href="/admin/login">লগইন করুন</a>` : !enabled ? html`
  <p class="muted">রিসেট এখন বন্ধ আছে। চালু করতে Vercel → প্রজেক্ট → Settings → Environment Variables এ
  <b>ADMIN_RESET_CODE</b> নামে কমপক্ষে ১২ অক্ষরের একটা গোপন কোড বসান, তারপর Redeploy করুন।</p>` : html`
  <form method="post" action="/admin/reset" class="form">
    ${ui.field('গোপন রিসেট কোড', ui.input('code', '', { type: 'password', required: true, autocomplete: 'off' }), 'Claude যে কোডটা দিয়েছে (যেমন ABCD-EFGH-...)')}
    ${ui.field('নতুন ইউজারনেম', ui.input('username', values.username || 'admin', { required: true, maxlength: 40, autocapitalize: 'none' }), 'ইংরেজি ছোট হাতের অক্ষর বা সংখ্যা')}
    ${ui.field('নতুন পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর। কোথাও লিখে রাখুন।')}
    ${ui.field('আবার নতুন পাসওয়ার্ড', ui.input('password2', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))}
    ${ui.check('lock_staff', values.lock_staff !== undefined ? !!values.lock_staff : true, 'বাকি সব স্টাফ অ্যাকাউন্ট বন্ধ করে দিন (পরে "স্টাফ" মেনু থেকে আবার চালু করা যাবে)')}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block btn-lg">পাসওয়ার্ড রিসেট করুন</button>
  </form>`}
  <p class="center small"><a href="/admin/login">লগইন পেজে ফিরে যান</a></p>
</div>`;
}

function accountPage(user, flash) {
  return html`<h1>আমার অ্যাকাউন্ট</h1>${ui.flash(flash)}
  <form method="post" action="/admin/account" class="form panel narrow-form">
    <p><b>${user.name}</b> · ইউজারনেম: <b>${user.username}</b></p>
    ${ui.field('বর্তমান পাসওয়ার্ড', ui.input('current', '', { type: 'password', required: true, autocomplete: 'current-password' }))}
    ${ui.field('নতুন পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর')}
    <button class="btn">পাসওয়ার্ড বদলান</button>
  </form>`;
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
          : String(b.password || '').length < 8 ? 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।'
            : b.password !== b.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null;
      if (error) return bare('অ্যাকাউন্ট তৈরি', authPage({ settings, mode: 'setup', error, values: b }), 400);
      const id = await staffModel.createOwner({ name: b.name, username, password: b.password });
      const user = await staffModel.getStaff(id);
      await db.logActivity(id, 'login', 'staff', id, 'প্রথম সেটআপ');
      return redirect(res, '/admin', { 'Set-Cookie': sessionCookie(req, settings, user) });
    }
    return bare('অ্যাকাউন্ট তৈরি', authPage({ settings, mode: 'setup' }));
  }
  if (path === '/admin/reset') {
    if (method === 'POST') {
      const b = await parseBody(req);
      const vals = { username: b.username, lock_staff: b.lock_staff ? '1' : '' };
      const code = resetCode();
      const envOk = code.length >= 12;
      const oneTime = await oneTimeAvailable();
      if (!envOk && !oneTime) return bare('রিসেট', resetPage({ settings, enabled: false }), 403);
      if (await tooMany(ip)) return bare('রিসেট', resetPage({ settings, enabled: true, error: 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।', values: vals }), 429);
      const given = String(b.code || '').trim();
      const viaEnv = envOk && sameSecret(given, code);
      const viaOneTime = oneTime && sameSecret(hashCode(given), ONE_TIME_RESET_HASH);
      if (!viaEnv && !viaOneTime) {
        await failed(ip);
        return bare('রিসেট', resetPage({ settings, enabled: true, error: 'গোপন রিসেট কোড ভুল হয়েছে।', values: vals }), 401);
      }
      const username = staffModel.cleanUsername(b.username);
      const error = username.length < 3 ? 'ইউজারনেম কমপক্ষে ৩ অক্ষরের দিন (ইংরেজি ছোট হাতের অক্ষর/সংখ্যা)।'
        : String(b.password || '').length < 8 ? 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।'
          : b.password !== b.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null;
      if (error) return bare('রিসেট', resetPage({ settings, enabled: true, error, values: vals }), 400);
      const owner = await db.one("SELECT id FROM staff WHERE role='owner' ORDER BY id LIMIT 1");
      if (!owner) return redirect(res, '/admin/setup');
      const clash = await db.one('SELECT id FROM staff WHERE lower(username)=$1 AND id<>$2', [username, owner.id]);
      if (clash) return bare('রিসেট', resetPage({ settings, enabled: true, error: 'এই ইউজারনেম অন্য একজন স্টাফের, অন্য একটা দিন।', values: vals }), 400);
      await db.q('UPDATE staff SET username=$1, active=true WHERE id=$2', [username, owner.id]);
      await staffModel.setPassword(owner.id, b.password);
      if (b.lock_staff) await db.q("UPDATE staff SET active=false WHERE role<>'owner'");
      // New secret = every old login cookie stops working (owner's and staff's).
      await db.setSetting('session_secret', crypto.randomBytes(32).toString('hex'));
      if (viaOneTime) await db.setSetting('reset_used_' + ONE_TIME_RESET_HASH.slice(0, 16), new Date().toISOString());
      await security.clear(db, 'login:ip:' + ip);
      await db.logActivity(owner.id, 'password_reset', 'staff', owner.id, `ইমার্জেন্সি রিসেট (${ip})${b.lock_staff ? ', সব স্টাফ বন্ধ' : ''}`);
      return bare('রিসেট', resetPage({ settings, done: true }));
    }
    return bare('রিসেট', resetPage({ settings, enabled: resetCode().length >= 12 || await oneTimeAvailable() }));
  }
  if (path === '/admin/login') {
    if (method === 'POST') {
      const b = await parseBody(req);
      if (await tooMany(ip, b.login)) {
        if (await security.hit(db, 'log:login:' + ip, 1, 900)) await db.logActivity(null, 'blocked', 'security', null, `লগইন আটকানো (অনেকবার ভুল পাসওয়ার্ড): "${str(b.login, 40)}" (${ip})`).catch(() => {});
        return bare('লগইন', authPage({ settings, error: 'অনেকবার ভুল হয়েছে, তাই নিরাপত্তার জন্য লগইন কিছুক্ষণ বন্ধ। ১৫ মিনিট থেকে ১ ঘণ্টা পর আবার চেষ্টা করুন।', values: b }), 429);
      }
      const user = await staffModel.findLogin(b.login);
      if (user && user.active && verifyPassword(b.password || '', user.password)) {
        await security.clear(db, 'login:ip:' + ip);
        await staffModel.touchLogin(user.id);
        await db.logActivity(user.id, 'login', 'staff', user.id, ip);
        return redirect(res, firstAllowed(user), { 'Set-Cookie': sessionCookie(req, settings, user) });
      }
      await failed(ip, b.login);
      const error = user && !user.active ? 'এই অ্যাকাউন্ট বন্ধ করা আছে। মালিকের সাথে কথা বলুন।' : 'ইউজারনেম বা পাসওয়ার্ড ভুল হয়েছে।';
      return bare('লগইন', authPage({ settings, error, values: b }), 401);
    }
    if (await currentUser(req, settings)) return redirect(res, '/admin');
    return bare('লগইন', authPage({ settings }));
  }
  if (path === '/admin/logout' && method === 'POST') {
    return redirect(res, '/admin/login', { 'Set-Cookie': 'sm_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
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
    page: (title, body, active, opts = {}) => send(res, opts.status || 200, adminLayout({ settings: ctx.settings, user, title, body, active })),
    back: (to, msgKey) => redirect(res, to + (msgKey ? (to.includes('?') ? '&' : '?') + 'msg=' + msgKey : '')),
    fail: (to, text) => redirect(res, to + (to.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent(text)),
    log: (action, entity, entityId, detail) => db.logActivity(user.id, action, entity, entityId, detail),
    // every delete goes to the recycle bin (Admin → রিসাইকেল বিন), with who / when / from where
    trash: (kind, id) => require('../models/trash').move(kind, id, { id: user.id, name: user.name, ip,
      path: (() => { try { return new URL(req.headers.referer || '').pathname; } catch (_) { return path; } })() }),
    reloadSettings: async () => { settings = await db.getSettings(); ctx.settings = settings; return settings; },
  };

  // own account
  if (path === '/admin/account') {
    if (method === 'POST') {
      const b = await ctx.body();
      if (!verifyPassword(b.current || '', user.password) || String(b.password || '').length < 8) {
        return ctx.page('আমার অ্যাকাউন্ট', accountPage(user, { type: 'error', text: 'বর্তমান পাসওয়ার্ড ভুল, অথবা নতুন পাসওয়ার্ড ৮ অক্ষরের কম।' }), '', { status: 400 });
      }
      await staffModel.setPassword(user.id, b.password);
      const fresh = await staffModel.getStaff(user.id);
      await ctx.log('password', 'staff', user.id, 'নিজের পাসওয়ার্ড বদল');
      return redirect(res, '/admin/account?msg=password', { 'Set-Cookie': sessionCookie(req, settings, fresh) });
    }
    return ctx.page('আমার অ্যাকাউন্ট', accountPage(user, ctx.flash), '');
  }

  // image upload used by every image picker
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
    const id = await catalog.saveMedia({ mime, data, thumb: okThumb, width: int(b.width), height: int(b.height), phash: b.phash, phashM: b.phash_m });
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
    if (r.perm && !allowed(user, typeof r.perm === 'function' ? r.perm(ctx) : r.perm)) {
      if (path.startsWith('/admin/api/')) return json(res, 403, { error: 'অনুমতি নেই।' });
      const to = firstAllowed(user);
      return redirect(res, (to === path ? '/admin/account' : to) + '?msg=noperm');
    }
    return r.handler(ctx, match);
  }
  return ctx.page('পাওয়া যায়নি', html`<h1>পেজটি পাওয়া যায়নি</h1><p><a href="${firstAllowed(user)}">শুরুর পেজে ফিরে যান</a></p>`, '', { status: 404 });
}

module.exports = { handle, currentUser };

'use strict';
// Admin panel: login, sessions, permissions and routing to the page modules.
const db = require('../db');
const staffModel = require('../models/staff');
const catalog = require('../models/catalog');
const { html, parseCookies, parseBody, verifyPassword, sign, unsign, int, str } = require('../util');
const { adminLayout, MENU, allowed } = require('./layout');
const ui = require('./ui');

const SESSION_DAYS = 30;
const MODULES = ['dashboard', 'orders', 'products', 'inventory', 'customers', 'marketing', 'blog', 'design',
  'accounting', 'staff', 'reports', 'integrations', 'settings'].map((m) => require('./' + m));
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

// Slow down password guessing (per server instance).
const attempts = new Map();
function tooMany(ip) {
  const a = attempts.get(ip);
  return a && a.n >= 8 && Date.now() - a.t < 15 * 60e3;
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.t > 15 * 60e3) attempts.set(ip, { n: 1, t: Date.now() });
  else a.n += 1;
  if (attempts.size > 5000) attempts.clear();
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
  <p class="muted small">আগের পাসওয়ার্ড দিয়ে ঢুকতে চাইলে ইউজারনেম লিখুন: <b>admin</b></p>`}
  <p class="center small"><a href="/">দোকানে ফিরে যান</a></p>
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
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const bare = (title, body, status = 200) => send(res, status, adminLayout({ settings, title, body, bare: true }));

  // ----- public: setup, login, logout -----
  const staffCount = await staffModel.countStaff();
  if (path === '/admin/setup' || (path === '/admin/login' && !staffCount)) {
    if (staffCount) return redirect(res, '/admin/login');
    if (method === 'POST' && path === '/admin/setup') {
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
  if (path === '/admin/login') {
    if (method === 'POST') {
      const b = await parseBody(req);
      if (tooMany(ip)) return bare('লগইন', authPage({ settings, error: 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।', values: b }), 429);
      const user = await staffModel.findLogin(b.login);
      if (user && user.active && verifyPassword(b.password || '', user.password)) {
        attempts.delete(ip);
        await staffModel.touchLogin(user.id);
        await db.logActivity(user.id, 'login', 'staff', user.id, ip);
        return redirect(res, firstAllowed(user), { 'Set-Cookie': sessionCookie(req, settings, user) });
      }
      failed(ip);
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
    const m = String(b.data || '').match(/^data:(image\/(?:jpeg|png|webp|gif|x-icon|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json(res, 400, { error: 'ছবিটি পড়া যায়নি। JPG বা PNG দিন।' });
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 1.5 * 1024 * 1024) return json(res, 400, { error: 'ছবিটি অনেক বড়। ছোট ছবি দিন।' });
    const t = String(b.thumb || '').match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    const id = await catalog.saveMedia({ mime: m[1], data, thumb: t ? Buffer.from(t[1], 'base64') : null, width: int(b.width), height: int(b.height) });
    if (Math.random() < 0.05) catalog.cleanupMedia().catch(() => {});
    return json(res, 200, { id, url: `/media/${id}`, thumb: `/media/${id}/t` });
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

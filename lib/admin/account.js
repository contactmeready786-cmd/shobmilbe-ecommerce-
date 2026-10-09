'use strict';
// Admin → আমার অ্যাকাউন্ট: change my password, two-step login (authenticator app), and the devices I'm logged in on.
const { html, raw, bn, fmtDate, str, verifyPassword, passwordProblem } = require('../util');
const db = require('../db');
const ui = require('./ui');
const security = require('../security');
const sessions = require('../models/sessions');
const staffModel = require('../models/staff');
const totp = require('../services/totp');
const qr = require('../services/qr');

const MSG = {
  password: 'পাসওয়ার্ড বদলানো হয়েছে। নিরাপত্তার জন্য অন্য সব ডিভাইস থেকে লগআউট করা হয়েছে।',
  tfa_on: '✅ দুই ধাপের লগইন চালু হয়েছে। এখন থেকে লগইনে পাসওয়ার্ডের পরে অ্যাপের কোড লাগবে।',
  tfa_off: 'দুই ধাপের লগইন বন্ধ করা হয়েছে।',
  out_one: 'ওই ডিভাইস থেকে লগআউট করা হয়েছে।',
  out_others: 'অন্য সব ডিভাইস থেকে লগআউট করা হয়েছে।',
  profile: '✅ প্রোফাইল সেভ হয়েছে।',
};
function flash(ctx) {
  const m = MSG[ctx.query.get('msg')];
  return m ? ui.flash({ text: m }) : ui.flash(ctx.flash);
}

function devicesTable(rows, me, action) {
  if (!rows.length) return html`<p class="muted">কোনো ডিভাইসে লগইন নেই।</p>`;
  return html`<div class="table-wrap"><table class="table compact"><thead><tr><th>ডিভাইস</th><th>কোথা থেকে</th><th>লগইন</th><th>শেষ ব্যবহার</th><th></th></tr></thead>
  <tbody>${rows.map((s) => html`<tr>
    <td>${s.device || '—'}${s.id === me ? html` <span class="pill pill-delivered">এই ডিভাইস</span>` : ''}</td>
    <td class="small">${s.place || ''}${s.place ? html`<br>` : ''}<span class="muted mono">${s.ip}</span></td>
    <td class="small">${fmtDate(s.created_at)}</td>
    <td class="small">${fmtDate(s.last_seen)}</td>
    <td>${s.id === me ? '' : html`<form method="post" action="${action}" data-confirm="এই ডিভাইস থেকে লগআউট করবেন?"><input type="hidden" name="id" value="${s.id}"><button class="btn btn-sm btn-ghost">লগআউট করুন</button></form>`}</td>
  </tr>`)}</tbody></table></div>`;
}

async function page(ctx, error) {
  const u = ctx.user;
  const mine = await sessions.listFor(u.id, ctx.settings);
  const history = await sessions.history({ staffId: u.id }, { limit: 12 });
  const isOwner = u.role === 'owner';
  const tfa = u.totp_on && !!u.totp_secret;
  const body = html`<h1>আমার প্রোফাইল ও অ্যাকাউন্ট</h1>${flash(ctx)}
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
${require('./profile').myPanel(u)}
<div class="two-col">
  <section class="panel">
    <h2>🔑 পাসওয়ার্ড বদলান</h2>
    <p><b translate="no">${u.name}</b> · ইউজারনেম: <b translate="no">${u.username}</b>${u.password_changed_at ? html`<br><span class="small muted">শেষ বদল: ${fmtDate(u.password_changed_at)}</span>` : ''}</p>
    <form method="post" action="/admin/account" class="form">
      ${ui.field('বর্তমান পাসওয়ার্ড', ui.input('current', '', { type: 'password', required: true, autocomplete: 'current-password' }))}
      ${ui.field('নতুন পাসওয়ার্ড', ui.input('password', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password', 'data-pw-meter': true }), 'কমপক্ষে ৮ অক্ষর, অক্ষর আর সংখ্যা মিলিয়ে (যেমন Rahim#2025)। ১২৩৪৫৬৭৮, মোবাইল নম্বর বা নিজের নাম দেবেন না।')}
      ${ui.field('আবার নতুন পাসওয়ার্ড', ui.input('password2', '', { type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))}
      <button class="btn">পাসওয়ার্ড বদলান</button>
      <p class="small muted">বদলালে নিরাপত্তার জন্য আপনার অন্য সব ডিভাইস থেকে লগআউট হয়ে যাবে।</p>
    </form>
  </section>
  <section class="panel">
    <h2>📱 দুই ধাপের লগইন</h2>
    ${isOwner ? html`<p>মালিকের অ্যাকাউন্টে পাসওয়ার্ডের পরে <b>আঙুলের ছাপ / পাসকি / মুখ যাচাই</b> চালু করা যায় — এটা অথেনটিকেটর কোডের চেয়েও শক্ত।</p>
      <a class="btn btn-ghost" href="/admin/security/login">লগইন তালা (আঙুল ও মুখ) →</a>
      <p class="small muted">স্টাফদের জন্য অথেনটিকেটর কোড বাধ্যতামূলক করতে: <a href="/admin/security/logins#settings">লগইন ইতিহাস ও ডিভাইস → সেটিংস</a></p>`
    : tfa ? html`<p class="flash">✅ চালু আছে — লগইনে পাসওয়ার্ডের পরে ফোনের অ্যাপের ৬ অঙ্কের কোড লাগে।</p>
      ${ctx.settings.staff_2fa_required === '1' ? html`<p class="small muted">মালিক এটা সবার জন্য বাধ্যতামূলক করেছেন, তাই বন্ধ করা যাবে না। নতুন ফোনে নিতে চাইলে মালিককে রিসেট করতে বলুন।</p>` : html`
      <form method="post" action="/admin/account/2fa" class="form" data-confirm="দুই ধাপের লগইন বন্ধ করবেন? তখন শুধু পাসওয়ার্ড দিয়েই ঢোকা যাবে।">
        <input type="hidden" name="action" value="disable">
        ${ui.field('বন্ধ করতে বর্তমান পাসওয়ার্ড দিন', ui.input('current', '', { type: 'password', required: true, autocomplete: 'current-password' }))}
        <button class="btn btn-sm btn-danger">দুই ধাপের লগইন বন্ধ করুন</button>
      </form>`}`
      : html`<p>চালু করলে কেউ আপনার পাসওয়ার্ড জেনে গেলেও আপনার ফোন ছাড়া ঢুকতে পারবে না।</p>
      <a class="btn" href="/admin/account/2fa">চালু করুন →</a>`}
  </section>
</div>
<section class="panel">
  <div class="title-row"><h2>💻 যেসব ডিভাইসে লগইন আছে <small>${bn(mine.length)}টি</small></h2>
  ${mine.length > 1 ? html`<form method="post" action="/admin/account/logout-others" data-confirm="এই ডিভাইস ছাড়া বাকি সব জায়গা থেকে লগআউট করবেন?"><button class="btn btn-sm btn-ghost">অন্য সব ডিভাইস থেকে লগআউট</button></form>` : ''}</div>
  <p class="small muted">অচেনা কোনো ডিভাইস দেখলে সাথে সাথে সেখান থেকে লগআউট করুন আর পাসওয়ার্ড বদলান। ${bn(sessions.idleHours(ctx.settings))} ঘণ্টা ব্যবহার না হলে লগইন নিজে থেকেই বন্ধ হয়ে যায়।</p>
  ${devicesTable(mine, u.__session, '/admin/account/logout-one')}
</section>
<section class="panel">
  <h2>🕘 আমার সাম্প্রতিক লগইন</h2>
  ${history.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>কী হয়েছে</th><th>ডিভাইস</th><th>কোথা থেকে</th></tr></thead>
  <tbody>${history.map((h) => html`<tr class="${h.ok ? '' : 'row-warn'}"><td class="small">${fmtDate(h.created_at)}</td><td>${sessions.EVENTS[h.event] || h.event}${h.detail ? html`<br><span class="small muted">${h.detail}</span>` : ''}</td>
    <td class="small">${h.device}</td><td class="small">${h.place}${h.place ? ' · ' : ''}<span class="mono">${h.ip}</span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কিছু নেই।</p>`}
</section>`;
  return ctx.page('আমার প্রোফাইল ও অ্যাকাউন্ট', body, '', { status: error ? 400 : 200 });
}

async function changePassword(ctx) {
  const b = await ctx.body();
  const u = ctx.user;
  if (!(await security.hit(db, 'pwchange:' + u.id, 10, 3600))) return page(ctx, 'অনেকবার চেষ্টা হয়েছে। এক ঘণ্টা পর আবার চেষ্টা করুন।');
  if (!verifyPassword(b.current || '', u.password)) {
    await sessions.record(ctx.req, { staffId: u.id, login: u.username, event: 'fail', ip: ctx.ip, detail: 'পাসওয়ার্ড বদলের সময় ভুল বর্তমান পাসওয়ার্ড' });
    return page(ctx, 'বর্তমান পাসওয়ার্ড ভুল হয়েছে।');
  }
  const bad = passwordProblem(b.password, u) || (b.password !== b.password2 ? 'দুটো নতুন পাসওয়ার্ড মিলছে না।' : null)
    || (verifyPassword(b.password, u.password) ? 'নতুন পাসওয়ার্ড আগেরটার মতোই — অন্য একটা দিন।' : null);
  if (bad) return page(ctx, bad);
  await staffModel.setPassword(u.id, b.password);
  const fresh = await staffModel.getStaff(u.id);
  await sessions.revokeAll(u.id, 'পাসওয়ার্ড বদল', u.__token);
  await ctx.log('password', 'staff', u.id, 'নিজের পাসওয়ার্ড বদল');
  if (u.role === 'owner') await require('../services/notify').securityAlert(ctx.settings, 'মালিকের পাসওয়ার্ড বদলানো হয়েছে', `যেখান থেকে: ${ctx.ip}`).catch(() => {});
  const cookie = await ctx.newSession(fresh);
  ctx.res.writeHead(303, { Location: '/admin/account?msg=password', 'Cache-Control': 'no-store', 'Set-Cookie': cookie });
  return ctx.res.end();
}

// ---------------------------------------------------------------- two-step login set-up (staff)
async function twoFactor(ctx) {
  const u = ctx.user;
  if (u.role === 'owner') return ctx.redirect(ctx.res, '/admin/security/login');
  const enabled = u.totp_on && !!u.totp_secret;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!(await security.hit(db, 'tfa-setup:' + u.id, 20, 3600))) return ctx.fail('/admin/account', 'অনেকবার চেষ্টা হয়েছে, এক ঘণ্টা পর আবার চেষ্টা করুন।');
    if (b.action === 'disable') {
      if (!enabled) return ctx.redirect(ctx.res, '/admin/account');
      if (ctx.settings.staff_2fa_required === '1') return ctx.fail('/admin/account', 'মালিক দুই ধাপের লগইন বাধ্যতামূলক করেছেন, তাই বন্ধ করা যাবে না।');
      if (!verifyPassword(b.current || '', u.password)) return ctx.fail('/admin/account', 'পাসওয়ার্ড ভুল — দুই ধাপের লগইন বন্ধ হয়নি।');
      await db.q(`UPDATE staff SET totp_on=false, totp_secret='' WHERE id=$1`, [u.id]);
      await ctx.log('tfa_off', 'staff', u.id, 'নিজের দুই ধাপের লগইন বন্ধ');
      return ctx.back('/admin/account', 'tfa_off');
    }
    if (enabled) return ctx.redirect(ctx.res, '/admin/account');
    const secret = security.decrypt(u.totp_secret);
    const step = totp.check(secret, b.code, 0);
    if (!secret || !step) return ctx.redirect(ctx.res, '/admin/account/2fa?bad=1' + (ctx.query.get('need') ? '&need=1' : ''));
    await db.q('UPDATE staff SET totp_on=true, totp_last_step=$1 WHERE id=$2', [step, u.id]);
    await ctx.log('tfa_on', 'staff', u.id, 'নিজের দুই ধাপের লগইন চালু');
    return ctx.back('/admin/account', 'tfa_on');
  }
  if (enabled) return ctx.redirect(ctx.res, '/admin/account');
  // a fresh secret is kept (locked) on the account until it is confirmed with a code
  let secret = security.decrypt(u.totp_secret);
  if (!secret || ctx.query.get('new') === '1') {
    secret = totp.newSecret();
    await db.q('UPDATE staff SET totp_secret=$1, totp_on=false WHERE id=$2', [security.encrypt(secret), u.id]);
  }
  // the app shows "shobmilbe.com (rahim)" — a short plain name keeps the QR code small and easy to scan
  const host = String(ctx.settings.custom_domain || (ctx.settings.site_url || '').replace(/^https?:\/\//, '') || ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || 'Shop')
    .split(/[/,:]/)[0].replace(/^www\./, '').trim().slice(0, 40) || 'Shop';
  const link = totp.uri(secret, u.username, host);
  const need = ctx.query.get('need') === '1';
  const body = html`<p class="crumbs"><a href="/admin/account">← আমার অ্যাকাউন্ট</a></p>
<h1>📱 দুই ধাপের লগইন চালু করুন</h1>
${need ? html`<p class="flash flash-error">মালিক সব স্টাফের জন্য দুই ধাপের লগইন বাধ্যতামূলক করেছেন। এটা চালু না করা পর্যন্ত অ্যাডমিনের অন্য কোনো পেজ খোলা যাবে না।</p>` : ''}
${ctx.query.get('bad') ? html`<p class="flash flash-error">কোডটা মেলেনি। অ্যাপে এখন যে কোড দেখাচ্ছে সেটা দিন — ফোনের সময় (Date & time) "Automatic" আছে কি না দেখুন।</p>` : ''}
<div class="two-col">
  <section class="panel">
    <h2>১) ফোনে অ্যাপ নিন</h2>
    <p>Play Store / App Store থেকে <b>Google Authenticator</b> (অথবা Microsoft Authenticator) ইনস্টল করুন। ফ্রি।</p>
    <h2>২) এই QR কোড স্ক্যান করুন</h2>
    <p class="small muted">অ্যাপে <b>+</b> → <b>Scan a QR code</b> চাপুন, তারপর ক্যামেরা এই কোডের দিকে ধরুন।</p>
    <div class="qr-box">${raw((() => { try { return qr.svg(link, { px: 220, label: 'Authenticator QR' }); } catch (_) { return '<p class="muted small">QR কোড বানানো যায়নি — নিচের "হাতে লিখুন" অংশের কী দিন।</p>'; } })())}</div>
    <details class="help"><summary>স্ক্যান করতে পারছেন না? হাতে লিখুন</summary><div>
      <p class="small">অ্যাপে <b>+</b> → <b>Enter a setup key</b> চাপুন। Account name: <b translate="no">${u.username}</b>, Key:</p>
      <p class="mono setup-key" translate="no">${totp.pretty(secret)}</p>
      <p class="small">এই অ্যাডমিন ফোনেই খোলা থাকলে: <a href="${link}">এখানে চাপ দিয়ে সরাসরি অ্যাপে যোগ করুন</a></p>
    </div></details>
  </section>
  <section class="panel">
    <h2>৩) অ্যাপের কোড দিয়ে নিশ্চিত করুন</h2>
    <form method="post" action="/admin/account/2fa${need ? '?need=1' : ''}" class="form">
      <input type="hidden" name="action" value="enable">
      ${ui.field('অ্যাপে দেখানো ৬ অঙ্কের কোড', ui.input('code', '', { required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, class: 'code-input', autofocus: true }))}
      <button class="btn btn-lg">চালু করুন</button>
    </form>
    <p class="small muted">এই কোড কাউকে বলবেন না, স্ক্রিনশটও পাঠাবেন না। ফোন হারালে মালিক "স্টাফ" পেজ থেকে রিসেট করে দিতে পারবেন।</p>
    <p class="small"><a href="/admin/account/2fa?new=1${need ? '&need=1' : ''}">নতুন QR কোড বানান</a></p>
  </section>
</div>`;
  return ctx.page('দুই ধাপের লগইন', body, '');
}

async function logoutOne(ctx) {
  const b = await ctx.body();
  if (String(b.id) === ctx.user.__session) return ctx.redirect(ctx.res, '/admin/account');
  const who = await sessions.revokeId(str(b.id, 100), ctx.user.id, 'নিজে অন্য ডিভাইস থেকে লগআউট করেছেন');
  if (who) await sessions.record(ctx.req, { staffId: ctx.user.id, login: ctx.user.username, event: 'revoked', ok: true, ip: ctx.ip, detail: 'নিজে একটা ডিভাইস লগআউট করেছেন' });
  return ctx.back('/admin/account', 'out_one');
}
async function logoutOthers(ctx) {
  const n = await sessions.revokeAll(ctx.user.id, 'নিজে অন্য সব ডিভাইস লগআউট করেছেন', ctx.user.__token);
  if (n) await sessions.record(ctx.req, { staffId: ctx.user.id, login: ctx.user.username, event: 'revoked', ok: true, ip: ctx.ip, detail: `${n}টি ডিভাইস লগআউট` });
  return ctx.back('/admin/account', 'out_others');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/account', handler: (ctx) => page(ctx) },
    { method: 'POST', path: '/admin/account', handler: changePassword },
    { method: '*', path: '/admin/account/2fa', handler: twoFactor },
    { method: 'POST', path: '/admin/account/logout-one', handler: logoutOne },
    { method: 'POST', path: '/admin/account/logout-others', handler: logoutOthers },
  ],
  devicesTable,
};

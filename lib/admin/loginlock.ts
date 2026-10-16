// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → নিরাপত্তা → লগইন তালা (owner only):
// passkeys (fingerprint / Windows Hello / phone QR), and whether the lock is on. (The camera face check was removed.)
// Also builds the "second check" page shown after the owner's password (see admin/index.js → /admin/verify).
import { html, raw, sign, unsign, parseCookies, fmtDate, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as lock from '../models/loginlock';
import * as security from '../security';
import { ASSET_V } from './layout';
import * as $recovery from './recovery';

const BASE = '/admin/security/login';

// ---------------------------------------------------------------- challenge cookie for this page
function chCookie(ctx, value) {
  const secure = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_ch2=${encodeURIComponent(sign(value, ctx.settings.session_secret))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=300${secure}`;
}
function chValue(ctx) { return unsign(parseCookies(ctx.req.headers.cookie).sm_ch2, ctx.settings.session_secret); }

// ---------------------------------------------------------------- the second-check page (after the password)
function verifyPage({ settings, need, mobile, hasPasskey, otherHosts = [], error, blocked }) {
  return html`<div class="auth-card panel ll-verify" data-ll-verify data-need="${need || ''}" data-mode="${mode || ''}"
    data-mobile="${mobile ? '1' : ''}" data-has-passkey="${hasPasskey ? '1' : ''}">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>🔐 মালিকের দ্বিতীয় যাচাই</h1>
  ${blocked ? html`<p class="form-error">${error}</p><p class="center"><a class="btn btn-block" href="/admin/login">আবার লগইন করুন</a></p>` : html`
  <p class="muted">পাসওয়ার্ড ঠিক আছে ✅ এবার আঙুলের ছাপ দিয়ে নিজেকে যাচাই করুন।</p>
  ${error ? html`<p class="form-error">${error}</p>` : ''}

  <section class="ll-part" data-ll-pk hidden>
    <h2>👆 আঙুলের ছাপ / পাসকি</h2>
    ${hasPasskey ? html`
    <p class="small">${mobile ? 'নিচের বোতাম চাপুন, তারপর ফোনের আঙুলের ছাপ (বা ফোনের স্ক্রিন লক) দিন।'
      : 'নিচের বোতাম চাপুন। ল্যাপটপে Windows Hello (মুখ/আঙুল/PIN) চাইবে। ল্যাপটপে না থাকলে "অন্য ডিভাইস / ফোন" বেছে নিন, স্ক্রিনের QR কোড ফোন দিয়ে স্ক্যান করে ফোনে আঙুল ছোঁয়ান।'}</p>
    <button type="button" class="btn btn-block btn-lg" data-ll-pk-go>👆 আঙুলের ছাপ দিয়ে যাচাই করুন</button>` : html`
    <p class="form-error">এই ঠিকানায় কোনো পাসকি (আঙুলের ছাপ) সেভ করা নেই।</p>
    ${otherHosts.length ? html`<p class="small">আপনার পাসকি আছে এই ঠিকানায়: <b>${otherHosts.join(', ')}</b>। সেখানে লগইন করে "লগইন তালা" পেজ থেকে একটা <b>অনুমতি কোড</b> বানান, তারপর নিচে দিন।</p>` : ''}`}
  </section>

  <p class="form-error" data-ll-msg hidden></p>

  <details class="ll-more">
    <summary>অন্য ঠিকানা থেকে পাওয়া অনুমতি কোড আছে?</summary>
    <form method="post" action="/admin/verify/code" class="form">
      ${ui.field('৮ সংখ্যার অনুমতি কোড', ui.input('code', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, required: true }))}
      <button class="btn btn-ghost btn-block">কোড দিয়ে ঢুকুন</button>
    </form>
  </details>
  <form method="post" action="/admin/verify/cancel" class="center"><button class="link-btn">বাতিল করে লগইন পেজে ফিরুন</button></form>
  <p class="center small"><a href="/admin/reset">ফোন হারিয়েছেন / আঙুলের ছাপ কাজ করছে না?</a></p>`}
</div>
<script src="/js/loginlock.js?v=${ASSET_V}" defer></script>`;
}

// ---------------------------------------------------------------- settings page
function deviceGuess(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android ফোন' : 'Android ট্যাব';
  if (/Windows/i.test(ua)) return 'Windows কম্পিউটার';
  if (/Macintosh/i.test(ua)) return 'Mac কম্পিউটার';
  return 'আমার ডিভাইস';
}

async function page(ctx, extra = {}) {
  const u = ctx.user;
  const m = lock.mode(ctx.settings);
  const host = lock.rpId(ctx.req);
  const keys = await lock.passkeys(u.id);
  const keysHere = keys.filter((k) => k.rp_id === host);
  const ready = {};
  for (const x of lock.MODES) ready[x] = x === 'off' ? null : await lock.readyFor(x, u.id, ctx.req);
  const hasReset = String(process.env.ADMIN_RESET_CODE || '').trim().length >= 12 || (await $recovery.available()) > 0;

  const modeCard = (x, title, lines, rec) => html`<label class="ll-mode ${m === x ? 'is-on' : ''} ${ready[x] ? 'is-off' : ''}">
    <input type="radio" name="mode" value="${x}" ${m === x ? raw('checked') : ''} ${ready[x] && m !== x ? raw('disabled') : ''}>
    <span><b>${title}</b>${rec ? html` <span class="pill pill-green">${rec}</span>` : ''}
      <span class="small muted">${lines}</span>
      ${ready[x] ? html`<span class="small ll-need">⚠️ ${ready[x]}</span>` : ''}</span></label>`;

  const body = html`<h1>🔐 লগইন তালা (আঙুলের ছাপ)</h1>${ui.flash(ctx.flash)}${extra.flash ? ui.flash(extra.flash) : ''}
<p class="muted">শুধু <b>মালিকের</b> লগইনে কাজ করে। পাসওয়ার্ড দেওয়ার পরেও আঙুলের ছাপ (পাসকি) না মিললে কেউ ঢুকতে পারবে না। স্টাফদের লগইন আগের মতোই থাকবে।</p>

${extra.code ? html`<section class="panel ll-codebox">
  <h2>🔑 এক-বারের অনুমতি কোড</h2>
  <p class="ll-code">${extra.code}</p>
  <p class="small">১৫ মিনিট কাজ করবে, একবারই। নতুন ঠিকানায় পাসওয়ার্ড দেওয়ার পর যাচাই পেজে "অনুমতি কোড আছে?" খুলে এই কোড দিন, তারপর সেখানে নতুন করে পাসকি যোগ করুন। কাউকে দেবেন না।</p>
</section>` : ''}

<section class="panel">
  <h2>এখন চালু: ${m === 'off' ? ui.pill('বন্ধ', 'pill-grey') : ui.pill(lock.MODE_NAMES[m], 'pill-green')}</h2>
  <p class="small muted">দুই ধাপ: আগে পাসকি যোগ করুন, তারপর তালা চালু করুন।</p>
</section>

<section class="panel" id="passkeys">
  <h2>ধাপ ১ · 👆 পাসকি (আঙুলের ছাপ / Windows Hello / ফোন দিয়ে QR)</h2>
  <p class="small">যে ফোন বা ল্যাপটপ দিয়ে লগইন করবেন, <b>সেই ডিভাইস থেকে এই পেজ খুলে</b> নিচের বোতাম চাপুন। ফোনে আঙুলের ছাপ চাইবে, ল্যাপটপে Windows Hello। ল্যাপটপে কিছু না থাকলে "অন্য ডিভাইস / ফোন" বেছে নিয়ে QR কোড ফোন দিয়ে স্ক্যান করুন।</p>
  ${keys.length ? html`<div class="ll-table"><table class="table"><thead><tr><th>ডিভাইস</th><th>ঠিকানা</th><th>যোগ হয়েছে</th><th>শেষ ব্যবহার</th><th></th></tr></thead><tbody>
    ${keys.map((k) => html`<tr><td><b>${k.name}</b></td><td class="small">${k.rp_id}${k.rp_id !== host ? html` ${ui.pill('অন্য ঠিকানা', 'pill-amber')}` : ''}</td>
      <td class="small">${fmtDate(k.created_at)}</td><td class="small">${k.last_used ? fmtDate(k.last_used) : 'এখনো না'}</td>
      <td><form method="post" action="${BASE}/passkey/${k.id}/delete" data-confirm="এই ডিভাইসের পাসকি মুছে ফেলবেন? হারানো বা বিক্রি করা ফোন হলে অবশ্যই মুছুন।"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>`)}
  </tbody></table></div>` : html`<p class="muted">এখনো কোনো পাসকি যোগ করা হয়নি।</p>`}
  <div class="ll-add" data-ll-pk-add>
    ${ui.field('এই ডিভাইসের নাম', ui.input('pk_name', deviceGuess(ctx.req), { maxlength: 60 }), 'যেমন: আমার Samsung ফোন, অফিসের ল্যাপটপ')}
    <button type="button" class="btn" data-ll-pk-register>➕ এই ডিভাইসে পাসকি যোগ করুন</button>
    <p class="small muted" data-ll-pk-note hidden></p>
  </div>
  <p class="small muted">পাসকি শুধু এই ঠিকানায় কাজ করে: <b>${host}</b>। পরে নতুন ডোমেইনে (যেমন shobmilbe.com) গেলে নিচের "অনুমতি কোড" দিয়ে সেখানে আবার যোগ করতে হবে।</p>
</section>

<section class="panel" id="mode">
  <h2>ধাপ ২ · তালা চালু / বন্ধ</h2>
  <form method="post" action="${BASE}/mode" class="form ll-modes">
    ${modeCard('off', '⛔ বন্ধ — শুধু পাসওয়ার্ড', 'আগের মতো, শুধু ইউজারনেম আর পাসওয়ার্ড।')}
    ${modeCard('passkey', '১ · শুধু পাসকি', 'মোবাইলে আঙুলের ছাপ। ল্যাপটপে Windows Hello, অথবা ফোন দিয়ে QR স্ক্যান করে ফোনে আঙুল। সবচেয়ে নিরাপদ আর সহজ।', 'সবচেয়ে নিরাপদ')}
    <button class="btn btn-lg">💾 সেভ করুন</button>
  </form>
</section>

<div class="two-col">
<section class="panel">
  <h2>🔑 নতুন ঠিকানার জন্য অনুমতি কোড</h2>
  <p class="small">সাইট নতুন ডোমেইনে নিলে সেখানে পুরোনো পাসকি কাজ করবে না। এখান থেকে কোড বানিয়ে নতুন ঠিকানার যাচাই পেজে একবার দিন, তারপর সেখানে নতুন পাসকি যোগ করুন।</p>
  <form method="post" action="${BASE}/code"><button class="btn btn-ghost">কোড বানান</button></form>
</section>
<section class="panel">
  <h2>🆘 ফোন হারালে</h2>
  <p class="small">লগইন পেজের <b>"পাসওয়ার্ড ভুলে গেছেন?"</b> থেকে কাগজে লেখা রিকভারি কোড দিয়ে নতুন পাসওয়ার্ড দিন, আর <b>"আঙুলের ছাপের তালা বন্ধ করে দিন"</b> টিক দিন। পরে ঢুকে হারানো ফোনের পাসকি মুছে দিন।</p>
  <p class="small">${hasReset ? html`✅ জরুরি রিকভারি কোড বানানো আছে।` : html`⚠️ জরুরি রিকভারি কোড এখনো বানানো হয়নি। লগইন তালা চালুর আগে <a href="/admin/security/recovery">এখান থেকে বানিয়ে</a> কাগজে লিখে রাখুন, নইলে ফোন হারালে নিজেই আটকে যেতে পারেন।`}</p>
</section>
</div>
<script src="/js/loginlock.js?v=${ASSET_V}" defer></script>`;
  return ctx.page('লগইন তালা', body, 'loginlock');
}

// ---------------------------------------------------------------- handlers
async function saveMode(ctx) {
  const b = await ctx.body();
  const m = lock.MODES.includes(b.mode) ? b.mode : 'off';
  const why = m === 'off' ? null : await lock.readyFor(m, ctx.user.id, ctx.req);
  if (why) return ctx.fail(BASE, why);
  const before = lock.mode(ctx.settings);
  await db.setSetting('login_lock_mode', m);
  await ctx.log('settings', 'security', ctx.user.id, `লগইন তালা: ${lock.MODE_NAMES[before]} → ${lock.MODE_NAMES[m]}`);
  // the owner set this up just now, so this login counts as verified (otherwise they'd be thrown out)
  await ctx.markVerified();
  ctx.res.writeHead(303, { Location: BASE + '?msg=saved#mode', 'Cache-Control': 'no-store' });
  return ctx.res.end();
}

async function pkOptions(ctx) {
  const ch = lock.newChallenge('create', ctx.user.id);
  const existing = await lock.passkeysFor(ctx.user.id, lock.rpId(ctx.req));
  return ctx.json(ctx.res, 200, lock.registrationOptions(ctx.req, ctx.user, ctx.settings, ch.challenge, existing), { 'Set-Cookie': chCookie(ctx, ch.value) });
}
async function pkAdd(ctx) {
  const c = lock.readChallenge(chValue(ctx), 'create', ctx.user.id);
  if (!c) return ctx.json(ctx.res, 400, { error: 'সময় শেষ, আবার চাপুন।' });
  if (!(await lock.useOnce(db, c.challenge))) return ctx.json(ctx.res, 400, { error: 'আবার চাপুন।' });
  const b = await ctx.body();
  try {
    const r = await lock.addPasskey(ctx.req, ctx.user, c.challenge, b);
    await ctx.log('passkey_add', 'security', ctx.user.id, `পাসকি যোগ: ${r.name} (${r.rp})`);
    return ctx.json(ctx.res, 200, { ok: true });
  } catch (e) {
    if (/duplicate key/.test(e.message)) return ctx.json(ctx.res, 400, { error: 'এই পাসকি আগেই যোগ করা আছে।' });
    return ctx.json(ctx.res, 400, { error: 'যোগ করা যায়নি: ' + e.message });
  }
}
async function pkDelete(ctx, m) {
  const id = int(m[1]);
  const k = await db.one('SELECT id, name, rp_id FROM owner_passkeys WHERE id=$1 AND staff_id=$2', [id, ctx.user.id]);
  if (!k) return ctx.back(BASE);
  const mode = lock.mode(ctx.settings);
  if (['passkey', 'both'].includes(mode) && k.rp_id === lock.rpId(ctx.req)) {
    const here = await lock.passkeysFor(ctx.user.id, k.rp_id);
    if (here.length <= 1) return ctx.fail(BASE, 'এটাই এই ঠিকানার শেষ পাসকি। আগে অন্য ডিভাইসে পাসকি যোগ করুন, অথবা লগইন তালা বন্ধ করুন।');
  }
  await db.q('DELETE FROM owner_passkeys WHERE id=$1 AND staff_id=$2', [id, ctx.user.id]);
  await ctx.log('passkey_delete', 'security', ctx.user.id, `পাসকি মোছা: ${k.name} (${k.rp_id})`);
  return ctx.back(BASE, 'saved');
}

async function makeCode(ctx) {
  if (!(await security.hit(db, 'llcode:' + ctx.user.id, 10, 3600))) return ctx.fail(BASE, 'অনেকবার কোড বানানো হয়েছে, একটু পরে চেষ্টা করুন।');
  const code = await lock.makeCode(ctx.user.id);
  await ctx.log('login_code', 'security', ctx.user.id, 'নতুন ঠিকানার জন্য এক-বারের অনুমতি কোড তৈরি');
  return page(ctx, { code: code.replace(/(\d{4})(\d{4})/, '$1 $2') });
}

ui.MESSAGES.bridged = 'অনুমতি কোড দিয়ে ঢুকেছেন। এখন এই ঠিকানার জন্য নিচে নতুন পাসকি যোগ করুন।';

export const routes = [
    { method: 'GET', path: BASE, perm: 'owner', handler: (ctx) => page(ctx) },
    { method: 'POST', path: BASE + '/mode', perm: 'owner', handler: saveMode },
    { method: 'POST', path: BASE + '/passkey/options', perm: 'owner', handler: pkOptions },
    { method: 'POST', path: BASE + '/passkey/add', perm: 'owner', handler: pkAdd },
    { method: 'POST', path: /^\/admin\/security\/login\/passkey\/(\d+)\/delete$/, perm: 'owner', handler: pkDelete },
    { method: 'POST', path: BASE + '/code', perm: 'owner', handler: makeCode },
  ];
export { verifyPage };

'use strict';
// Admin → নিরাপত্তা → লগইন তালা (owner only):
// passkeys (fingerprint / Windows Hello / phone QR), the owner's face photos, and which of the three ways is used.
// Also builds the "second check" page shown after the owner's password (see admin/index.js → /admin/verify).
const { html, raw, sign, unsign, parseCookies, fmtDate, int } = require('../util');
const db = require('../db');
const ui = require('./ui');
const lock = require('../models/loginlock');
const security = require('../security');
const { ASSET_V } = require('./layout');

const BASE = '/admin/security/login';

// ---------------------------------------------------------------- challenge cookie for this page
function chCookie(ctx, value) {
  const secure = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_ch2=${encodeURIComponent(sign(value, ctx.settings.session_secret))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=300${secure}`;
}
function chValue(ctx) { return unsign(parseCookies(ctx.req.headers.cookie).sm_ch2, ctx.settings.session_secret); }

// ---------------------------------------------------------------- shared camera widget
function camWidget(startLabel) {
  return html`<div class="ll-cam" data-ll-cam>
    <div class="ll-cam-box"><video playsinline muted autoplay></video><div class="ll-ring" data-ll-ring></div>
      <div class="ll-cam-idle" data-ll-idle>📷</div></div>
    <p class="ll-say" data-ll-say aria-live="polite"></p>
    <ol class="ll-steps" data-ll-steps></ol>
    <button type="button" class="btn btn-block btn-lg" data-ll-face-go>${startLabel}</button>
    <p class="small muted center">ভালো আলোতে বসুন, চশমা/মাস্ক খুলে নিন, মুখ গোল দাগের ভেতরে রাখুন।</p>
  </div>`;
}

// ---------------------------------------------------------------- the second-check page (after the password)
function verifyPage({ settings, need, mode, mobile, passed = {}, hasPasskey, otherHosts = [], hasFace, error, blocked }) {
  const steps = mode === 'both' ? (mobile ? 1 : 2) : 1;
  const stepNo = mode === 'both' && passed.passkey ? 2 : 1;
  return html`<div class="auth-card panel ll-verify" data-ll-verify data-need="${need || ''}" data-mode="${mode || ''}"
    data-mobile="${mobile ? '1' : ''}" data-has-passkey="${hasPasskey ? '1' : ''}" data-has-face="${hasFace ? '1' : ''}">
  <p class="logo auth-logo">${settings.store_name}<small> Admin</small></p>
  <h1>🔐 মালিকের দ্বিতীয় যাচাই</h1>
  ${blocked ? html`<p class="form-error">${error}</p><p class="center"><a class="btn btn-block" href="/admin/login">আবার লগইন করুন</a></p>` : html`
  <p class="muted">পাসওয়ার্ড ঠিক আছে ✅ এবার নিজেকে যাচাই করুন।${steps > 1 ? html` <b>ধাপ ${ui.bn(stepNo)} / ${ui.bn(steps)}</b>` : ''}</p>
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

  <section class="ll-part" data-ll-face hidden>
    <h2>🙂 ক্যামেরায় মুখ যাচাই</h2>
    <p class="small">ক্যামেরা চালু হলে যা বলবে তা করুন: <b>চোখের পলক</b> ফেলুন, <b>মাথা বামে</b> আর <b>ডানে</b> ঘোরান। শেষে সোজা তাকান।</p>
    ${camWidget('📷 ক্যামেরা চালু করে যাচাই শুরু করুন')}
  </section>

  <p class="form-error" data-ll-msg hidden></p>
  <p class="center small" data-ll-switch hidden><button type="button" class="link-btn" data-ll-switch-btn></button></p>

  <details class="ll-more">
    <summary>অন্য ঠিকানা থেকে পাওয়া অনুমতি কোড আছে?</summary>
    <form method="post" action="/admin/verify/code" class="form">
      ${ui.field('৮ সংখ্যার অনুমতি কোড', ui.input('code', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, required: true }))}
      <button class="btn btn-ghost btn-block">কোড দিয়ে ঢুকুন</button>
    </form>
  </details>
  <form method="post" action="/admin/verify/cancel" class="center"><button class="link-btn">বাতিল করে লগইন পেজে ফিরুন</button></form>
  <p class="center small"><a href="/admin/reset">ফোন হারিয়েছেন / ক্যামেরা কাজ করছে না?</a></p>`}
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
  const [keys, faces] = await Promise.all([lock.passkeys(u.id), lock.faces(u.id)]);
  const keysHere = keys.filter((k) => k.rp_id === host);
  const ready = {};
  for (const x of lock.MODES) ready[x] = x === 'off' ? null : await lock.readyFor(x, u.id, ctx.req);
  const hasReset = String(process.env.ADMIN_RESET_CODE || '').trim().length >= 12;

  const modeCard = (x, title, lines, rec) => html`<label class="ll-mode ${m === x ? 'is-on' : ''} ${ready[x] ? 'is-off' : ''}">
    <input type="radio" name="mode" value="${x}" ${m === x ? raw('checked') : ''} ${ready[x] && m !== x ? raw('disabled') : ''}>
    <span><b>${title}</b>${rec ? html` <span class="pill pill-green">${rec}</span>` : ''}
      <span class="small muted">${lines}</span>
      ${ready[x] ? html`<span class="small ll-need">⚠️ ${ready[x]}</span>` : ''}</span></label>`;

  const body = html`<h1>🔐 লগইন তালা (আঙুলের ছাপ ও মুখ যাচাই)</h1>${ui.flash(ctx.flash)}${extra.flash ? ui.flash(extra.flash) : ''}
<p class="muted">শুধু <b>মালিকের</b> লগইনে কাজ করে। পাসওয়ার্ড দেওয়ার পরেও আঙুলের ছাপ বা মুখ না মিললে কেউ ঢুকতে পারবে না। স্টাফদের লগইন আগের মতোই থাকবে।</p>

${extra.code ? html`<section class="panel ll-codebox">
  <h2>🔑 এক-বারের অনুমতি কোড</h2>
  <p class="ll-code">${extra.code}</p>
  <p class="small">১৫ মিনিট কাজ করবে, একবারই। নতুন ঠিকানায় পাসওয়ার্ড দেওয়ার পর যাচাই পেজে "অনুমতি কোড আছে?" খুলে এই কোড দিন, তারপর সেখানে নতুন করে পাসকি যোগ করুন। কাউকে দেবেন না।</p>
</section>` : ''}

<section class="panel">
  <h2>এখন চালু: ${m === 'off' ? ui.pill('বন্ধ', 'pill-grey') : ui.pill(lock.MODE_NAMES[m], 'pill-green')}</h2>
  <p class="small muted">নিচের তিন ধাপে সাজানো আছে: আগে পাসকি আর মুখের ছবি যোগ করুন, তারপর পদ্ধতি বেছে নিন।</p>
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

<section class="panel" id="faces">
  <h2>ধাপ ২ · 🙂 মালিকের মুখের ছবি</h2>
  <p class="small">ক্যামেরায় মুখ যাচাইয়ের সময় এই ছবির সাথে মেলানো হয়। <b>ক্যামেরা দিয়ে তোলা ছবি সবচেয়ে ভালো মেলে।</b> চাইলে ২-৩টা ছবি দিন (যেমন একটা চশমাসহ, একটা ছাড়া)। ছবিগুলো এনক্রিপ্ট করে রাখা হয়, শুধু আপনি দেখতে পারবেন।</p>
  ${faces.length ? html`<div class="ll-faces">${faces.map((f) => html`<figure class="ll-face">
      <img src="${BASE}/face/${f.id}" alt="মালিকের মুখের ছবি" loading="lazy">
      <figcaption class="small">${f.source === 'camera' ? '📷 ক্যামেরা' : '🖼️ আপলোড'} · ${fmtDate(f.created_at, false)}</figcaption>
      <form method="post" action="${BASE}/face/${f.id}/delete" data-confirm="এই মুখের ছবি মুছে ফেলবেন?"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form>
    </figure>`)}</div>` : html`<p class="muted">এখনো কোনো মুখের ছবি নেই।</p>`}
  <div class="ll-face-tools" data-ll-face-add>
    <div class="ll-btns">
      <button type="button" class="btn" data-ll-face-camera>📷 ক্যামেরা দিয়ে মুখ যোগ করুন</button>
      <label class="btn btn-ghost">🖼️ ছবি আপলোড করুন<input type="file" accept="image/jpeg,image/png,image/webp" data-ll-face-file hidden></label>
      ${faces.length ? html`<button type="button" class="btn btn-ghost" data-ll-face-test>🧪 মুখ যাচাই পরীক্ষা করুন</button>` : ''}
    </div>
    <div data-ll-face-panel hidden>${camWidget('📷 ক্যামেরা চালু করুন')}</div>
    <p class="small" data-ll-face-note hidden></p>
  </div>
</section>

<section class="panel" id="mode">
  <h2>ধাপ ৩ · কোন পদ্ধতি চালু থাকবে</h2>
  <form method="post" action="${BASE}/mode" class="form ll-modes">
    ${modeCard('off', '⛔ বন্ধ — শুধু পাসওয়ার্ড', 'আগের মতো, শুধু ইউজারনেম আর পাসওয়ার্ড।')}
    ${modeCard('passkey', '১ · শুধু পাসকি', 'মোবাইলে আঙুলের ছাপ। ল্যাপটপে Windows Hello, অথবা ফোন দিয়ে QR স্ক্যান করে ফোনে আঙুল। সবচেয়ে নিরাপদ আর সহজ।', 'সবচেয়ে নিরাপদ')}
    ${modeCard('both', '২ · পাসকি + ক্যামেরায় মুখ যাচাই', 'সব ডিভাইসে আঙুলের ছাপ/পাসকি লাগবে। কম্পিউটার বা ল্যাপটপে তার সাথে ক্যামেরায় মুখ যাচাইও লাগবে (পলক + মাথা ঘোরানো)।', 'আমার পরামর্শ')}
    ${modeCard('split', '৩ · মোবাইলে আঙুল, কম্পিউটারে মুখ', 'মোবাইলে আঙুলের ছাপ চাইবে (ফোনে না থাকলে মুখ)। কম্পিউটার/ল্যাপটপে শুধু ক্যামেরায় মুখ যাচাই।')}
    <p class="small muted">⚠️ ক্যামেরায় মুখ যাচাই ওয়েবসাইটে চলে, তাই ব্যাংকের মতো নিখুঁত না। কম আলো বা দুর্বল ক্যামেরায় মাঝে মাঝে আপনাকেও আটকাতে পারে, আর খুব চালাক কেউ ভিডিও দিয়ে ধোঁকা দেওয়ার চেষ্টা করতে পারে। আঙুলের ছাপ/পাসকি এর চেয়ে অনেক শক্ত।</p>
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
  <h2>🆘 ফোন হারালে / ক্যামেরা নষ্ট হলে</h2>
  <p class="small">লগইন পেজের <b>"পাসওয়ার্ড ভুলে গেছেন?"</b> থেকে গোপন রিসেট কোড দিয়ে নতুন পাসওয়ার্ড দিন, আর <b>"আঙুলের ছাপ / মুখ যাচাই বন্ধ করে দিন"</b> টিক দিন। পরে ঢুকে হারানো ফোনের পাসকি মুছে দিন।</p>
  <p class="small">${hasReset ? html`✅ Vercel-এ <b>ADMIN_RESET_CODE</b> বসানো আছে।` : html`⚠️ Vercel-এ <b>ADMIN_RESET_CODE</b> বসানো নেই। লগইন তালা চালুর আগে এটা বসিয়ে রাখা ভালো, নইলে ফোন হারালে নিজেই আটকে যেতে পারেন।`}</p>
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
  ctx.res.writeHead(303, { Location: BASE + '?msg=saved#mode', 'Cache-Control': 'no-store', 'Set-Cookie': ctx.loginCookie(ctx.user, true) });
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

async function faceAdd(ctx) {
  if (!(await security.hit(db, 'faceadd:' + ctx.user.id, 20, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার করুন।' });
  const b = await ctx.body();
  try {
    await lock.addFace(ctx.user.id, { photo: b.photo, descriptor: b.descriptor, source: b.source });
    await ctx.log('face_add', 'security', ctx.user.id, `মালিকের মুখের ছবি যোগ (${b.source === 'camera' ? 'ক্যামেরা' : 'আপলোড'})`);
    return ctx.json(ctx.res, 200, { ok: true });
  } catch (e) {
    return ctx.json(ctx.res, 400, { error: e.message });
  }
}
async function facePhoto(ctx, m) {
  const buf = await lock.facePhoto(ctx.user.id, int(m[1]));
  if (!buf) return ctx.send(ctx.res, 404, 'Not found', 'text/plain');
  return ctx.send(ctx.res, 200, buf, security.imageKind(buf) || 'image/jpeg', { 'Cache-Control': 'private, no-store' });
}
async function faceDelete(ctx, m) {
  const id = int(m[1]);
  const mode = lock.mode(ctx.settings);
  if (['both', 'split'].includes(mode) && (await lock.faceCount(ctx.user.id)) <= 1) {
    return ctx.fail(BASE, 'এটাই শেষ মুখের ছবি, আর মুখ যাচাই চালু আছে। আগে নতুন ছবি যোগ করুন, অথবা পদ্ধতি বদলান।');
  }
  await db.q('DELETE FROM owner_faces WHERE id=$1 AND staff_id=$2', [id, ctx.user.id]);
  await ctx.log('face_delete', 'security', ctx.user.id, 'মালিকের মুখের ছবি মোছা');
  return ctx.back(BASE, 'saved');
}
async function faceTestOptions(ctx) {
  const steps = lock.faceSteps();
  const ch = lock.newChallenge('ftest', ctx.user.id, steps.join(','));
  return ctx.json(ctx.res, 200, { nonce: ch.challenge, steps }, { 'Set-Cookie': chCookie(ctx, ch.value) });
}
async function faceTest(ctx) {
  const c = lock.readChallenge(chValue(ctx), 'ftest', ctx.user.id);
  const b = await ctx.body();
  if (!c || c.challenge !== b.nonce || !(await lock.useOnce(db, c.challenge))) return ctx.json(ctx.res, 400, { error: 'সময় শেষ, আবার শুরু করুন।' });
  const r = await lock.judgeFace(ctx.user.id, c.extra.split(','), b);
  const score = r.median != null ? Math.max(0, Math.min(100, Math.round((1 - r.median / 0.9) * 100))) : null;
  return ctx.json(ctx.res, 200, { ok: r.ok, reason: r.reason || '', score });
}
async function makeCode(ctx) {
  if (!(await security.hit(db, 'llcode:' + ctx.user.id, 10, 3600))) return ctx.fail(BASE, 'অনেকবার কোড বানানো হয়েছে, একটু পরে চেষ্টা করুন।');
  const code = await lock.makeCode(ctx.user.id);
  await ctx.log('login_code', 'security', ctx.user.id, 'নতুন ঠিকানার জন্য এক-বারের অনুমতি কোড তৈরি');
  return page(ctx, { code: code.replace(/(\d{4})(\d{4})/, '$1 $2') });
}

ui.MESSAGES.bridged = 'অনুমতি কোড দিয়ে ঢুকেছেন। এখন এই ঠিকানার জন্য নিচে নতুন পাসকি যোগ করুন।';

module.exports = {
  verifyPage,
  routes: [
    { method: 'GET', path: BASE, perm: 'owner', handler: (ctx) => page(ctx) },
    { method: 'POST', path: BASE + '/mode', perm: 'owner', handler: saveMode },
    { method: 'POST', path: BASE + '/passkey/options', perm: 'owner', handler: pkOptions },
    { method: 'POST', path: BASE + '/passkey/add', perm: 'owner', handler: pkAdd },
    { method: 'POST', path: /^\/admin\/security\/login\/passkey\/(\d+)\/delete$/, perm: 'owner', handler: pkDelete },
    { method: 'POST', path: BASE + '/face/add', perm: 'owner', handler: faceAdd },
    { method: 'GET', path: /^\/admin\/security\/login\/face\/(\d+)$/, perm: 'owner', handler: facePhoto },
    { method: 'POST', path: /^\/admin\/security\/login\/face\/(\d+)\/delete$/, perm: 'owner', handler: faceDelete },
    { method: 'POST', path: BASE + '/face/test-options', perm: 'owner', handler: faceTestOptions },
    { method: 'POST', path: BASE + '/face/test', perm: 'owner', handler: faceTest },
    { method: 'POST', path: BASE + '/code', perm: 'owner', handler: makeCode },
  ],
};

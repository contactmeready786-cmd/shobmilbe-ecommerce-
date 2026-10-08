'use strict';
// Admin → স্টোর ডিজাইন → ভাষা (বাংলা / English)
//  - one switch turns the English version on/off (the বাংলা | English button next to the cart appears / disappears)
//  - which language a first-time visitor sees
//  - every translated line of the owner's own texts, each one can be corrected by hand
const { html, raw, bn, int, str } = require('../util');
const db = require('../db');
const ui = require('./ui');
const translate = require('../services/translate');

const BASE = '/admin/design/language';
const PER = 40;
const bumpRev = () => db.setSetting('i18n_rev', String(Date.now()).slice(-9));

async function stats(settings) {
  const [all, manual, texts] = await Promise.all([
    db.one('SELECT count(*)::int AS n FROM translations'),
    db.one("SELECT count(*)::int AS n FROM translations WHERE origin = 'manual'"),
    translate.siteTexts(settings).catch(() => []),
  ]);
  let have = 0;
  if (texts.length) {
    const r = await db.one('SELECT count(*)::int AS n FROM translations WHERE hash = ANY($1::text[]) AND en <> \'\'', [texts.map(translate.hash)]);
    have = r ? r.n : 0;
  }
  return { rows: all ? all.n : 0, manual: manual ? manual.n : 0, site: texts.length, siteDone: Math.min(have, texts.length) };
}

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const vals = {
      i18n_on: b.i18n_on ? '1' : '0',
      i18n_default: b.i18n_default === 'en' ? 'en' : 'bn',
      i18n_auto: b.i18n_auto ? '1' : '0',
    };
    const key = String(b.i18n_google_key || '').trim();
    if (b.clear_key) vals.i18n_google_key = '';
    else if (key && !/^•+$/.test(key)) {
      if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) return ctx.fail(BASE, 'Google API key ঠিক নেই (দেখতে এমন হয়: AIzaSy…)।');
      vals.i18n_google_key = key;
    }
    await db.setMany(vals);
    await ctx.reloadSettings();
    await ctx.log('settings', 'design', null, `ইংরেজি অনুবাদ ${vals.i18n_on === '1' ? 'চালু' : 'বন্ধ'} (শুরুর ভাষা: ${vals.i18n_default === 'en' ? 'English' : 'বাংলা'})`);
    return ctx.back(BASE, 'saved');
  }

  const q = str(ctx.query.get('q'), 100);
  const show = ['manual', 'auto'].includes(ctx.query.get('show')) ? ctx.query.get('show') : '';
  const pageNo = Math.max(1, int(ctx.query.get('page')) || 1);
  const where = [];
  const params = [];
  if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); where.push(`(src ILIKE $${params.length} OR en ILIKE $${params.length})`); }
  if (show) { params.push(show); where.push(`origin = $${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [st, count, rows] = await Promise.all([
    stats(s),
    db.one(`SELECT count(*)::int AS n FROM translations ${w}`, params),
    db.q(`SELECT id, src, en, origin, hits FROM translations ${w} ORDER BY (origin = 'manual') DESC, hits DESC, id DESC LIMIT ${PER} OFFSET ${(pageNo - 1) * PER}`, params),
  ]);
  const on = s.i18n_on === '1';
  const listUrl = `${BASE}?${new URLSearchParams({ ...(q ? { q } : {}), ...(show ? { show } : {}) })}`;

  const body = html`<h1>🌐 ভাষা — বাংলা / English</h1>
${ui.flash(ctx.flash)}
<p class="muted">চালু করলে দোকানের উপরে <b>কার্টের পাশে</b> একটা ছোট বাটন আসবে — এক পাশে <b>বাংলা</b>, এক পাশে <b>English</b>।
কাস্টমার যেটায় চাপ দেবেন, পুরো দোকান সাথে সাথে সেই ভাষায় বদলে যাবে — পেজ আবার লোড হয় না, কোনো দেরি হয় না। কাস্টমারের পছন্দ তাঁর ফোন/কম্পিউটারে মনে থাকে।</p>

<div class="two-col">
  <form method="post" action="${BASE}" class="form panel">
    ${ui.switchRow('i18n_on', on, 'ইংরেজি অনুবাদ চালু (বাংলা / English বাটন)', 'বন্ধ করলে বাটনটা দোকান থেকে সরে যাবে, সবাই আগের মতো শুধু বাংলা দেখবেন।')}
    ${ui.field('নতুন কাস্টমার প্রথমে কোন ভাষা দেখবেন', ui.select('i18n_default', [['bn', 'বাংলা (প্রস্তাবিত)'], ['en', 'English']], s.i18n_default === 'en' ? 'en' : 'bn'),
    'কেউ একবার বাটন চাপলে পরের বার থেকে তাঁর বাছাই করা ভাষাই দেখাবে।')}
    ${ui.switchRow('i18n_auto', s.i18n_auto !== '0', 'নতুন লেখা নিজে থেকে অনুবাদ হবে', 'নতুন পণ্য, বিবরণ, ব্যানার, ব্লগ — প্রথমবার কেউ ইংরেজিতে দেখলেই অনুবাদ হয়ে সেভ থাকে, পরে সবাই সাথে সাথে পায়।')}
    <details class="help" ${s.i18n_google_key ? raw('open') : ''}><summary>🔑 Google Cloud Translation API key (ঐচ্ছিক — আরও নির্ভরযোগ্য)</summary><div>
      <p class="small">key ছাড়াও অনুবাদ কাজ করে (Google এর ফ্রি অনুবাদ দিয়ে)। খুব বেশি পণ্য/ভিজিটর হলে Google Cloud থেকে একটা key নিয়ে এখানে দিন —
      মাসে ৫ লাখ অক্ষর পর্যন্ত ফ্রি, এর বেশি হলে খুব সামান্য খরচ। (console.cloud.google.com → Cloud Translation API চালু করুন → Credentials → API key)</p>
      ${ui.field('API key', ui.input('i18n_google_key', s.i18n_google_key ? '••••••••' : '', { type: 'password', autocomplete: 'off', placeholder: s.i18n_google_key ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : 'AIzaSy…' }))}
      ${s.i18n_google_key ? ui.check('clear_key', false, 'key মুছে ফেলুন (ফ্রি অনুবাদে ফিরে যান)') : ''}
    </div></details>
    <button class="btn btn-lg">সেভ করুন</button>
  </form>

  <section class="panel">
    <h2>অনুবাদ কীভাবে হয়</h2>
    <ul class="small">
      <li>✅ দোকানের সব বাটন, মেনু, চেকআউট, মেসেজ — <b>হাতে করা নির্ভুল অনুবাদ</b> (মেশিন না)।</li>
      <li>📦 আপনার লেখা পণ্যের নাম, বিবরণ, ক্যাটাগরি, ব্যানার, ব্লগ, নোটিশ — একবার অনুবাদ হয়ে <b>সেভ থাকে</b>, নিচের তালিকায় দেখতে ও ঠিক করতে পারবেন। আপনার ঠিক করা লাইন কখনো বদলাবে না।</li>
      <li>🔢 দাম, সংখ্যা, তারিখ, সময় ইংরেজি অঙ্কে দেখাবে (৳১২০ → ৳120)।</li>
      <li>🔒 কাস্টমারের নাম, ফোন নম্বর, ঠিকানা কখনো অনুবাদ বা কোথাও পাঠানো হয় না।</li>
      <li>⚡ সাইট ভারী হয় না: ইংরেজি দেখাতে আলাদা পেজ লোড হয় না, শুধু লেখা বদলায়।</li>
    </ul>
    <h2>দোকানের লেখার অনুবাদ</h2>
    <p data-i18n-progress>${st.site ? html`${bn(st.siteDone)} / ${bn(st.site)} টি লেখা অনুবাদ হয়ে আছে${st.siteDone >= st.site ? ' ✅' : ''}` : 'এখনো কোনো লেখা নেই।'}</p>
    ${st.site > st.siteDone ? html`<p class="small muted">বাকিগুলো কেউ ইংরেজিতে দেখলে নিজে থেকেই হবে। চাইলে এখনই একবারে করে রাখুন — তাহলে প্রথম কাস্টমারও সাথে সাথে পাবেন।</p>` : ''}
    <button type="button" class="btn" data-i18n-fill ${st.site > st.siteDone ? '' : raw('disabled')}>⚡ এখনই সব অনুবাদ করে রাখুন</button>
    <p class="small muted">পণ্যের নাম, ক্যাটাগরি, ব্র্যান্ড, ব্যানার, ব্লগের শিরোনাম, পেজ, নোটিশ ও মেনু। (লম্বা বিবরণ প্রথমবার খোলার সময় অনুবাদ হয়।)</p>
    <p class="small">${on ? html`<a href="/?lang=en" target="_blank" rel="noopener">দোকান ইংরেজিতে দেখুন ↗</a>` : html`<span class="muted">চালু করার পর দোকান ইংরেজিতে দেখতে পারবেন।</span>`}</p>
  </section>
</div>

<section class="panel">
  <h2>অনুবাদের তালিকা <small>${bn(st.rows)}টি লাইন · হাতে ঠিক করা ${bn(st.manual)}টি</small></h2>
  <p class="small muted">কোনো অনুবাদ পছন্দ না হলে ডান পাশে ঠিক করে "সেভ" চাপুন — সাথে সাথে দোকানে বদলে যাবে। যেগুলো বেশি দেখা হয় সেগুলো উপরে।</p>
  <form method="get" action="${BASE}" class="toolbar filters">
    <input type="search" name="q" value="${q}" placeholder="বাংলা বা ইংরেজি লিখে খুঁজুন">
    ${ui.select('show', [['', 'সব'], ['manual', 'শুধু হাতে ঠিক করা'], ['auto', 'শুধু মেশিনে অনুবাদ']], show)}
    <button class="btn btn-sm">খুঁজুন</button>
  </form>
  ${rows.length ? html`<div class="table-wrap"><table class="i18n-table">
    <thead><tr><th>বাংলা (আপনার লেখা)</th><th>English</th><th></th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td class="i18n-src">${r.src.length > 400 ? r.src.slice(0, 400) + '…' : r.src}<br><span class="small muted">${r.origin === 'manual' ? '✍️ হাতে ঠিক করা' : '🤖 মেশিন'} · ${bn(r.hits)} বার দেখা</span></td>
      <td><form method="post" action="${BASE}/edit" class="i18n-edit" id="i18n-${r.id}">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="back" value="${listUrl}&page=${pageNo}">
        <textarea name="en" rows="${Math.min(6, Math.max(1, Math.ceil(r.en.length / 60)))}" maxlength="${translate.MAX_LEN * 2}" lang="en">${r.en}</textarea>
      </form></td>
      <td class="prod-actions"><button class="btn btn-sm" form="i18n-${r.id}">সেভ</button>
        <form method="post" action="${BASE}/redo"><input type="hidden" name="id" value="${r.id}"><input type="hidden" name="back" value="${listUrl}&page=${pageNo}">
        <button class="btn btn-sm btn-ghost" title="মেশিন দিয়ে আবার অনুবাদ করুন">↻ আবার</button></form></td>
    </tr>`)}</tbody></table></div>
    ${ui.pager(count ? count.n : 0, pageNo, PER, listUrl)}`
    : ui.empty(q || show ? 'এই খোঁজে কিছু পাওয়া যায়নি।' : 'এখনো কোনো অনুবাদ নেই। উপরের "এখনই সব অনুবাদ করে রাখুন" চাপুন, অথবা দোকান ইংরেজিতে খুললেই তৈরি হবে।')}
</section>

<section class="panel">
  <h2>➕ নিজে একটা অনুবাদ বসান</h2>
  <p class="small muted">দোকানের কোনো লেখার ইংরেজি আপনার মনমতো না হলে (বাটন, মেনু — যেকোনো লেখা) বাংলাটা হুবহু লিখে তার ইংরেজি দিন। এটা সবকিছুর উপরে কাজ করবে।</p>
  <form method="post" action="${BASE}/add" class="form">
    <div class="field-row">
      ${ui.field('বাংলা লেখা (দোকানে যেভাবে আছে)', ui.textarea('src', '', { rows: 2, maxlength: translate.MAX_LEN, required: true, placeholder: 'যেমন: কার্টে যোগ করুন' }))}
      ${ui.field('English', ui.textarea('en', '', { rows: 2, maxlength: translate.MAX_LEN * 2, required: true, placeholder: 'e.g. Add to Cart', lang: 'en' }))}
    </div>
    <button class="btn">যোগ করুন</button>
  </form>
</section>`;
  return ctx.page('ভাষা (বাংলা / English)', body, 'language');
}

function backTo(b) { const v = str(b.back, 400); return v.startsWith(BASE) ? v : BASE; }

async function edit(ctx) {
  const b = await ctx.body();
  const id = int(b.id);
  const en = String(b.en || '').replace(/\s+/g, ' ').trim().slice(0, translate.MAX_LEN * 2);
  const row = await db.one('SELECT id, src FROM translations WHERE id = $1', [id]);
  if (!row) return ctx.fail(BASE, 'লাইনটি পাওয়া যায়নি।');
  if (!en) return ctx.fail(backTo(b), 'ইংরেজি লেখা খালি রাখা যাবে না। মেশিনের অনুবাদ ফেরত চাইলে "↻ আবার" চাপুন।');
  await db.q("UPDATE translations SET en = $2, origin = 'manual', updated_at = now() WHERE id = $1", [id, en]);
  await bumpRev();
  await ctx.log('edit', 'translation', id, `অনুবাদ ঠিক করা: ${row.src.slice(0, 60)} → ${en.slice(0, 60)}`);
  return ctx.back(backTo(b), 'saved');
}

async function redo(ctx) {
  const b = await ctx.body();
  let en = null;
  try { en = await translate.retranslate(int(b.id), ctx.settings); } catch (e) { en = ''; }
  if (en === null) return ctx.fail(BASE, 'লাইনটি পাওয়া যায়নি।');
  if (!en) return ctx.fail(backTo(b), 'অনুবাদের সার্ভার এই মুহূর্তে সাড়া দিচ্ছে না, একটু পরে চেষ্টা করুন।');
  await bumpRev();
  await ctx.log('edit', 'translation', int(b.id), 'মেশিন দিয়ে আবার অনুবাদ');
  return ctx.back(backTo(b), 'saved');
}

async function add(ctx) {
  const b = await ctx.body();
  const src = translate.norm(b.src).slice(0, translate.MAX_LEN);
  const en = translate.norm(b.en).slice(0, translate.MAX_LEN * 2);
  if (!src || !en) return ctx.fail(BASE, 'বাংলা আর ইংরেজি দুটোই লিখুন।');
  if (!translate.hasBangla(src)) return ctx.fail(BASE, 'প্রথম ঘরে দোকানে যেভাবে আছে সেই বাংলা লেখাটা দিন।');
  await translate.save(src, en, 'manual');
  await bumpRev();
  await ctx.log('add', 'translation', null, `অনুবাদ যোগ: ${src.slice(0, 60)} → ${en.slice(0, 60)}`);
  return ctx.back(`${BASE}?q=${encodeURIComponent(src.slice(0, 60))}`, 'added');
}

// "এখনই সব অনুবাদ করে রাখুন": the browser calls this again and again until nothing is left.
async function fill(ctx) {
  const r = await translate.fillBatch(ctx.settings, 50);
  return ctx.json(ctx.res, 200, r);
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'design', handler: page },
    { method: 'POST', path: BASE + '/edit', perm: 'design', handler: edit },
    { method: 'POST', path: BASE + '/redo', perm: 'design', handler: redo },
    { method: 'POST', path: BASE + '/add', perm: 'design', handler: add },
    { method: 'POST', path: BASE + '/fill', perm: 'design', handler: fill },
  ],
};

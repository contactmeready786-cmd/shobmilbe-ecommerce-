'use strict';
// Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে: one page with an on/off switch for every part of the shop
// (with a line on what it does) and small boxes for the texts on those parts. Switches save at once.
const { html, raw, str } = require('../util');
const db = require('../db');
const ui = require('./ui');
const U = require('../services/uiswitch');

const BASE = '/admin/design/switches';
const HOME_LABELS = {
  slider: 'বড় ব্যানার স্লাইডার', trust: 'ভরসার বার (ডেলিভারি, ক্যাশ অন ডেলিভারি, রিটার্ন)', categories: 'ক্যাটাগরি বক্স', flash: '⚡ ফ্ল্যাশ সেল',
  new: 'নতুন এসেছে', offers: 'অফারে আছে', bestsellers: 'সবচেয়ে বেশি বিক্রি', popular: 'সবাই দেখছে', promo: 'মাঝের ছোট ব্যানার',
  cat_rows: 'ক্যাটাগরি অনুযায়ী পণ্যের সারি', budget: '৳১০০ এর মধ্যে', featured: 'আমাদের বাছাই', blog: 'ব্লগ পোস্ট',
};

function switchForm(action, on, label) {
  return html`<form method="post" action="${action}" class="prod-toggle" data-on="${label}: চালু — দোকানে দেখাচ্ছে" data-off="${label}: বন্ধ — দোকানে লুকানো">
    <label class="switch" title="${label}"><input type="checkbox" name="active" value="1" ${on ? raw('checked') : ''} data-prod-toggle aria-label="${label}"><span class="switch-ui" aria-hidden="true"></span></label>
    <span class="small prod-toggle-text" data-prod-toggle-text>${on ? 'চালু' : 'বন্ধ'}</span><noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript></form>`;
}
function textForm(s, key, t) {
  const cur = typeof s[key] === 'string' ? s[key] : '';
  return html`<form method="post" action="${BASE}/text" class="ui-text" data-ui-text>
    <input type="hidden" name="key" value="${key}">
    <label class="small muted">${t.label}</label>
    <span class="ui-text-row"><input name="value" value="${cur}" maxlength="${t.max || 120}" placeholder="${t.ph || t.def || ''}">
    <button class="btn btn-sm btn-ghost">সেভ</button></span>
    ${t.def ? html`<span class="small muted">খালি রাখলে: "${t.def}"</span>` : ''}
  </form>`;
}

async function page(ctx) {
  const s = ctx.settings;
  const home = db.jsonSetting(s, 'home_sections', []);
  const row = (it) => html`<li class="ui-row ${it.key && !U.on(s, it.key) ? 'row-off' : ''}">
    <div class="ui-row-main">
      <div class="ui-row-text"><b>${it.label}</b><span class="small muted">${it.desc}</span></div>
      ${it.link ? html`<a class="btn btn-sm btn-ghost" href="${it.link}">ওখানে যান →</a>` : switchForm(`${BASE}/toggle/${it.key}`, U.on(s, it.key), it.label)}
    </div>
    ${it.text ? textForm(s, it.text.key, it.text) : ''}
  </li>`;
  const LBL = { ...HOME_LABELS, ...(await require('./homerows').allLabels()).labels };
  for (const k of Object.keys(HOME_LABELS)) LBL[k] = HOME_LABELS[k];
  const allHome = [...home, ...Object.keys(LBL).filter((k) => !home.includes(k))].filter((k) => LBL[k]);
  const body = html`<h1>👁️ দোকানে কী দেখাবে</h1>${ui.flash(ctx.flash)}
<p class="muted">দোকানের প্রতিটা অংশ এখান থেকে চালু/বন্ধ করুন — সুইচ টিপলেই সাথে সাথে সেভ হয়, দোকানে কয়েক সেকেন্ডের মধ্যে বদলে যায়। লেখা বদলাতে ঘরে লিখে "সেভ" চাপুন। দাম, "কার্টে যোগ করুন", ঠিকানা আর অর্ডার কনফার্মের বাটন সবসময় চালু থাকে, যাতে ভুল করে অর্ডার বন্ধ না হয়ে যায়।</p>
<nav class="chips ui-jump">${U.GROUPS.filter((g) => !g.hidden).map((g) => html`<a class="chip" href="#g-${g.id}">${g.title}</a>`)}<a class="chip" href="#g-home">🏠 হোমপেজ</a></nav>
<div class="ui-groups">
${U.GROUPS.filter((g) => !g.hidden).slice(0, 1).map((g) => html`<section class="panel ui-group" id="g-${g.id}"><h2>${g.title}</h2><ul class="ui-list">${g.items.filter((i) => !i.hidden).map(row)}</ul></section>`)}
<section class="panel ui-group" id="g-home"><h2>🏠 হোমপেজের সারি</h2>
  <p class="small muted">সারিগুলোর ক্রম (কোনটা আগে) বদলাতে <a href="/admin/design">লোগো, রং ও হোমপেজ</a> পেজে যান।</p>
  <ul class="ui-list">${allHome.map((k) => html`<li class="ui-row ${home.includes(k) ? '' : 'row-off'}">
    <div class="ui-row-main"><div class="ui-row-text"><b>${LBL[k]}</b>${/^x\d+$/.test(k) ? html` <a class="small" href="/admin/design/rows/${k.slice(1)}">✏️ এডিট</a>` : ''}${k === 'flash' ? html`<span class="small muted">কোনো ফ্ল্যাশ সেল চলার সময়ই শুধু দেখায়; নাম আসে সেলের নাম থেকে।</span>` : ''}</div>
      ${switchForm(`${BASE}/home/${k}`, home.includes(k), LBL[k])}</div>
    ${U.HOME_TEXTS[k] && U.HOME_TEXTS[k].title ? textForm(s, `uit_home_${k}`, U.TEXTS.get(`uit_home_${k}`)) : ''}
    ${U.HOME_TEXTS[k] && U.HOME_TEXTS[k].sub && k !== 'flash' ? textForm(s, `uit_home_${k}_sub`, U.TEXTS.get(`uit_home_${k}_sub`)) : ''}
  </li>`)}</ul>
</section>
${U.GROUPS.filter((g) => !g.hidden).slice(1).map((g) => html`<section class="panel ui-group" id="g-${g.id}"><h2>${g.title}</h2><ul class="ui-list">${g.items.filter((i) => !i.hidden).map(row)}</ul></section>`)}
</div>`;
  return ctx.page('দোকানে কী দেখাবে', body, 'ui-switches');
}

// The switch (and its text box) for a shop part shown on that part's own admin page (restock, Q&A …).
// It saves the moment it is clicked, the same way as on "দোকানে কী দেখাবে".
function featureRows(ctx, keys) {
  if (!ctx.can('design')) return '';
  const s = ctx.settings;
  const items = keys.map((k) => U.GROUPS.flatMap((g) => g.items).find((i) => i.key === k)).filter(Boolean);
  return html`<section class="panel"><ul class="ui-list">${items.map((it) => html`<li class="ui-row ${!U.on(s, it.key) ? 'row-off' : ''}">
    <div class="ui-row-main"><div class="ui-row-text"><b>${it.label}</b><span class="small muted">${it.desc}</span></div>${switchForm(`${BASE}/toggle/${it.key}`, U.on(s, it.key), it.label)}</div>
    ${it.text ? textForm(s, it.text.key, it.text) : ''}</li>`)}</ul></section>`;
}

function done(ctx, ok, msg) {
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ctx.res, ok ? 200 : 400, ok ? { ok: true } : { error: msg });
  return ok ? ctx.back(BASE, 'saved') : ctx.fail(BASE, msg);
}
async function toggle(ctx, m) {
  const key = m[1];
  if (!U.KEYS.has(key)) return done(ctx, false, 'অজানা সুইচ।');
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  await db.setSetting(key, on ? '1' : '0');
  await ctx.log('settings', 'design', null, `দোকানে কী দেখাবে: ${key} ${on ? 'চালু' : 'বন্ধ'}`);
  return done(ctx, true);
}
async function homeToggle(ctx, m) {
  const key = m[1];
  const LBL = (await require('./homerows').allLabels()).labels;
  if (!LBL[key]) return done(ctx, false, 'অজানা সারি।');
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const list = db.jsonSetting(ctx.settings, 'home_sections', []).filter((k) => LBL[k] && k !== key);
  if (on) {
    // back in its usual place: just after the row that comes before it in the default order
    const order = Object.keys(HOME_LABELS);
    let at = list.length;
    for (let i = order.indexOf(key) - 1; i >= 0; i--) { const j = list.indexOf(order[i]); if (j >= 0) { at = j + 1; break; } }
    if (order.indexOf(key) === 0) at = 0;
    list.splice(at, 0, key);
  }
  await db.setSetting('home_sections', JSON.stringify(list));
  await ctx.log('settings', 'design', null, `হোমপেজের সারি "${LBL[key]}" ${on ? 'চালু' : 'বন্ধ'}`);
  return done(ctx, true);
}
async function saveText(ctx) {
  const b = await ctx.body();
  const key = String(b.key || '');
  const t = U.TEXTS.get(key);
  if (!t) return done(ctx, false, 'অজানা লেখা।');
  const v = str(b.value, t.max || 120);
  await db.setSetting(key, v);
  await ctx.log('settings', 'design', null, `দোকানের লেখা বদল (${key}): ${v || '(আগের মতো)'}`);
  return done(ctx, true);
}

module.exports = {
  featureRows,
  routes: [
    { method: 'GET', path: BASE, perm: 'design', handler: page },
    { method: 'POST', path: /^\/admin\/design\/switches\/toggle\/([a-z0-9_]+)$/, perm: 'design', handler: toggle },
    { method: 'POST', path: /^\/admin\/design\/switches\/home\/([a-z0-9_]+)$/, perm: 'design', handler: homeToggle },
    { method: 'POST', path: `${BASE}/text`, perm: 'design', handler: saveText },
  ],
};

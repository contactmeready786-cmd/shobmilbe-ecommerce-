// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → মার্কেটিং → ভিজিটর অ্যানালিটিক্স
// Overview (how many, from where, what they look at), live visitors, every visit with its full journey, and settings.
import { html, raw, bn, money, fmtDate, str, dateRange, pageNum, pct } from '../util';
import * as db from '../db';
import * as V from '../services/visitors';
import * as ui from './ui';
import * as charts from './charts';
import * as $services_geolock from '../services/geolock';

const BASE = '/admin/marketing/visitors';
const PER_PAGE = 50;
const COUNTRY_PATH = `${BASE}/countries`;
const DEVICES = { mobile: ['📱', 'মোবাইল'], desktop: ['💻', 'কম্পিউটার'], tablet: ['📲', 'ট্যাবলেট'] };
const EVENT_LABELS = {
  add_to_cart: ['🛒', 'কার্টে যোগ করেছে'], begin_checkout: ['🧾', 'চেকআউট শুরু করেছে'], purchase: ['✅', 'অর্ডার করেছে'],
  search: ['🔎', 'খুঁজেছে'], contact: ['📞', 'যোগাযোগ বাটনে চাপ দিয়েছে'],
};

// ---------------------------------------------------------------- small helpers
function dur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return bn(s) + ' সে';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মি' + (s % 60 ? ' ' + bn(s % 60) + ' সে' : '');
  return bn(Math.floor(s / 3600)) + ' ঘ ' + bn(Math.floor((s % 3600) / 60)) + ' মি';
}
function ago(d) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return fmtDate(d);
}
function device(d) { const x = DEVICES[d] || ['🖥️', d || 'অজানা']; return html`<span title="${x[1]}">${x[0]} ${x[1]}</span>`; }
function where(row) {
  const p = V.place(row);
  return html`<span class="va-place" title="${p.country}">${p.flag} ${p.text}</span>${netBadge(row)}${row.suspicious ? html` <a class="pill pill-red va-alert" href="/admin/security/threats?ip=${encodeURIComponent(row.ip)}" title="এই IP থেকে সাইটের ক্ষতি করার চেষ্টা হয়েছে — দেখুন">🚨 সন্দেহজনক</a>` : ''}`;
}
// 🛡️ = foreign IP but the phone's clock is set to Bangladesh (VPN/proxy); 🌍 = really abroad
const NET = {
  vpn: ['🛡️', 'VPN / প্রক্সি', 'IP বিদেশের, কিন্তু ফোন/কম্পিউটারের ঘড়ি বাংলাদেশের সময়ে — সম্ভবত বাংলাদেশ থেকেই VPN বা প্রক্সি দিয়ে এসেছে', 'pill-amber'],
  abroad: ['🌍', 'বিদেশ থেকে', 'IP আর ঘড়ি দুটোই বিদেশের — দেশের বাইরে থেকে এসেছে', 'pill-blue'],
};
function netBadge(row) {
  const n = NET[row.net];
  return n ? html` <span class="pill ${n[3]}" title="${n[2]}">${n[0]} ${n[1]}</span>` : '';
}
// the delivery address the visitor gave when ordering (this visit or an earlier one)
function orderAddr(row, long) {
  const parts = [row.o_thana, row.o_district].filter(Boolean).join(', ');
  const addr = String(row.o_address || '');
  if (!parts && !addr) return '';
  const text = long ? [addr, parts].filter(Boolean).join(', ') : parts || (addr.length > 40 ? addr.slice(0, 40) + '…' : addr);
  return html`<br><small class="va-addr" translate="no" title="${addr}">🏠 ${text}</small>`;
}
function phoneName(row) {
  const brand = row.brand || '';
  const model = row.model || '';
  // "Apple" + "iPhone 13" → "iPhone 13"; "Samsung" + "SM-A536E" → "Samsung SM-A536E"; "Xiaomi" + "Redmi Note 12" → as is
  if (brand === 'Apple' && /^(iPhone|iPad|Mac)/.test(model)) return model;
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  return [brand, model].filter(Boolean).join(' ');
}
function deviceCell(row, extra) {
  const name = phoneName(row);
  return html`${device(row.device)}${name ? html`<br><b class="small" translate="no">${name}</b>` : ''}<br><small class="muted">${row.browser}${extra ? ' · ' + row.os : ''}</small>`;
}
function pageName(path, title, settings) {
  const store = settings.store_name || '';
  let t = String(title || '').replace(new RegExp('\\s*\\|\\s*' + store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$'), '').trim();
  const p = String(path || '');
  if (p === '/') t = 'হোমপেজ';
  else if (p === '/cart') t = 'কার্ট';
  else if (p.startsWith('/checkout')) t = 'চেকআউট';
  else if (p.startsWith('/order/')) t = 'অর্ডার সম্পন্ন (ধন্যবাদ পেজ)';
  else if (p.startsWith('/track')) t = 'অর্ডার ট্র্যাক';
  return t || p;
}
function pageCell(path, title, settings) {
  return html`<a href="${path}" target="_blank" rel="noopener" class="va-page"><b>${pageName(path, title, settings)}</b><small>${decodeSafe(path)}</small></a>`;
}
function decodeSafe(p) { try { return decodeURI(p); } catch (_) { return p; } }
function sourcePill(row) {
  const cls = { social: 'pill-blue', organic: 'pill-green', cpc: 'pill-amber', paid: 'pill-amber', referral: '', direct: 'pill-grey' }[row.medium] || '';
  return html`<span class="pill ${cls}" title="${row.medium || ''}${row.campaign ? ' · ' + row.campaign : ''}">${row.source || 'অজানা'}</span>`;
}
function who(row) {
  if (row.visitor_name || row.visitor_phone) return html`<span class="va-who">👤 <b>${row.visitor_name || ''}</b> ${row.visitor_phone ? html`<small>${row.visitor_phone}</small>` : ''}</span>`;
  return html`<span class="muted small">${row.total_visits > 1 ? `পুরনো ভিজিটর · ${bn(row.total_visits)}বার এসেছে` : (row.is_new ? 'নতুন ভিজিটর' : 'পুরনো ভিজিটর')}</span>`;
}
function rate(a, b) { return b ? pct((100 * a) / b) : '—'; }

function tabs(active, live) {
  const items = [['', '📊 সারাংশ'], ['live', `🟢 এখন লাইভ${live !== undefined ? ` (${bn(live)})` : ''}`], ['sessions', '🧭 সব ভিজিট'], ['countries', '🌍 দেশ ব্লক'], ['settings', '⚙️ সেটিংস']];
  return html`<nav class="tabs va-tabs">${items.map(([k, l]) => html`<a class="tab ${active === k ? 'on' : ''}" href="${k === 'countries' ? COUNTRY_PATH : BASE + (k ? '?tab=' + k : '')}">${l}</a>`)}</nav>`;
}
function rangeChips(from, to, extra = '') {
  const presets = [[1, 'আজ'], [7, '৭ দিন'], [30, '৩০ দিন'], [90, '৯০ দিন']];
  return html`<form class="date-filter" method="get" action="${BASE}">
    ${raw(extra)}
    <div class="chips">${presets.map(([d, l]) => html`<a class="chip" href="${BASE}?days=${d}">${l}</a>`)}</div>
    <label>থেকে <input type="date" name="from" value="${from}"></label>
    <label>পর্যন্ত <input type="date" name="to" value="${to}"></label>
    <button class="btn btn-sm">দেখুন</button>
  </form>`;
}
function offNotice(settings) {
  return settings.visitor_tracking === '0'
    ? html`<p class="flash flash-error">ভিজিটর ট্র্যাকিং এখন <b>বন্ধ</b> আছে, তাই নতুন তথ্য জমা হচ্ছে না। <a href="${BASE}?tab=settings">সেটিংস থেকে চালু করুন</a>।</p>` : '';
}

// ---------------------------------------------------------------- overview
// 🔄 Owner-only: start counting from zero (e.g. after own/test visits). Shown on the main page and in settings.
function resetBox(ctx) {
  if (ctx.user.role !== 'owner') return '';
  const at = ctx.settings.analytics_reset_at;
  return html`<form method="post" action="${BASE}/clear" class="reset-box" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 14px"
    data-confirm="সব হিসাব শূন্য করবেন? এখন পর্যন্ত সব ভিজিট, পেজ ভিউ, ক্লিক, সার্চ আর লাইভ স্কোরের ক্লিকের হিসাব মুছে যাবে, আর এখন থেকে নতুন করে গোনা শুরু হবে। এটা আর ফেরত আনা যাবে না। (অর্ডার, কাস্টমার, পণ্য, টাকার হিসাব কিছুই মুছবে না।)">
    <button class="btn btn-danger btn-sm">🔄 সব হিসাব শূন্য করুন</button>
    <span class="muted small">${at ? html`শেষবার শূন্য করা হয়েছে: ${fmtDate(at)} — হিসাব তখন থেকে।` : 'নিজের বা টেস্টের ভিজিট বাদ দিয়ে নতুন করে গুনতে চাইলে।'}</span>
  </form>`;
}

async function overviewPage(ctx) {
  const { from, to } = dateRange(ctx.query, 7);
  const d = await V.overview(from, to);
  const k = d.k;
  const s = ctx.settings;
  const f = d.funnel;
  const daily = d.daily.map((r) => ({ label: charts.dayLabel(r.day), bar: r.visitors, line: r.pageviews }));
  const body = html`<div class="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>
${tabs('', d.live)}
${ui.flash(ctx.flash)}${offNotice(s)}
${resetBox(ctx)}
${rangeChips(from, to)}
<p class="muted small">${fmtDate(from + 'T00:00:00+06:00', false)} থেকে ${fmtDate(to + 'T00:00:00+06:00', false)} পর্যন্ত (বাংলাদেশ সময়)</p>
<div class="kpis kpis-tight">
  ${ui.kpi('এখন সাইটে আছে', html`<span class="live-dot"></span>${bn(d.live)} জন`, `গত ${bn(V.LIVE_MINUTES)} মিনিটে সক্রিয়`, 'kpi-green', `${BASE}?tab=live`)}
  ${ui.kpi('ভিজিটর (আলাদা মানুষ)', bn(k.visitors), `নতুন ${bn(k.new_visitors)} জন`)}
  ${ui.kpi('ভিজিট (সেশন)', bn(k.sessions), `প্রতি ভিজিটে গড়ে ${bn(k.sessions ? (k.pageviews / k.sessions).toFixed(1) : 0)} পেজ`)}
  ${ui.kpi('পেজ দেখা হয়েছে', bn(k.pageviews), '')}
  ${ui.kpi('গড় সময় সাইটে', dur(k.avg_duration), 'প্রতি ভিজিটে')}
  ${ui.kpi('বাউন্স রেট', rate(k.bounces, k.sessions), 'এক পেজ দেখেই চলে গেছে')}
  ${ui.kpi('বিদেশ / VPN', html`🌍 ${bn(d.net.abroad)} · 🛡️ ${bn(d.net.vpn)}`, `বাংলাদেশ থেকে ${bn(d.net.bd)}টি ভিজিট`, '', `${BASE}?tab=sessions&net=vpn&from=${from}&to=${to}`)}
  ${ui.kpi('অর্ডার হয়েছে', bn(k.orders), `কনভার্সন ${rate(k.orders, k.sessions)}`, 'kpi-blue', `${BASE}?tab=sessions&ordered=1&from=${from}&to=${to}`)}
</div>

<div class="va-grid va-grid-2-1">
<section class="panel"><h2>প্রতিদিনের ভিজিটর</h2>
  ${charts.combo(daily, { barName: 'ভিজিটর', lineName: 'পেজ ভিউ', lineMoney: false, height: 190 })}
</section>
  <section class="panel"><h2>কেনাকাটার ধাপ (ফানেল)</h2>
    <p class="muted small">কতজন কোন ধাপ পর্যন্ত গেছে — কোথায় বেশি মানুষ থেমে যাচ্ছে বুঝতে পারবেন।</p>
    ${funnel([['সাইটে এসেছে', f.all_sessions], ['পণ্য দেখেছে', f.viewed], ['কার্টে যোগ করেছে', f.carted], ['চেকআউটে গেছে', f.checkout], ['অর্ডার করেছে', f.ordered]])}
  </section>
</div>

<div class="va-grid va-grid-3">
  <section class="panel"><h2>কোথা থেকে এসেছে</h2>
    ${charts.donut(d.sources.map((r) => ({ label: r.source, value: r.n })), { centerSub: 'ভিজিট' })}
    ${d.sources.some((r) => r.orders) ? html`<p class="small muted">অর্ডার: ${d.sources.filter((r) => r.orders).map((r) => `${r.source} ${bn(r.orders)}টি`).join(' · ')}</p>` : ''}
  </section>
  <section class="panel"><h2>📍 লোকেশন (শহর / জেলা)</h2>
    ${d.cities.length && d.cities.some((c) => c.country) ? charts.hbars(d.cities.map((c) => ({ label: `${V.flag(c.country)} ${V.place(c).text}`, value: c.n, sub: `${bn(c.visitors)} জন` })), { color: 2 })
    : html`<p class="muted">লোকেশন এখনো পাওয়া যায়নি। সাইট Vercel-এ চালু থাকলে নিজে থেকেই আসবে (লোকাল কম্পিউটারে লোকেশন দেখায় না)।</p>`}
    ${d.regions.length ? html`<h3 class="h3">বিভাগ / জেলা অনুযায়ী</h3>${charts.hbars(d.regions.map((r) => ({ label: V.regionName(r.country, r.region) || r.region, value: r.n })), { color: 4 })}` : ''}
    ${d.countries.length > 1 ? html`<h3 class="h3">দেশ</h3>${charts.hbars(d.countries.map((c) => ({ label: `${V.flag(c.country)} ${V.countryName(c.country)}`, value: c.n })), { color: 5 })}` : ''}
  </section>
  <section class="panel"><h2>⏰ কোন সময়ে বেশি আসে</h2>
    ${charts.hours(d.hours, 'টি ভিজিট')}
    <p class="muted small">ঘর যত গাঢ়, সেই ঘণ্টায় তত বেশি ভিজিটর। বিজ্ঞাপন বা পোস্ট দেওয়ার ভালো সময় বুঝতে কাজে লাগবে।</p>
    <h3 class="h3">ডিভাইস</h3>
    ${charts.donut(d.devices.map((r) => ({ label: (DEVICES[r.device] || ['', r.device])[1], value: r.n })), { centerSub: 'ভিজিট' })}
  </section>
</div>

<div class="va-grid va-grid-2">
<section class="panel"><h2>সবচেয়ে বেশি দেখা পেজ</h2>
  ${d.pages.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>পেজ</th><th class="num">দেখা হয়েছে</th><th class="num">ভিজিট</th><th class="num">গড় সময়</th></tr></thead>
  <tbody>${d.pages.map((p) => html`<tr><td>${pageCell(p.path, p.title, s)}</td><td class="num">${bn(p.views)}</td><td class="num">${bn(p.visits)}</td><td class="num">${dur(p.avg_time)}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কোনো ডাটা নেই।</p>`}
</section>
<section class="panel"><h2>কোন পণ্য বেশি দেখছে</h2>
  ${d.products.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>পণ্য</th><th class="num">দেখা হয়েছে</th><th class="num">কতজন দেখেছে</th><th class="num">গড় সময়</th><th class="num">কার্টে যোগ</th><th class="num">কার্ট রেট</th></tr></thead>
  <tbody>${d.products.map((p) => html`<tr><td><a href="/admin/products/${p.id}">${p.name}</a></td><td class="num">${bn(p.views)}</td><td class="num">${bn(p.viewers)}</td><td class="num">${dur(p.avg_time)}</td><td class="num">${bn(p.carts)}</td><td class="num">${rate(p.carts, p.viewers)}</td></tr>`)}</tbody></table></div>
  <p class="muted small">অনেকে দেখছে কিন্তু কার্টে কম যোগ করছে? দাম, ছবি বা বিবরণ আরেকবার দেখুন।</p>`
    : html`<p class="muted">এখনো কোনো পণ্য দেখা হয়নি।</p>`}
</section>
</div>

<details class="panel va-more">
  <summary>📱 মোবাইল, মডেল, ব্রাউজার আর রেফারার — বিস্তারিত দেখুন</summary>
  <div class="va-grid va-grid-2">
  <section class="panel"><h2>📱 মোবাইলের কোম্পানি</h2>
    ${d.brands.length ? charts.hbars(d.brands.map((r) => ({ label: r.brand, value: r.n })), { color: 4 }) : html`<p class="muted">এখনো কোনো ডাটা নেই।</p>`}
  </section>
  <section class="panel"><h2>📱 কোন মডেল</h2>
    ${d.models.length ? charts.hbars(d.models.map((r) => ({ label: phoneName(r), value: r.n })), { color: 6 }) : html`<p class="muted">এখনো কোনো ডাটা নেই।</p>`}
    <p class="muted small">Android ফোনের মডেল ফোন নিজেই জানায় (যেমন SM-A536E = Samsung Galaxy A53)। iPhone মডেল জানায় না, তাই স্ক্রিনের মাপ দেখে আনুমানিক বলা হয়।</p>
  </section>
  <section class="panel"><h2>ব্রাউজার / অ্যাপ</h2>
    ${charts.hbars(d.browsers.map((r) => ({ label: r.browser, value: r.n })), { color: 3 })}
    <h3 class="h3">অপারেটিং সিস্টেম</h3>
    ${charts.hbars(d.oses.map((r) => ({ label: r.os, value: r.n })), { color: 6 })}
  </section>
  <section class="panel"><h2>রেফারার (কোন সাইটের লিংক থেকে)</h2>
    ${charts.hbars(d.referrers.map((r) => ({ label: r.ref_host, value: r.n })), { color: 1 })}
    <h3 class="h3">ক্যাম্পেইন (UTM)</h3>
    ${d.campaigns.length ? charts.hbars(d.campaigns.map((r) => ({ label: `${r.campaign} (${r.source})`, value: r.n, sub: r.orders ? `${bn(r.orders)} অর্ডার` : '' })), { color: 7 })
    : html`<p class="muted small">বিজ্ঞাপনের লিংকে <code>?utm_source=facebook&amp;utm_campaign=eid-offer</code> এমন যোগ করলে কোন ক্যাম্পেইন থেকে কত ভিজিটর আর অর্ডার এলো এখানে দেখাবে।</p>`}
    ${d.contacts.length ? html`<h3 class="h3">যোগাযোগ বাটনে চাপ</h3>${charts.hbars(d.contacts.map((r) => ({ label: r.label, value: r.n })), { color: 2 })}` : ''}
  </section>
  </div>
</details>`;
  return ctx.page('ভিজিটর অ্যানালিটিক্স', body, 'visitors');
}

function funnel(steps) {
  const top = steps[0][1] || 0;
  return html`<ol class="funnel">${steps.map(([label, n], i) => {
    const w = top ? Math.max(3, (100 * n) / top) : 0;
    const prev = i ? steps[i - 1][1] : null;
    return html`<li><span class="fn-label">${label}</span><span class="fn-track"><span class="fn-fill" style="width:${w.toFixed(1)}%"></span></span>
      <span class="fn-val"><b>${bn(n)}</b>${i ? html` <small>${rate(n, prev)}</small>` : ''}</span></li>`;
  })}</ol>`;
}

// ---------------------------------------------------------------- live
async function livePage(ctx) {
  const rows = await V.liveSessions();
  const s = ctx.settings;
  const body = html`<div class="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>
${tabs('live', rows.length)}${offNotice(s)}
<p class="muted small">গত ${bn(V.LIVE_MINUTES)} মিনিটে যারা সাইটে সক্রিয় ছিল। তালিকাটা প্রতি ৫ সেকেন্ডে নিজে থেকে আপডেট হয় — পেজ রিলোড করতে হবে না।</p>
<div data-live-refresh="5">${rows.length ? html`<div class="table-wrap"><table class="table va-table"><thead><tr><th>এখন যে পেজে</th><th>লোকেশন</th><th>ডিভাইস</th><th>কোথা থেকে</th><th class="num">সাইটে আছে</th><th class="num">পেজ</th><th>কে</th><th></th></tr></thead>
<tbody>${rows.map((r) => html`<tr>
  <td><span class="live-dot"></span> ${pageCell(r.exit_path, r.exit_title, s)}</td>
  <td>${where(r)}${orderAddr(r)}${r.ip ? html`<br><small class="muted">${r.ip}</small>` : ''}</td>
  <td>${deviceCell(r, true)}</td>
  <td>${sourcePill(r)}</td>
  <td class="num">${dur(r.on_site)}</td>
  <td class="num">${bn(r.pageviews)}</td>
  <td>${who(r)}${r.order_code ? html`<br><a class="pill pill-green" href="/admin/orders?q=${r.order_code}">অর্ডার ${r.order_code}</a>` : ''}</td>
  <td><a class="btn btn-sm btn-ghost" href="${BASE}/s/${r.id}">বিস্তারিত</a></td>
</tr>`)}</tbody></table></div>`
    : ui.empty('এই মুহূর্তে কেউ সাইটে নেই।')}</div>`;
  return ctx.page('লাইভ ভিজিটর', body, 'visitors');
}

// ---------------------------------------------------------------- all visits
async function sessionsPage(ctx) {
  const page = pageNum(ctx.query);
  const r = ctx.query.get('from') || ctx.query.get('to') ? dateRange(ctx.query, 30) : { from: '', to: '' };
  const f = {
    from: r.from, to: r.to,
    q: str(ctx.query.get('q'), 80),
    source: str(ctx.query.get('source'), 80),
    device: DEVICES[ctx.query.get('device')] ? ctx.query.get('device') : '',
    ordered: ctx.query.get('ordered') === '1',
    net: ['bd', 'vpn', 'abroad', 'suspicious'].includes(ctx.query.get('net')) ? ctx.query.get('net') : '',
    visitor: /^[a-f0-9]{20}$/.test(ctx.query.get('visitor') || '') ? ctx.query.get('visitor') : '',
  };
  const [rows, total, sources, live] = await Promise.all([
    V.listSessions(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), V.countSessions(f), V.sourceList(), V.liveSessions(),
  ]);
  const qs = new URLSearchParams({ tab: 'sessions' });
  for (const [key, val] of Object.entries(f)) if (val) qs.set(key, val === true ? '1' : val);
  const s = ctx.settings;
  const body = html`<div class="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>
${tabs('sessions', live.length)}${offNotice(s)}
<form class="toolbar" method="get" action="${BASE}">
  <input type="hidden" name="tab" value="sessions">
  ${f.visitor ? html`<input type="hidden" name="visitor" value="${f.visitor}">` : ''}
  <input type="search" name="q" value="${f.q}" placeholder="শহর, IP, পেজ, পণ্য, নাম বা ফোন" aria-label="খুঁজুন">
  ${ui.select('source', [['', 'সব উৎস'], ...sources.map((x) => [x, x])], f.source)}
  ${ui.select('device', [['', 'সব ডিভাইস'], ...Object.entries(DEVICES).map(([k2, v]) => [k2, v[1]])], f.device)}
  ${ui.select('net', [['', 'সব দেশ / নেটওয়ার্ক'], ['bd', '🇧🇩 বাংলাদেশ থেকে'], ['vpn', '🛡️ VPN / প্রক্সি'], ['abroad', '🌍 বিদেশ থেকে'], ['suspicious', '🚨 সন্দেহজনক']], f.net)}
  <label class="small">থেকে <input type="date" name="from" value="${f.from}"></label>
  <label class="small">পর্যন্ত <input type="date" name="to" value="${f.to}"></label>
  ${ui.check('ordered', f.ordered, 'শুধু যারা অর্ডার করেছে')}
  <button class="btn btn-sm">খুঁজুন</button>
  ${[...qs.keys()].length > 1 ? html`<a class="small" href="${BASE}?tab=sessions">সব দেখুন</a>` : ''}
</form>
${f.visitor ? html`<p class="flash">একজন নির্দিষ্ট ভিজিটরের সব ভিজিট দেখাচ্ছে।</p>` : ''}
${rows.length ? html`<div class="table-wrap"><table class="table va-table"><thead><tr><th>কখন</th><th>লোকেশন</th><th>ডিভাইস</th><th>কোথা থেকে</th><th>প্রথম পেজ → শেষ পেজ</th><th class="num">পেজ</th><th class="num">সময়</th><th>কে / ফলাফল</th></tr></thead>
<tbody>${rows.map((x) => html`<tr class="row-link" data-href="${BASE}/s/${x.id}">
  <td><a href="${BASE}/s/${x.id}"><b>${ago(x.started_at)}</b></a><br><small class="muted">${fmtDate(x.started_at)}</small></td>
  <td>${where(x)}${orderAddr(x)}</td>
  <td>${deviceCell(x)}</td>
  <td>${sourcePill(x)}${x.campaign ? html`<br><small class="muted">${x.campaign}</small>` : ''}</td>
  <td class="small">${decodeSafe(x.landing)}${x.exit_path && x.exit_path !== x.landing ? html` <span class="muted">→</span> ${decodeSafe(x.exit_path)}` : ''}</td>
  <td class="num">${bn(x.pageviews)}</td>
  <td class="num">${dur(x.duration)}</td>
  <td>${who(x)}
    ${x.order_code ? html`<br><span class="pill pill-green">✅ অর্ডার ${x.order_code}</span>` : x.carts ? html`<br><span class="pill pill-amber">🛒 কার্টে ${bn(x.carts)}টি, অর্ডার করেনি</span>` : ''}</td>
</tr>`)}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, BASE + '?' + qs)}`
    : ui.empty('কোনো ভিজিট পাওয়া যায়নি।')}`;
  return ctx.page('সব ভিজিট', body, 'visitors');
}

// ---------------------------------------------------------------- one visit
async function sessionPage(ctx, m) {
  const x = await V.getSession(m[1]);
  if (!x) return ctx.back(`${BASE}?tab=sessions`);
  const s = ctx.settings;
  // one timeline: pages and actions in the order they happened
  const timeline = [
    ...x.views.map((v) => ({ at: v.created_at, kind: 'page', v })),
    ...x.events.map((e) => ({ at: e.created_at, kind: 'event', e })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at) || (a.kind === 'page' ? -1 : 1));
  const p = V.place(x);
  const body = html`<p class="crumbs"><a href="${BASE}?tab=sessions">← সব ভিজিট</a></p>
<div class="title-row"><h1>একটি ভিজিটের বিস্তারিত</h1></div>
<div class="two-col">
  <section class="panel">
    <h2>ভিজিটর কে</h2>
    <dl class="dl">
      ${x.visitor_name || x.visitor_phone ? html`<dt>নাম / ফোন</dt><dd><b>${x.visitor_name}</b> ${x.visitor_phone}${x.visitor_phone ? html` · <a href="/admin/customers?q=${x.visitor_phone}">কাস্টমার দেখুন</a>` : ''}</dd>` : ''}
      <dt>লোকেশন (IP থেকে)</dt><dd>${p.flag} ${p.text}${x.country ? html` <span class="muted">(${p.country})</span>` : ''}${netBadge(x)}</dd>
      ${NET[x.net] ? html`<dt></dt><dd class="small muted">${NET[x.net][2]}</dd>` : ''}
      ${x.o_address || x.o_district ? html`<dt>ডেলিভারি ঠিকানা</dt><dd translate="no">🏠 ${[x.o_address, x.o_thana, x.o_district].filter(Boolean).join(', ')}</dd>` : ''}
      ${x.tz ? html`<dt>ডিভাইসের ঘড়ি</dt><dd>${x.tz}</dd>` : ''}
      <dt>IP ঠিকানা</dt><dd>${x.ip || '—'}</dd>
      <dt>ডিভাইস</dt><dd>${device(x.device)}${phoneName(x) ? html` · <b translate="no">${phoneName(x)}</b>` : ''} · ${x.os} · ${x.browser}${x.screen ? html` · স্ক্রিন ${x.screen}` : ''}</dd>
      <dt>ভাষা</dt><dd>${x.lang || '—'}</dd>
      <dt>প্রথম এসেছিল</dt><dd>${fmtDate(x.first_seen)}</dd>
      <dt>মোট এসেছে</dt><dd>${bn(x.total_visits)} বার · ${bn(x.total_pageviews)}টি পেজ${x.total_orders ? html` · <b class="good">${bn(x.total_orders)}টি অর্ডার</b>` : ''}</dd>
    </dl>
    ${x.others.length ? html`<p><a class="btn btn-sm btn-ghost" href="${BASE}?tab=sessions&visitor=${x.visitor_id}">এই ভিজিটরের সব ভিজিট (${bn(x.others.length + 1)})</a></p>` : ''}
  </section>
  <section class="panel">
    <h2>এই ভিজিট</h2>
    <dl class="dl">
      <dt>শুরু</dt><dd>${fmtDate(x.started_at)} <span class="muted">(${ago(x.started_at)})</span></dd>
      <dt>শেষ দেখা</dt><dd>${fmtDate(x.last_seen)}</dd>
      <dt>সাইটে ছিল</dt><dd><b>${dur(x.duration)}</b> (সক্রিয় সময়)</dd>
      <dt>পেজ দেখেছে</dt><dd>${bn(x.pageviews)}টি</dd>
      <dt>কোথা থেকে</dt><dd>${sourcePill(x)} <span class="muted small">${x.medium}</span>${x.campaign ? html` · ক্যাম্পেইন: <b>${x.campaign}</b>` : ''}</dd>
      ${x.referrer ? html`<dt>রেফারার</dt><dd class="small break">${x.referrer}</dd>` : ''}
      <dt>ফলাফল</dt><dd>${x.order_code ? html`<a class="pill pill-green" href="/admin/orders?q=${x.order_code}">✅ অর্ডার ${x.order_code}</a>` : html`<span class="muted">অর্ডার করেনি</span>`}</dd>
    </dl>
  </section>
</div>
<section class="panel">
  <h2>কী কী করেছে (ধাপে ধাপে)</h2>
  ${timeline.length ? html`<ol class="journey">${timeline.map((t) => (t.kind === 'page'
    ? html`<li class="j-page"><time>${fmtTime(t.at)}</time><div>${pageCell(t.v.path, t.v.product_name || t.v.title, s)}
        <small class="muted">${t.v.duration ? `${dur(t.v.duration)} ছিল` : 'সময় জানা যায়নি'}${t.v.scroll ? ` · ${bn(t.v.scroll)}% পর্যন্ত স্ক্রল` : ''}</small></div></li>`
    : html`<li class="j-event"><time>${fmtTime(t.at)}</time><div><b>${(EVENT_LABELS[t.e.event] || ['•'])[0]} ${(EVENT_LABELS[t.e.event] || ['', t.e.event])[1]}</b>
        ${t.e.label ? html`: ${t.e.label}` : ''}${t.e.value ? html` <span class="muted">(${money(t.e.value)})</span>` : ''}</div></li>`))}</ol>`
    : html`<p class="muted">কোনো পেজের তথ্য নেই।</p>`}
</section>
${x.others.length ? html`<section class="panel"><h2>এই ভিজিটরের আগের/পরের ভিজিট</h2>
  <div class="table-wrap"><table class="table"><thead><tr><th>কখন</th><th>কোথা থেকে</th><th class="num">পেজ</th><th class="num">সময়</th><th>ফলাফল</th></tr></thead>
  <tbody>${x.others.map((o) => html`<tr><td><a href="${BASE}/s/${o.id}">${fmtDate(o.started_at)}</a></td><td>${o.source}</td><td class="num">${bn(o.pageviews)}</td><td class="num">${dur(o.duration)}</td>
    <td>${o.order_code ? html`<span class="pill pill-green">অর্ডার ${o.order_code}</span>` : ''}</td></tr>`)}</tbody></table></div></section>` : ''}`;
  return ctx.page('ভিজিটের বিস্তারিত', body, 'visitors');
}
function fmtTime(d) {
  return bn(new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}

// ---------------------------------------------------------------- settings
async function settingsPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const keep = ['30', '60', '90', '180', '365'].includes(String(b.visitor_keep_days)) ? String(b.visitor_keep_days) : '60';
    await db.setMany({ visitor_tracking: b.visitor_tracking ? '1' : '0', visitor_exclude_admin: b.visitor_exclude_admin ? '1' : '0', visitor_keep_days: keep });
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, 'ভিজিটর অ্যানালিটিক্স সেটিংস');
    return ctx.back(`${BASE}?tab=settings`, 'saved');
  }
  const live = await V.liveSessions();
  const sw = (name, on, title, desc) => html`<label class="switch-row">
    <span class="switch-text"><b>${title}</b><small>${desc}</small></span>
    <span class="switch"><input type="checkbox" name="${name}" value="1" ${on ? raw('checked') : ''}><span class="switch-ui" aria-hidden="true"></span></span>
    <span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>`;
  const size = await db.one(`SELECT (SELECT count(*) FROM page_views)::int AS views, (SELECT count(*) FROM visit_sessions)::int AS sessions,
    pg_size_pretty(pg_total_relation_size('page_views') + pg_total_relation_size('visit_sessions') + pg_total_relation_size('visit_events') + pg_total_relation_size('visitors')) AS size`);
  const body = html`<div class="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>
${tabs('settings', live.length)}${ui.flash(ctx.flash)}
<div class="two-col">
  <form method="post" action="${BASE}" class="form panel">
    <h2>সেটিংস</h2>
    <div class="switch-list">
      ${sw('visitor_tracking', s.visitor_tracking !== '0', 'ভিজিটর ট্র্যাকিং চালু', 'বন্ধ করলে নতুন ভিজিটরের তথ্য আর জমা হবে না (আগের তথ্য থেকে যাবে)।')}
      ${sw('visitor_exclude_admin', s.visitor_exclude_admin !== '0', 'আমার নিজের ভিজিট গুনবে না', 'যে ব্রাউজারে Admin প্যানেলে লগইন করা আছে, সেখান থেকে দোকান দেখলে সেটা হিসাবে ধরবে না — তাহলে আসল কাস্টমারের হিসাব ঠিক থাকবে।')}
    </div>
    ${ui.field('তথ্য কতদিন রাখবে', ui.select('visitor_keep_days', [['30', '৩০ দিন'], ['60', '৬০ দিন (পরামর্শ)'], ['90', '৯০ দিন'], ['180', '১৮০ দিন'], ['365', '১ বছর']], s.visitor_keep_days || '60'),
    'এর চেয়ে পুরনো ভিজিটের তথ্য নিজে থেকে মুছে যাবে, যাতে ডাটাবেস ভরে না যায়। অর্ডার বা কাস্টমারের তথ্য কখনো মুছবে না।')}
    <button class="btn">সেভ করুন</button>
  </form>
  <section class="panel">
    <h2>কীভাবে কাজ করে</h2>
    <ul class="checklist">
      <li>✅ কেউ দোকানে ঢুকলে সে কোন পেজ দেখছে, কতক্ষণ থাকছে, কতটা স্ক্রল করছে — সব জমা হয়।</li>
      <li>✅ লোকেশন (দেশ, বিভাগ/জেলা, শহর) IP থেকে Vercel নিজে বের করে দেয়, তাই আলাদা কোনো সার্ভিস লাগে না। এটা আনুমানিক — মোবাইল ডাটায় অনেক সময় কাছের বড় শহর দেখায়।</li>
      <li>✅ Facebook, Google, TikTok, YouTube বা সরাসরি — কোথা থেকে এসেছে তা রেফারার আর বিজ্ঞাপনের লিংক (fbclid, gclid, utm) দেখে বোঝা যায়।</li>
      <li>✅ কেউ অর্ডার করলে তার নাম-ফোন সেই ভিজিটের সাথে জুড়ে যায়, তাই কোন কাস্টমার কোন পথে এসে কিনলো দেখতে পাবেন।</li>
      <li>✅ গুগল/ফেসবুকের রোবট (bot) গোনা হয় না।</li>
    </ul>
    <p class="muted small">এখন জমা আছে: ${bn(size.sessions)}টি ভিজিট, ${bn(size.views)}টি পেজ ভিউ (জায়গা লাগছে ${size.size})।</p>
    ${resetBox(ctx)}
  </section>
</div>`;
  return ctx.page('ভিজিটর সেটিংস', body, 'visitors');
}

// ---------------------------------------------------------------- 🌍 দেশ ব্লক (owner only)
// Tick the countries that may open the shop; everyone else sees "not available in your country" (services/geolock.js).
async function countriesPage(ctx) {
  const G = $services_geolock;
  const s = ctx.settings;
  const mine = G.countryOf(ctx.req);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const picked = [...new Set([].concat(b.c || []).map((x) => String(x).toUpperCase()).filter((x) => Object.prototype.hasOwnProperty.call(G.COUNTRIES, x)))];
    const on = !!b.geo_lock_on;
    if (on && !picked.length) return ctx.fail(COUNTRY_PATH, 'চালু করতে অন্তত একটা দেশে টিক দিন (যেমন বাংলাদেশ)।');
    await db.setMany({ geo_lock_on: on ? '1' : '0', geo_allow: picked.join(','), geo_tz_check: b.geo_tz_check ? '1' : '0', geo_vpn_home: b.geo_vpn_home ? '1' : '0' });
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, `দেশ ব্লক: ${on ? 'চালু' : 'বন্ধ'} — খোলা: ${picked.join(', ') || '—'}`);
    return ctx.back(COUNTRY_PATH, 'saved');
  }
  const cfg = G.config(s);
  const allow = new Set(G.allowedList(s));
  const [visits, blocked, live] = await Promise.all([
    db.q(`SELECT country, count(*)::int AS n FROM visit_sessions WHERE started_at > now() - interval '30 days' AND country <> '' GROUP BY country`).catch(() => []),
    db.q(`SELECT country, why, sum(n)::int AS n FROM geo_blocks WHERE day > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7 GROUP BY country, why ORDER BY 3 DESC`).catch(() => []),
    V.liveSessions(),
  ]);
  const seen = Object.fromEntries(visits.map((r) => [r.country, r.n]));
  const blockedTotal = blocked.reduce((a, r) => a + r.n, 0);
  const tzBlocked = blocked.filter((r) => r.why === 'tz').reduce((a, r) => a + r.n, 0);
  // ticked first, then countries that sent visitors (most first), then the rest by name
  const list = Object.keys(G.COUNTRIES).map((c) => ({ c, bn: V.countryName(c), en: G.countryName(c, 'en'), n: seen[c] || 0, on: allow.has(c) }))
    .sort((a, b) => (b.on - a.on) || (b.n - a.n) || a.en.localeCompare(b.en));
  const sw = (name, on, title, desc) => html`<label class="switch-row">
    <span class="switch-text"><b>${title}</b><small>${desc}</small></span>
    <span class="switch"><input type="checkbox" name="${name}" value="1" ${on ? raw('checked') : ''}><span class="switch-ui" aria-hidden="true"></span></span>
    <span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>`;
  const body = html`<div class="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>
${tabs('countries', live.length)}${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', cfg.on ? '🔒 চালু' : '⚪ বন্ধ', cfg.on ? `খোলা: ${cfg.list.map((c) => V.flag(c)).join(' ')}` : 'এখন সব দেশ থেকে ঢোকা যায়')}
  ${ui.kpi('খোলা দেশ', bn(allow.size), '')}
  ${ui.kpi('গত ৭ দিনে আটকানো', bn(blockedTotal), tzBlocked ? `এর মধ্যে VPN (ঘড়ি মেলেনি) ${bn(tzBlocked)}` : '')}
  ${ui.kpi('আপনি এখন আছেন', mine ? `${V.flag(mine)} ${V.countryName(mine)}` : 'জানা যায়নি', mine && cfg.on && !allow.has(mine) ? 'এই দেশে টিক নেই' : '')}
</div>
<form method="post" action="${COUNTRY_PATH}" class="form" data-geo-form>
<div class="two-col">
  <section class="panel">
    <h2>🌍 শুধু টিক দেওয়া দেশ থেকে সাইটে ঢোকা যাবে</h2>
    <div class="switch-list">
      ${sw('geo_lock_on', s.geo_lock_on === '1', 'দেশ ব্লক চালু', 'চালু করলে টিক না দেওয়া দেশের কেউ দোকান খুললে দেখবে "দুঃখিত, আপনার দেশ থেকে খোলা যায় না"।')}
      ${sw('geo_tz_check', s.geo_tz_check !== '0', 'VPN দিয়ে লুকিয়ে আসা বিদেশি ধরুন', 'বিদেশি কেউ বাংলাদেশের VPN দিয়ে এলেও তার ফোন/কম্পিউটারের ঘড়ি নিজের দেশের সময়ে থাকে। ঘড়ি টিক দেওয়া দেশের না হলে আটকে যাবে।')}
      ${sw('geo_vpn_home', s.geo_vpn_home === '1', 'VPN চালু রাখা দেশি কাস্টমারকে ঢুকতে দিন', 'বন্ধ থাকলে (পরামর্শ) বাংলাদেশে বসে VPN চালিয়ে এলে বিদেশি হিসেবেই আটকে যাবে — VPN বন্ধ করলেই ঢুকতে পারবে। চালু করলে ঘড়ি বাংলাদেশের সময়ে থাকলে ঢুকতে দেবে।')}
    </div>
    <h3 class="h3">দেশ বাছাই করুন <span class="muted small" data-geo-count></span></h3>
    <div class="field-row">
      <div class="field"><input type="search" placeholder="দেশ খুঁজুন… (যেমন India / ভারত)" data-geo-search aria-label="দেশ খুঁজুন"></div>
      <div class="field"><button type="button" class="btn btn-sm btn-ghost" data-geo-only>শুধু টিক দেওয়াগুলো দেখুন</button> <button type="button" class="btn btn-sm btn-ghost" data-geo-none>সব টিক তুলে দিন</button></div>
    </div>
    <div class="geo-list" style="max-height:460px;overflow:auto;border:1px solid var(--line,#e3e8f0);border-radius:10px;padding:6px 10px">
      ${list.map((r) => html`<label class="check" data-geo-row data-k="${(r.bn + ' ' + r.en + ' ' + r.c).toLowerCase()}" style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line,#eef1f6)">
        <input type="checkbox" name="c" value="${r.c}" ${r.on ? raw('checked') : ''}>
        <span style="font-size:1.25em">${V.flag(r.c)}</span>
        <span style="flex:1"><b>${r.bn}</b> <span class="small muted">${r.en}</span></span>
        ${r.n ? html`<span class="small muted" title="গত ৩০ দিনের ভিজিট">${bn(r.n)} ভিজিট</span>` : ''}</label>`)}
    </div>
    <p class="small muted">প্রথমে টিক দেওয়া দেশ, তারপর গত ৩০ দিনে যেসব দেশ থেকে ভিজিটর এসেছে (বেশি থেকে কম), তারপর বাকি সব দেশ।</p>
    <button class="btn btn-block btn-lg">✅ সেভ করুন</button>
  </section>
  <section class="panel">
    <h2>গত ৭ দিনে যাদের আটকানো হয়েছে</h2>
    ${blocked.length ? html`<table class="table compact"><thead><tr><th>দেশ</th><th>কারণ</th><th class="num">বার</th></tr></thead><tbody>
      ${blocked.slice(0, 30).map((r) => html`<tr><td>${V.flag(r.country)} ${r.country === '??' ? 'অজানা' : V.countryName(r.country)}</td><td class="small">${r.why === 'tz' ? '🛡️ VPN (ঘড়ি মেলেনি)' : r.why === 'admin' ? '🔐 অ্যাডমিনে ঢোকার চেষ্টা' : '🌍 দেশ'}</td><td class="num">${bn(r.n)}</td></tr>`)}
    </tbody></table>` : html`<p class="muted">${cfg.on ? 'এখনো কাউকে আটকাতে হয়নি।' : 'দেশ ব্লক বন্ধ আছে।'}</p>`}
    <h2>যা কখনো আটকাবে না</h2>
    <ul class="checklist small">
      <li>🔐 অ্যাডমিন প্যানেলের দেশ আলাদা ঠিক করা হয় (শুধু বাংলাদেশ, বিদেশ যাওয়ার আগে খুলে নিতে হয়): <a href="/admin/security#admin-country">নিরাপত্তা → অ্যাডমিন কোন দেশ থেকে খুলবে</a>। অ্যাডমিনে লগইন করা ব্রাউজারে দোকানও খুলবে।</li>
      <li>✅ Google, Facebook, Bing-এর রোবট — এরা আমেরিকা/ইউরোপ থেকে আসে। আটকালে দোকান Google সার্চ, Merchant Center আর ফেসবুক পোস্টের ছবি থেকে হারিয়ে যেত।</li>
      <li>✅ বিকাশ/পেমেন্ট, Pathao/Steadfast কুরিয়ারের অটো-আপডেট আর প্রতিদিনের অটো কাজ।</li>
      <li>✅ পণ্যের ছবি আর প্রোডাক্ট ফিড।</li>
    </ul>
    <p class="small muted">দেশ বোঝা হয় ভিজিটরের IP থেকে (Vercel নিজে বলে দেয়)। কোনো কারণে দেশ জানা না গেলে তাকে ঢুকতে দেওয়া হয়, যাতে ভুলে পুরো দোকান বন্ধ না হয়।</p>
  </section>
</div>
</form>
<script>${raw(`(function(){var f=document.querySelector('[data-geo-form]');if(!f)return;var rows=[].slice.call(f.querySelectorAll('[data-geo-row]')),q=f.querySelector('[data-geo-search]'),cnt=f.querySelector('[data-geo-count]'),only=false;
function upd(){var n=0,t=(q.value||'').trim().toLowerCase();rows.forEach(function(r){var c=r.querySelector('input').checked;if(c)n++;r.style.display=((!t||r.getAttribute('data-k').indexOf(t)>=0)&&(!only||c))?'':'none';});cnt.textContent='('+n+'টি টিক দেওয়া)';}
q.addEventListener('input',upd);f.addEventListener('change',upd);
f.querySelector('[data-geo-only]').addEventListener('click',function(){only=!only;this.textContent=only?'সব দেশ দেখুন':'শুধু টিক দেওয়াগুলো দেখুন';upd();});
f.querySelector('[data-geo-none]').addEventListener('click',function(){if(!confirm('সব দেশের টিক তুলে দেবেন?'))return;rows.forEach(function(r){r.querySelector('input').checked=false;});upd();});
f.addEventListener('submit',function(e){var on=f.querySelector('[name=geo_lock_on]').checked,n=rows.filter(function(r){return r.querySelector('input').checked;}).length;if(on&&!n){e.preventDefault();alert('অন্তত একটা দেশে টিক দিন।');}});
upd();})();`)}</script>`;
  return ctx.page('দেশ ব্লক', body, 'visitors');
}

async function clearData(ctx) {
  await V.clearAll();
  await ctx.reloadSettings();
  await ctx.log('settings', 'marketing', null, 'ভিজিটর অ্যানালিটিক্সের সব হিসাব শূন্য করা হয়েছে');
  return ctx.back(BASE, 'deleted');
}

async function main(ctx) {
  const tab = ctx.query.get('tab') || '';
  if (ctx.method === 'POST' || tab === 'settings') return settingsPage(ctx);
  if (tab === 'live') return livePage(ctx);
  if (tab === 'sessions') return sessionsPage(ctx);
  return overviewPage(ctx);
}

export const routes = [
    { method: '*', path: BASE, perm: 'marketing', handler: main },
    { method: 'GET', path: /^\/admin\/marketing\/visitors\/s\/([a-f0-9]{20})$/, perm: 'marketing', handler: sessionPage },
    { method: 'POST', path: '/admin/marketing/visitors/clear', perm: 'owner', handler: clearData },
    { method: '*', path: COUNTRY_PATH, perm: 'owner', handler: countriesPage },
  ];

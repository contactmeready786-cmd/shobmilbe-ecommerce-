'use strict';
// Admin → স্টাফ ও নিরাপত্তা → সন্দেহজনক ভিজিটর
// Who tried to harm the site (hacking-file scans, harmful code in links, wrong admin passwords, request floods),
// from where, what exactly they tried — and one tap to shut that IP out of the whole shop (for 24 hours or for good).
const { html, bn, fmtDate, str } = require('../util');
const db = require('../db');
const G = require('../services/guard');
const V = require('../services/visitors');
const ui = require('./ui');

const BASE = '/admin/security/threats';

function ago(d) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return bn(Math.floor(s / 86400)) + ' দিন আগে';
}
function kindPills(kinds) {
  return html`<span class="threat-kinds">${Object.entries(kinds || {}).map(([k, n]) => {
    const x = G.KINDS[k] || ['•', k];
    const cls = k === 'probe' || k === 'attack' ? 'pill-red' : k === 'login_fail' ? 'pill-amber' : '';
    return html`<span class="pill ${cls}" title="${x[1]}">${x[0]} ${x[1]} × ${bn(n)}</span>`;
  })}</span>`;
}
function place(r) {
  if (!r.country) return html`<span class="muted">অজানা</span>`;
  const p = V.place({ country: r.country, region: '', city: r.city });
  return html`<span title="${p.country}">${p.flag} ${p.text}</span>`;
}
function blockButtons(ip, blocked, until) {
  if (blocked) {
    return html`<span class="pill pill-red">⛔ ব্লক করা${until ? html` · ${fmtDate(until)} পর্যন্ত` : ' · স্থায়ী'}</span>
      <form method="post" action="${BASE}/unblock"><input type="hidden" name="ip" value="${ip}"><button class="btn btn-sm btn-ghost">ব্লক তুলুন</button></form>`;
  }
  return html`<form method="post" action="${BASE}/block"><input type="hidden" name="ip" value="${ip}"><input type="hidden" name="hours" value="24"><button class="btn btn-sm btn-danger">⛔ ২৪ ঘণ্টা ব্লক</button></form>
    <form method="post" action="${BASE}/block" data-confirm="এই IP থেকে আর কখনো সাইট খোলা যাবে না (যতক্ষণ না আপনি ব্লক তোলেন)। মোবাইল ইন্টারনেটে অনেক মানুষ একই IP ভাগ করে, তাই আসল কাস্টমারও আটকে যেতে পারে। নিশ্চিত?"><input type="hidden" name="ip" value="${ip}"><input type="hidden" name="hours" value="0"><button class="link-btn danger small">স্থায়ী ব্লক</button></form>`;
}

async function page(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    await db.setMany({ guard_on: b.guard_on === '1' ? '1' : '0', guard_autoblock: b.guard_autoblock === '1' ? '1' : '0' });
    await ctx.log('settings', 'security', null, `সন্দেহজনক ভিজিটর ধরা ${b.guard_on === '1' ? 'চালু' : 'বন্ধ'}, নিজে থেকে ব্লক ${b.guard_autoblock === '1' ? 'চালু' : 'বন্ধ'}`);
    G.resetCache();
    return ctx.back(BASE, 'saved');
  }
  const ip = str(ctx.query.get('ip'), 64);
  const days = [1, 7, 30, 90].includes(Number(ctx.query.get('days'))) ? Number(ctx.query.get('days')) : 7;
  const s = ctx.settings;
  const [rows, sum, blocks, evs] = await Promise.all([
    G.suspects({ days: ip ? 90 : days, ip }), G.summary(days), G.siteBlocks(), ip ? G.events(ip) : Promise.resolve([]),
  ]);
  const one = ip ? rows[0] : null;
  const body = html`<div class="title-row"><h1>🚨 সন্দেহজনক ভিজিটর</h1></div>
${ui.flash(ctx.flash)}
<form method="post" action="${BASE}" class="panel switch-list" data-autosubmit>
  ${ui.switchRow('guard_on', s.guard_on !== '0', 'সন্দেহজনক ভিজিটর ধরা', 'যারা সাইটে হ্যাকিংয়ের দুর্বল জায়গা খোঁজে, লিংকে ক্ষতিকর কোড পাঠায়, অ্যাডমিনে বারবার ভুল পাসওয়ার্ড দেয় বা অস্বাভাবিক দ্রুত রিকোয়েস্ট পাঠায় — তাদের এখানে দেখাবে, আর বেশি হলে আপনাকে ইমেইল/WhatsApp-এ জানাবে। সাধারণ কাস্টমার এসব কখনো করে না।')}
  ${ui.switchRow('guard_autoblock', s.guard_autoblock !== '0', 'বারবার হ্যাকিং চেষ্টা করলে নিজে থেকে ২৪ ঘণ্টা ব্লক', '১ ঘণ্টায় ২০ বার বা তার বেশি হ্যাকিংয়ের চেষ্টা করলে ওই IP ২৪ ঘণ্টা পুরো সাইটে ঢুকতে পারবে না। ২৪ ঘণ্টা পর নিজে থেকেই খুলে যাবে।')}
</form>
${ui.helpBox('এটা কীভাবে কাজ করে — আর GPS কেন নেই', html`<ul>
  <li><b>কী ধরা হয়:</b> 🕳️ /wp-login.php, /.env, /phpmyadmin এর মতো ফাইল খোঁজা (হ্যাকারদের টুল এসব খোঁজে — আপনার সাইটে এগুলো নেই, তাই কোনো ক্ষতি হয় না, কিন্তু কে খুঁজছে জানা যায়) · 💉 লিংকে SQL/স্ক্রিপ্ট কোড পাঠানো · 🔑 অ্যাডমিনে ভুল পাসওয়ার্ড · 🌊 অল্প সময়ে অনেক অর্ডার/কুপন/ট্র্যাকিং চেষ্টা · ⛔ ব্লক করা নম্বর থেকে আবার অর্ডারের চেষ্টা।</li>
  <li><b>ব্লক করলে:</b> ওই IP থেকে দোকানের কোনো পেজ খুলবে না। অ্যাডমিন প্যানেল সবসময় খোলা থাকে, তাই ভুল করে নিজেকে আটকে ফেললেও এখানে এসে ব্লক তুলতে পারবেন।</li>
  <li><b>সাবধান:</b> বাংলাদেশে মোবাইল ইন্টারনেটে (GP, Robi, Banglalink) অনেক মানুষ একই IP ভাগ করে ব্যবহার করে। তাই স্থায়ী ব্লকের চেয়ে ২৪ ঘণ্টার ব্লক নিরাপদ।</li>
  <li><b>GPS কেন নেওয়া হয় না:</b> ব্রাউজার কাউকে না জানিয়ে GPS দেয় না — সবসময় "Allow / Block" জিজ্ঞেস করে। যে ক্ষতি করতে আসে সে অবশ্যই Block চাপবে, আর সাধারণ কাস্টমার এই প্রশ্ন দেখে ভয়ে চলে যায়। তাই GPS দিয়ে নিরাপত্তা হয় না; এখানে যা ধরা হচ্ছে (IP, শহর, ডিভাইস, কী করার চেষ্টা করেছে) সেটাই আসল কাজের তথ্য। দরকার হলে এই তথ্য দিয়ে পুলিশের সাইবার ইউনিটে অভিযোগ করা যায়।</li>
</ul>`)}
${ip ? html`<p class="crumbs"><a href="${BASE}">← সব সন্দেহজনক ভিজিটর</a></p>
<section class="panel">
  <h2>IP: <span class="mono" translate="no">${ip}</span></h2>
  ${one ? html`<dl class="dl">
    <dt>লোকেশন</dt><dd>${place(one)}</dd>
    <dt>কী করেছে</dt><dd>${kindPills(one.kinds)}</dd>
    <dt>প্রথম / শেষ</dt><dd>${fmtDate(one.first_at)} → ${fmtDate(one.last_at)}</dd>
    <dt>ব্রাউজার/টুল</dt><dd class="small break">${one.ua || '—'}</dd>
    <dt>সাইটে ভিজিট</dt><dd>${one.visits ? html`<a href="/admin/marketing/visitors?tab=sessions&q=${encodeURIComponent(ip)}">${bn(one.visits)}টি ভিজিট দেখুন (কোন ফোন, কোন পেজ)</a>` : html`<span class="muted">কোনো সাধারণ ভিজিট নেই — সম্ভবত সরাসরি টুল/বট দিয়ে এসেছে</span>`}</dd>
    <dt>ব্লক</dt><dd class="threat-acts">${blockButtons(ip, !!one.block_id, one.block_until)}</dd>
  </dl>` : html`<p class="muted">গত ৯০ দিনে এই IP থেকে কোনো সন্দেহজনক কাজ পাওয়া যায়নি।</p>
    <div class="threat-acts">${blockButtons(ip, blocks.some((b) => b.value === ip), (blocks.find((b) => b.value === ip) || {}).expires_at)}</div>`}
</section>
${evs.length ? html`<section class="panel"><h2>সব ঘটনা (নতুন আগে)</h2><div class="table-wrap"><table class="table"><thead><tr><th>কখন</th><th>কী</th><th>ঠিকানা / বিস্তারিত</th></tr></thead>
<tbody>${evs.map((e) => html`<tr><td class="small">${fmtDate(e.created_at)}</td><td>${(G.KINDS[e.kind] || ['•', e.kind]).join(' ')}</td>
  <td class="threat-paths" translate="no">${e.path || ''}${e.detail ? html` <span class="muted">${e.detail}</span>` : ''}</td></tr>`)}</tbody></table></div></section>` : ''}`
  : html`
<div class="kpis">
  ${ui.kpi('সন্দেহজনক IP', bn(sum.ips), `গত ${bn(days)} দিনে`, sum.ips ? 'kpi-red' : '')}
  ${ui.kpi('হ্যাকিংয়ের চেষ্টা', bn(sum.hack), 'ফাইল খোঁজা / ক্ষতিকর কোড')}
  ${ui.kpi('ভুল অ্যাডমিন পাসওয়ার্ড', bn(sum.logins), '')}
  ${ui.kpi('এখন ব্লক করা', bn(sum.blocked), 'পুরো সাইট থেকে')}
</div>
<div class="chips">${[[1, 'আজ'], [7, '৭ দিন'], [30, '৩০ দিন'], [90, '৯০ দিন']].map(([d, l]) => html`<a class="chip ${d === days ? 'on' : ''}" href="${BASE}?days=${d}">${l}</a>`)}</div>
<form class="toolbar" method="get" action="${BASE}"><input type="search" name="ip" placeholder="IP দিয়ে খুঁজুন / ব্লক করুন" aria-label="IP"><button class="btn btn-sm">দেখুন</button></form>
${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>IP / লোকেশন</th><th>কী করেছে</th><th>যা খুঁজেছে</th><th>শেষ কবে</th><th>ব্লক</th></tr></thead>
<tbody>${rows.map((r) => html`<tr>
  <td><a href="${BASE}?ip=${encodeURIComponent(r.ip)}" class="mono" translate="no"><b>${r.ip}</b></a><br>${place(r)}${r.visits ? html`<br><small class="muted">${bn(r.visits)}টি ভিজিট</small>` : ''}</td>
  <td>${kindPills(r.kinds)}</td>
  <td class="threat-paths" translate="no">${(r.paths || []).map((p) => html`<div>${p}</div>`)}</td>
  <td class="small">${ago(r.last_at)}<br><span class="muted">মোট ${bn(r.n)}বার</span></td>
  <td class="threat-acts">${blockButtons(r.ip, !!r.block_id, r.block_until)}</td>
</tr>`)}</tbody></table></div>`
    : ui.empty(s.guard_on === '0' ? 'সন্দেহজনক ভিজিটর ধরা এখন বন্ধ। উপরের সুইচ চালু করুন।' : 'ভালো খবর — এই সময়ে কোনো সন্দেহজনক কিছু পাওয়া যায়নি। 👍')}
${blocks.length ? html`<section class="panel"><h2>⛔ এখন পুরো সাইট থেকে ব্লক করা IP</h2><div class="table-wrap"><table class="table"><thead><tr><th>IP</th><th>কারণ</th><th>কবে থেকে / কতদিন</th><th></th></tr></thead>
<tbody>${blocks.map((b) => html`<tr><td><a class="mono" href="${BASE}?ip=${encodeURIComponent(b.value)}" translate="no">${b.value}</a></td><td class="small">${b.reason || '—'}${b.staff_name ? html`<br><span class="muted">${b.staff_name}</span>` : ''}</td>
  <td class="small">${fmtDate(b.created_at)}<br>${b.expires_at ? html`${fmtDate(b.expires_at)} পর্যন্ত` : 'স্থায়ী'}</td>
  <td><form method="post" action="${BASE}/unblock"><input type="hidden" name="ip" value="${b.value}"><button class="link-btn">ব্লক তুলুন</button></form></td></tr>`)}</tbody></table></div></section>` : ''}`}`;
  return ctx.page('সন্দেহজনক ভিজিটর', body, 'threats');
}

async function block(ctx) {
  const b = await ctx.body();
  const ip = str(b.ip, 64).trim();
  const hours = Number(b.hours) > 0 ? 24 : 0;
  const ok = await G.blockSite(ip, `${ctx.user.name || 'মালিক'} ব্লক করেছেন${hours ? ' (২৪ ঘণ্টা)' : ' (স্থায়ী)'}`, hours, ctx.user.id);
  if (!ok) return ctx.fail(BASE, 'সঠিক IP ঠিকানা দিন।');
  await ctx.log('block', 'security', null, `সাইট থেকে ব্লক: ${ip}${hours ? ' (২৪ ঘণ্টা)' : ' (স্থায়ী)'}`);
  return ctx.back(`${BASE}?ip=${encodeURIComponent(ip)}`, 'blocked');
}
async function unblock(ctx) {
  const b = await ctx.body();
  const ip = str(b.ip, 64).trim();
  await G.unblockSite(ip);
  await ctx.log('unblock', 'security', null, `সাইট থেকে ব্লক তোলা: ${ip}`);
  return ctx.back(`${BASE}?ip=${encodeURIComponent(ip)}`, 'unblocked');
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'owner', handler: page },
    { method: 'POST', path: BASE + '/block', perm: 'owner', handler: block },
    { method: 'POST', path: BASE + '/unblock', perm: 'owner', handler: unblock },
  ],
};

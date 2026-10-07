'use strict';
// Admin → মার্কেট রিসার্চ (owner only). Nothing here is ever shown on the shop.
const { html, raw, bn, money, int, str, fmtDate } = require('../util');
const db = require('../db');
const R = require('../services/research');
const ui = require('./ui');

const TABS = [['winning', '🏆 উইনিং প্রোডাক্ট'], ['new', '🆕 বাজারে নতুন'], ['drops', '📉 দাম কমেছে'], ['demand', '🔎 আপনার কাস্টমার যা খুঁজছে'], ['sources', '🏪 যেসব দোকান দেখা হচ্ছে']];

function pic(src) { return src ? html`<img src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<span>📦</span>`; }
function ago(d) {
  if (!d) return 'এখনো না';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'এইমাত্র' : m < 60 ? `${bn(m)} মিনিট আগে` : m < 1440 ? `${bn(Math.round(m / 60))} ঘণ্টা আগে` : `${bn(Math.round(m / 1440))} দিন আগে`;
}

function winningCard(g, i) {
  const links = R.sourcingLinks(g.term);
  return html`<article class="rs-card">
    <div class="rs-rank">${bn(i + 1)}</div>
    <a class="rs-pic" href="${g.best.url}" target="_blank" rel="noopener noreferrer">${pic(g.lead.image)}</a>
    <div class="rs-body">
      <h3><a href="${g.lead.url}" target="_blank" rel="noopener noreferrer">${g.lead.title}</a></h3>
      <p class="rs-why">${g.why.slice(0, 4).map((w) => html`<span>${w}</span>`)}</p>
      <div class="rs-nums">
        <div><small>বাজারে দাম</small><b>${g.min === g.max ? money(g.min) : html`${money(g.min)} – ${money(g.max)}`}</b><small>সবচেয়ে কম: ${g.best.shop}</small></div>
        <div><small>আপনি বিক্রি করতে পারেন</small><b class="good">${g.sell ? money(g.sell) : '—'}</b><small>বাজারের মাঝামাঝি দামের সামান্য কম</small></div>
        <div><small>এর চেয়ে কমে কিনলে লাভ</small><b class="warn">${g.buyMax ? money(g.buyMax) : '—'}</b><small>কেনা দাম এর মধ্যে রাখুন</small></div>
        <div><small>আপনার দোকানে</small>${g.ours
    ? html`<b><a href="/admin/products/${g.ours.id}">আছে — ${money(g.ours.price)}</a></b><small>${Number(g.ours.price) > g.max ? '⚠️ বাজারের চেয়ে বেশি দাম' : Number(g.ours.price) < g.min ? 'বাজারের চেয়ে কম দাম' : 'দাম বাজারের মধ্যে'}${g.ours.cost_price ? ` · কেনা ${money(g.ours.cost_price)}` : ''}</small>`
    : html`<b class="bad">নেই</b><small><a href="/admin/products/import?url=${encodeURIComponent(g.best.url)}">তথ্য কপি করে আনুন →</a></small>`}</div>
      </div>
      <p class="rs-src"><small>কোথা থেকে কিনবেন খুঁজুন:</small> ${links.map(([l, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`)}</p>
      <p class="rs-shops small muted">যে দোকানে আছে: ${g.items.slice(0, 5).map((x) => html`<a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.shop} (${money(x.price)}${x.rank ? `, #${bn(x.rank)}` : ''})</a> `)}</p>
    </div>
  </article>`;
}

async function page(ctx) {
  const tab = TABS.some((t) => t[0] === ctx.query.get('tab')) ? ctx.query.get('tab') : 'winning';
  const segment = R.SEGMENTS[ctx.query.get('seg')] ? ctx.query.get('seg') : '';
  const margin = Math.min(80, Math.max(5, int(ctx.settings.research_margin, 30)));
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'add') {
      try { await R.addSource(str(b.url, 300), b.segment, str(b.name, 60)); } catch (e) { return ctx.fail('/admin/research?tab=sources', e.message); }
      return ctx.back('/admin/research?tab=sources', 'added');
    }
    if (b.form === 'toggle' && int(b.id)) await db.q('UPDATE research_sources SET active = NOT active WHERE id=$1', [int(b.id)]);
    if (b.form === 'delete' && int(b.id)) await db.q('DELETE FROM research_sources WHERE id=$1', [int(b.id)]);
    if (b.form === 'margin') { await db.setSetting('research_margin', String(Math.min(80, Math.max(5, int(b.margin, 30))))); await ctx.reloadSettings(); }
    return ctx.back(`/admin/research?tab=${b.form === 'margin' ? 'winning' : 'sources'}`, 'saved');
  }
  const st = await R.status();
  const segChips = html`<div class="chips">${[['', 'সব'], ...Object.entries(R.SEGMENTS)].map(([k, l]) => html`<a class="chip ${segment === k ? 'on' : ''}" href="/admin/research?tab=${tab}${k ? `&seg=${k}` : ''}">${l}</a>`)}</div>`;
  let content = '';
  if (tab === 'winning') {
    const list = await R.winners({ segment, margin });
    content = html`${segChips}
      <form method="post" action="/admin/research" class="toolbar rs-margin"><input type="hidden" name="form" value="margin">
        <label>কত % লাভ রাখতে চান <input type="number" name="margin" value="${margin}" min="5" max="80" class="w-num"></label><button class="btn btn-sm btn-ghost">হিসাব বদলান</button>
        <span class="small muted">"এর চেয়ে কমে কিনলে লাভ" এই হার দিয়ে হিসাব হয়।</span></form>
      ${list.length ? html`<div class="rs-list">${list.map(winningCard)}</div>` : ui.empty('এখনো যথেষ্ট তথ্য জমেনি। কয়েক ঘণ্টা পর আবার দেখুন, বা উপরের "এখনই আপডেট করুন" চাপুন।')}`;
  } else if (tab === 'new') {
    const list = await R.newInMarket({ segment, limit: 60 });
    content = html`${segChips}${list.length ? html`<div class="table-wrap panel"><table class="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th class="num">দাম</th><th>কবে এসেছে</th><th>কিনতে খুঁজুন</th></tr></thead>
      <tbody>${list.map((x) => html`<tr><td class="thumb">${pic(x.image)}</td><td><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.title}</a><br><span class="small muted">${x.category}</span></td>
        <td class="small">${x.shop}</td><td class="num">${x.price ? money(x.price) : '—'}</td><td class="small">${ago(x.first_seen)}</td>
        <td class="small">${R.sourcingLinks(x.title.split(/\s+/).slice(0, 6).join(' ')).slice(0, 3).map(([l, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a> `)}</td></tr>`)}</tbody></table></div>`
      : ui.empty('গত ৭ দিনে নতুন কিছু ধরা পড়েনি (প্রথম দিনের তথ্য "নতুন" ধরা হয় না)।')}`;
  } else if (tab === 'drops') {
    const list = await R.priceDrops({ limit: 40 });
    content = list.length ? html`<div class="table-wrap panel"><table class="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th class="num">আগে</th><th class="num">এখন</th></tr></thead>
      <tbody>${list.map((x) => html`<tr><td class="thumb">${pic(x.image)}</td><td><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.title}</a></td><td class="small">${x.shop}</td>
        <td class="num"><s>${money(x.prev_price)}</s></td><td class="num good"><b>${money(x.price)}</b></td></tr>`)}</tbody></table></div>`
      : ui.empty('গত ৭ দিনে কোনো দোকানে দাম কমেনি।');
  } else if (tab === 'demand') {
    const d = await R.demand(30);
    content = html`<div class="two-col">
      <section class="panel"><h2>কাস্টমার যা খুঁজেছে <small>৩০ দিন</small></h2>
        ${d.searches.length ? html`<table class="table"><thead><tr><th>খুঁজেছে</th><th class="num">কতবার</th><th class="num">আপনার দোকানে</th></tr></thead>
        <tbody>${d.searches.map((s) => html`<tr class="${s.found ? '' : 'rs-miss'}"><td><b>${s.term}</b></td><td class="num">${bn(s.times)}</td>
          <td class="num">${s.found ? html`${bn(s.found)}টি` : html`<b class="bad">নেই — এনে রাখুন!</b><br>${R.sourcingLinks(s.term).slice(0, 3).map(([l, u]) => html`<a class="small" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a> `)}`}</td></tr>`)}</tbody></table>`
    : html`<p class="muted">এখনো কেউ সাইটে কিছু খোঁজেনি।</p>`}
      </section>
      <section class="panel"><h2>সবচেয়ে বেশি দেখা পণ্য <small>৩০ দিন</small></h2>
        ${d.viewed.length ? html`<table class="table"><thead><tr><th>পণ্য</th><th class="num">দেখেছে</th><th class="num">বিক্রি</th></tr></thead>
        <tbody>${d.viewed.map((p) => html`<tr><td><a href="/admin/products/${p.id}">${p.name}</a>${p.stock <= 0 ? html` <span class="pill pill-cancelled">স্টক নেই</span>` : ''}</td>
          <td class="num">${bn(p.people)} জন</td><td class="num ${p.sold ? 'good' : ''}">${bn(p.sold)}</td></tr>`)}</tbody></table>
        <p class="small muted">অনেকে দেখছে কিন্তু বিক্রি কম → দাম বা ছবি/বিবরণ দেখুন। স্টক নেই কিন্তু দেখছে → দ্রুত স্টক আনুন।</p>`
    : html`<p class="muted">এখনো তথ্য নেই।</p>`}
      </section></div>`;
  } else {
    const sources = await R.listSources();
    content = html`<section class="panel"><h2>নতুন দোকান যোগ করুন</h2>
      <form method="post" action="/admin/research?tab=sources" class="form"><input type="hidden" name="form" value="add">
        <div class="field-row">
          ${ui.field('দোকানের লিংক', ui.input('url', '', { required: true, placeholder: 'https://example.com.bd', type: 'url' }))}
          ${ui.field('ধরন', ui.select('segment', Object.entries(R.SEGMENTS), 'electronics'))}
          ${ui.field('নাম (ঐচ্ছিক)', ui.input('name', '', { maxlength: 60 }))}
        </div>
        <button class="btn">যোগ করুন</button>
        <p class="small muted">বাংলাদেশের যেকোনো WooCommerce বা Shopify দিয়ে বানানো দোকান যোগ করা যায় (অনেক দোকানই এগুলো দিয়ে বানানো)। দোকান যে তথ্য রোবটকে পড়তে দেয় না (robots.txt), সেটা পড়া হয় না। Daraz, Facebook পেজ — এগুলো স্বয়ংক্রিয় পড়া বন্ধ রেখেছে, তাই যোগ করা যায় না।</p>
      </form></section>
      <div class="table-wrap panel"><table class="table"><thead><tr><th>দোকান</th><th>ধরন</th><th class="num">পণ্য</th><th>শেষ পড়া</th><th>অবস্থা</th><th></th></tr></thead>
      <tbody>${sources.map((s) => html`<tr class="${s.active ? '' : 'row-off'}"><td><b>${s.name}</b><br><a class="small muted" href="${s.url}" target="_blank" rel="noopener noreferrer">${s.url}</a></td>
        <td class="small">${R.SEGMENTS[s.segment] || s.segment} · ${s.kind === 'woo' ? 'WooCommerce (বিক্রির ক্রম সহ)' : 'Shopify'}</td>
        <td class="num">${bn(s.live_items)}</td><td class="small">${ago(s.last_ok)}</td>
        <td class="small">${s.last_error ? html`<span class="bad">⚠️ ${s.last_error}</span>` : s.active ? '✅ চালু' : 'বন্ধ'}</td>
        <td class="small"><form method="post" action="/admin/research?tab=sources" style="display:inline"><input type="hidden" name="form" value="toggle"><input type="hidden" name="id" value="${s.id}"><button class="link-btn">${s.active ? 'বন্ধ করুন' : 'চালু করুন'}</button></form>
          · <form method="post" action="/admin/research?tab=sources" style="display:inline" data-confirm="এই দোকান আর তার সব তথ্য মুছবেন?"><input type="hidden" name="form" value="delete"><input type="hidden" name="id" value="${s.id}"><button class="link-btn danger">মুছুন</button></form></td></tr>`)}</tbody></table></div>`;
  }
  const body = html`<h1>🔭 মার্কেট রিসার্চ <small>শুধু আপনি দেখতে পাচ্ছেন — দোকানে কোথাও দেখায় না</small></h1>
${ui.flash(ctx.flash)}
<div class="rs-status panel">
  <span>🏪 <b>${bn(st.sources)}</b>টি দোকান দেখা হচ্ছে</span><span>📦 <b>${bn(st.items)}</b>টি পণ্যের দাম জানা</span>
  <span>🕒 শেষ আপডেট: <b data-rs-last>${ago(st.last_ok)}</b></span>
  <button type="button" class="btn btn-sm" data-rs-run>🔄 এখনই আপডেট করুন</button><span class="small muted" data-rs-msg></span>
</div>
<nav class="tabs rs-tabs">${TABS.map(([k, l]) => html`<a class="tab ${tab === k ? 'on' : ''}" href="/admin/research?tab=${k}${segment ? `&seg=${segment}` : ''}">${l}</a>`)}</nav>
${content}
${ui.helpBox('এটা কীভাবে কাজ করে?', html`<ul>
  <li>প্রতি ঘণ্টায় নিজে থেকে (আপনি ঘুমিয়ে থাকলেও) বাংলাদেশের অন্য অনলাইন দোকানগুলোর পণ্যের তালিকা পড়া হয় — দাম, আগের দাম, স্টক, আর কোন পণ্য সবচেয়ে বেশি বিক্রি হচ্ছে তার ক্রম।</li>
  <li><b>উইনিং স্কোর</b> বাড়ে যখন: পণ্যটি দোকানের সবচেয়ে বেশি বিক্রির তালিকার উপরে, কয়েকটা দোকানে একসাথে বিক্রি হচ্ছে, সপ্তাহে ক্রম উপরে উঠছে, বারবার স্টক শেষ হচ্ছে, নতুন এসেছে, আর আপনার সাইটে কাস্টমাররা এটা খুঁজছে।</li>
  <li><b>আপনি বিক্রি করতে পারেন</b> = বাজারের মাঝামাঝি দামের সামান্য কম। <b>এর চেয়ে কমে কিনলে লাভ</b> = সেই দাম থেকে আপনার বেছে নেওয়া লাভের হার বাদ দিয়ে।</li>
  <li>পাইকারি কেনা দাম ইন্টারনেটে খোলাভাবে পাওয়া যায় না — তাই 1688 / Alibaba / AliExpress / Daraz এ সরাসরি খোঁজার লিংক দেওয়া আছে। ঢাকার পাইকারি বাজারেও (যেমন পাটুয়াটুলী, নবাবপুর, স্টেডিয়াম মার্কেট) এই লক্ষ্য দামের মধ্যে খুঁজুন।</li>
  <li>আরও দোকান যোগ করলে ফল আরও ভালো হবে — "যেসব দোকান দেখা হচ্ছে" ট্যাবে যোগ করুন।</li>
</ul>`)}`;
  return ctx.page('মার্কেট রিসার্চ', body, 'research');
}

// "এখনই আপডেট করুন": read one shop per call (the page calls it until all are fresh)
async function runApi(ctx) {
  const r = await R.tick({ force: true });
  return ctx.json(ctx.res, 200, r);
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/research', perm: 'owner', handler: page },
    { method: 'POST', path: '/admin/api/research/run', perm: 'owner', handler: runApi },
  ],
};
void raw; void fmtDate;

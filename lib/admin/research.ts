// Admin → মার্কেট রিসার্চ (owner only). Nothing here is ever shown on the shop.
import { html, raw, bn, money, int, str, fmtDate } from '../util';
import * as db from '../db';
import * as R from '../services/research';
import * as ui from './ui';
import type { AdminCtx, Loose } from '../types';

const TABS = [['winning', '🏆 উইনিং প্রোডাক্ট'], ['find', '🔍 প্রোডাক্ট খুঁজুন'], ['new', '🆕 বাজারে নতুন'], ['drops', '📉 দাম কমেছে'], ['demand', '🔎 আপনার কাস্টমার যা খুঁজছে'], ['sources', '🏪 যেসব দোকান দেখা হচ্ছে']];

function pic(src?: Loose) { return src ? html`<img src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer">` : html`<span>📦</span>`; }
function ago(d?: Loose) {
  if (!d) return 'এখনো না';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'এইমাত্র' : m < 60 ? `${bn(m)} মিনিট আগে` : m < 1440 ? `${bn(Math.round(m / 60))} ঘণ্টা আগে` : `${bn(Math.round(m / 1440))} দিন আগে`;
}

function winningCard(g?: Loose, i?: Loose, segment: Loose = '') {
  const links = R.sourcingLinks(g.term);
  return html`<article class="rs-card">
    <div class="rs-rank">${bn(i + 1)}</div>
    <a class="rs-pic" href="${g.best.url}" target="_blank" rel="noopener noreferrer">${pic(g.lead.image)}</a>
    <div class="rs-body">
      <h3><a href="${g.lead.url}" target="_blank" rel="noopener noreferrer">${g.lead.title}</a></h3>
      <p class="rs-why">${g.why.slice(0, 4).map((w?: Loose) => html`<span>${w}</span>`)}</p>
      <div class="rs-nums">
        <div><small>বাজারে দাম</small><b>${g.min === g.max ? money(g.min) : html`${money(g.min)} – ${money(g.max)}`}</b><small>সবচেয়ে কম: ${g.best.shop}</small></div>
        <div><small>আপনি বিক্রি করতে পারেন</small><b class="good">${g.sell ? money(g.sell) : '—'}</b><small>বাজারের মাঝামাঝি দামের সামান্য কম</small></div>
        <div><small>এর চেয়ে কমে কিনলে লাভ</small><b class="warn">${g.buyMax ? money(g.buyMax) : '—'}</b><small>কেনা দাম এর মধ্যে রাখুন</small></div>
        <div><small>আপনার দোকানে</small>${oursCell(g.oursAll || [], g.best.url, g.min, g.max, `/admin/research${segment ? `?seg=${segment}` : ''}`)}</div>
      </div>
      <p class="rs-src"><small>কোথা থেকে কিনবেন খুঁজুন:</small> ${links.map(([l, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`)}</p>
      <p class="rs-shops small muted">যে দোকানে আছে: ${g.items.slice(0, 5).map((x?: Loose) => html`<a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.shop} (${money(x.price)}${x.rank ? `, #${bn(x.rank)}` : ''})</a> `)}</p>
    </div>
  </article>`;
}

// "is it in our shop?" — every matching product, with a link; unsure matches say so
// The import page opens in the SAME tab: a new tab on a phone is handed to the customer app
// (it owns shobmilbe.com links), which never opens admin pages.
function impLink(url?: Loose, back?: Loose) { return `/admin/products/import?url=${encodeURIComponent(url)}${back ? `&back=${encodeURIComponent(back)}` : ''}`; }
function oursCell(list?: Loose, url?: Loose, min?: Loose, max?: Loose, back: Loose = '/admin/research') {
  if (!list.length) return html`<b class="bad">নেই</b><small><a href="${impLink(url, back)}">➕ তথ্য কপি করে আনুন →</a></small>`;
  const sure = list[0].match >= 0.85;
  const p = list[0];
  const priceNote = min && max ? (Number(p.price) > max ? '⚠️ বাজারের চেয়ে বেশি দাম' : Number(p.price) < min ? 'বাজারের চেয়ে কম দাম' : 'দাম বাজারের মধ্যে') : '';
  return html`<b class="${sure ? '' : 'warn'}">${sure ? (list.length > 1 ? `আছে (${bn(list.length)}টি)` : 'আছে') : 'সম্ভবত আছে'}</b>
    ${list.slice(0, 3).map((x?: Loose) => html`<small><a href="/admin/products/${x.id}">${x.name.length > 46 ? x.name.slice(0, 44) + '…' : x.name} — ${money(x.price)}</a>${x.active === false ? ' (বন্ধ)' : ''}${x.via === 'link' ? ' · এই দোকান থেকেই আনা' : ''}</small>`)}
    ${sure ? (priceNote || p.cost_price ? html`<small>${priceNote}${p.cost_price ? ` · কেনা ${money(p.cost_price)}` : ''}</small>` : '') : html`<small>নাম পুরো মেলেনি — মিলিয়ে দেখুন। <a href="${impLink(url, back)}">আলাদা হলে আনুন →</a></small>`}`;
}

// another shop seen on Google: paste its link once, every later search includes it
function addShop(term?: Loose) {
  const g = `https://www.google.com/search?q=${encodeURIComponent(term + ' price in Bangladesh')}`;
  return html`<section class="panel rs-addshop"><h2>আরও দোকানে খুঁজতে চান?</h2>
    <p class="small muted"><a href="${g}" target="_blank" rel="noopener noreferrer">Google-এ "${term} price in Bangladesh" খুলুন →</a> যে দোকানে পণ্যটা দেখবেন, তার লিংক নিচে দিন। এরপর থেকে প্রতিটা সার্চে ওই দোকানেও খোঁজা হবে (সারাদিন পড়া হবে না, শুধু আপনি খুঁজলে)।</p>
    <form method="post" action="/admin/research" class="toolbar"><input type="hidden" name="form" value="add_search"><input type="hidden" name="q" value="${term}">
      <input type="url" name="url" placeholder="https://দোকানের-ঠিকানা.com" required maxlength="300"><button class="btn btn-sm">➕ সার্চে যোগ করুন</button></form></section>`;
}

// 🔍 search every shop by product name
async function findTab(ctx: AdminCtx) {
  const term = str(ctx.query.get('q') || '', 80).trim();
  const form = html`<form method="get" action="/admin/research" class="toolbar rs-find" data-rs-find><input type="hidden" name="tab" value="find">
    <input type="search" name="q" value="${term}" placeholder="পণ্যের নাম বা নামের অংশ — যেমন TDA2030, 7812, SG90" required minlength="2" maxlength="80" autofocus>
    <button class="btn">🔍 সব দোকানে খুঁজুন</button><span class="small muted" data-rs-find-msg></span></form>
    <p class="small muted">যেসব দোকান দেখা হচ্ছে আর বাংলাদেশের কম্পোনেন্টের দোকানগুলো — সবগুলোতে এখনই খোঁজা হয় (দোকানের নিজের সার্চ দিয়ে) + আগে পড়া তথ্য। ২০–২৫ সেকেন্ড লাগতে পারে। যেটা পছন্দ "➕ যোগ করুন" চাপুন — পণ্য আমদানির পেজ খুলে তথ্য ও ছবি নিজে থেকে কপি হয়ে আসবে, সেভ করে "← সার্চে ফিরে যান" চাপলে এই তালিকায় ফিরবেন।</p>`;
  if (term.length < 2) return form;
  const r = await R.searchMarket(term, { fresh: ctx.query.get('fresh') === '1' });
  const back = `/admin/research?tab=find&q=${encodeURIComponent(term)}`;
  const have = r.items.filter((x) => x.ours.length).length;
  const shopLine = r.again ? html`<p class="small muted">একটু আগে সব দোকানে খোঁজা হয়েছিল — সেই ফল দেখানো হচ্ছে। <a href="/admin/research?tab=find&fresh=1&q=${encodeURIComponent(term)}">আবার খুঁজুন</a></p>` : r.shops.length ? (() => {
    const got = r.shops.filter((x) => x.n), none = r.shops.filter((x) => !x.n && !x.error), bad = r.shops.filter((x) => x.error);
    return html`<p class="small muted rs-shopline">🏪 ${bn(r.shops.length)}টি দোকানে খোঁজা হলো${got.length ? html` — পাওয়া গেছে: ${got.map((x) => html`<span class="good">${x.name} (${bn(x.n)})</span> `)}` : ''}</p>
      ${none.length || bad.length ? html`<details class="small muted rs-shopline"><summary>${none.length ? `${bn(none.length)}টিতে পাওয়া যায়নি` : ''}${none.length && bad.length ? ' · ' : ''}${bad.length ? `${bn(bad.length)}টি খোলা যায়নি` : ''}</summary>
        ${none.map((x) => html`<span>${x.name}</span> `)}${bad.map((x) => html`<span class="bad">${x.name}: ${x.error}</span> `)}</details>` : ''}`;
  })() : '';
  if (!r.items.length) return html`${form}${shopLine}${ui.empty(`"${term}" কোনো দোকানে পাওয়া যায়নি। নামটা ছোট করে বা মডেল নম্বর দিয়ে খুঁজুন।`)}
    <p class="rs-src"><small>অন্য জায়গায় খুঁজুন:</small> ${R.sourcingLinks(term).map(([l, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`)}</p>${addShop(term)}`;
  const prices = r.items.map((x) => Number(x.price)).filter((x) => x > 0);
  const parts = r.items.filter((x) => !x.made);
  const made = r.items.filter((x) => x.made);
  const rows = (list?: Loose) => html`<div class="table-wrap panel"><table class="table rs-find-table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th class="num">দাম</th><th>আপনার দোকানে</th></tr></thead>
    <tbody>${list.map((x?: Loose) => html`<tr class="${x.ours.length ? 'rs-have' : ''}"><td class="thumb">${pic(x.image)}</td>
      <td><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.title}</a>${x.category ? html`<br><span class="small muted">${x.category}</span>` : ''}</td>
      <td class="small">${x.shop}${x.in_stock === false ? html`<br><span class="bad">স্টক নেই</span>` : ''}</td>
      <td class="num">${x.price ? html`<b>${money(x.price)}</b>${x.regular_price ? html`<br><s class="small muted">${money(x.regular_price)}</s>` : ''}` : '—'}</td>
      <td class="rs-ours">${x.ours.length ? oursCell(x.ours, x.url, 0, 0, back) : html`<a class="btn btn-sm" href="${impLink(x.url, back)}">➕ যোগ করুন</a>`}</td></tr>`)}</tbody></table></div>`;
  return html`${form}${shopLine}
    <div class="rs-status panel"><span>📦 <b>${bn(r.items.length)}</b>টি পাওয়া গেছে</span><span>🏪 <b>${bn(new Set(r.items.map((x) => x.shop)).size)}</b>টি দোকানে</span>
      ${prices.length ? html`<span>💰 বাজারে দাম <b>${money(Math.min(...prices))} – ${money(Math.max(...prices))}</b></span>` : ''}
      <span>${have ? html`✅ <b>${bn(have)}</b>টি আপনার দোকানে আছে` : '❌ আপনার দোকানে একটাও নেই'}</span></div>
    ${made.length && parts.length ? html`<h2 class="rs-sec">🔹 শুধু পার্ট / IC <small>${bn(parts.length)}টি</small></h2>` : ''}
    ${parts.length ? rows(parts) : ''}
    ${made.length ? html`<h2 class="rs-sec">🔸 এটা দিয়ে বানানো বোর্ড / মডিউল / কিট <small>${bn(made.length)}টি — প্রতিটা আলাদা পণ্য</small></h2>${rows(made)}` : ''}
    ${addShop(term)}`;
}

async function page(ctx: AdminCtx) {
  const tab = TABS.some((t) => t[0] === ctx.query.get('tab')) ? ctx.query.get('tab') : 'winning';
  const segment = R.SEGMENTS[ctx.query.get('seg')] ? ctx.query.get('seg') : '';
  const margin = Math.min(80, Math.max(5, int(ctx.settings.research_margin, 30)));
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'add_search') {
      const back = `/admin/research?tab=find&fresh=1&q=${encodeURIComponent(str(b.q, 80))}`;
      try { await R.addSource(str(b.url, 300), 'electronics', '', true); } catch (e: Loose) { return ctx.fail(back, e.message); }
      return ctx.back(back, 'added');
    }
    if (b.form === 'add') {
      try { await R.addSource(str(b.url, 300), b.segment, str(b.name, 60)); } catch (e: Loose) { return ctx.fail('/admin/research?tab=sources', e.message); }
      return ctx.back('/admin/research?tab=sources', 'added');
    }
    if (b.form === 'toggle' && int(b.id)) await db.q('UPDATE research_sources SET active = NOT active WHERE id=$1', [int(b.id)]);
    if (b.form === 'delete' && int(b.id)) await ctx.trash('research_source', int(b.id));
    if (b.form === 'margin') { await db.setSetting('research_margin', String(Math.min(80, Math.max(5, int(b.margin, 30))))); await ctx.reloadSettings(); }
    return ctx.back(`/admin/research?tab=${b.form === 'margin' ? 'winning' : 'sources'}`, 'saved');
  }
  const st = await R.status();
  const segChips = html`<div class="chips">${[['', 'সব'], ...Object.entries(R.SEGMENTS)].map(([k, l]) => html`<a class="chip ${segment === k ? 'on' : ''}" href="/admin/research?tab=${tab}${k ? `&seg=${k}` : ''}">${l}</a>`)}</div>`;
  let content: Loose = '';
  if (tab === 'find') {
    content = await findTab(ctx);
  } else if (tab === 'winning') {
    const list = await R.winners({ segment, margin });
    content = html`${segChips}
      <form method="post" action="/admin/research" class="toolbar rs-margin"><input type="hidden" name="form" value="margin">
        <label>কত % লাভ রাখতে চান <input type="number" name="margin" value="${margin}" min="5" max="80" class="w-num"></label><button class="btn btn-sm btn-ghost">হিসাব বদলান</button>
        <span class="small muted">"এর চেয়ে কমে কিনলে লাভ" এই হার দিয়ে হিসাব হয়।</span></form>
      ${list.length ? html`<div class="rs-list">${list.map((g, i) => winningCard(g, i, segment))}</div>` : ui.empty('এখনো যথেষ্ট তথ্য জমেনি। কয়েক ঘণ্টা পর আবার দেখুন, বা উপরের "এখনই আপডেট করুন" চাপুন।')}`;
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
        <p class="small muted">বাংলাদেশের প্রায় যেকোনো অনলাইন দোকান যোগ করা যায়। WooCommerce / Shopify দোকানের পুরো তালিকা একবারে পড়া হয় (বিক্রির ক্রমসহ)। অন্য দোকান (নিজস্ব ওয়েবসাইট) <b>পেজ ধরে ধরে</b> পড়া হয়: সাইটম্যাপ আর ক্যাটাগরি পেজ থেকে পণ্যের পেজ, তারপর প্রতিটা পণ্যের দাম ও স্টক। প্রতিবার ~২৫টা পেজ, ঘণ্টায় কয়েকবার। প্রথমবার পুরো দোকান পড়তে কয়েক দিন লাগে, তারপর প্রতিদিন নতুন পণ্য আর জনপ্রিয় পণ্যের দাম আবার দেখা হয়। দোকান যে পেজ রোবটকে পড়তে দেয় না (robots.txt), সেটা পড়া হয় না। Daraz, Facebook পেজ স্বয়ংক্রিয় পড়া বন্ধ রেখেছে।</p>
      </form></section>
      <div class="table-wrap panel"><table class="table"><thead><tr><th>দোকান</th><th>ধরন</th><th class="num">পণ্য (দাম জানা)</th><th>পেজ পড়া</th><th>শেষ পড়া</th><th>অবস্থা</th><th>চালু</th><th>মুছুন</th></tr></thead>
      <tbody>${sources.map((s) => html`<tr class="${s.active ? '' : 'row-off'}"><td><b>${s.name}</b><br><a class="small muted" href="${s.url}" target="_blank" rel="noopener noreferrer">${s.url}</a></td>
        <td class="small">${s.search_only ? html`<b>🔍 শুধু সার্চে</b> · ` : ''}${R.SEGMENTS[s.segment] || s.segment} · ${s.kind === 'woo' ? 'WooCommerce (বিক্রির ক্রম সহ)' : s.kind === 'shopify' ? 'Shopify' : s.kind === 'auto' ? 'প্রথম সার্চে চেনা হবে' : 'পেজ ধরে ধরে'}</td>
        <td class="num">${bn(s.live_items)}</td>
        <td class="small">${s.kind === 'site' ? (s.queued ? html`${bn(s.queued - s.waiting)} / ${bn(s.queued)}${s.waiting ? html`<br><span class="muted">${bn(s.waiting)}টি বাকি</span>` : html`<br><span class="good">সব পড়া হয়েছে</span>`}` : html`<span class="muted">শুরু হয়নি</span>`) : html`<span class="muted">একবারে পুরো তালিকা</span>`}</td>
        <td class="small">${ago(s.last_ok)}</td>
        <td class="small">${s.last_error ? html`<span class="bad">⚠️ ${s.last_error}</span>` : s.active ? '✅ চালু' : 'বন্ধ'}</td>
        <td>${ui.rowSwitch(`/admin/toggle/research/${s.id}`, s.active, 'বন্ধ করলে এই দোকান আর পড়া হবে না')}</td>
        <td class="prod-actions"><form method="post" action="/admin/research?tab=sources" data-confirm="এই দোকান আর তার সব তথ্য মুছবেন? রিসাইকেল বিনে থাকবে।"><input type="hidden" name="form" value="delete"><input type="hidden" name="id" value="${s.id}"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>`)}</tbody></table></div>`;
  }
  const body = html`<h1>🔭 মার্কেট রিসার্চ <small>শুধু আপনি দেখতে পাচ্ছেন — দোকানে কোথাও দেখায় না</small></h1>
${ui.flash(ctx.flash)}
<div class="rs-status panel">
  <span>🏪 <b>${bn(st!.sources)}</b>টি দোকান দেখা হচ্ছে</span><span>📦 <b>${bn(st!.items)}</b>টি পণ্যের দাম জানা</span>
  <span>🕒 শেষ আপডেট: <b data-rs-last>${ago(st!.last_ok)}</b></span>
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
async function runApi(ctx: AdminCtx) {
  const r = await R.tick({ force: true });
  return ctx.json(ctx.res, 200, r);
}

export const routes = [
    { method: '*', path: '/admin/research', perm: 'owner', handler: page },
    { method: 'POST', path: '/admin/api/research/run', perm: 'owner', handler: runApi },
  ];
void raw; void fmtDate;

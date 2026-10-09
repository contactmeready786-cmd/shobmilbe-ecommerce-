'use strict';
// Admin → মার্কেটিং → ফ্ল্যাশ সেল ও অফার
//   • ফ্ল্যাশ সেল: a start and end time, products (by SKU) with a sale price and an optional piece limit.
//     While it runs the sale price is the price everywhere in the shop; the home page shows a row with a countdown.
//   • এটা কিনলে ওটা ফ্রি (Buy X Get Y): buy N of a product → get M of the same or another product free / % off.
// The pricing itself lives in services/pricing.js (one discount per line, flash lines take no coupon).
const { html, bn, int, str, list, money, amount, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const pricing = require('../services/pricing');

const BASE = '/admin/marketing/flash';
const DHAKA_MS = 6 * 3600e3; // Bangladesh: UTC+6, no summer time
const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() + DHAKA_MS).toISOString().slice(0, 16) : '');
function fromLocalInput(v) {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00+06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const validDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

function tabs(tab) {
  return html`<nav class="rs-tabs">
    <a class="tab ${tab === 'flash' ? 'on' : ''}" href="${BASE}">⚡ ফ্ল্যাশ সেল</a>
    <a class="tab ${tab === 'offers' ? 'on' : ''}" href="${BASE}?tab=offers">🎁 এটা কিনলে ওটা ফ্রি</a>
    <a class="tab" href="/admin/marketing/coupons">🏷️ কুপন</a>
  </nav>`;
}
function saleState(s) {
  const now = Date.now();
  if (!s.active) return ['বন্ধ', ''];
  if (now < new Date(s.starts_at).getTime()) return ['শুরু হয়নি', 'pill-pending'];
  if (now >= new Date(s.ends_at).getTime()) return ['শেষ', ''];
  return ['🔴 চলছে', 'pill-delivered'];
}

// ---------------------------------------------------------------- flash sales
async function flashPage(ctx) {
  const tab = ctx.query.get('tab') === 'offers' ? 'offers' : 'flash';
  if (tab === 'offers') return offersPage(ctx);
  const editId = int(ctx.query.get('edit')) || null;
  if (ctx.method === 'POST') return saveFlash(ctx);
  const sales = await db.q(`SELECT fs.*, (SELECT count(*)::int FROM flash_items WHERE sale_id=fs.id) AS items,
      (SELECT coalesce(sum(sold),0)::int FROM flash_items WHERE sale_id=fs.id) AS sold
    FROM flash_sales fs ORDER BY (fs.active AND now() < fs.ends_at) DESC, fs.starts_at DESC LIMIT 100`);
  const editing = editId ? sales.find((x) => x.id === editId) : null;
  const items = editing ? await db.q(`SELECT fi.*, p.name, p.sku, p.price AS base, p.stock FROM flash_items fi JOIN products p ON p.id=fi.product_id
    WHERE fi.sale_id=$1 ORDER BY fi.id`, [editing.id]) : [];
  return ctx.page('ফ্ল্যাশ সেল', flashBody(ctx, sales, editing, items), 'flash');
}
function flashBody(ctx, sales, editing, items, error = null) {
  const e = editing || { title: '', show_home: true, active: true };
  const now = new Date();
  const start = editing ? toLocalInput(e.starts_at) : toLocalInput(now);
  const end = editing ? toLocalInput(e.ends_at) : toLocalInput(new Date(now.getTime() + 24 * 3600e3));
  const rows = items.length ? items : [];
  const blank = Math.max(3, 6 - rows.length);
  const row = (it) => html`<div class="field-row tier-row flash-row">
    ${ui.field('পণ্যের SKU', ui.input('sku[]', it.sku || '', { maxlength: 40, placeholder: 'যেমন 101' }), it.name ? html`${it.name} · এখন দাম ${money(it.base)} · স্টক ${bn(it.stock)}` : '')}
    ${ui.field('সেলের দাম (৳)', ui.input('sale_price[]', it.price ?? '', { type: 'number', min: 0.01, step: '0.01', class: 'w-num' }))}
    ${ui.field('সর্বোচ্চ কয়টা (ঐচ্ছিক)', ui.input('max_qty[]', it.max_qty || '', { type: 'number', min: 0, class: 'w-num', placeholder: '০ = সীমা নেই' }),
    it.id ? `বিক্রি হয়েছে ${bn(it.sold || 0)}টি` : '')}
  </div>`;
  return html`<h1>⚡ ফ্ল্যাশ সেল ও অফার</h1>${tabs('flash')}${ui.flash(ctx.flash)}
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
${ui.helpBox('ফ্ল্যাশ সেল কীভাবে কাজ করে', html`<ul>
  <li>শুরু আর শেষের সময় দিন, তারপর পণ্যের SKU আর সেলের দাম লিখুন। সময় হলেই দোকানের সব জায়গায় সেলের দাম বসে যাবে, আগের দাম কাটা দাগে দেখাবে, আর পণ্যের পেজে উল্টো গণনা (countdown) চলবে।</li>
  <li>"সর্বোচ্চ কয়টা" দিলে (যেমন ২০) — ২০টা বিক্রি হলেই ওই পণ্যের সেল শেষ, তারপর আগের দামে বিক্রি হবে। খালি বা ০ = কোনো সীমা নেই।</li>
  <li>হোমপেজে "⚡ ফ্ল্যাশ সেল" সারি দেখায় (চাইলে নিচের টিক তুলে দিন)। ডিজাইন → হোমপেজ থেকে সারিটা উপরে-নিচে সরাতে পারবেন।</li>
  <li>লোকসান ঠেকাতে: ফ্ল্যাশ সেলের পণ্যে কুপন চলে না, আর "বেশি কিনলে কম দাম" এর সাথে মিলিয়ে দুইবার ছাড় হয় না — যেটা কম সেটাই বসে।</li>
</ul>`)}
<div class="two-col">
  <section class="panel table-wrap">
    <h2>সব ফ্ল্যাশ সেল</h2>
    ${sales.length ? html`<table class="table"><thead><tr><th>নাম</th><th>সময়</th><th class="num">পণ্য</th><th class="num">বিক্রি</th><th>অবস্থা</th><th>চালু</th><th>কাজ</th></tr></thead>
    <tbody>${sales.map((x) => { const [st, cls] = saleState(x); return html`<tr class="${x.active ? '' : 'row-off'}">
      <td><b>${x.title}</b>${x.show_home ? '' : html`<br><span class="small muted">হোমপেজে দেখায় না</span>`}</td>
      <td class="small">${fmtDate(x.starts_at)}<br>→ ${fmtDate(x.ends_at)}</td>
      <td class="num">${bn(x.items)}</td><td class="num">${bn(x.sold)}</td>
      <td>${ui.pill(st, cls)}</td>
      <td>${ui.rowSwitch(`/admin/toggle/flash/${x.id}`, x.active, 'বন্ধ করলে সাথে সাথে আগের দাম ফিরে আসবে')}</td>
      ${ui.rowActions({ edit: `${BASE}?edit=${x.id}`, del: `${BASE}/${x.id}/delete`, delConfirm: `"${x.title}" ফ্ল্যাশ সেল মুছবেন? পুরো মুছে যাবে, আগের দাম ফিরে আসবে।` })}
    </tr>`; })}</tbody></table>` : ui.empty('এখনো কোনো ফ্ল্যাশ সেল নেই। ডান পাশ থেকে প্রথমটা বানান।')}
  </section>
  <section class="panel">
    <h2>${editing ? `এডিট: ${e.title}` : 'নতুন ফ্ল্যাশ সেল'}</h2>
    <form method="post" action="${BASE}" class="form">
      ${editing ? html`<input type="hidden" name="id" value="${editing.id}">` : ''}
      ${ui.field('নাম', ui.input('title', e.title, { required: true, maxlength: 80, placeholder: 'যেমন: শুক্রবারের ফ্ল্যাশ সেল' }), 'হোমপেজের সারির উপরে এই নাম দেখাবে')}
      <div class="field-row">
        ${ui.field('শুরু (বাংলাদেশ সময়)', ui.input('starts_at', start, { type: 'datetime-local', required: true }))}
        ${ui.field('শেষ (বাংলাদেশ সময়)', ui.input('ends_at', end, { type: 'datetime-local', required: true }))}
      </div>
      ${ui.check('show_home', e.show_home, 'হোমপেজে "⚡ ফ্ল্যাশ সেল" সারিতে দেখাও')}
      ${editing ? ui.check('active', e.active, 'চালু') : ''}
      <h3>পণ্য</h3>
      <div data-repeat="flash">${rows.map(row)}${Array.from({ length: blank }, () => row({}))}</div>
      <button type="button" class="btn btn-sm btn-ghost" data-repeat-add="flash">+ আরও পণ্য</button>
      <p class="small muted">খালি সারি বাদ যাবে। একই পণ্য দুইবার দিলে পরেরটা থাকবে। সেলের দাম পণ্যের এখনকার দামের চেয়ে কম হতে হবে।</p>
      <div class="row-actions"><button class="btn">${editing ? 'সেভ করুন' : 'ফ্ল্যাশ সেল তৈরি করুন'}</button>${editing ? html`<a class="btn btn-ghost" href="${BASE}">বাতিল</a>` : ''}</div>
    </form>
  </section>
</div>`;
}
async function saveFlash(ctx) {
  const b = await ctx.body();
  const id = int(b.id) || null;
  const title = str(b.title, 80);
  const starts = fromLocalInput(b.starts_at);
  const ends = fromLocalInput(b.ends_at);
  const skus = list(b.sku); const prices = list(b.sale_price); const maxes = list(b.max_qty);
  const problems = [];
  const items = new Map();
  for (let i = 0; i < skus.length; i++) {
    const sku = str(skus[i], 40);
    if (!sku) continue;
    const p = await db.one('SELECT id, name, price FROM products WHERE sku=$1', [sku]);
    const price = amount(prices[i]);
    if (!p) { problems.push(`SKU ${sku} পাওয়া যায়নি`); continue; }
    if (!(price > 0) || price >= Number(p.price)) { problems.push(`"${p.name}": সেলের দাম ৳০ এর বেশি আর এখনকার দাম ${money(p.price)} এর কম হতে হবে`); continue; }
    items.set(p.id, { product_id: p.id, price, max_qty: Math.max(0, int(maxes[i])) });
  }
  const error = !title ? 'নাম লিখুন।' : !starts || !ends ? 'শুরু আর শেষের সময় দিন।' : ends <= starts ? 'শেষের সময় শুরুর পরে হতে হবে।'
    : problems.length ? 'এগুলো ঠিক করুন: ' + problems.join('; ') : !items.size ? 'অন্তত একটা পণ্যের SKU আর সেলের দাম দিন।' : null;
  if (error) {
    const sales = await db.q('SELECT fs.*, 0 AS items, 0 AS sold FROM flash_sales fs ORDER BY fs.starts_at DESC LIMIT 100');
    const editing = { id, title, starts_at: starts || new Date(), ends_at: ends || new Date(), show_home: !!b.show_home, active: id ? !!b.active : true };
    const rows = [];
    for (let i = 0; i < skus.length; i++) if (str(skus[i])) rows.push({ sku: skus[i], price: prices[i], max_qty: maxes[i] });
    return ctx.page('ফ্ল্যাশ সেল', flashBody(ctx, sales, id ? editing : { ...editing, id: null }, rows, error), 'flash', { status: 400 });
  }
  const sid = await db.tx(async (t) => {
    let saleId = id;
    if (saleId) {
      await t.query('UPDATE flash_sales SET title=$1, starts_at=$2, ends_at=$3, show_home=$4, active=$5 WHERE id=$6', [title, starts, ends, !!b.show_home, !!b.active, saleId]);
    } else {
      saleId = (await t.query('INSERT INTO flash_sales(title, starts_at, ends_at, show_home) VALUES($1,$2,$3,$4) RETURNING id', [title, starts, ends, !!b.show_home])).rows[0].id;
    }
    // keep the "sold" count of products that stay in the sale
    const keep = [...items.keys()];
    await t.query('DELETE FROM flash_items WHERE sale_id=$1 AND NOT (product_id = ANY($2::int[]))', [saleId, keep]);
    for (const it of items.values()) {
      await t.query(`INSERT INTO flash_items(sale_id, product_id, price, max_qty) VALUES($1,$2,$3,$4)
        ON CONFLICT (sale_id, product_id) DO UPDATE SET price=EXCLUDED.price, max_qty=EXCLUDED.max_qty`, [saleId, it.product_id, it.price, it.max_qty]);
    }
    return saleId;
  });
  await ctx.log('settings', 'marketing', sid, `ফ্ল্যাশ সেল "${title}": ${items.size}টি পণ্য, ${fmtDate(starts)} → ${fmtDate(ends)}`);
  return ctx.back(BASE, 'saved');
}
async function deleteFlash(ctx, m) {
  const r = await db.one('DELETE FROM flash_sales WHERE id=$1 RETURNING title', [int(m[1])]);
  if (r) await ctx.log('delete', 'marketing', int(m[1]), `ফ্ল্যাশ সেল মুছা: ${r.title}`);
  return ctx.back(BASE, 'removed');
}

// ---------------------------------------------------------------- buy X get Y
async function offersPage(ctx, error = null, values = null) {
  if (ctx.method === 'POST' && !error) return saveOffer(ctx);
  const editId = int(ctx.query.get('edit')) || null;
  const offers = await db.q(`SELECT o.*, b.name AS buy_name, b.sku AS buy_sku, g.name AS get_name, g.sku AS get_sku,
      (SELECT coalesce(sum(i.qty),0)::int FROM order_items i JOIN orders od ON od.id=i.order_id WHERE i.kind='gift' AND i.ref_id=o.id AND od.status NOT IN ('cancelled','returned')) AS given
    FROM offers o JOIN products b ON b.id=o.buy_product_id LEFT JOIN products g ON g.id=o.get_product_id ORDER BY o.active DESC, o.id DESC LIMIT 100`);
  const editing = values || (editId ? offers.find((o) => o.id === editId) : null);
  const o = editing || { buy_qty: 1, get_qty: 1, get_percent: 100, max_times: 1, active: true };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const body = html`<h1>⚡ ফ্ল্যাশ সেল ও অফার</h1>${tabs('offers')}${ui.flash(ctx.flash)}
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
${ui.helpBox('"এটা কিনলে ওটা ফ্রি" কীভাবে কাজ করে', html`যেমন: <b>২টা ব্যাটারি কিনলে ১টা ফ্রি</b>, অথবা <b>Arduino কিনলে USB কেবল ফ্রি</b>, অথবা <b>মাল্টিমিটার কিনলে প্রোব ৫০% ছাড়ে</b>।
কাস্টমার শর্ত পূরণ করলে কার্টে নিজে থেকে "🎁 উপহার" লাইন যোগ হয়, অর্ডারে আলাদা লাইন হিসেবে থাকে আর স্টক থেকেও কমে। উপহারের স্টক না থাকলে উপহার যোগ হয় না (অর্ডার আটকায় না)। পণ্যের পেজেও অফারটা দেখায়। উপহারে কুপন চলে না।`)}
<div class="two-col">
  <section class="panel table-wrap">
    <h2>সব অফার</h2>
    ${offers.length ? html`<table class="table"><thead><tr><th>অফার</th><th>কিনলে</th><th>পাবে</th><th>মেয়াদ</th><th class="num">দেওয়া হয়েছে</th><th>চালু</th><th>কাজ</th></tr></thead>
    <tbody>${offers.map((x) => { const over = x.ends_on && String(x.ends_on).slice(0, 10) < today; return html`<tr class="${x.active && !over ? '' : 'row-off'}">
      <td><b>${pricing.offerTitle(x, bn)}</b></td>
      <td class="small">${bn(x.buy_qty)}× ${x.buy_name}<br><span class="muted">SKU ${x.buy_sku || '—'}</span></td>
      <td class="small">${bn(x.get_qty)}× ${x.get_product_id ? x.get_name : 'একই পণ্য'} — ${x.get_percent >= 100 ? 'ফ্রি' : `${bn(x.get_percent)}% ছাড়`}${x.max_times > 1 ? html`<br><span class="muted">এক অর্ডারে সর্বোচ্চ ${bn(x.max_times)} বার</span>` : ''}</td>
      <td class="small">${x.starts_on || x.ends_on ? `${x.starts_on ? String(x.starts_on).slice(0, 10) : '…'} → ${x.ends_on ? String(x.ends_on).slice(0, 10) : '…'}` : 'সবসময়'}${over ? html`<br><span class="warn">শেষ</span>` : ''}</td>
      <td class="num">${bn(x.given)}</td>
      <td>${ui.rowSwitch(`/admin/toggle/offer/${x.id}`, x.active, 'বন্ধ করলে আর উপহার যোগ হবে না')}</td>
      ${ui.rowActions({ edit: `${BASE}?tab=offers&edit=${x.id}`, del: `${BASE}/offers/${x.id}/delete`, delConfirm: 'অফারটি মুছবেন? আগের অর্ডারে দেওয়া উপহার যেমন আছে থাকবে।' })}</tr>`; })}</tbody></table>`
    : ui.empty('এখনো কোনো অফার নেই।')}
  </section>
  <section class="panel">
    <h2>${editing && editing.id ? 'অফার এডিট' : 'নতুন অফার'}</h2>
    <form method="post" action="${BASE}?tab=offers" class="form">
      ${editing && editing.id ? html`<input type="hidden" name="id" value="${editing.id}">` : ''}
      <div class="field-row">
        ${ui.field('যে পণ্য কিনবে (SKU)', ui.input('buy_sku', o.buy_sku || '', { required: true, maxlength: 40, placeholder: 'যেমন 101' }))}
        ${ui.field('কয়টা কিনলে', ui.input('buy_qty', o.buy_qty, { type: 'number', min: 1, class: 'w-num' }))}
      </div>
      <div class="field-row">
        ${ui.field('যে পণ্য পাবে (SKU)', ui.input('get_sku', o.get_product_id ? o.get_sku : (o.get_sku || ''), { maxlength: 40, placeholder: 'খালি = একই পণ্য' }))}
        ${ui.field('কয়টা পাবে', ui.input('get_qty', o.get_qty, { type: 'number', min: 1, class: 'w-num' }))}
      </div>
      <div class="field-row">
        ${ui.field('কত % ছাড়ে পাবে', ui.input('get_percent', o.get_percent, { type: 'number', min: 1, max: 100, class: 'w-num' }), '১০০ = একদম ফ্রি')}
        ${ui.field('এক অর্ডারে সর্বোচ্চ কতবার', ui.input('max_times', o.max_times, { type: 'number', min: 1, max: 50, class: 'w-num' }), 'যেমন ২ হলে ৪টা কিনলে ২টা ফ্রি')}
      </div>
      <div class="field-row">
        ${ui.field('শুরু (ঐচ্ছিক)', ui.input('starts_on', o.starts_on ? String(o.starts_on).slice(0, 10) : '', { type: 'date' }))}
        ${ui.field('শেষ (ঐচ্ছিক)', ui.input('ends_on', o.ends_on ? String(o.ends_on).slice(0, 10) : '', { type: 'date' }))}
      </div>
      ${ui.field('অফারের নাম (ঐচ্ছিক)', ui.input('title', o.title || '', { maxlength: 80, placeholder: 'খালি রাখলে নিজে থেকে: "২টা কিনলে ১টা ফ্রি"' }), 'দোকানে পণ্যের পেজে আর কার্টে এই লেখা দেখাবে')}
      ${editing && editing.id ? ui.check('active', editing.active, 'চালু') : ''}
      <div class="row-actions"><button class="btn">${editing && editing.id ? 'সেভ করুন' : 'অফার তৈরি করুন'}</button>${editing && editing.id ? html`<a class="btn btn-ghost" href="${BASE}?tab=offers">বাতিল</a>` : ''}</div>
    </form>
  </section>
</div>`;
  return ctx.page('অফার', body, 'flash', { status: error ? 400 : 200 });
}
async function saveOffer(ctx) {
  const b = await ctx.body();
  const id = int(b.id) || null;
  const buy = await db.one('SELECT id, name FROM products WHERE sku=$1', [str(b.buy_sku, 40)]);
  const get = str(b.get_sku, 40) ? await db.one('SELECT id, name FROM products WHERE sku=$1', [str(b.get_sku, 40)]) : null;
  const v = {
    title: str(b.title, 80), buy_qty: Math.max(1, Math.min(999, int(b.buy_qty, 1))), get_qty: Math.max(1, Math.min(999, int(b.get_qty, 1))),
    get_percent: Math.max(1, Math.min(100, int(b.get_percent, 100))), max_times: Math.max(1, Math.min(50, int(b.max_times, 1))),
    starts_on: validDate(b.starts_on), ends_on: validDate(b.ends_on), active: id ? !!b.active : true,
  };
  const error = !buy ? `যে পণ্য কিনবে — SKU "${str(b.buy_sku, 40)}" পাওয়া যায়নি।` : str(b.get_sku, 40) && !get ? `যে পণ্য পাবে — SKU "${str(b.get_sku, 40)}" পাওয়া যায়নি।`
    : v.starts_on && v.ends_on && v.ends_on < v.starts_on ? 'শেষের তারিখ শুরুর পরে হতে হবে।' : null;
  if (error) return offersPage({ ...ctx, method: 'GET' }, error, { ...v, id, buy_sku: b.buy_sku, get_sku: b.get_sku });
  const vals = [v.title, buy.id, v.buy_qty, get ? get.id : null, v.get_qty, v.get_percent, v.max_times, v.starts_on, v.ends_on, v.active];
  let oid = id;
  if (id) {
    await db.q(`UPDATE offers SET title=$1, buy_product_id=$2, buy_qty=$3, get_product_id=$4, get_qty=$5, get_percent=$6, max_times=$7,
      starts_on=$8, ends_on=$9, active=$10 WHERE id=$11`, [...vals, id]);
  } else {
    oid = (await db.one(`INSERT INTO offers(title, buy_product_id, buy_qty, get_product_id, get_qty, get_percent, max_times, starts_on, ends_on, active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals)).id;
  }
  await ctx.log('settings', 'marketing', oid, `অফার: ${v.buy_qty}× ${buy.name} কিনলে ${v.get_qty}× ${get ? get.name : 'একই পণ্য'} ${v.get_percent >= 100 ? 'ফ্রি' : v.get_percent + '% ছাড়ে'}`);
  return ctx.back(`${BASE}?tab=offers`, 'saved');
}
async function deleteOffer(ctx, m) {
  const r = await db.one('DELETE FROM offers WHERE id=$1 RETURNING id', [int(m[1])]);
  if (r) await ctx.log('delete', 'marketing', r.id, 'অফার মুছা');
  return ctx.back(`${BASE}?tab=offers`, 'removed');
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'marketing', handler: flashPage },
    { method: 'POST', path: /^\/admin\/marketing\/flash\/(\d+)\/delete$/, perm: 'marketing', handler: deleteFlash },
    { method: 'POST', path: /^\/admin\/marketing\/flash\/offers\/(\d+)\/delete$/, perm: 'marketing', handler: deleteOffer },
  ],
};

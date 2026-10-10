'use strict';
// Admin → স্টক ও কেনাকাটা → 🏬 গুদাম ও শাখা: more than one place where goods are kept (a second store, a branch shop).
// Each has its own count; the main store (where online orders are packed) is the rest of the total stock.
const { html, int, str, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const W = require('../models/warehouses');

const BASE = '/admin/warehouses';
const REASON = { transfer: '🔁 স্থানান্তর', sale: '🧾 দোকানে বিক্রি', sale_cancel: '↩️ বিক্রি বাতিল', count: '🔢 গণনা ঠিক' };

// "SKU / barcode / name" typed or scanned → one product (variants are separate products)
async function findProduct(code) {
  const c = str(code, 100);
  if (!c) return null;
  const exact = await db.one(`SELECT id, name, stock, variant_count FROM products WHERE (upper(barcode)=upper($1) OR lower(sku)=lower($1)) AND variant_count = 0 LIMIT 1`, [c]);
  if (exact) return exact;
  const rows = await db.q(`SELECT id, name, stock FROM products WHERE name ILIKE $1 AND variant_count = 0 AND product_type='single' ORDER BY length(name) LIMIT 2`, [`%${c}%`]);
  return rows.length === 1 ? rows[0] : null;
}

function transferForm(stores, { from = '', to = '', back = BASE } = {}) {
  const opts = [['0', '🏠 মূল গুদাম (অনলাইন)'], ...stores.filter((w) => w.active).map((w) => [w.id, `${w.is_shop ? '🏪' : '🏬'} ${w.name}`])];
  return html`<form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="transfer"><input type="hidden" name="back" value="${back}">
    ${ui.field('পণ্য (SKU, বারকোড স্ক্যান বা নাম)', ui.input('code', '', { required: true, maxlength: 100, autocomplete: 'off', placeholder: 'যেমন 125 বা SB000125' }))}
    <div class="field-row">${ui.field('কোথা থেকে', ui.select('from', opts, from || '0'))}${ui.field('কোথায়', ui.select('to', opts, to || (stores[0] ? stores[0].id : '0')))}
      ${ui.field('কয়টি', ui.input('qty', '1', { type: 'number', min: 1, required: true, class: 'w-num' }))}</div>
    ${ui.field('নোট (ঐচ্ছিক)', ui.input('note', '', { maxlength: 200 }))}
    <button class="btn btn-sm">🔁 স্থানান্তর করুন</button></form>`;
}

async function listPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const back = /^\/admin\/warehouses(\/\d+)?$/.test(String(b.back || '')) ? b.back : BASE;
    try {
      if (b.action === 'save') {
        const id = await W.save(b);
        await ctx.log('warehouse_save', 'warehouse', id, str(b.name, 80));
        return ctx.back(back, 'saved');
      }
      if (b.action === 'transfer') {
        const p = await findProduct(b.code);
        if (!p) return ctx.fail(back, `"${str(b.code, 40)}" দিয়ে একটা পণ্য পাওয়া যায়নি — SKU বা বারকোড দিন।`);
        await W.transfer({ productId: p.id, qty: b.qty, from: b.from, to: b.to, note: b.note }, ctx.user.id);
        await ctx.log('warehouse_move', 'product', p.id, `${p.name} ×${int(b.qty)} স্থানান্তর`);
        return ctx.redirect(ctx.res, back + '?info=' + encodeURIComponent(`✅ "${p.name}" ${bn(int(b.qty))}টি সরানো হয়েছে।`));
      }
      if (b.action === 'count') {
        const r = await W.setCount(b.wh, b.product, b.qty, ctx.user.id);
        await ctx.log('warehouse_count', 'product', int(b.product), `${r.name}: ${r.was} → ${r.now}`);
        return ctx.back(back, 'saved');
      }
      if (b.action === 'delete') {
        if (!ctx.can('inventory')) return ctx.back(BASE, 'noperm');
        await ctx.trash('warehouse', int(b.id));
        await ctx.log('warehouse_delete', 'warehouse', int(b.id), 'মুছে ফেলা — এর পণ্য মূল গুদামে গণ্য হবে');
        return ctx.back(BASE, 'deleted');
      }
    } catch (e) {
      if (!(e instanceof W.WhError)) throw e;
      return ctx.fail(back, e.message);
    }
    return ctx.back(BASE);
  }
  const [stores, moves, problems, totals] = await Promise.all([W.list(), W.moves({ limit: 30 }), W.problems(),
    db.one(`SELECT coalesce(sum(stock),0)::int AS units FROM products WHERE product_type='single' AND variant_count = 0`)]);
  const inBranches = stores.reduce((t, w) => t + w.units, 0);
  const body = html`<div class="title-row"><h1>🏬 গুদাম ও শাখা</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}">🔄 রিফ্রেশ</a><a class="btn btn-sm" href="/admin/pos">🧾 দোকানে বিক্রি (POS)</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li><b>মূল গুদাম</b> = যেখান থেকে অনলাইন অর্ডার প্যাক হয়। পারচেজ (মাল কেনা) আর অনলাইন বিক্রি মূল গুদামের হিসাবে চলে।</li>
  <li>আরেকটা দোকান/শাখা বা আলাদা গুদাম থাকলে নিচে যোগ করুন। তারপর "স্থানান্তর" দিয়ে মূল গুদাম থেকে পণ্য পাঠান — প্রতিটা শাখার আলাদা স্টক থাকবে।</li>
  <li>শাখার দোকানে সরাসরি বিক্রি করতে <a href="/admin/pos">POS</a> খুলে শাখা বাছুন — বিক্রি সেই শাখার স্টক থেকে কাটবে।</li>
  <li>মোট স্টক (সব জায়গা মিলিয়ে) আগের মতোই ইনভেন্টরি পেজে দেখা যায়।</li>
</ol>`)}
<div class="kpis kpis-tight">
  ${ui.kpi('মোট স্টক (সব জায়গা)', bn(totals.units), 'পিস')}
  ${ui.kpi('🏠 মূল গুদামে', bn(totals.units - inBranches), 'অনলাইন অর্ডার এখান থেকে', 'kpi-blue')}
  ${ui.kpi('শাখাগুলোতে', bn(inBranches), `${bn(stores.length)}টি গুদাম/শাখা`)}
  ${problems.length ? ui.kpi('মিলছে না', bn(problems.length), 'নিচে দেখুন', 'kpi-alert') : ''}
</div>
${problems.length ? html`<section class="panel"><h2>⚠️ এই পণ্যগুলোর হিসাব মিলছে না</h2><p class="small muted">শাখায় যত গোনা আছে, মোট স্টক তার চেয়ে কম (সম্ভবত অনলাইনে বিক্রি হয়েছে শাখার মাল দিয়ে)। শাখার গণনা ঠিক করুন বা ইনভেন্টরিতে মোট স্টক ঠিক করুন।</p>
  <ul>${problems.map((p) => html`<li>${p.name} (SKU ${p.sku}) — মোট ${bn(p.stock)}, শাখাগুলোতে ${bn(p.branches)}</li>`)}</ul></section>` : ''}
<div class="two-col">
  <section class="panel table-wrap"><h2>সব জায়গা</h2>
    <table class="table compact"><thead><tr><th>নাম</th><th>ধরন</th><th class="num">পণ্য</th><th class="num">পিস</th><th></th></tr></thead><tbody>
      <tr><td><b>🏠 মূল গুদাম</b><br><span class="small muted">অনলাইন অর্ডার</span></td><td class="small">মূল</td><td></td><td class="num">${bn(totals.units - inBranches)}</td><td><a class="btn btn-sm btn-ghost" href="/admin/inventory">ইনভেন্টরি</a></td></tr>
      ${stores.map((w) => html`<tr class="${w.active ? '' : 'row-off'}"><td><a href="${BASE}/${w.id}"><b>${w.name}</b></a>${w.address ? html`<br><span class="small muted">${w.address}</span>` : ''}</td>
        <td class="small">${w.is_shop ? '🏪 দোকান (POS)' : '🏬 গুদাম'}${w.active ? '' : ' · বন্ধ'}</td><td class="num">${bn(w.products)}</td><td class="num">${bn(w.units)}</td>
        <td><a class="btn btn-sm btn-ghost" href="${BASE}/${w.id}">খুলুন</a></td></tr>`)}
    </tbody></table>
  </section>
  <div>
    <section class="panel"><h2>🔁 স্থানান্তর</h2>${stores.length ? transferForm(stores) : html`<p class="muted">আগে একটা শাখা/গুদাম যোগ করুন।</p>`}</section>
    <section class="panel"><h2>+ নতুন শাখা / গুদাম</h2>
      <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="save">
        ${ui.field('নাম', ui.input('name', '', { required: true, maxlength: 80, placeholder: 'যেমন: মিরপুর শাখা' }))}
        <div class="field-row">${ui.field('ঠিকানা', ui.input('address', '', { maxlength: 300 }))}${ui.field('ফোন', ui.input('phone', '', { maxlength: 30 }))}</div>
        ${ui.check('is_shop', true, 'এটা একটা দোকান (POS-এ বিক্রি হবে)')}
        <button class="btn btn-sm">যোগ করুন</button></form></section>
  </div>
</div>
<section class="panel table-wrap"><h2>সাম্প্রতিক নড়াচড়া</h2>${movesTable(moves)}</section>`;
  return ctx.page('গুদাম ও শাখা', body, 'warehouses');
}

function movesTable(moves) {
  if (!moves.length) return html`<p class="muted">এখনো কিছু নেই।</p>`;
  return html`<table class="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th class="num">পরিমাণ</th><th>কোথা থেকে → কোথায়</th><th>কী</th><th>কে</th></tr></thead><tbody>
  ${moves.map((m) => html`<tr><td class="small nowrap">${fmtDate(m.created_at)}</td><td>${m.name || '—'} <span class="small muted">${m.sku || ''}</span></td><td class="num">${bn(m.qty)}</td>
    <td class="small">${m.from_wh ? m.from_name || '—' : m.reason === 'sale_cancel' ? 'ক্রেতা' : '🏠 মূল'} → ${m.to_wh ? m.to_name || '—' : m.reason === 'sale' ? 'ক্রেতা' : '🏠 মূল'}</td>
    <td class="small">${REASON[m.reason] || m.reason}${m.order_code ? html` <a href="/admin/orders/${m.ref_id}">${m.order_code}</a>` : ''}${m.note ? ` · ${m.note}` : ''}</td><td class="small">${m.staff_name || ''}</td></tr>`)}
  </tbody></table>`;
}

async function storePage(ctx, m) {
  const w = await W.get(int(m[1]));
  if (!w) return ctx.redirect(ctx.res, BASE);
  const q = str(ctx.query.get('q'), 60);
  const back = `${BASE}/${w.id}`;
  const [rows, stores, moves] = await Promise.all([W.storeStock(w.id, { q }), W.list(), W.moves({ whId: w.id, limit: 40 })]);
  const body = html`<p class="crumbs"><a href="${BASE}">← সব গুদাম ও শাখা</a></p>
<div class="title-row"><h1>${w.is_shop ? '🏪' : '🏬'} ${w.name}</h1><div class="row-actions">${w.is_shop ? html`<a class="btn btn-sm" href="/admin/pos?wh=${w.id}">🧾 এই শাখায় বিক্রি</a>` : ''}</div></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel table-wrap"><h2>এই জায়গার পণ্য <small>${bn(rows.length)}টি</small></h2>
    <form method="get" action="${back}" class="filters"><input type="search" name="q" value="${q}" placeholder="নাম, SKU বা বারকোড"><button class="btn btn-sm">খুঁজুন</button></form>
    ${rows.length ? html`<table class="table compact"><thead><tr><th></th><th>পণ্য</th><th class="num">এখানে</th><th class="num">মূল গুদামে</th><th>গণনা ঠিক করুন</th></tr></thead><tbody>
    ${rows.map((p) => html`<tr><td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="">` : html`<span>${p.emoji || '📦'}</span>`}</td><td>${p.name}<br><span class="small muted">SKU ${p.sku} · ${p.barcode}</span></td>
      <td class="num"><b>${bn(p.qty)}</b></td><td class="num ${p.main < 0 ? 'warn' : ''}">${bn(p.main)}</td>
      <td><form method="post" action="${BASE}" class="inline-form"><input type="hidden" name="action" value="count"><input type="hidden" name="back" value="${back}"><input type="hidden" name="wh" value="${w.id}"><input type="hidden" name="product" value="${p.id}">
        <input type="number" name="qty" value="${p.qty}" min="0" class="w-num" aria-label="গোনা পরিমাণ"><button class="btn btn-sm btn-ghost">সেভ</button></form></td></tr>`)}
    </tbody></table>` : html`<p class="muted">এখানে কোনো পণ্য নেই। পাশের "স্থানান্তর" দিয়ে মূল গুদাম থেকে পণ্য আনুন।</p>`}
  </section>
  <div>
    <section class="panel"><h2>🔁 স্থানান্তর</h2>${transferForm(stores, { from: '0', to: String(w.id), back })}</section>
    <section class="panel"><h2>✏️ তথ্য</h2>
      <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${w.id}"><input type="hidden" name="back" value="${back}">
        ${ui.field('নাম', ui.input('name', w.name, { required: true, maxlength: 80 }))}
        <div class="field-row">${ui.field('ঠিকানা', ui.input('address', w.address, { maxlength: 300 }))}${ui.field('ফোন', ui.input('phone', w.phone, { maxlength: 30 }))}</div>
        ${ui.field('ক্রম', ui.input('sort', w.sort, { type: 'number', class: 'w-num' }))}
        ${ui.check('is_shop', w.is_shop, 'এটা একটা দোকান (POS-এ বিক্রি হবে)')} ${ui.check('active', w.active, 'চালু')}
        <button class="btn btn-sm">সেভ করুন</button></form>
      ${ctx.can('inventory') ? html`<form method="post" action="${BASE}" class="mt" data-confirm="এই শাখা মুছবেন? এর সব পণ্য মূল গুদামে গণ্য হবে। রিসাইকেল বিনে থাকবে।"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${w.id}"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form>` : ''}
    </section>
  </div>
</div>
<section class="panel table-wrap"><h2>এই জায়গার নড়াচড়া</h2>${movesTable(moves)}</section>`;
  return ctx.page(w.name, body, 'warehouses');
}

module.exports = {
  findProduct,
  routes: [
    { method: '*', path: BASE, perm: 'inventory', handler: listPage },
    { method: 'GET', path: /^\/admin\/warehouses\/(\d+)$/, perm: 'inventory', handler: storePage },
  ],
};

'use strict';
const { html, raw, money, bn, fmtDate, int, str, list, ymd, pct } = require('../util');
const catalog = require('../models/catalog');
const finance = require('../models/finance');
const ui = require('./ui');

// ---------------------------------------------------------------- inventory
async function inventoryPage(ctx) {
  const low = ctx.query.get('low') === '1';
  const q = str(ctx.query.get('q'), 60);
  const seeCost = ctx.can('see_cost');
  const [sum, rows, moves] = await Promise.all([
    catalog.inventorySummary(),
    catalog.listProducts({ includeInactive: false, type: 'single', lowStock: low, q, sort: 'stock_asc', limit: 500 }),
    catalog.stockMovements({ limit: 25 }),
  ]);
  const body = html`<div class="title-row"><h1>ইনভেন্টরি (স্টক)</h1>
  <div class="row-actions"><a class="btn" href="/admin/purchases/new">+ মাল কিনেছি (পারচেজ)</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis">
  ${ui.kpi('মোট পণ্য', bn(sum.products), `${bn(sum.units)} পিস স্টকে`)}
  ${seeCost ? ui.kpi('স্টকের কেনা দাম', money(sum.cost_value), 'এখন দোকানে যত টাকার মাল', 'kpi-blue') : ''}
  ${ui.kpi('স্টকের বিক্রি দাম', money(sum.sale_value), seeCost ? `সম্ভাব্য লাভ ${money(Number(sum.sale_value) - Number(sum.cost_value))}` : '', 'kpi-green')}
  ${ui.kpi('স্টক কম', bn(sum.low), `${bn(sum.out)}টি একদম শেষ`, sum.low ? 'kpi-alert' : '', '/admin/inventory?low=1')}
</div>
<form class="toolbar" method="get" action="/admin/inventory">
  <input type="search" name="q" value="${q}" placeholder="পণ্যের নাম বা SKU">
  ${ui.check('low', low, 'শুধু স্টক কম')}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
<form method="post" action="/admin/inventory/adjust" class="panel table-wrap">
  <table class="table">
    <thead><tr><th>পণ্য</th><th>SKU</th><th class="num">এখন স্টক</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">স্টকের মূল্য</th>` : ''}<th>বদল (+ বা −)</th><th>কারণ</th></tr></thead>
    <tbody>${rows.map((p) => html`<tr>
      <td>${p.name} <a class="small" href="/admin/products/${p.id}">✏️ এডিট</a></td>
      <td class="small">${p.sku || '—'}</td>
      <td class="num ${p.stock <= p.low_stock ? 'warn' : ''}"><b>${bn(p.stock)}</b> <span class="small muted">${p.unit}</span></td>
      ${seeCost ? html`<td class="num">${money(p.cost_price)}</td><td class="num">${money(p.cost_price * p.stock)}</td>` : ''}
      <td><input type="hidden" name="pid[]" value="${p.id}"><input type="number" name="change[]" class="w-num" placeholder="০" aria-label="বদল"></td>
      <td>${ui.select('reason[]', [['adjust', 'হাতে বদল'], ['count', 'গণনা ঠিক করা'], ['damage', 'নষ্ট/ভাঙা'], ['lost', 'হারানো'], ['return', 'কাস্টমার ফেরত']], 'adjust')}</td>
    </tr>`)}</tbody>
  </table>
  ${rows.length ? html`<div class="form-actions">${ui.input('note', '', { placeholder: 'নোট (ঐচ্ছিক)', maxlength: 200 })}<button class="btn">স্টক আপডেট করুন</button></div>
  <p class="muted small">যেসব পণ্যের স্টক বদলাতে চান শুধু সেগুলোর ঘরে সংখ্যা দিন। যেমন ৫টি নষ্ট হলে লিখুন −5, ১০টি বেশি পেলে লিখুন 10।</p>` : html`<p class="muted">কিছু পাওয়া যায়নি।</p>`}
</form>
<section class="panel">
  <h2>স্টকের সাম্প্রতিক ইতিহাস</h2>
  ${movesTable(moves)}
</section>`;
  return ctx.page('ইনভেন্টরি', body, 'inventory');
}
function movesTable(moves) {
  if (!moves.length) return html`<p class="muted">এখনো কোনো বদল নেই।</p>`;
  return html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th class="num">বদল</th><th class="num">পরে স্টক</th><th>কারণ</th><th>কে</th></tr></thead>
  <tbody>${moves.map((m) => html`<tr><td class="small">${fmtDate(m.created_at)}</td><td>${m.product_name || '—'}</td>
    <td class="num ${m.change < 0 ? 'warn' : 'good'}">${m.change > 0 ? '+' : ''}${bn(m.change)}</td><td class="num">${bn(m.balance ?? '')}</td>
    <td class="small">${catalog.STOCK_REASONS[m.reason] || m.reason}${m.ref_type === 'order' && m.ref_id ? html` · <a href="/admin/orders/${m.ref_id}">অর্ডার</a>` : ''}${m.ref_type === 'purchase' && m.ref_id ? html` · <a href="/admin/purchases/${m.ref_id}">পারচেজ</a>` : ''}${m.note ? ` · ${m.note}` : ''}</td>
    <td class="small">${m.staff_name || '—'}</td></tr>`)}</tbody></table></div>`;
}
async function adjust(ctx) {
  const b = await ctx.body();
  const pids = list(b.pid);
  const changes = list(b.change);
  const reasons = list(b.reason);
  let n = 0;
  const { tx } = require('../db');
  await tx(async (t) => {
    for (let i = 0; i < pids.length; i++) {
      const ch = int(changes[i]);
      if (!ch) continue;
      const reason = catalog.STOCK_REASONS[reasons[i]] ? reasons[i] : 'adjust';
      await catalog.moveStock(t, int(pids[i]), ch, reason, 'manual', null, str(b.note, 200), ctx.user.id);
      n++;
    }
  });
  if (n) await ctx.log('stock_adjust', 'product', null, `${n}টি পণ্যের স্টক বদল`);
  return ctx.back('/admin/inventory', 'saved');
}

// ---------------------------------------------------------------- suppliers
async function suppliersPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.name)) return ctx.fail('/admin/suppliers', 'সাপ্লায়ারের নাম দিন।');
    const id = await finance.saveSupplier({ ...b, active: b.id ? b.active : true });
    await ctx.log('supplier_save', 'supplier', id, str(b.name, 60));
    return ctx.back(b.id ? `/admin/suppliers/${id}` : '/admin/suppliers', 'saved');
  }
  const rows = await finance.listSuppliers();
  const seeCost = ctx.can('see_cost');
  const totalDue = rows.reduce((s, r) => s + finance.supplierDue(r), 0);
  const body = html`<div class="title-row"><h1>সাপ্লায়ার <small>${bn(rows.length)} জন</small></h1>
  <div class="row-actions"><a class="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a></div></div>
${ui.flash(ctx.flash)}
${seeCost ? html`<div class="kpis">${ui.kpi('সাপ্লায়ারদের মোট পাওনা', money(totalDue), 'আপনার কাছে তারা যত টাকা পাবে', totalDue > 0 ? 'kpi-alert' : '')}</div>` : ''}
<div class="two-col">
  <section class="panel table-wrap">
    ${rows.length ? html`<table class="table"><thead><tr><th>নাম</th><th>ফোন</th><th class="num">পারচেজ</th>${seeCost ? html`<th class="num">মোট কেনা</th><th class="num">পরিশোধ</th><th class="num">বাকি</th>` : ''}<th>চালু</th><th>কাজ</th></tr></thead>
    <tbody>${rows.map((s) => html`<tr class="${s.active ? '' : 'row-off'}"><td><b>${s.name}</b>${s.company ? html`<br><span class="small muted">${s.company}</span>` : ''}</td>
      <td class="small">${s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a>` : '—'}</td><td class="num">${bn(s.purchase_count)}</td>
      ${seeCost ? html`<td class="num">${money(s.purchased)}</td><td class="num">${money(s.paid)}</td><td class="num ${finance.supplierDue(s) > 0 ? 'warn' : ''}">${money(finance.supplierDue(s))}</td>` : ''}
      <td>${ui.rowSwitch(`/admin/toggle/supplier/${s.id}`, s.active, 'বন্ধ করলে নতুন পারচেজে এই সাপ্লায়ার আসবে না')}</td>${ui.rowActions({ edit: `/admin/suppliers/${s.id}`, editLabel: '✏️ খুলুন / এডিট' })}</tr>`)}</tbody></table>`
    : html`<p class="muted">এখনো কোনো সাপ্লায়ার নেই। পাশের ফর্ম থেকে যোগ করুন।</p>`}
  </section>
  <section class="panel">
    <h2>নতুন সাপ্লায়ার</h2>
    ${supplierForm({})}
  </section>
</div>`;
  return ctx.page('সাপ্লায়ার', body, 'suppliers');
}
function supplierForm(s) {
  return html`<form method="post" action="/admin/suppliers" class="form">
    ${s.id ? html`<input type="hidden" name="id" value="${s.id}">` : ''}
    ${ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 100 }))}
    ${ui.field('প্রতিষ্ঠান / দোকান', ui.input('company', s.company || '', { maxlength: 120 }))}
    <div class="field-row">${ui.field('ফোন', ui.input('phone', s.phone || '', { maxlength: 30 }))}${ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>
    ${ui.field('ঠিকানা', ui.textarea('address', s.address || '', { rows: 2, maxlength: 400 }))}
    ${ui.field('শুরুতে বাকি ছিল (৳)', ui.input('opening_due', s.opening_due || 0, { type: 'number' }), 'এই সফটওয়্যার শুরুর আগে তার কাছে যত টাকা বাকি ছিল')}
    ${ui.field('নোট', ui.textarea('note', s.note || '', { rows: 2, maxlength: 1000 }))}
    ${s.id ? ui.check('active', s.active, 'চালু আছে') : ''}
    <button class="btn">${s.id ? 'সেভ করুন' : 'যোগ করুন'}</button>
  </form>`;
}
async function supplierDetail(ctx, m) {
  const s = await finance.getSupplier(int(m[1]));
  if (!s) return ctx.redirect(ctx.res, '/admin/suppliers');
  const seeCost = ctx.can('see_cost');
  const accounts = await finance.listAccounts();
  const due = finance.supplierDue(s);
  const body = html`<p class="crumbs"><a href="/admin/suppliers">← সব সাপ্লায়ার</a></p>
<div class="title-row"><h1>${s.name}</h1><div class="row-actions"><a class="btn" href="/admin/purchases/new?supplier=${s.id}">+ এর কাছ থেকে কিনুন</a></div></div>
${ui.flash(ctx.flash)}
${seeCost ? html`<div class="kpis">
  ${ui.kpi('মোট কেনা', money(s.purchased), `${bn(s.purchase_count)}টি পারচেজ`)}
  ${ui.kpi('পরিশোধ করেছেন', money(s.paid), '')}
  ${ui.kpi('বাকি (তাকে দিতে হবে)', money(due), '', due > 0 ? 'kpi-alert' : 'kpi-green')}
</div>` : ''}
<div class="two-col">
  <div>
    <section class="panel"><h2>কোন পণ্য কত দামে কিনেছেন</h2>
      ${s.products.length ? html`<table class="table compact"><thead><tr><th>পণ্য</th><th class="num">মোট পরিমাণ</th>${seeCost ? html`<th class="num">গড় কেনা দাম</th>` : ''}<th>শেষ কেনা</th></tr></thead>
      <tbody>${s.products.map((p) => html`<tr><td>${p.product_id ? html`<a href="/admin/products/${p.product_id}">${p.name}</a>` : p.name}</td><td class="num">${bn(p.qty)}</td>${seeCost ? html`<td class="num">${money(p.avg_cost)}</td>` : ''}<td class="small">${p.last_date ? fmtDate(p.last_date + 'T06:00:00Z', false) : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">এখনো কিছু কেনা হয়নি।</p>`}
    </section>
    <section class="panel"><h2>পারচেজ</h2>${purchasesTable(s.purchases, seeCost)}</section>
    ${seeCost ? html`<section class="panel"><h2>পেমেন্ট</h2>
      ${s.payments.length ? html`<table class="table compact"><tbody>${s.payments.map((t) => html`<tr><td class="small">${fmtDate(t.tx_date + 'T06:00:00Z', false)}</td><td>${t.account_name || '—'}</td><td class="small">${t.note}</td><td class="num">${money(t.amount)}</td></tr>`)}</tbody></table>` : html`<p class="muted">কোনো পেমেন্ট নেই।</p>`}
    </section>` : ''}
  </div>
  <div>
    ${ctx.can('accounting') || seeCost ? html`<section class="panel"><h2>সাপ্লায়ারকে টাকা দিন</h2>
      <form method="post" action="/admin/suppliers/${s.id}/pay" class="form">
        <div class="field-row">${ui.field('টাকা', ui.input('amount', due > 0 ? due : '', { type: 'number', min: 1, required: true }))}${ui.field('তারিখ', ui.input('tx_date', ymd(), { type: 'date' }))}</div>
        ${ui.field('কোন অ্যাকাউন্ট থেকে', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`]), ''))}
        ${ui.field('নোট', ui.input('note', '', { maxlength: 200 }))}
        <button class="btn">পেমেন্ট সেভ করুন</button>
      </form></section>` : ''}
    <section class="panel"><h2>তথ্য এডিট</h2>${supplierForm(s)}</section>
  </div>
</div>`;
  return ctx.page(s.name, body, 'suppliers');
}
async function supplierPay(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  try {
    await finance.addTransaction({ type: 'expense', category: 'সাপ্লায়ার পেমেন্ট', amount: b.amount, account_id: b.account_id, supplier_id: id, tx_date: b.tx_date, note: b.note }, ctx.user.id);
  } catch (e) { return ctx.fail(`/admin/suppliers/${id}`, e.message); }
  await ctx.log('supplier_pay', 'supplier', id, `৳${b.amount}`);
  return ctx.back(`/admin/suppliers/${id}`, 'paid');
}

// ---------------------------------------------------------------- purchases
function purchasesTable(rows, seeCost) {
  if (!rows.length) return html`<p class="muted">কোনো পারচেজ নেই।</p>`;
  return html`<div class="table-wrap"><table class="table compact"><thead><tr><th>নম্বর</th><th>তারিখ</th><th>সাপ্লায়ার</th><th class="num">পরিমাণ</th>${seeCost ? html`<th class="num">মোট</th>` : ''}<th>অবস্থা</th></tr></thead>
  <tbody>${rows.map((p) => html`<tr><td><a href="/admin/purchases/${p.id}"><b>${p.code}</b></a></td><td class="small">${fmtDate(p.purchase_date + 'T06:00:00Z', false)}</td>
    <td>${p.supplier_name || '—'}</td><td class="num">${bn(p.units || 0)}</td>${seeCost ? html`<td class="num">${money(p.total)}</td>` : ''}
    <td>${ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</td></tr>`)}</tbody></table></div>`;
}
async function purchasesPage(ctx) {
  const rows = await finance.listPurchases({});
  const body = html`<div class="title-row"><h1>পারচেজ (মাল কেনা)</h1><div class="row-actions"><a class="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('পারচেজ কেন দরকার?', html`সাপ্লায়ারের কাছ থেকে মাল কিনলে এখানে এন্ট্রি দিন। তাহলে <b>স্টক নিজে থেকে বাড়বে</b>, পণ্যের <b>কেনা দাম আপডেট</b> হবে (গড় দাম), আর সাপ্লায়ারের কাছে কত বাকি তা হিসাব থাকবে। গাড়ি ভাড়া/অন্য খরচ দিলে সেটাও পণ্যের কেনা দামে ভাগ হয়ে যোগ হবে, তাই লাভের হিসাব একদম সঠিক থাকবে।`)}
<section class="panel">${purchasesTable(rows, ctx.can('see_cost'))}</section>`;
  return ctx.page('পারচেজ', body, 'purchases');
}
async function purchaseNew(ctx) {
  const [suppliers, accounts] = await Promise.all([finance.listSuppliers({ includeInactive: false }), finance.listAccounts()]);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const pids = list(b.item_id);
    const qtys = list(b.item_qty);
    const costs = list(b.item_cost);
    try {
      const id = await finance.savePurchase({ ...b, items: pids.map((p, i) => ({ product_id: p, qty: qtys[i], unit_cost: costs[i] })) }, ctx.user.id);
      await ctx.log('purchase_add', 'purchase', id, '');
      return ctx.back(`/admin/purchases/${id}`, 'added');
    } catch (e) {
      return ctx.fail('/admin/purchases/new', e.message);
    }
  }
  const body = html`<p class="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p>
<h1>নতুন পারচেজ (মাল কেনা)</h1>${ui.flash(ctx.flash)}
${!suppliers.length ? html`<p class="flash">আগে একজন <a href="/admin/suppliers">সাপ্লায়ার যোগ করুন</a> (না করলেও চলবে)।</p>` : ''}
<form method="post" action="/admin/purchases/new" class="form" data-purchase-form>
  <div class="two-col">
    <section class="panel">
      <h2>কী কী কিনলেন</h2>
      <div class="item-picker">
        <input type="search" placeholder="পণ্যের নাম বা SKU খুঁজে যোগ করুন…" data-product-search data-all="1" autocomplete="off">
        <ul class="picker-results" data-product-results hidden></ul>
      </div>
      <table class="table item-rows"><thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">প্রতিটার কেনা দাম (৳)</th><th class="num">মোট</th><th></th></tr></thead>
        <tbody data-item-rows data-purchase></tbody></table>
      <p class="muted small" data-no-items>উপরে খুঁজে পণ্য যোগ করুন। নতুন পণ্য হলে আগে <a href="/admin/products/new" target="_blank">পণ্য তৈরি করুন</a>।</p>
      <div class="field-row">
        ${ui.field('ছাড় পেয়েছেন (৳)', ui.input('discount', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('গাড়ি/কুরিয়ার ভাড়া (৳)', ui.input('shipping', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('অন্য খরচ (৳)', ui.input('other_cost', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('ভ্যাট (৳, ঐচ্ছিক)', ui.input('vat', 0, { type: 'number', min: 0, 'data-pc': true }), 'চালানে ভ্যাট থাকলে')}
      </div>
      <div class="order-total">সর্বমোট: <b data-grand>৳০</b></div>
    </section>
    <section class="panel">
      ${ui.field('সাপ্লায়ার', ui.select('supplier_id', [['', 'বাছাই করুন'], ...suppliers.map((s) => [s.id, s.name])], ctx.query.get('supplier') || ''))}
      ${ui.field('তারিখ', ui.input('purchase_date', ymd(), { type: 'date', required: true }))}
      ${ui.field('অবস্থা', ui.select('status', [['received', 'মাল বুঝে পেয়েছি (স্টকে যোগ হবে)'], ['ordered', 'অর্ডার দিয়েছি, মাল এখনো আসেনি']], 'received'))}
      <h2>এখনই কত টাকা দিলেন</h2>
      <div class="field-row">
        ${ui.field('টাকা', ui.input('paid_now', 0, { type: 'number', min: 0 }), 'বাকি থাকলে ০ রাখুন')}
        ${ui.field('অ্যাকাউন্ট', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, a.name]), ''))}
      </div>
      ${ui.field('নোট / চালান নম্বর', ui.textarea('note', '', { rows: 2, maxlength: 1000 }))}
      <button class="btn btn-lg btn-block">পারচেজ সেভ করুন</button>
    </section>
  </div>
</form>`;
  return ctx.page('নতুন পারচেজ', body, 'purchases');
}
async function purchaseDetail(ctx, m) {
  const p = await finance.getPurchase(int(m[1]));
  if (!p) return ctx.redirect(ctx.res, '/admin/purchases');
  const seeCost = ctx.can('see_cost');
  const body = html`<p class="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p>
<div class="title-row"><h1>পারচেজ ${p.code} ${ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</h1></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel">
    <table class="table"><thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">বিক্রি দাম</th><th class="num">লাভ/পিস</th><th class="num">মোট</th>` : ''}</tr></thead>
    <tbody>${p.items.map((i) => html`<tr><td>${i.product_id ? html`<a href="/admin/products/${i.product_id}">${i.name}</a>` : i.name}${i.sku ? html`<br><span class="small muted">${i.sku}</span>` : ''}</td><td class="num">${bn(i.qty)}</td>
      ${seeCost ? html`<td class="num">${money(i.unit_cost)}</td><td class="num">${money(i.sale_price || 0)}</td>
      <td class="num ${i.sale_price - i.unit_cost < 0 ? 'warn' : 'good'}">${money((i.sale_price || 0) - i.unit_cost)}${i.sale_price ? html`<br><span class="small">${pct(((i.sale_price - i.unit_cost) / i.sale_price) * 100)}</span>` : ''}</td>
      <td class="num">${money(i.unit_cost * i.qty)}</td>` : ''}</tr>`)}</tbody>
    ${seeCost ? html`<tfoot><tr><td colspan="5">পণ্যের দাম</td><td class="num">${money(p.subtotal)}</td></tr>
      ${p.discount ? html`<tr><td colspan="5">ছাড়</td><td class="num">− ${money(p.discount)}</td></tr>` : ''}
      ${p.shipping ? html`<tr><td colspan="5">ভাড়া</td><td class="num">${money(p.shipping)}</td></tr>` : ''}
      ${p.other_cost ? html`<tr><td colspan="5">অন্য খরচ</td><td class="num">${money(p.other_cost)}</td></tr>` : ''}
      ${p.vat ? html`<tr><td colspan="5">ভ্যাট</td><td class="num">${money(p.vat)}</td></tr>` : ''}
      <tr class="total"><td colspan="5"><b>সর্বমোট</b></td><td class="num"><b>${money(p.total)}</b></td></tr>
      <tr><td colspan="5">পরিশোধ</td><td class="num">${money(p.paid)}</td></tr>
      <tr><td colspan="5">বাকি</td><td class="num ${p.total - p.paid > 0 ? 'warn' : ''}">${money(p.total - p.paid)}</td></tr></tfoot>` : ''}
    </table>
  </section>
  <section class="panel">
    <p>সাপ্লায়ার: ${p.supplier_id ? html`<a href="/admin/suppliers/${p.supplier_id}">${p.supplier_name}</a>` : '—'}</p>
    <p>তারিখ: ${fmtDate(p.purchase_date + 'T06:00:00Z', false)} · এন্ট্রি দিয়েছেন: ${p.staff_name || '—'}</p>
    ${p.note ? html`<p class="note">${p.note}</p>` : ''}
    ${p.status === 'ordered' ? html`<form method="post" action="/admin/purchases/${p.id}/status"><input type="hidden" name="status" value="received"><button class="btn">✅ মাল বুঝে পেয়েছি (স্টকে যোগ করুন)</button></form>` : ''}
    ${p.status !== 'cancelled' ? html`<form method="post" action="/admin/purchases/${p.id}/status" class="mt" data-confirm="এই পারচেজ বাতিল করবেন? ${p.status === 'received' ? 'যোগ হওয়া স্টক আবার কমে যাবে।' : ''}"><input type="hidden" name="status" value="cancelled"><button class="link-btn danger">পারচেজ বাতিল করুন</button></form>` : ''}
    ${p.supplier_id && p.total - p.paid > 0 ? html`<p class="mt"><a href="/admin/suppliers/${p.supplier_id}">সাপ্লায়ারকে বাকি টাকা দিন →</a></p>` : ''}
  </section>
</div>`;
  return ctx.page(p.code, body, 'purchases');
}
async function purchaseStatus(ctx, m) {
  const b = await ctx.body();
  await finance.setPurchaseStatus(int(m[1]), b.status, ctx.user.id);
  await ctx.log('purchase_status', 'purchase', int(m[1]), b.status);
  return ctx.back(`/admin/purchases/${int(m[1])}`, 'status');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/inventory', perm: 'inventory', handler: inventoryPage },
    { method: 'POST', path: '/admin/inventory/adjust', perm: 'inventory', handler: adjust },
    { method: '*', path: '/admin/suppliers', perm: 'inventory', handler: suppliersPage },
    { method: 'GET', path: /^\/admin\/suppliers\/(\d+)$/, perm: 'inventory', handler: supplierDetail },
    { method: 'POST', path: /^\/admin\/suppliers\/(\d+)\/pay$/, perm: 'inventory', handler: supplierPay },
    { method: 'GET', path: '/admin/purchases', perm: 'inventory', handler: purchasesPage },
    { method: '*', path: '/admin/purchases/new', perm: 'inventory', handler: purchaseNew },
    { method: 'GET', path: /^\/admin\/purchases\/(\d+)$/, perm: 'inventory', handler: purchaseDetail },
    { method: 'POST', path: /^\/admin\/purchases\/(\d+)\/status$/, perm: 'inventory', handler: purchaseStatus },
  ],
};
void raw;

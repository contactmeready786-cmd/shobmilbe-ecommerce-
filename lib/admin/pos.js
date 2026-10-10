'use strict';
// Admin → 🧾 দোকানে বিক্রি (POS): a sale at the shop counter.
// Scan the product's barcode (barcode gun, or the phone/laptop camera) or type the name/SKU → it goes into the bill;
// change quantity / price, discount, customer's mobile (optional), how they paid, cash given → change to return.
// "বিক্রি সম্পন্ন" saves it as an order (source: দোকান, already delivered and paid) — stock goes down at once
// (from the chosen branch, when there are branches) — and the cash memo opens for printing.
const { html, raw, int, str, bn, money, fmtDate, amount, round2, normalizePhone, validPhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const O = require('../models/orders');
const catalog = require('../models/catalog');
const W = require('../models/warehouses');
const { ASSET_V } = require('./layout');

const PAY = [['cash', '💵 নগদ'], ['manual_bkash', 'বিকাশ'], ['manual_nagad', 'নগদ (মোবাইল)'], ['manual_rocket', 'রকেট'], ['card', '💳 কার্ড']];

async function page(ctx) {
  const stores = (await W.list({ activeOnly: true })).filter((w) => w.is_shop);
  const wh = int(ctx.query.get('wh'));
  const today = await db.one(`SELECT count(*)::int AS n, coalesce(sum(total),0)::numeric(14,2) AS total FROM orders
    WHERE source='pos' AND status='delivered' AND (created_at AT TIME ZONE 'Asia/Dhaka')::date = (now() AT TIME ZONE 'Asia/Dhaka')::date`);
  const recent = await db.q(`SELECT o.id, o.code, o.total, o.customer_name, o.created_at, o.payment, w.name AS wh_name FROM orders o LEFT JOIN warehouses w ON w.id=o.warehouse_id
    WHERE o.source='pos' ORDER BY o.id DESC LIMIT 8`);
  const canPrice = ctx.can('orders_edit');
  const body = html`<div class="pos" data-pos data-no-dirty data-can-price="${canPrice ? '1' : ''}">
  <div class="pos-left">
    <div class="pos-top">
      <h1>🧾 দোকানে বিক্রি</h1>
      ${stores.length ? html`<label class="pos-wh">কোন দোকান ${ui.select('wh', [['0', '🏠 মূল দোকান/গুদাম'], ...stores.map((w) => [w.id, `🏪 ${w.name}`])], wh || '0', { 'data-pos-wh': true })}</label>` : ''}
    </div>
    <form class="pos-scan" data-pos-scan autocomplete="off">
      <input type="search" name="q" placeholder="বারকোড স্ক্যান করুন বা নাম / SKU লিখুন" autofocus data-pos-q aria-label="পণ্য খুঁজুন">
      <button class="btn">যোগ</button>
      <button type="button" class="btn btn-ghost" data-pos-cam title="ক্যামেরায় বারকোড স্ক্যান">📷</button>
    </form>
    <div class="pos-cam" data-pos-cam-box hidden><video data-pos-video playsinline muted></video><button type="button" class="btn btn-sm btn-ghost" data-pos-cam-stop>✕ ক্যামেরা বন্ধ</button></div>
    <p class="pos-msg" data-pos-msg role="status"></p>
    <ul class="pos-results" data-pos-results></ul>
    <section class="panel pos-today"><h2>আজ দোকানে বিক্রি: <b>${money(today.total)}</b> <small>${bn(today.n)}টি মেমো</small></h2>
      ${recent.length ? html`<ul class="pos-recent">${recent.map((o) => html`<li><a href="/admin/orders/${o.id}" class="mono">${o.code}</a> <span class="small muted">${fmtDate(o.created_at)}${o.wh_name ? ` · ${o.wh_name}` : ''}</span> <b>${money(o.total)}</b>
        <a class="small" href="/admin/pos/memo/${o.id}" target="_blank" rel="noopener">🖨️ মেমো</a></li>`)}</ul>` : ''}
    </section>
  </div>
  <aside class="pos-bill panel">
    <h2>বিল</h2>
    <table class="pos-lines"><tbody data-pos-lines><tr><td class="muted">কোনো পণ্য নেই — বারকোড স্ক্যান করুন।</td></tr></tbody></table>
    <div class="pos-sum">
      <div><span>পণ্যের দাম</span><b data-pos-sub>৳০</b></div>
      <div><label for="pos-disc">ছাড় (৳)</label><input id="pos-disc" type="number" min="0" step="0.01" value="0" data-pos-disc></div>
      <div class="grand"><span>মোট</span><b data-pos-total>৳০</b></div>
    </div>
    <div class="field-row pos-cust">
      <label class="field"><span>কাস্টমারের মোবাইল (ঐচ্ছিক)</span><input inputmode="tel" maxlength="20" data-pos-phone placeholder="01XXXXXXXXX"></label>
      <label class="field"><span>নাম (ঐচ্ছিক)</span><input maxlength="80" data-pos-name></label>
    </div>
    <div class="pos-pay">${PAY.map(([k, l], i) => html`<label class="pos-pay-opt"><input type="radio" name="pos_pay" value="${k}" ${i === 0 ? raw('checked') : ''}><span>${l}</span></label>`)}</div>
    <div class="field-row">
      <label class="field"><span>কাস্টমার দিলেন (৳)</span><input type="number" min="0" step="1" data-pos-given></label>
      <div class="field"><span>ফেরত দিতে হবে</span><b class="pos-change" data-pos-change>—</b></div>
    </div>
    <label class="field"><span>নোট (ঐচ্ছিক)</span><input maxlength="200" data-pos-note></label>
    <p class="form-error" data-pos-error hidden></p>
    <button class="btn btn-amber btn-lg btn-block" data-pos-done disabled>✅ বিক্রি সম্পন্ন ও মেমো প্রিন্ট</button>
    <button type="button" class="link-btn small" data-pos-clear>বিল খালি করুন</button>
  </aside>
</div>
<script src="/js/scan.js?v=${ASSET_V}" defer></script>
<script src="/js/pos.js?v=${ASSET_V}" defer></script>`;
  return ctx.page('দোকানে বিক্রি (POS)', body, 'pos');
}

// A scanned code (barcode / SKU) or typed words → the product(s)
async function find(ctx) {
  const q = str(ctx.query.get('q'), 100);
  const wh = int(ctx.query.get('wh'));
  if (!q) return ctx.json(ctx.res, 200, { exact: null, list: [] });
  const shape = (p, st) => ({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, price: Number(p.base_price ?? p.price), stock: p.stock,
    here: wh ? ((st.get(p.id) || { by: {} }).by[wh] || 0) : (st.get(p.id) || { main: p.stock }).main, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji, active: p.active });
  const exact = await db.one(`SELECT id FROM products WHERE (upper(barcode)=upper($1) OR lower(sku)=lower($1)) AND variant_count = 0 LIMIT 1`, [q]);
  if (exact) {
    const p = await catalog.getProduct({ id: exact.id });
    const st = await W.stockFor([p.id]);
    return ctx.json(ctx.res, 200, { exact: shape(p, st), list: [] });
  }
  const list = await catalog.listProducts({ q, items: true, includeInactive: true, limit: 12, sort: 'name' });
  const st = await W.stockFor(list.map((p) => p.id));
  return ctx.json(ctx.res, 200, { exact: null, list: list.map((p) => shape(p, st)) });
}

async function sale(ctx) {
  const b = await ctx.body();
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((x) => ({ id: int(x.id), qty: Math.min(9999, int(x.qty)), price: x.price }))
    .filter((x) => x.id > 0 && x.qty > 0);
  if (!items.length) return ctx.json(ctx.res, 400, { error: 'বিলে কোনো পণ্য নেই।' });
  // only staff who may edit orders can change a price at the counter; others sell at the saved price
  if (!ctx.can('orders_edit')) {
    const prods = await catalog.getProductsByIds(items.map((x) => x.id), { includeInactive: true });
    items.forEach((x) => { const p = prods.find((y) => y.id === x.id); x.price = p ? Number(p.base_price) : 0; });
  }
  const phone = b.phone ? normalizePhone(b.phone) : '';
  if (phone && !validPhone(phone)) return ctx.json(ctx.res, 400, { error: 'মোবাইল নম্বর ঠিক নেই (না দিলেও চলবে)।' });
  const pay = PAY.some(([k]) => k === b.payment) ? b.payment : 'cash';
  const wh = int(b.wh) || null;
  if (wh) {
    const w = await W.get(wh);
    if (!w || !w.active) return ctx.json(ctx.res, 400, { error: 'দোকান/শাখা পাওয়া যায়নি।' });
  }
  let order;
  try {
    order = await O.createOrder({ items, name: str(b.name, 80) || 'দোকানের কাস্টমার', phone, address: 'দোকানে সরাসরি বিক্রি', area: 'dhaka',
      note: str(b.note, 200), payment: pay, source: 'pos', createdBy: ctx.user.id, discount: amount(b.discount), delivery: 0, warehouseId: wh,
      adminNote: wh ? '' : '' }, ctx.settings);
  } catch (e) {
    if (e instanceof O.OrderError) return ctx.json(ctx.res, 400, { error: e.message });
    throw e;
  }
  const given = round2(amount(b.given));
  await db.q(`UPDATE orders SET payment_status='paid', paid_amount=total, pos_tendered=$1, transaction_id=$2, updated_at=now() WHERE id=$3`,
    [given, str(b.trx, 40), order.id]);
  await O.setStatus(order.id, 'delivered', ctx.user.id);
  await ctx.log('pos_sale', 'order', order.id, `দোকানে বিক্রি ${order.code}: ৳${order.total}`);
  return ctx.json(ctx.res, 200, { ok: true, id: order.id, code: order.code, total: order.total, change: given ? round2(given - order.total) : 0 });
}

// The cash memo (80 mm receipt printer; also fine on A4)
async function memo(ctx, m) {
  const o = await O.getOrder({ id: int(m[1]) });
  if (!o) return ctx.redirect(ctx.res, '/admin/pos');
  const s = ctx.settings;
  const w = o.warehouse_id ? await W.get(o.warehouse_id) : null;
  const bc = require('../services/barcode').svg(o.code, { height: 40, module: 1.6, fontSize: 11 });
  const sold = await db.one('SELECT name FROM staff WHERE id=$1', [o.created_by]);
  const change = Number(o.pos_tendered) ? round2(Number(o.pos_tendered) - Number(o.total)) : 0;
  const page = html`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>মেমো ${o.code}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;margin:0;background:#eee;color:#000}
.memo{width:76mm;margin:10px auto;background:#fff;padding:4mm 3mm;font-size:12px;line-height:1.35}
h1{font-size:18px;text-align:center;margin:0}.c{text-align:center}.s{font-size:11px}
table{width:100%;border-collapse:collapse;margin:6px 0}td{padding:2px 0;vertical-align:top}td.n{text-align:right;white-space:nowrap}
.line{border-top:1px dashed #000;margin:5px 0}.tot td{font-weight:700;font-size:14px}.bc{text-align:center;margin-top:6px}.bc svg{max-width:100%}
.noprint{text-align:center;margin:10px}@media print{body{background:#fff}.memo{margin:0;width:auto}.noprint{display:none}@page{margin:2mm}}
</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨️ প্রিন্ট</button> <a href="/admin/pos">← নতুন বিক্রি</a></div>
<div class="memo">
  <h1>${s.store_name}</h1>
  <p class="c s">${w && w.address ? w.address : s.address || ''}${(w && w.phone) || s.phone ? html`<br>ফোন: ${(w && w.phone) || s.phone}` : ''}${s.vat_bin ? html`<br>BIN: ${s.vat_bin}` : ''}</p>
  <p class="c"><b>ক্যাশ মেমো</b></p>
  <p class="s">মেমো: <b>${o.code}</b><br>তারিখ: ${fmtDate(o.created_at)}${w ? html`<br>দোকান: ${w.name}` : ''}${o.phone ? html`<br>কাস্টমার: ${o.customer_name} (${o.phone})` : ''}</p>
  <div class="line"></div>
  <table><tbody>${o.items.map((it) => html`<tr><td>${it.name}${it.sku ? html` <span class="s">[${it.sku}]</span>` : ''}<br><span class="s">${bn(it.qty)} × ${money(it.price)}</span></td><td class="n">${money(it.price * it.qty)}</td></tr>`)}</tbody></table>
  <div class="line"></div>
  <table><tbody>
    <tr><td>পণ্যের দাম</td><td class="n">${money(o.subtotal)}</td></tr>
    ${Number(o.discount) ? html`<tr><td>ছাড়</td><td class="n">− ${money(o.discount)}</td></tr>` : ''}
    <tr class="tot"><td>মোট</td><td class="n">${money(o.total)}</td></tr>
    <tr><td>পেমেন্ট</td><td class="n">${O.PAYMENT_METHODS[o.payment] || o.payment}</td></tr>
    ${Number(o.pos_tendered) ? html`<tr><td>দিয়েছেন</td><td class="n">${money(o.pos_tendered)}</td></tr><tr><td>ফেরত</td><td class="n">${money(Math.max(0, change))}</td></tr>` : ''}
  </tbody></table>
  <div class="line"></div>
  <p class="c s">ধন্যবাদ! আবার আসবেন।${s.site_url ? html`<br>অনলাইনে অর্ডার: ${String(s.site_url).replace(/^https?:\/\//, '')}` : ''}${sold ? html`<br>বিক্রেতা: ${sold.name}` : ''}</p>
  <div class="bc">${raw(bc)}</div>
</div>
<script>${raw(ctx.query.get('print') === '1' ? 'window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});' : '')}</script>
</body></html>`;
  return ctx.send(ctx.res, 200, page.s || String(page));
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/pos', perm: 'pos', handler: page },
    { method: 'GET', path: '/admin/api/pos/find', perm: 'pos', handler: find },
    { method: 'POST', path: '/admin/api/pos/sale', perm: 'pos', handler: sale },
    { method: 'GET', path: /^\/admin\/pos\/memo\/(\d+)$/, perm: 'pos', handler: memo },
  ],
};

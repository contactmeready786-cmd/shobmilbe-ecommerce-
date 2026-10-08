'use strict';
const { html, raw, money, bn, fmtDate, int, str, csv, pageNum, normalizePhone, validPhone, validYmd, list, esc , amount: amt, roundOff } = require('../util');
const db = require('../db');
const O = require('../models/orders');
const catalog = require('../models/catalog');
const customers = require('../models/customers');
const finance = require('../models/finance');
const courier = require('../services/courier');
const { invoicePage } = require('../views/invoice');
const ui = require('./ui');
const navswitch = require('./navswitch');

const PER_PAGE = 30;
const statusPill = (s) => ui.pill(O.STATUSES[s] || s, 'pill-' + s);
const payPill = (s) => ui.pill(O.PAYMENT_STATUSES[s] || s, 'pay-' + s);

function filtersFrom(query) {
  return {
    status: O.STATUSES[query.get('status')] ? query.get('status') : '',
    q: str(query.get('q'), 80),
    from: validYmd(query.get('from')) || '',
    to: validYmd(query.get('to')) || '',
    courier: ['steadfast', 'pathao', 'redx', 'none'].includes(query.get('courier')) ? query.get('courier') : '',
    payment: O.PAYMENT_METHODS[query.get('payment')] ? query.get('payment') : '',
    paymentStatus: O.PAYMENT_STATUSES[query.get('pstatus')] ? query.get('pstatus') : '',
    phone: str(query.get('phone'), 20),
  };
}
function qs(f, extra = {}) {
  const p = new URLSearchParams();
  const map = { status: f.status, q: f.q, from: f.from, to: f.to, courier: f.courier, payment: f.payment, pstatus: f.paymentStatus, phone: f.phone, ...extra };
  Object.entries(map).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

// ---------------------------------------------------------------- list
async function listPage(ctx) {
  const f = filtersFrom(ctx.query);
  const page = pageNum(ctx.query);
  const [rows, total, counts] = await Promise.all([
    O.listOrders({ ...f, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), O.countOrders(f), O.statusCounts(),
  ]);
  const couriers = courier.available(ctx.settings);
  const body = html`
<div class="title-row"><h1>অর্ডার <small>${bn(total)}টি</small></h1>
  <div class="row-actions">
    ${ctx.can('orders_edit') ? html`<a class="btn" href="/admin/orders/new">+ নতুন অর্ডার</a>` : ''}
    ${ctx.can('reports') ? html`<a class="btn btn-ghost" href="/admin/orders/export.csv${qs(f)}">⬇ CSV ডাউনলোড</a>` : ''}
  </div>
</div>
${ui.flash(ctx.flash)}
${navswitch.box(ctx, { urls: ['/track'], footer: ['track'], back: '/admin/orders', note: 'ক্রেতারা "অর্ডার ট্র্যাক" পেজে ফোন নম্বর দিয়ে নিজের অর্ডারের অবস্থা দেখতে পারে।' })}
<div class="chips status-chips">
  <a class="chip ${!f.status ? 'on' : ''}" href="/admin/orders${qs({ ...f, status: '' })}">সব <b>${bn(counts.all || 0)}</b></a>
  ${Object.entries(O.STATUSES).map(([k, v]) => html`<a class="chip chip-${k} ${f.status === k ? 'on' : ''}" href="/admin/orders${qs({ ...f, status: k })}">${v} <b>${bn(counts[k] || 0)}</b></a>`)}
</div>
<form class="toolbar filters" method="get" action="/admin/orders">
  ${f.status ? html`<input type="hidden" name="status" value="${f.status}">` : ''}
  <input type="search" name="q" value="${f.q}" placeholder="অর্ডার নম্বর, নাম, ফোন, পণ্য বা SKU">
  <label>থেকে <input type="date" name="from" value="${f.from}"></label>
  <label>পর্যন্ত <input type="date" name="to" value="${f.to}"></label>
  ${ui.select('courier', [['', 'সব কুরিয়ার'], ['none', 'কুরিয়ারে পাঠানো হয়নি'], ...Object.entries(courier.PROVIDERS).map(([k, v]) => [k, v.label])], f.courier)}
  ${ui.select('payment', [['', 'সব পেমেন্ট'], ...Object.entries(O.PAYMENT_METHODS)], f.payment)}
  ${ui.select('pstatus', [['', 'পেইড/বাকি সব'], ...Object.entries(O.PAYMENT_STATUSES)], f.paymentStatus)}
  <button class="btn btn-sm">ফিল্টার</button>
  ${qs(f) ? html`<a href="/admin/orders" class="small">সব মুছুন</a>` : ''}
</form>
${rows.length ? html`
<form method="post" action="/admin/orders/bulk" data-bulk>
  ${ctx.can('orders_edit') || ctx.can('courier') ? html`<div class="bulk-bar" data-bulk-bar hidden>
    <b data-bulk-count>০</b>টি বাছাই করা:
    ${ctx.can('orders_edit') ? html`${ui.select('status', [['', 'অবস্থা বদলান…'], ...Object.entries(O.STATUSES)], '')}
      <button class="btn btn-sm" name="action" value="status">প্রয়োগ</button>` : ''}
    ${ctx.can('courier') && couriers.length ? html`${ui.select('courier', couriers.map((c) => [c, courier.PROVIDERS[c].label]), ctx.settings.courier_default || couriers[0])}
      <button class="btn btn-sm btn-amber" name="action" value="courier">কুরিয়ারে পাঠান</button>` : ''}
    <button class="btn btn-sm btn-ghost" name="action" value="invoice" formtarget="_blank">ইনভয়েস প্রিন্ট</button>
  </div>` : ''}
  <div class="table-wrap panel"><table class="table orders-table">
    <thead><tr><th><input type="checkbox" data-check-all aria-label="সব বাছুন"></th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th class="num">মোট</th><th>অবস্থা</th><th>পেমেন্ট</th><th>কুরিয়ার</th></tr></thead>
    <tbody>${rows.map((o) => html`<tr>
      <td><input type="checkbox" name="ids[]" value="${o.id}" aria-label="বাছুন"></td>
      <td><a href="/admin/orders/${o.id}"><b>${o.code}</b></a><br><span class="small muted">${fmtDate(o.created_at)}</span>${o.source === 'admin' ? html`<br><span class="pill">ম্যানুয়াল</span>` : ''}</td>
      <td><span translate="no">${o.customer_name}</span><br><a class="small" href="tel:${o.phone}">${o.phone}</a><br><span class="small muted" translate="${O.areaLabel(o) ? 'no' : 'yes'}">${O.areaLabel(o) || (o.area === 'dhaka' ? 'ঢাকা' : 'ঢাকার বাইরে')}</span></td>
      <td class="small items-cell">${o.item_names || ''}${o.item_skus ? html`<br><span class="muted">SKU: ${o.item_skus}</span>` : ''}</td>
      <td class="num"><b>${money(o.total)}</b>${o.discount ? html`<br><span class="small muted">ছাড় ${money(o.discount)}</span>` : ''}</td>
      <td>${statusPill(o.status)}</td>
      <td class="small">${O.PAYMENT_METHODS[o.payment] || o.payment}<br>${payPill(o.payment_status)}</td>
      <td class="small">${o.courier ? html`${o.courier}<br><span class="muted">${o.consignment_id}</span>` : html`<span class="muted">—</span>`}</td>
    </tr>`)}</tbody>
  </table></div>
</form>
${ui.pager(total, page, PER_PAGE, '/admin/orders' + qs(f))}` : ui.empty('এই ফিল্টারে কোনো অর্ডার নেই।')}`;
  return ctx.page('অর্ডার', body, 'orders');
}

async function bulk(ctx) {
  const b = await ctx.body();
  const ids = list(b.ids).map((x) => int(x)).filter(Boolean).slice(0, 200);
  if (!ids.length) return ctx.fail('/admin/orders', 'কোনো অর্ডার বাছাই করা হয়নি।');
  if (b.action === 'invoice') return ctx.redirect(ctx.res, '/admin/orders/invoice?ids=' + ids.join(','));
  if (b.action === 'status') {
    if (!ctx.can('orders_edit')) return ctx.back('/admin/orders', 'noperm');
    if (!O.STATUSES[b.status]) return ctx.fail('/admin/orders', 'কোন অবস্থায় নেবেন তা বাছুন।');
    const errors = [];
    for (const id of ids) {
      try {
        const r = await O.setStatus(id, b.status, ctx.user.id);
        if (r.changed) await ctx.log('order_status', 'order', id, `${r.prev} → ${b.status}`);
      } catch (e) { errors.push(e.message); }
    }
    if (b.status === 'confirmed') for (const id of ids) await autoSend(ctx, id);
    return errors.length ? ctx.fail('/admin/orders', `${bn(errors.length)}টি অর্ডার বদলানো যায়নি: ${errors[0]}`) : ctx.back('/admin/orders', 'status');
  }
  if (b.action === 'courier') {
    if (!ctx.can('courier')) return ctx.back('/admin/orders', 'noperm');
    let ok = 0;
    const errors = [];
    for (const id of ids) {
      const r = await sendToCourier(ctx, id, b.courier, {});
      if (r.ok) ok++; else errors.push(r.message);
    }
    return errors.length ? ctx.fail('/admin/orders', `${bn(ok)}টি পাঠানো হয়েছে, ${bn(errors.length)}টি যায়নি: ${errors[0]}`) : ctx.back('/admin/orders', 'sent');
  }
  return ctx.back('/admin/orders');
}

async function exportCsv(ctx) {
  const f = filtersFrom(ctx.query);
  const rows = await O.listOrders({ ...f, limit: 10000 });
  const seeCost = ctx.can('see_cost');
  const out = [['Order', 'Date', 'Status', 'Customer', 'Phone', 'Address', 'Thana', 'District', 'Items', 'SKU', 'Subtotal', 'Discount', 'Delivery', 'Total',
    'Paid', 'Payment', 'Payment status', 'TrxID', 'Courier', 'Consignment', ...(seeCost ? ['Cost', 'Profit'] : []), 'Note']];
  for (const o of rows) {
    out.push([o.code, fmtDate(o.created_at).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)), O.STATUSES[o.status], o.customer_name, o.phone, o.address, o.thana, o.district,
      o.item_names, o.item_skus, o.subtotal, o.discount, o.delivery, o.total, o.paid_amount, o.payment, o.payment_status, o.transaction_id,
      o.courier, o.consignment_id, ...(seeCost ? [o.cost_total, o.total - o.cost_total - o.delivery] : []), o.note]);
  }
  await ctx.log('export', 'order', null, `${rows.length}টি অর্ডার CSV`);
  return ctx.send(ctx.res, 200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="orders-${Date.now()}.csv"` });
}

// ---------------------------------------------------------------- detail
async function detail(ctx, m) {
  const id = int(m[1]);
  const order = await O.getOrder({ id });
  if (!order) return ctx.redirect(ctx.res, '/admin/orders');
  const [stats, blocked, history, txs, customer] = await Promise.all([
    customers.phoneStats(order.phone),
    customers.isBlocked(order.phone, order.ip),
    db.q(`SELECT a.*, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.entity='order' AND a.entity_id=$1 ORDER BY a.created_at DESC LIMIT 50`, [id]),
    ctx.can('accounting') ? db.q('SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE order_id=$1 ORDER BY id', [id]) : [],
    order.customer_id ? db.one('SELECT id FROM customers WHERE id=$1', [order.customer_id]) : null,
  ]);
  const prev = { ...stats, orders: stats.orders - 1, delivered: stats.delivered - (order.status === 'delivered' ? 1 : 0), failed: stats.failed - (O.RELEASED.has(order.status) ? 1 : 0) };
  const risk = customers.riskOf(prev);
  const couriers = courier.available(ctx.settings);
  const accounts = ctx.can('accounting') ? await finance.listAccounts() : [];
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const seeCost = ctx.can('see_cost');
  const trackUrl = order.courier && courier.PROVIDERS[order.courier] ? courier.PROVIDERS[order.courier].track(order) : '';
  const wa = order.phone.replace(/^0/, '880');

  const body = html`<p class="crumbs"><a href="/admin/orders">← সব অর্ডার</a></p>
<div class="title-row"><h1>অর্ডার ${order.code} ${statusPill(order.status)}</h1>
  <div class="row-actions">
    ${ctx.can('orders_edit') ? html`<a class="btn btn-ghost" href="/admin/orders/${id}/edit">✏️ এডিট</a>` : ''}
    <a class="btn btn-ghost" href="/admin/orders/invoice?ids=${id}" target="_blank">🖨️ ইনভয়েস</a>
  </div>
</div>
${ui.flash(ctx.flash)}
${blocked ? html`<p class="flash flash-error">⛔ এই কাস্টমার ব্লক লিস্টে আছে${blocked.reason ? `: ${blocked.reason}` : ''}।</p>` : ''}
<div class="two-col">
  <div>
    <section class="panel">
      <h2>পণ্যসমূহ</h2>
      <table class="lines"><tbody>
        ${order.items.map((it) => html`<tr>
          <td class="li-pic">${it.image_id ? html`<img src="/media/${it.image_id}/t" alt="">` : html`<span>${it.emoji || '📦'}</span>`}</td>
          <td>${it.product_id ? html`<a href="/admin/products/${it.product_id}">${it.name}</a>` : it.name}${it.sku ? html`<br><span class="small muted">SKU: ${it.sku}</span>` : ''}
            ${it.components ? html`<br><span class="small muted">প্যাকেজ</span>` : ''}
            <br><span class="muted small">${money(it.price)} × ${bn(it.qty)}${seeCost ? html` · কেনা ${money(it.cost)}` : ''}</span></td>
          <td class="num">${money(it.price * it.qty)}</td></tr>`)}
      </tbody><tfoot>
        <tr><td colspan="2">পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
        ${order.discount ? html`<tr><td colspan="2">ছাড় ${order.coupon_code ? html`<span class="pill">${order.coupon_code}</span>` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
        <tr><td colspan="2">ডেলিভারি (${order.area === 'dhaka' ? 'ঢাকা সিটি' : 'ঢাকার বাইরে'})</td><td class="num">${money(order.delivery)}</td></tr>
        ${roundOff(order) ? html`<tr><td colspan="2">রাউন্ড ফিগার</td><td class="num">${roundOff(order) > 0 ? '+ ' : '− '}${money(Math.abs(roundOff(order)))}</td></tr>` : ''}
        <tr class="total"><td colspan="2">মোট</td><td class="num">${money(order.total)}</td></tr>
        ${order.paid_amount ? html`<tr><td colspan="2">পরিশোধিত</td><td class="num">${money(order.paid_amount)}</td></tr>` : ''}
        <tr><td colspan="2"><b>কাস্টমারের কাছ থেকে নিতে হবে</b></td><td class="num"><b>${money(due)}</b></td></tr>
        ${seeCost ? html`<tr><td colspan="2" class="muted">লাভ (পণ্যের দাম − কেনা দাম − ছাড়)</td><td class="num ${order.subtotal - order.discount - order.cost_total >= 0 ? 'good' : 'warn'}">${money(order.subtotal - order.discount - order.cost_total)}</td></tr>` : ''}
      </tfoot></table>
    </section>

    ${ctx.can('orders_edit') ? html`<section class="panel">
      <h2>অবস্থা বদলান</h2>
      <form method="post" action="/admin/orders/${id}/status" class="status-form">
        ${Object.entries(O.STATUSES).map(([k, v]) => html`<button name="status" value="${k}" class="btn btn-sm ${order.status === k ? 'is-current' : 'btn-ghost'} st-${k}" ${order.status === k ? raw('disabled') : ''}>${v}</button>`)}
      </form>
      <p class="muted small">বাতিল বা ফেরত দিলে পণ্যগুলো আবার স্টকে যোগ হবে। ক্যাশ অন ডেলিভারি অর্ডার "ডেলিভারি সম্পন্ন" করলে পেমেন্ট পেইড হয়ে যাবে।</p>
    </section>` : ''}

    <section class="panel">
      <h2>কুরিয়ার</h2>
      ${order.consignment_id ? html`
        <p>${(courier.PROVIDERS[order.courier] || {}).label || order.courier} · ID: <b>${order.consignment_id}</b>${order.tracking_code && order.tracking_code !== order.consignment_id ? html` · ট্র্যাকিং: <b>${order.tracking_code}</b>` : ''}</p>
        <p>কুরিয়ারের স্ট্যাটাস: <b>${order.courier_status || '—'}</b> <span class="muted small">(${fmtDate(order.courier_sent_at)} এ পাঠানো)</span></p>
        <div class="row-actions">
          ${ctx.can('courier') ? html`<form method="post" action="/admin/orders/${id}/courier/sync"><button class="btn btn-sm btn-ghost">🔄 স্ট্যাটাস আপডেট আনুন</button></form>` : ''}
          ${trackUrl ? html`<a class="btn btn-sm btn-ghost" href="${trackUrl}" target="_blank" rel="noopener">ট্র্যাক করুন ↗</a>` : ''}
        </div>`
    : ctx.can('courier') ? (couriers.length ? html`
        <form method="post" action="/admin/orders/${id}/courier" class="form courier-form" data-courier-form data-district="${order.district}">
          <div class="field-row">
            ${ui.field('কুরিয়ার', ui.select('courier', couriers.map((c) => [c, courier.PROVIDERS[c].label]), ctx.settings.courier_default || couriers[0], { 'data-courier-pick': true }))}
            ${ui.field('ওজন (কেজি)', ui.input('weight', '0.5', { type: 'number', step: '0.1', min: '0.1' }))}
            ${ui.field('COD (টাকা তুলবে)', ui.input('cod_show', due, { disabled: true }))}
          </div>
          <div class="field-row" data-courier-extra="pathao" hidden>
            ${ui.field('শহর (ঐচ্ছিক)', raw('<select name="city_id" data-pathao="cities"><option value="">অটো (ঠিকানা থেকে)</option></select>'))}
            ${ui.field('জোন (ঐচ্ছিক)', raw('<select name="zone_id" data-pathao="zones"><option value="">অটো</option></select>'))}
          </div>
          <div class="field-row" data-courier-extra="redx" hidden>
            ${ui.field('RedX ডেলিভারি এরিয়া', raw('<select name="area_id" data-redx-area><option value="">লোড হচ্ছে…</option></select><input type="hidden" name="area_name" data-redx-area-name>'))}
          </div>
          ${ui.field('কুরিয়ারের জন্য নোট', ui.input('note', order.note || '', { maxlength: 250 }))}
          <button class="btn btn-amber">🛵 কুরিয়ারে পাঠান</button>
        </form>` : html`<p class="muted">কোনো কুরিয়ার API সেটআপ করা নেই। ${ctx.can('settings') ? html`<a href="/admin/integrations/courier">এখনই সেটআপ করুন</a>` : 'মালিককে সেটআপ করতে বলুন।'}</p>`)
      : html`<p class="muted">এখনো কুরিয়ারে পাঠানো হয়নি।</p>`}
    </section>

    <section class="panel">
      <h2>ইতিহাস</h2>
      <ul class="timeline">
        ${history.map((h) => html`<li><b>${h.staff_name || 'সিস্টেম'}</b> · ${actionLabel(h)}<br><span class="small muted">${fmtDate(h.created_at)}</span></li>`)}
        <li><b>${order.source === 'admin' ? (order.created_by_name || 'স্টাফ') : 'কাস্টমার'}</b> · অর্ডার করেছেন (${order.source === 'admin' ? 'ম্যানুয়াল' : 'ওয়েবসাইট'})<br><span class="small muted">${fmtDate(order.created_at)}${order.ip ? ` · IP ${order.ip}` : ''}</span></li>
      </ul>
    </section>
  </div>

  <div>
    <section class="panel">
      <h2>কাস্টমার</h2>
      <p class="big-name" translate="no">${order.customer_name}</p>
      <p><a href="tel:${order.phone}">📞 ${order.phone}</a> · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>${order.email ? html` · ${order.email}` : ''}</p>
      <p translate="no">${order.address}<br><span class="muted">${O.areaLabel(order)}</span></p>
      ${order.note ? html`<p class="note">📝 <span translate="no">${order.note}</span></p>` : ''}
      ${customer && ctx.can('customers') ? html`<p><a href="/admin/customers/${customer.id}">কাস্টমারের সব অর্ডার →</a></p>` : ''}
      <div class="risk risk-${risk.level}">
        <b>${risk.label}</b>
        <span>আগের অর্ডার: ${bn(prev.orders)}টি · ডেলিভারি ${bn(prev.delivered)} · বাতিল/ফেরত ${bn(prev.failed)}${risk.ratio !== null ? ` · সফলতা ${bn(risk.ratio)}%` : ''}</span>
        ${stats.last_day > 1 ? html`<span>⚠️ গত ২৪ ঘণ্টায় এই নম্বর থেকে ${bn(stats.last_day)}টি অর্ডার</span>` : ''}
      </div>
      ${courier.configured(ctx.settings, 'pathao') ? html`<button class="btn btn-sm btn-ghost" type="button" data-fraud-check="${order.phone}">কুরিয়ার রেকর্ড চেক করুন (Pathao)</button><div class="small" data-fraud-out></div>` : ''}
      ${ctx.can('customers') ? (blocked ? '' : html`<details class="mt"><summary class="link-btn danger">⛔ এই কাস্টমারকে ব্লক করুন</summary>
        <form method="post" action="/admin/orders/${id}/block" class="form">
          ${ui.field('কারণ', ui.input('reason', 'ফেক অর্ডার / পণ্য নেয়নি', { maxlength: 300 }))}
          ${ui.check('block_ip', false, `IP ঠিকানাও ব্লক করুন (${order.ip || 'নেই'})`)}
          <button class="btn btn-sm btn-danger">ব্লক করুন</button>
        </form></details>`) : ''}
    </section>

    <section class="panel">
      <h2>পেমেন্ট</h2>
      <p>${O.PAYMENT_METHODS[order.payment] || order.payment} · ${payPill(order.payment_status)}</p>
      ${order.transaction_id ? html`<p>TrxID: <b class="mono">${order.transaction_id}</b>${order.payment_number ? html` · নম্বর: ${order.payment_number}` : ''}</p>` : ''}
      ${order.payment.startsWith('manual_') && order.payment_status !== 'paid' ? html`<p class="note">কাস্টমার Send Money করেছেন বলে জানিয়েছেন। আপনার ${order.payment.replace('manual_', '')} অ্যাপে TrxID মিলিয়ে দেখে তারপর "টাকা পেয়েছি" চাপুন।</p>` : ''}
      ${txs.length ? html`<ul class="small">${txs.map((t) => html`<li>${fmtDate(t.created_at, false)} · ${money(t.amount)} → ${t.account_name || '—'} ${t.note ? `(${t.note})` : ''}</li>`)}</ul>` : ''}
      ${ctx.can('orders_edit') && due > 0 ? html`<details ${order.payment.startsWith('manual_') ? raw('open') : ''}><summary class="link-btn">💵 টাকা পেয়েছি (পেমেন্ট রেকর্ড করুন)</summary>
        <form method="post" action="/admin/orders/${id}/payment" class="form">
          <div class="field-row">
            ${ui.field('টাকা', ui.input('amount', due, { type: 'number', min: 1, required: true }))}
            ${ui.field('মাধ্যম', ui.select('method', Object.entries(O.PAYMENT_METHODS), order.payment))}
          </div>
          ${ui.field('TrxID / রেফারেন্স', ui.input('trx', order.transaction_id || '', { maxlength: 80 }))}
          ${accounts.length ? ui.field('কোন অ্যাকাউন্টে জমা হলো (হিসাবে যোগ হবে)', ui.select('account_id', [['', 'হিসাবে যোগ করবেন না'], ...accounts.filter((a) => a.active).map((a) => [a.id, a.name])], '')) : ''}
          <button class="btn btn-sm">সেভ করুন</button>
        </form></details>` : ''}
    </section>

    <section class="panel">
      <h2>ভেতরের নোট (শুধু স্টাফ দেখবে)</h2>
      <form method="post" action="/admin/orders/${id}/note" class="form">
        ${ui.textarea('admin_note', order.admin_note, { rows: 3, maxlength: 1000, placeholder: 'যেমন: কাস্টমার বিকেলে কল ধরতে বলেছেন' })}
        ${ctx.can('orders_edit') ? html`<button class="btn btn-sm btn-ghost">নোট সেভ</button>` : ''}
      </form>
    </section>
  </div>
</div>
<script src="/js/bd-geo.js" defer></script>`;
  return ctx.page(`অর্ডার ${order.code}`, body, 'orders');
}

const ACTIONS = {
  order_status: 'অবস্থা বদলেছেন', order_edit: 'অর্ডার এডিট করেছেন', courier_send: 'কুরিয়ারে পাঠিয়েছেন', courier_sync: 'কুরিয়ার স্ট্যাটাস এনেছেন',
  order_payment: 'পেমেন্ট রেকর্ড করেছেন', order_note: 'নোট লিখেছেন', order_create: 'অর্ডার তৈরি করেছেন', block: 'ব্লক করেছেন', courier_auto: 'অটো কুরিয়ার',
};
function actionLabel(h) {
  let d = h.detail || '';
  if (h.action === 'order_status') d = d.replace(/(\w+) → (\w+)/, (_, a, b) => `${O.STATUSES[a] || a} → ${O.STATUSES[b] || b}`);
  return `${ACTIONS[h.action] || h.action}${d ? ': ' + d : ''}`;
}

// ---------------------------------------------------------------- actions
async function autoSend(ctx, id) {
  const s = ctx.settings;
  if (s.courier_auto_send !== '1' || !s.courier_default || !courier.configured(s, s.courier_default)) return;
  const o = await O.getOrder({ id });
  if (!o || o.consignment_id || o.status !== 'confirmed') return;
  const r = await sendToCourier(ctx, id, s.courier_default, {}, true);
  if (!r.ok) await ctx.log('courier_auto', 'order', id, 'পাঠানো যায়নি: ' + r.message);
}

async function sendToCourier(ctx, id, name, extra, auto = false) {
  const order = await O.getOrder({ id });
  if (!order) return { ok: false, message: 'অর্ডার পাওয়া যায়নি।' };
  if (O.RELEASED.has(order.status) || order.status === 'delivered') return { ok: false, message: `${order.code}: এই অবস্থার অর্ডার কুরিয়ারে পাঠানো যায় না।` };
  const r = await courier.send(order, name, ctx.settings, { ...extra, areaText: O.areaLabel(order) });
  if (!r.ok) return { ok: false, message: `${order.code}: ${r.message}` };
  await O.setCourierInfo(id, { courier: name, consignment_id: r.consignment_id, tracking_code: r.tracking_code, status: r.status });
  await ctx.log(auto ? 'courier_auto' : 'courier_send', 'order', id, `${name} · ${r.consignment_id}`);
  if (['pending', 'confirmed', 'processing', 'hold'].includes(order.status)) {
    try {
      const s = await O.setStatus(id, 'shipped', ctx.user.id);
      if (s.changed) await ctx.log('order_status', 'order', id, `${s.prev} → shipped`);
    } catch (_) { /* keep going */ }
  }
  return { ok: true };
}

async function setStatusAction(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  try {
    const r = await O.setStatus(id, b.status, ctx.user.id);
    if (r.changed) await ctx.log('order_status', 'order', id, `${r.prev} → ${b.status}`);
    if (b.status === 'confirmed') await autoSend(ctx, id);
  } catch (e) {
    return ctx.fail(`/admin/orders/${id}`, e.message);
  }
  return ctx.back(`/admin/orders/${id}`, 'status');
}
async function courierAction(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const r = await sendToCourier(ctx, id, b.courier, { weight: b.weight, note: b.note, city_id: b.city_id, zone_id: b.zone_id, area_id: b.area_id, area_name: b.area_name });
  return r.ok ? ctx.back(`/admin/orders/${id}`, 'sent') : ctx.fail(`/admin/orders/${id}`, r.message);
}
async function syncOne(ctx, order) {
  const r = await courier.status(order, ctx.settings);
  if (!r.ok) return r;
  await O.setCourierStatus(order.id, r.status);
  const mapped = courier.mapStatus(order.courier, r.status);
  if (mapped && mapped !== order.status) {
    try {
      const s = await O.setStatus(order.id, mapped, ctx.user ? ctx.user.id : null);
      if (s.changed) await db.logActivity(ctx.user ? ctx.user.id : null, 'order_status', 'order', order.id, `${s.prev} → ${mapped}`);
    } catch (_) { /* ignore */ }
  }
  return r;
}
async function syncAction(ctx, m) {
  const id = int(m[1]);
  const order = await O.getOrder({ id });
  if (!order) return ctx.back('/admin/orders');
  const r = await syncOne(ctx, order);
  if (r.ok) await ctx.log('courier_sync', 'order', id, r.status);
  return r.ok ? ctx.back(`/admin/orders/${id}`, 'synced') : ctx.fail(`/admin/orders/${id}`, r.message);
}
async function syncAll(ctx) {
  const rows = await db.q(`SELECT id FROM orders WHERE status='shipped' AND courier<>'' AND consignment_id<>'' ORDER BY courier_sent_at LIMIT 60`);
  let n = 0;
  for (const r of rows) {
    const o = await O.getOrder({ id: r.id });
    const res = await syncOne(ctx, o);
    if (res.ok) n++;
  }
  return ctx.redirect(ctx.res, `/admin/orders?status=shipped&msg=synced`);
  void n;
}
async function paymentAction(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const order = await O.getOrder({ id });
  if (!order) return ctx.back('/admin/orders');
  const amount = amt(b.amount);
  if (!amount) return ctx.fail(`/admin/orders/${id}`, 'টাকার পরিমাণ দিন।');
  await O.markPaid(id, { amount: (order.paid_amount || 0) + amount, trxId: str(b.trx, 80), method: O.PAYMENT_METHODS[b.method] ? b.method : null });
  if (int(b.account_id) && ctx.can('accounting')) {
    await finance.addTransaction({ type: 'income', category: 'অর্ডার পেমেন্ট', amount, account_id: b.account_id, order_id: id, note: `${order.code} ${str(b.trx, 80)}` }, ctx.user.id);
  }
  await ctx.log('order_payment', 'order', id, `৳${amount} ${str(b.trx, 80)}`);
  return ctx.back(`/admin/orders/${id}`, 'paid');
}
async function noteAction(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  await db.q('UPDATE orders SET admin_note=$1, updated_at=now() WHERE id=$2', [str(b.admin_note, 1000), id]);
  await ctx.log('order_note', 'order', id, str(b.admin_note, 120));
  return ctx.back(`/admin/orders/${id}`, 'saved');
}
async function blockAction(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const order = await O.getOrder({ id });
  if (!order) return ctx.back('/admin/orders');
  await customers.block('phone', order.phone, b.reason || '', ctx.user.id);
  if (b.block_ip && order.ip) await customers.block('ip', order.ip, b.reason || '', ctx.user.id);
  await ctx.log('block', 'order', id, `${order.phone} ${str(b.reason, 100)}`);
  return ctx.back(`/admin/orders/${id}`, 'blocked');
}

async function invoices(ctx) {
  const ids = String(ctx.query.get('ids') || '').split(',').map((x) => int(x)).filter(Boolean).slice(0, 200);
  const list = [];
  for (const id of ids) { const o = await O.getOrder({ id }); if (o) list.push(o); }
  if (!list.length) return ctx.redirect(ctx.res, '/admin/orders');
  return ctx.send(ctx.res, 200, invoicePage(list, ctx.settings));
}

// ---------------------------------------------------------------- create / edit form
function orderForm({ order, settings, error, action, title, isNew }) {
  const o = order || { items: [], district: 'Dhaka', thana: '', payment: 'cod', payment_status: 'unpaid', status: 'confirmed' };
  return html`<p class="crumbs"><a href="${isNew ? '/admin/orders' : `/admin/orders/${o.id}`}">← ফিরে যান</a></p>
<h1>${title}</h1>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${action}" class="form" data-order-form data-dhaka="${settings.delivery_dhaka}" data-outside="${settings.delivery_outside}"
  data-free-min="${settings.free_delivery_min}" data-city="${JSON.stringify(O.dhakaCityAreas(settings))}">
  <div class="two-col">
    <section class="panel">
      <h2>পণ্য</h2>
      <div class="item-picker">
        <input type="search" placeholder="পণ্যের নাম বা SKU লিখে খুঁজুন…" data-product-search autocomplete="off">
        <ul class="picker-results" data-product-results hidden></ul>
      </div>
      <table class="table item-rows"><thead><tr><th>পণ্য</th><th class="num">দাম (৳)</th><th class="num">পরিমাণ</th><th class="num">মোট</th><th></th></tr></thead>
        <tbody data-item-rows>${(o.items || []).map((it) => html`<tr data-row>
          <td>${it.name}${it.sku ? html`<br><span class="small muted">${it.sku}</span>` : ''}<input type="hidden" name="item_id[]" value="${it.product_id}"></td>
          <td class="num"><input type="number" name="item_price[]" value="${it.price}" min="0" step="0.01" class="w-num" data-price></td>
          <td class="num"><input type="number" name="item_qty[]" value="${it.qty}" min="1" class="w-num" data-qty></td>
          <td class="num" data-line-total>${money(it.price * it.qty)}</td>
          <td><button type="button" class="link-btn danger" data-remove-row aria-label="সরান">✕</button></td></tr>`)}</tbody>
      </table>
      <p class="muted small" data-no-items ${o.items && o.items.length ? raw('hidden') : ''}>উপরে খুঁজে পণ্য যোগ করুন।</p>
      <div class="field-row">
        ${ui.field('ডেলিভারি চার্জ (৳)', ui.input('delivery', o.delivery ?? settings.delivery_dhaka, { type: 'number', min: 0, 'data-delivery': true }), 'এলাকা বাছলে নিজে থেকে বসবে, চাইলে বদলাতে পারেন')}
        ${ui.field('ছাড় (৳)', ui.input('discount', o.discount || 0, { type: 'number', min: 0, 'data-discount': true }))}
      </div>
      <div class="order-total">মোট: <b data-grand>${money(o.total || 0)}</b></div>
    </section>
    <section class="panel">
      <h2>কাস্টমার</h2>
      ${ui.field('নাম', ui.input('customer_name', o.customer_name || '', { required: true, maxlength: 80 }))}
      ${ui.field('মোবাইল নম্বর', ui.input('phone', o.phone || '', { required: true, inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }))}
      ${ui.field('ইমেইল (ঐচ্ছিক)', ui.input('email', o.email || '', { type: 'email', maxlength: 120 }))}
      <div class="field-row">
        ${ui.field('জেলা', raw(`<select name="district" data-district data-value="${esc(o.district || 'Dhaka')}"></select>`))}
        ${ui.field('থানা / এলাকা', raw(`<select name="thana" data-thana data-value="${esc(o.thana || '')}"></select>`))}
      </div>
      ${ui.field('পূর্ণ ঠিকানা', ui.textarea('address', o.address || '', { rows: 2, required: true, maxlength: 400 }))}
      ${ui.field('কাস্টমারের নোট', ui.input('note', o.note || '', { maxlength: 300 }))}
      <h2>পেমেন্ট</h2>
      <div class="field-row">
        ${ui.field('মাধ্যম', ui.select('payment', Object.entries(O.PAYMENT_METHODS), o.payment))}
        ${ui.field('অবস্থা', ui.select('payment_status', Object.entries(O.PAYMENT_STATUSES), o.payment_status))}
      </div>
      <div class="field-row">
        ${ui.field('পরিশোধিত টাকা', ui.input('paid_amount', o.paid_amount || 0, { type: 'number', min: 0 }))}
        ${ui.field('TrxID', ui.input('transaction_id', o.transaction_id || '', { maxlength: 80 }))}
      </div>
      ${isNew ? ui.field('অর্ডারের অবস্থা', ui.select('status', Object.entries(O.STATUSES).filter(([k]) => !O.RELEASED.has(k)), 'confirmed')) : ''}
      ${ui.field('ভেতরের নোট', ui.textarea('admin_note', o.admin_note || '', { rows: 2, maxlength: 1000 }))}
    </section>
  </div>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">${isNew ? 'অর্ডার তৈরি করুন' : 'পরিবর্তন সেভ করুন'}</button></div>
</form>
<script src="/js/bd-geo.js" defer></script>`;
}

function itemsFromBody(b) {
  const ids = list(b.item_id);
  const qtys = list(b.item_qty);
  const prices = list(b.item_price);
  return ids.map((id, i) => ({ id: int(id), qty: int(qtys[i]), price: prices[i] }));
}

async function newOrder(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const items = itemsFromBody(b);
    const phone = normalizePhone(b.phone);
    let error = null;
    if (!str(b.customer_name)) error = 'কাস্টমারের নাম দিন।';
    else if (!validPhone(phone)) error = 'সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।';
    else if (str(b.address).length < 4) error = 'ঠিকানা দিন।';
    else if (!items.length) error = 'অন্তত একটি পণ্য যোগ করুন।';
    if (!error) {
      try {
        const r = await O.createOrder({
          items, name: str(b.customer_name, 80), phone, email: str(b.email, 120), address: str(b.address, 400),
          district: str(b.district, 60), thana: str(b.thana, 60), note: str(b.note, 300), payment: O.PAYMENT_METHODS[b.payment] ? b.payment : 'cod',
          trxId: str(b.transaction_id, 80), source: 'admin', createdBy: ctx.user.id, delivery: b.delivery, discount: b.discount,
          status: b.status, adminNote: str(b.admin_note, 1000),
        }, ctx.settings);
        if (O.PAYMENT_STATUSES[b.payment_status] && b.payment_status !== 'unpaid') {
          await O.markPaid(r.id, { amount: amt(b.paid_amount) || (b.payment_status === 'paid' ? r.total : 0), trxId: str(b.transaction_id, 80) });
        }
        await require('../services/drafts').markOrdered(phone, r.code);
        await ctx.log('order_create', 'order', r.id, r.code);
        if (b.status === 'confirmed') await autoSend(ctx, r.id);
        return ctx.back(`/admin/orders/${r.id}`, 'added');
      } catch (e) {
        if (!(e instanceof O.OrderError)) throw e;
        error = e.message;
      }
    }
    const order = { ...b, phone: b.phone, items: await describeItems(items) };
    return ctx.page('নতুন অর্ডার', orderForm({ order, settings: ctx.settings, error, action: '/admin/orders/new', title: 'নতুন অর্ডার তৈরি', isNew: true }), 'order-new', { status: 400 });
  }
  // from "অসম্পূর্ণ অর্ডার": the shopper's details and cart already filled in
  const draft = ctx.query.get('draft') ? await require('../services/drafts').get(ctx.query.get('draft')) : null;
  if (draft) {
    const items = await describeItems((draft.items || []).map((i) => ({ id: int(i.id), qty: int(i.qty, 1) })));
    const order = { items, customer_name: draft.name, phone: draft.phone, address: draft.address, district: draft.district || 'Dhaka', thana: draft.thana,
      note: draft.note, payment: 'cod', payment_status: 'unpaid', status: 'confirmed', admin_note: 'অসম্পূর্ণ অর্ডার থেকে (কল করে নেওয়া)' };
    return ctx.page('নতুন অর্ডার', orderForm({ order, settings: ctx.settings, action: '/admin/orders/new', title: 'অসম্পূর্ণ অর্ডার থেকে নতুন অর্ডার', isNew: true }), 'order-new');
  }
  return ctx.page('নতুন অর্ডার', orderForm({ settings: ctx.settings, action: '/admin/orders/new', title: 'নতুন অর্ডার তৈরি (ফোন/ফেসবুক অর্ডার)', isNew: true }), 'order-new');
}
async function describeItems(items) {
  const prods = await catalog.getProductsByIds(items.map((i) => i.id), { includeInactive: true });
  return items.map((i) => {
    const p = prods.find((x) => x.id === i.id);
    return p ? { product_id: p.id, name: p.name, sku: p.sku, price: i.price !== undefined && i.price !== '' ? int(i.price) : p.price, qty: i.qty || 1 } : null;
  }).filter(Boolean);
}

async function editOrder(ctx, m) {
  const id = int(m[1]);
  const order = await O.getOrder({ id });
  if (!order) return ctx.redirect(ctx.res, '/admin/orders');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const items = itemsFromBody(b);
    const phone = normalizePhone(b.phone);
    let error = !validPhone(phone) ? 'সঠিক মোবাইল নম্বর দিন।' : !items.length ? 'অন্তত একটি পণ্য রাখুন।' : null;
    if (!error) {
      try {
        await O.updateOrder(id, { ...b, phone, items }, ctx.settings, ctx.user.id);
        await ctx.log('order_edit', 'order', id, 'বিস্তারিত/পণ্য বদল');
        return ctx.back(`/admin/orders/${id}`, 'saved');
      } catch (e) {
        if (!(e instanceof O.OrderError)) throw e;
        error = e.message;
      }
    }
    const merged = { ...order, ...b, id, items: await describeItems(items) };
    return ctx.page('অর্ডার এডিট', orderForm({ order: merged, settings: ctx.settings, error, action: `/admin/orders/${id}/edit`, title: `অর্ডার ${order.code} এডিট` }), 'orders', { status: 400 });
  }
  return ctx.page('অর্ডার এডিট', orderForm({ order, settings: ctx.settings, action: `/admin/orders/${id}/edit`, title: `অর্ডার ${order.code} এডিট` }), 'orders');
}

// ---------------------------------------------------------------- small JSON APIs
async function productSearch(ctx) {
  const q = str(ctx.query.get('q'), 60);
  const rows = await catalog.listProducts({ q, includeInactive: ctx.query.get('all') === '1', limit: 12, sort: 'name', type: ctx.query.get('type') || undefined });
  return ctx.json(ctx.res, 200, { products: rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price, cost: ctx.can('see_cost') ? p.cost_price : undefined, stock: p.stock, unit: p.unit, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji, type: p.product_type })) });
}
async function courierList(ctx, m) {
  const name = m[1];
  if (name === 'pathao') {
    const r = await courier.pathaoList(ctx.settings, ctx.query.get('kind') || 'cities', ctx.query.get('parent'));
    return ctx.json(ctx.res, r.ok ? 200 : 502, r);
  }
  if (name === 'redx') {
    const r = await courier.redxAreas(ctx.settings, ctx.query.get('district') || '');
    return ctx.json(ctx.res, r.ok ? 200 : 502, r);
  }
  return ctx.json(ctx.res, 404, { ok: false, rows: [] });
}
async function fraudApi(ctx) {
  const phone = normalizePhone(ctx.query.get('phone'));
  if (!validPhone(phone)) return ctx.json(ctx.res, 400, { ok: false, message: 'ফোন নম্বর ঠিক নেই।' });
  if (!courier.configured(ctx.settings, 'pathao')) return ctx.json(ctx.res, 400, { ok: false, message: 'Pathao সেটআপ করা নেই।' });
  try {
    const r = await courier.pathaoSuccess(phone, ctx.settings);
    return ctx.json(ctx.res, 200, r);
  } catch (e) {
    return ctx.json(ctx.res, 502, { ok: false, message: e.message });
  }
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/orders', perm: 'orders', handler: listPage },
    { method: 'POST', path: '/admin/orders/bulk', perm: 'orders', handler: bulk },
    { method: 'GET', path: '/admin/orders/export.csv', perm: 'reports', handler: exportCsv },
    { method: 'GET', path: '/admin/orders/invoice', perm: 'orders', handler: invoices },
    { method: 'POST', path: '/admin/orders/sync', perm: 'courier', handler: syncAll },
    { method: '*', path: '/admin/orders/new', perm: 'orders_edit', handler: newOrder },
    { method: 'GET', path: /^\/admin\/orders\/(\d+)$/, perm: 'orders', handler: detail },
    { method: '*', path: /^\/admin\/orders\/(\d+)\/edit$/, perm: 'orders_edit', handler: editOrder },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/status$/, perm: 'orders_edit', handler: setStatusAction },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/courier$/, perm: 'courier', handler: courierAction },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/courier\/sync$/, perm: 'courier', handler: syncAction },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/payment$/, perm: 'orders_edit', handler: paymentAction },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/note$/, perm: 'orders_edit', handler: noteAction },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/block$/, perm: 'customers', handler: blockAction },
    { method: 'GET', path: '/admin/api/products/search', perm: (ctx) => (ctx.can('products') ? 'products' : ctx.can('inventory') ? 'inventory' : 'orders_edit'), handler: productSearch },
    { method: 'GET', path: /^\/admin\/api\/courier\/(pathao|redx)$/, perm: 'courier', handler: courierList },
    { method: 'GET', path: '/admin/api/fraud', perm: 'orders', handler: fraudApi },
  ],
  syncOne,
};

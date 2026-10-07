'use strict';
const { html, money, bn, dateRange, fmtDate } = require('../util');
const finance = require('../models/finance');
const orders = require('../models/orders');
const ui = require('./ui');
const charts = require('./charts');

async function dashboard(ctx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  const [d, series, monthly, recent] = await Promise.all([
    finance.dashboard(from, to), finance.dailySeries(from, to), finance.monthlySeries(12),
    ctx.can('orders') ? orders.listOrders({ limit: 8 }) : [],
  ]);
  const k = d.k;
  const live = d.live;
  const days = series.map((s) => ({ label: charts.dayLabel(s.day), bar: s.orders, line: s.sales }));
  const profitSeries = series.map((s) => ({ label: charts.dayLabel(s.day), bar: s.sales, line: s.profit }));
  const done = k.delivered + k.failed;
  const success = done ? Math.round((100 * k.delivered) / done) : null;
  const statusRows = Object.entries(orders.STATUSES).map(([key, label]) => ({ label, value: (d.byStatus.find((x) => x.status === key) || {}).n || 0 })).filter((r) => r.value);
  const payRows = d.byPayment.map((p) => ({ label: orders.PAYMENT_METHODS[p.payment] || p.payment, value: p.n }));
  const zoneRows = d.byZone.map((z) => ({ label: z.area === 'dhaka' ? 'ঢাকা সিটির ভেতরে' : 'ঢাকার বাইরে', value: z.n }));

  const body = html`
<div class="title-row"><h1>ড্যাশবোর্ড</h1><span class="muted">${fmtDate(from + 'T06:00:00Z', false)} থেকে ${fmtDate(to + 'T06:00:00Z', false)}</span></div>
${ui.flash(ctx.flash)}
${ui.dateFilter('/admin', from, to)}

<div class="kpis">
  ${ui.kpi('এখনই কনফার্ম করতে হবে', bn(live.pending), 'নতুন অর্ডার', live.pending ? 'kpi-alert' : '', '/admin/orders?status=pending')}
  ${ui.kpi('প্যাক করে পাঠাতে হবে', bn(live.to_ship), 'কনফার্ম/প্যাকিং', '', '/admin/orders?status=confirmed')}
  ${ui.kpi('কুরিয়ারে আছে', bn(live.shipped), 'ডেলিভারির পথে', '', '/admin/orders?status=shipped')}
  ${ui.kpi('আজকের বিক্রি', money(live.today_sales), `${bn(live.today_orders)}টি অর্ডার`)}
</div>
<div class="kpis">
  ${ui.kpi('মোট বিক্রি', money(k.sales), `${bn(k.orders)}টি অর্ডার (বাতিল বাদে)`, 'kpi-blue')}
  ${seeCost ? ui.kpi('মোট লাভ (খরচের আগে)', money(k.gross), 'বিক্রি − কেনা দাম − ডেলিভারি', 'kpi-green') : ''}
  ${seeCost ? ui.kpi('নিট লাভ (আনুমানিক)', money(Number(k.gross) - d.expenses), `খরচ ${money(d.expenses)} বাদে`, Number(k.gross) - d.expenses >= 0 ? 'kpi-green' : 'kpi-red') : ''}
  ${ui.kpi('গড় অর্ডারের দাম', money(k.aov), 'প্রতি অর্ডার')}
  ${ui.kpi('ডেলিভারি সফলতা', success === null ? '—' : bn(success) + '%', `${bn(k.delivered)} সফল · ${bn(k.failed)} বাতিল/ফেরত`)}
  ${ui.kpi('কাস্টমার', bn(live.customers), `এই সময়ে নতুন ${bn(live.new_customers)} জন`, '', ctx.can('customers') ? '/admin/customers' : '')}
</div>

<div class="grid-2">
  <section class="panel">
    <h2>প্রতিদিনের অর্ডার ও বিক্রি</h2>
    ${charts.combo(days, { barName: 'অর্ডার', lineName: 'বিক্রি (৳)' })}
  </section>
  <section class="panel">
    <h2>অর্ডারের অবস্থা</h2>
    ${charts.donut(statusRows, { centerSub: 'অর্ডার' })}
  </section>
</div>

${seeCost ? html`<div class="grid-2">
  <section class="panel">
    <h2>প্রতিদিনের বিক্রি ও লাভ</h2>
    ${charts.combo(profitSeries, { barName: 'বিক্রি', lineName: 'লাভ', barMoney: true })}
  </section>
  <section class="panel">
    <h2>গত ১২ মাস</h2>
    ${charts.combo(monthly.map((m) => ({ label: bn(m.month.slice(5)) + '/' + bn(m.month.slice(2, 4)), bar: Number(m.sales), line: Number(m.gross) - Number(m.expenses) })), { barName: 'বিক্রি', lineName: 'নিট লাভ', barMoney: true })}
  </section>
</div>` : ''}

<div class="grid-3">
  <section class="panel"><h2>সবচেয়ে বেশি বিক্রি</h2>
    ${charts.hbars(d.topProducts.map((p) => ({ label: p.name, value: p.qty, sub: money(p.revenue) })), { color: 0 })}</section>
  <section class="panel"><h2>ক্যাটাগরি অনুযায়ী বিক্রি</h2>
    ${charts.hbars(d.byCategory.map((c) => ({ label: c.name, value: Number(c.revenue) })), { isMoney: true, color: -1 })}</section>
  <section class="panel"><h2>কোন জেলা থেকে অর্ডার</h2>
    ${charts.hbars(d.byDistrict.map((c) => ({ label: (orders.findDistrict(c.district) || {}).bn || c.district, value: c.n })), { color: 2 })}</section>
</div>

<div class="grid-3">
  <section class="panel"><h2>ঢাকা বনাম ঢাকার বাইরে</h2>${charts.donut(zoneRows, { centerSub: 'অর্ডার' })}</section>
  <section class="panel"><h2>পেমেন্ট মেথড</h2>${charts.donut(payRows, { centerSub: 'অর্ডার' })}</section>
  <section class="panel"><h2>কোন সময়ে বেশি অর্ডার আসে</h2>${charts.hours(d.byHour)}
    <p class="muted small">গাঢ় রং মানে ওই ঘণ্টায় বেশি অর্ডার। বিজ্ঞাপন চালানোর সময় ঠিক করতে কাজে লাগবে।</p></section>
</div>

<div class="grid-2">
  ${ctx.can('orders') ? html`<section class="panel">
    <div class="section-head"><h2>সাম্প্রতিক অর্ডার</h2><a href="/admin/orders">সব অর্ডার</a></div>
    <table class="table compact"><tbody>${recent.map((o) => html`<tr>
      <td><a href="/admin/orders/${o.id}"><b>${o.code}</b></a><br><span class="small muted">${fmtDate(o.created_at)}</span></td>
      <td>${o.customer_name}<br><span class="small muted">${o.phone}</span></td>
      <td class="num">${money(o.total)}</td><td>${ui.pill(orders.STATUSES[o.status] || o.status, 'pill-' + o.status)}</td></tr>`)}</tbody></table>
  </section>` : ''}
  <section class="panel">
    <div class="section-head"><h2>স্টক কম আছে</h2>${ctx.can('inventory') ? html`<a href="/admin/inventory?low=1">সব দেখুন</a>` : ''}</div>
    ${d.lowStock.length ? html`<table class="table compact"><tbody>${d.lowStock.map((p) => html`<tr>
      <td>${ctx.can('products') ? html`<a href="/admin/products/${p.id}">${p.name}</a>` : p.name}<br><span class="small muted">${p.sku}</span></td>
      <td class="num ${p.stock === 0 ? 'warn' : ''}">${bn(p.stock)} ${p.unit}</td></tr>`)}</tbody></table>` : html`<p class="muted">সব পণ্যের যথেষ্ট স্টক আছে। 👍</p>`}
    ${seeCost ? html`<div class="inv-sum">
      <div><span class="muted small">স্টকের কেনা দাম</span><b>${money(d.inventory.cost_value)}</b></div>
      <div><span class="muted small">স্টকের বিক্রি দাম</span><b>${money(d.inventory.sale_value)}</b></div>
      <div><span class="muted small">মোট পিস</span><b>${bn(d.inventory.units)}</b></div>
    </div>` : ''}
  </section>
</div>`;
  return ctx.page('ড্যাশবোর্ড', body, 'home');
}

module.exports = { routes: [{ method: 'GET', path: '/admin', perm: 'dashboard', handler: dashboard }] };

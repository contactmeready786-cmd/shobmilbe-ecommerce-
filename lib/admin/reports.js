'use strict';
const { html, money, bn, fmtDate, dateRange, csv } = require('../util');
const db = require('../db');
const F = require('../models/finance');
const ui = require('./ui');
const charts = require('./charts');

const DAY = `(o.created_at AT TIME ZONE 'Asia/Dhaka')::date`;

async function sales(ctx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  const [daily, products, cats] = await Promise.all([
    F.dailySeries(from, to),
    db.q(`SELECT i.product_id, i.name, max(i.sku) AS sku, sum(i.qty)::int AS qty, sum(i.qty*i.price)::numeric(14,2) AS revenue, sum(i.qty*i.cost)::numeric(14,2) AS cost
          FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned')
          GROUP BY i.product_id, i.name ORDER BY revenue DESC LIMIT 200`, [from, to]),
    db.q(`SELECT coalesce(c.name,'ক্যাটাগরি নেই') AS name, sum(i.qty)::int AS qty, sum(i.qty*i.price)::numeric(14,2) AS revenue, sum(i.qty*(i.price-i.cost))::numeric(14,2) AS profit
          FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
          WHERE ${DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned') GROUP BY 1 ORDER BY revenue DESC`, [from, to]),
  ]);
  if (ctx.query.get('csv') === 'products') {
    const out = [['Product', 'SKU', 'Qty', 'Revenue', ...(seeCost ? ['Cost', 'Profit'] : [])]];
    products.forEach((p) => out.push([p.name, p.sku, p.qty, p.revenue, ...(seeCost ? [p.cost, Number(p.revenue) - Number(p.cost)] : [])]));
    return ctx.send(ctx.res, 200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="product-sales-${from}-${to}.csv"` });
  }
  const tot = daily.reduce((a, d) => ({ orders: a.orders + d.orders, sales: a.sales + d.sales, profit: a.profit + d.profit, delivered: a.delivered + d.delivered }), { orders: 0, sales: 0, profit: 0, delivered: 0 });
  const body = html`<div class="title-row"><h1>বিক্রির রিপোর্ট</h1>
  <div class="row-actions"><a class="btn btn-ghost" href="/admin/orders/export.csv?from=${from}&to=${to}">⬇ অর্ডার CSV</a><a class="btn btn-ghost" href="/admin/reports?from=${from}&to=${to}&csv=products">⬇ পণ্যভিত্তিক CSV</a><a class="btn btn-ghost" href="/admin/reports/staff">স্টাফ রিপোর্ট</a></div></div>
${ui.dateFilter('/admin/reports', from, to)}
<div class="kpis">
  ${ui.kpi('অর্ডার', bn(tot.orders), `${bn(tot.delivered)}টি ডেলিভারি হয়েছে`)}
  ${ui.kpi('বিক্রি', money(tot.sales), 'বাতিল বাদে', 'kpi-blue')}
  ${seeCost ? ui.kpi('লাভ (খরচের আগে)', money(tot.profit), 'বাতিল/ফেরত বাদে', 'kpi-green') : ''}
</div>
<section class="panel"><h2>প্রতিদিন</h2>${charts.combo(daily.map((d) => ({ label: charts.dayLabel(d.day), bar: d.sales, line: seeCost ? d.profit : d.orders })), { barName: 'বিক্রি', lineName: seeCost ? 'লাভ' : 'অর্ডার', barMoney: true, lineMoney: seeCost })}</section>
<div class="grid-2">
  <section class="panel table-wrap"><h2>পণ্য অনুযায়ী</h2>
    <table class="table compact"><thead><tr><th>পণ্য</th><th class="num">বিক্রি (পিস)</th><th class="num">টাকা</th>${seeCost ? html`<th class="num">লাভ</th>` : ''}</tr></thead>
    <tbody>${products.map((p) => html`<tr><td>${p.name}${p.sku ? html`<br><span class="small muted">${p.sku}</span>` : ''}</td><td class="num">${bn(p.qty)}</td><td class="num">${money(p.revenue)}</td>${seeCost ? html`<td class="num">${money(Number(p.revenue) - Number(p.cost))}</td>` : ''}</tr>`)}</tbody></table></section>
  <section class="panel table-wrap"><h2>ক্যাটাগরি অনুযায়ী</h2>
    <table class="table compact"><thead><tr><th>ক্যাটাগরি</th><th class="num">পিস</th><th class="num">টাকা</th>${seeCost ? html`<th class="num">লাভ</th>` : ''}</tr></thead>
    <tbody>${cats.map((c) => html`<tr><td>${c.name}</td><td class="num">${bn(c.qty)}</td><td class="num">${money(c.revenue)}</td>${seeCost ? html`<td class="num">${money(c.profit)}</td>` : ''}</tr>`)}</tbody></table>
    <h2 class="mt">প্রতিদিনের হিসাব</h2>
    <table class="table compact"><thead><tr><th>দিন</th><th class="num">অর্ডার</th><th class="num">বিক্রি</th></tr></thead>
    <tbody>${daily.slice().reverse().map((d) => html`<tr><td>${fmtDate(String(d.day instanceof Date ? d.day.toISOString() : d.day).slice(0, 10) + 'T06:00:00Z', false)}</td><td class="num">${bn(d.orders)}</td><td class="num">${money(d.sales)}</td></tr>`)}</tbody></table></section>
</div>`;
  return ctx.page('রিপোর্ট', body, 'reports');
}

async function staff(ctx) {
  const { from, to } = dateRange(ctx.query, 30);
  const rows = await F.staffReport(from, to);
  const body = html`<p class="crumbs"><a href="/admin/reports">← রিপোর্ট</a></p><h1>স্টাফ রিপোর্ট</h1>
${ui.dateFilter('/admin/reports/staff', from, to)}
<section class="panel table-wrap"><table class="table"><thead><tr><th>স্টাফ</th><th class="num">লগইন</th><th class="num">অর্ডার কনফার্ম</th><th class="num">বাতিল</th><th class="num">অর্ডার এডিট</th><th class="num">নতুন অর্ডার তৈরি</th><th class="num">কুরিয়ারে পাঠানো</th><th class="num">মোট কাজ</th><th>শেষ লগইন</th></tr></thead>
<tbody>${rows.map((s) => html`<tr class="${s.active ? '' : 'row-off'}"><td>${ctx.user.role === 'owner' ? html`<a href="/admin/staff/${s.id}">${s.name}</a>` : s.name}${s.role === 'owner' ? html` <span class="pill">মালিক</span>` : ''}</td>
  <td class="num">${bn(s.logins)}</td><td class="num">${bn(s.confirmed)}</td><td class="num">${bn(s.cancelled)}</td><td class="num">${bn(s.edits)}</td><td class="num">${bn(s.created)}</td><td class="num">${bn(s.sent)}</td><td class="num"><b>${bn(s.actions)}</b></td>
  <td class="small">${s.last_login ? fmtDate(s.last_login) : '—'}</td></tr>`)}</tbody></table></section>
<section class="panel"><h2>কাজের তুলনা</h2>${charts.hbars(rows.filter((r) => r.actions).map((r) => ({ label: r.name, value: r.actions, sub: `কনফার্ম ${bn(r.confirmed)}` })), { color: -1 })}</section>`;
  return ctx.page('স্টাফ রিপোর্ট', body, 'reports');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/reports', perm: 'reports', handler: sales },
    { method: 'GET', path: '/admin/reports/staff', perm: 'reports', handler: staff },
  ],
};

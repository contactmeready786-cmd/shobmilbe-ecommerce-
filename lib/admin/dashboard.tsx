import { Val, attrValue, jsxList } from '../react/html';
import { money, bn, dateRange, fmtDate } from '../util';
import * as finance from '../models/finance';
import * as orders from '../models/orders';
import * as ui from './ui';
import * as security from '../security';
import * as charts from './charts';
import * as $db from '../db';
import type { AdminCtx } from '../types';
import * as $health from '../services/health';

async function dashboard(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  // 🩺 measured in the background while the rest loads (lib/services/health.ts keeps the last answer)
  const healthP = ctx.user.role === 'owner' ? $health.measure(ctx.settings).catch(() => null) : Promise.resolve(null);
  const [d, series, monthly, recent, cmp] = await Promise.all([
    finance.dashboard(from, to), finance.dailySeries(from, to), finance.monthlySeries(12),
    ctx.can('orders') ? orders.listOrders({ limit: 8 }) : [],
    // 📮 complaints that are late or due within a day (the law gives 72 hours)
    ctx.can('orders') ? $db.one<{ late: number; soon: number }>(`SELECT count(*) FILTER (WHERE due_at < now())::int AS late,
      count(*) FILTER (WHERE due_at >= now() AND due_at < now() + interval '24 hours')::int AS soon
      FROM complaints WHERE status IN ('open','working')`).catch(() => null) : null,
  ]);
  const k = d.k;
  // 🩺 something about to run out (database space, backups, connections) — the owner sees it first thing
  const healthNow = await healthP;
  const healthWarn = healthNow ? $health.warnings(healthNow) : [];
  const live = d.live;
  const days = series.map((s) => ({ label: charts.dayLabel(s.day), bar: s.orders, line: s.sales }));
  const profitSeries = series.map((s) => ({ label: charts.dayLabel(s.day), bar: s.sales, line: s.profit }));
  const done = k!.delivered + k!.failed;
  const success = done ? Math.round((100 * k!.delivered) / done) : null;
  const statusRows = Object.entries(orders.STATUSES).map(([key, label]) => ({ label, value: (d.byStatus.find((x) => x.status === key) || {}).n || 0 })).filter((r) => r.value);
  const payRows = d.byPayment.map((p) => ({ label: orders.PAYMENT_METHODS[p.payment] || p.payment, value: p.n }));
  const zoneRows = d.byZone.map((z) => ({ label: z.area === 'dhaka' ? 'Inside Dhaka city' : 'Outside Dhaka', value: z.n }));

  // ---- v5 "Veylix" Overview (owner, 2026-11-17): a big sales card + trend + small number cards on top, then
  // order fulfilment / recent orders / payment methods side by side, then the rest of the numbers and charts.
  const total = (rows: { value: number }[]) => rows.reduce((a, r) => a + r.value, 0) || 1;
  const pct = (v: number, of: number) => `${Math.max(2, Math.round((100 * v) / of))}%`;
  const spark = series.slice(-24);
  const sparkMax = Math.max(1, ...spark.map((x) => Number(x.sales) || 0));
  const canProducts = ctx.can('products') || ctx.can('products_view');
  const statusTotal = total(statusRows);
  const payTotal = total(payRows);
  const stat = (label: string, value: unknown, tone: string, icon: string, href = '') => {
    const inner = <><span className={`chip-ic ${tone}`} aria-hidden="true">{icon}</span><div><span>{label}</span><b><Val v={value} /></b></div></>;
    return href ? <a className="vx-stat" href={href}>{inner}</a> : <div className="vx-stat">{inner}</div>;
  };
  const body = <>{' '}{(ctx.user.role === 'owner' && (!security.hasKey() || ctx.settings.__secrets_locked) ? <p className="flash flash-error">🛡️ One security step is still left —{' '}<a href="/admin/security">see the Security page</a>{' '}(5 minutes).</p> : null)}{' '}{(cmp && (cmp.late || cmp.soon) ? <p className={`flash ${cmp.late ? 'flash-error' : ''}`}>📮{' '}{(cmp.late ? <><b>{cmp.late} complaint(s) are past 72 hours!</b>{' '}</> : null)}{(cmp.soon ? <>{cmp.soon} have less than 24 hours left.{' '}</> : null)}<a href="/admin/complaints">See complaints →</a></p> : null)}{' '}{jsxList(healthWarn.map((w) => <p className={`flash ${w.level === 'bad' ? 'flash-error' : ''}`}>🩺{' '}<b><Val v={w.title} /></b>{' '}—{' '}<a href="/admin/health">See server & database →</a></p>))}<div className="title-row"><h1>Overview</h1><span className="muted">{fmtDate(from + 'T06:00:00Z', false)}{' '}–{' '}{fmtDate(to + 'T06:00:00Z', false)}</span></div>{ui.flash(ctx.flash)}{' '}{ui.dateFilter('/admin', from, to)}
  <div className="vx-dash">
    <div className="vx-row-1">
      <section className="panel vx-hero">
        <div className="vx-hero-head"><div><span className="vx-hero-label">Total sales</span><div className="vx-hero-value">{money(k!.sales)}</div></div><div className="vx-spark" aria-hidden="true">{jsxList(spark.map((x) => <i style={{ height: pct(Number(x.sales) || 0, sparkMax) }} />))}</div></div>
        <span className="vx-hero-sub">Today {money(live!.today_sales)} · this month {money(live!.month_sales)}</span>
        <div className="vx-hero-stats"><div><b>{bn(k!.orders)}</b><span>Orders</span></div><div><b>{money(k!.aov)}</b><span>Avg. order value</span></div><div><b>{success === null ? '—' : bn(success) + '%'}</b><span>Delivery success</span></div></div>
      </section>
      <div className="vx-right">
        <section className="panel"><div className="vx-card-head"><h2>Revenue trend</h2><span className="muted small">Orders (bars) and sales (line) per day</span></div>{charts.combo(days, { barName: 'Orders', lineName: 'Sales (৳)', height: 200 })}</section>
        <div className="vx-stats">
          {stat('Active products', bn(live!.products), 'chip-blue', '📦', canProducts ? '/admin/products?status=on' : '')}
          {stat('Customers', bn(live!.customers), 'chip-green', '👥', ctx.can('customers') ? '/admin/customers' : '')}
          {stat('Low stock', bn(live!.low_stock), 'chip-amber', '⚠️', ctx.can('inventory') ? '/admin/inventory?low=1' : '')}
          {stat('Cancelled / returned (30 days)', bn(live!.cancel_return_30), 'chip-red', '↩️', ctx.can('orders') ? '/admin/orders?status=returned' : '')}
        </div>
      </div>
    </div>
    <div className="vx-row-3">
      <section className="panel"><div className="vx-card-head"><h2>Order fulfilment</h2>{(ctx.can('orders') ? <a href="/admin/orders">View all →</a> : null)}</div>{(statusRows.length ? <div className="vx-bars">{jsxList(Object.entries(orders.STATUSES).map(([key, label]) => ({ key, label, value: (d.byStatus.find((x) => x.status === key) || {}).n || 0 })).filter((r) => r.value).map((r) => <a className="vx-bar" href={`/admin/orders?status=${attrValue(r.key)}`}><div className="vx-bar-top"><span><Val v={r.label} /></span><b>{bn(r.value)}</b></div><div className="vx-bar-track"><i style={{ width: pct(r.value, statusTotal) }} /></div></a>))}</div> : <p className="muted">No orders in this period.</p>)}</section>
      {(ctx.can('orders') ? <section className="panel"><div className="vx-card-head"><h2>Recent orders</h2><a href="/admin/orders">View all →</a></div>{(recent.length ? <ul className="vx-list">{jsxList(recent.slice(0, 6).map((o) => <li><a href={`/admin/orders/${attrValue(o.id)}`}><span><b><Val v={o.code} /></b><span className="small muted"><span translate="no"><Val v={o.customer_name} /></span>{' · '}{money(o.total)}</span></span>{ui.pill(orders.STATUSES[o.status] || o.status, 'pill-' + o.status)}</a></li>))}</ul> : <p className="muted">No orders yet.</p>)}</section> : null)}
      <section className="panel"><div className="vx-card-head"><h2>Payment methods</h2></div>{(payRows.length ? <div className="vx-bars">{jsxList(payRows.map((r) => <div className="vx-bar"><div className="vx-bar-top"><span><Val v={r.label} /></span><b>{bn(Math.round((100 * r.value) / payTotal))}%</b></div><div className="vx-bar-track"><i style={{ width: pct(r.value, payTotal) }} /></div></div>))}</div> : <p className="muted">No orders in this period.</p>)}</section>
    </div>
  </div>
  <h2 className="vx-section-h">Needs attention</h2><div className="kpis">{ui.kpi('Confirm now', bn(live!.pending), 'New orders', live!.pending ? 'kpi-alert' : '', '/admin/orders?status=pending')}{' '}{ui.kpi('Pack and send', bn(live!.to_ship), 'Confirmed / packing', '', '/admin/orders?status=confirmed')}{' '}{ui.kpi('With courier', bn(live!.shipped), 'On the way', '', '/admin/orders?status=shipped')}{' '}{ui.kpi('Out of stock', bn(live!.out_of_stock), 'Among active products', live!.out_of_stock ? 'kpi-alert' : '', canProducts ? '/admin/products?out=1' : '')}{' '}{ui.kpi('Last 7 days', money(live!.week_sales), `${bn(live!.week_orders)} orders`, '', '/admin?days=7')}{' '}{ui.kpi('New customers', bn(live!.new_customers), 'In this period')}</div>{(seeCost ? <div className="kpis">{ui.kpi('Gross profit (before expenses)', money(k!.gross), 'Sales − buying price − delivery', 'kpi-green')}{' '}{ui.kpi('Net profit (estimate)', money(Number(k!.gross) - d.expenses), `After expenses of ${money(d.expenses)}`, Number(k!.gross) - d.expenses >= 0 ? 'kpi-green' : 'kpi-red')}</div> : null)}{(seeCost ? <div className="dash-charts"><section className="panel"><h2>Daily sales & profit</h2>{charts.combo(profitSeries, { barName: 'Sales', lineName: 'Profit', barMoney: true })}</section><section className="panel"><h2>Last 12 months</h2>{charts.combo(monthly.map((m) => ({ label: bn(m.month.slice(5)) + '/' + bn(m.month.slice(2, 4)), bar: Number(m.sales), line: Number(m.gross) - Number(m.expenses) })), { barName: 'Sales', lineName: 'Net profit', barMoney: true })}</section></div> : null)}<div className="grid-3"><section className="panel"><h2>Best sellers</h2>{charts.hbars(d.topProducts.map((p) => ({ label: p.name, value: p.qty, sub: money(p.revenue) })), { color: 0 })}</section><section className="panel"><h2>Sales by category</h2>{charts.hbars(d.byCategory.map((c) => ({ label: c.name, value: Number(c.revenue) })), { isMoney: true, color: -1 })}</section><section className="panel"><h2>Orders by district</h2>{charts.hbars(d.byDistrict.map((c) => ({ label: (orders.findDistrict(c.district) || {}).bn || c.district, value: c.n })), { color: 2 })}</section></div><div className="grid-3"><section className="panel"><h2>Inside vs outside Dhaka</h2>{charts.donut(zoneRows, { centerSub: 'orders' })}</section><section className="panel"><h2>Order status</h2>{charts.donut(statusRows, { centerSub: 'orders' })}</section><section className="panel"><h2>Busiest hours</h2>{charts.hours(d.byHour)}<p className="muted small">Darker = more orders in that hour. Useful for timing your ads.</p></section></div><section className="panel"><div className="section-head"><h2>Low stock</h2>{(ctx.can('inventory') ? <a href="/admin/inventory?low=1">See all</a> : null)}</div>{(d.lowStock.length ? <ul className="low-list">{jsxList(d.lowStock.map((p) => <li title={attrValue(p.name)}>{(ctx.can('products') ? <a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a> : <span><Val v={p.name} /></span>)}<b className={p.stock === 0 ? 'warn' : ''}>{bn(p.stock)}{' '}<Val v={p.unit} /></b></li>))}</ul> : <p className="muted">Every product has enough stock. 👍</p>)}{' '}{(seeCost ? <div className="inv-sum"><div><span className="muted small">Stock at buying price</span><b>{money(d.inventory!.cost_value)}</b></div><div><span className="muted small">Stock at selling price</span><b>{money(d.inventory!.sale_value)}</b></div><div><span className="muted small">Total pieces</span><b>{bn(d.inventory!.units)}</b></div></div> : null)}</section></>;
  return ctx.page('Overview', body, 'home');
}

export const routes = [{ method: 'GET', path: '/admin', perm: 'dashboard', handler: dashboard }];

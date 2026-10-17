// Admin → রিপোর্ট: sales by day / week / month, products (best and slow sellers), categories, customers,
// cancelled & returned orders, profit & margin (owner only), staff — any date range, CSV and Excel downloads.
import { Val, attrValue, jsxList } from '../react/html';
import { money, bn, pct, fmtDate, dateRange, csv } from '../util';
import * as db from '../db';
import * as F from '../models/finance';
import * as O from '../models/orders';
import * as ui from './ui';
import * as charts from './charts';
import * as xlsx from '../services/xlsx';
import type { AdminCtx, Loose } from '../types';

const DAY = `(o.created_at AT TIME ZONE 'Asia/Dhaka')::date`;
const OK = `o.status NOT IN ('cancelled','returned')`;
const TABS = [['sales', '📈 বিক্রি'], ['products', '📦 পণ্য'], ['categories', '🗂️ ক্যাটাগরি'], ['customers', '👤 কাস্টমার'], ['returns', '↩️ বাতিল ও ফেরত'], ['profit', '💰 লাভ ও মার্জিন']];

// ---------------------------------------------------------------- data
async function salesBy(from?: Loose, to?: Loose, unit?: Loose) {
  const trunc = unit === 'month' ? 'month' : unit === 'week' ? 'week' : 'day';
  return db.q(`SELECT date_trunc('${trunc}', ${DAY})::date AS period,
      count(*)::int AS orders,
      count(*) FILTER (WHERE o.status='delivered')::int AS delivered,
      count(*) FILTER (WHERE o.status IN ('cancelled','returned'))::int AS failed,
      coalesce(sum(o.total) FILTER (WHERE ${OK}),0)::numeric(14,2) AS sales,
      coalesce(sum(o.subtotal - o.discount - o.points_discount - o.cost_total) FILTER (WHERE ${OK}),0)::numeric(14,2) AS profit,
      coalesce(sum(o.discount + o.points_discount) FILTER (WHERE ${OK}),0)::numeric(14,2) AS discount
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]);
}
async function productRows(from?: Loose, to?: Loose) {
  return db.q(`SELECT i.product_id, i.name, max(i.sku) AS sku, sum(i.qty)::int AS qty, sum(i.qty*i.price)::numeric(14,2) AS revenue,
      sum(i.qty*i.cost)::numeric(14,2) AS cost, count(DISTINCT o.id)::int AS orders,
      (SELECT count(*) FROM page_views v WHERE v.product_id=i.product_id AND (v.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS views
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${DAY} BETWEEN $1 AND $2 AND ${OK}
    GROUP BY i.product_id, i.name ORDER BY revenue DESC LIMIT 500`, [from, to]);
}
// Products on the shop that sold nothing in the range — the most viewed first (people look but don't buy).
async function slowRows(from?: Loose, to?: Loose) {
  return db.q(`SELECT p.id, p.name, p.sku, p.price, p.stock, p.created_at,
      (SELECT count(*) FROM page_views v WHERE v.product_id=p.id AND (v.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS views,
      (SELECT max(o.created_at) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND ${OK}) AS last_sold
    FROM products p WHERE p.active AND NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.product_id=p.id AND ${DAY} BETWEEN $1 AND $2 AND ${OK})
    ORDER BY views DESC, p.stock DESC, p.id LIMIT 200`, [from, to]);
}
async function categoryRows(from?: Loose, to?: Loose) {
  return db.q(`SELECT coalesce(c.name,'ক্যাটাগরি নেই') AS name, sum(i.qty)::int AS qty, sum(i.qty*i.price)::numeric(14,2) AS revenue,
      sum(i.qty*(i.price-i.cost))::numeric(14,2) AS profit, count(DISTINCT o.id)::int AS orders
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE ${DAY} BETWEEN $1 AND $2 AND ${OK} GROUP BY 1 ORDER BY revenue DESC`, [from, to]);
}
async function customerRows(from?: Loose, to?: Loose) {
  const top = await db.q(`SELECT o.phone, max(o.customer_name) AS name, count(*)::int AS orders, sum(o.total) FILTER (WHERE ${OK})::numeric(14,2) AS spent,
      count(*) FILTER (WHERE o.status IN ('cancelled','returned'))::int AS failed, max(c.id) AS customer_id
    FROM orders o LEFT JOIN customers c ON c.phone=o.phone WHERE ${DAY} BETWEEN $1 AND $2 GROUP BY o.phone ORDER BY spent DESC NULLS LAST LIMIT 100`, [from, to]);
  const mix = await db.one(`SELECT count(DISTINCT o.phone)::int AS buyers,
      count(DISTINCT o.phone) FILTER (WHERE NOT EXISTS (SELECT 1 FROM orders x WHERE x.phone=o.phone AND x.created_at < ($1::date)::timestamp AT TIME ZONE 'Asia/Dhaka'))::int AS new_buyers
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2`, [from, to]);
  const districts = await db.q(`SELECT coalesce(nullif(o.district,''),'অজানা') AS district, count(*)::int AS orders, sum(o.total) FILTER (WHERE ${OK})::numeric(14,2) AS sales
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [from, to]);
  return { top, mix, districts };
}
async function returnRows(from?: Loose, to?: Loose) {
  const orders = await db.q(`SELECT o.id, o.code, o.customer_name, o.phone, o.district, o.status, o.total, o.courier, o.courier_status, o.returned_to, o.created_at
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2 AND o.status IN ('cancelled','returned') ORDER BY o.created_at DESC LIMIT 300`, [from, to]);
  const products = await db.q(`SELECT i.product_id, i.name, sum(i.qty)::int AS qty, count(DISTINCT o.id)::int AS orders,
      (SELECT sum(j.qty) FROM order_items j JOIN orders x ON x.id=j.order_id WHERE j.product_id=i.product_id AND (x.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS sold
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${DAY} BETWEEN $1 AND $2 AND o.status IN ('cancelled','returned')
    GROUP BY i.product_id, i.name ORDER BY qty DESC LIMIT 50`, [from, to]);
  const districts = await db.q(`SELECT coalesce(nullif(o.district,''),'অজানা') AS district, count(*)::int AS orders,
      count(*) FILTER (WHERE o.status IN ('cancelled','returned'))::int AS failed
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2 GROUP BY 1 HAVING count(*) >= 3 ORDER BY (count(*) FILTER (WHERE o.status IN ('cancelled','returned')))::float / count(*) DESC LIMIT 15`, [from, to]);
  return { orders, products, districts };
}
async function profitRow(from?: Loose, to?: Loose) {
  return db.one(`SELECT coalesce(sum(o.subtotal) FILTER (WHERE ${OK}),0)::numeric(14,2) AS goods,
      coalesce(sum(o.discount + o.points_discount) FILTER (WHERE ${OK}),0)::numeric(14,2) AS discount,
      coalesce(sum(o.delivery) FILTER (WHERE ${OK}),0)::numeric(14,2) AS delivery,
      coalesce(sum(o.cost_total) FILTER (WHERE ${OK}),0)::numeric(14,2) AS cost,
      coalesce(sum(o.total) FILTER (WHERE ${OK}),0)::numeric(14,2) AS total,
      coalesce(sum(o.refund_amount),0)::numeric(14,2) AS refunds,
      (SELECT coalesce(sum(amount),0) FROM transactions t WHERE t.type='expense' AND t.tx_date BETWEEN $1 AND $2
         AND t.category NOT IN ('সাপ্লায়ার পেমেন্ট','মালিকের উত্তোলন','ঋণ পরিশোধ','ভ্যাট/ট্যাক্স পরিশোধ','রিফান্ড'))::numeric(14,2) AS expenses
    FROM orders o WHERE ${DAY} BETWEEN $1 AND $2`, [from, to]);
}

// ---------------------------------------------------------------- page
const periodLabel = (d?: Loose, unit?: Loose) => {
  const s = String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  if (unit === 'month') return bn(s.slice(0, 7));
  return fmtDate(s + 'T06:00:00Z', false) + (unit === 'week' ? ' থেকে' : '');
};
const margin = (rev?: Loose, cost?: Loose) => (Number(rev) > 0 ? ((Number(rev) - Number(cost)) / Number(rev)) * 100 : null);

async function page(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  const tabs = TABS.filter(([k]) => k !== 'profit' || seeCost);
  const tab = tabs.some(([k]) => k === ctx.query.get('tab')) ? ctx.query.get('tab') : 'sales';
  const unit = ['day', 'week', 'month'].includes(ctx.query.get('by')) ? ctx.query.get('by') : 'day';
  const qs = (extra?: Loose) => '?' + new URLSearchParams({ from, to, tab, ...(unit !== 'day' ? { by: unit } : {}), ...extra });
  let content: Loose = '';

  if (tab === 'sales') {
    const rows = await salesBy(from, to, unit);
    const tot = rows.reduce((a, d) => ({ orders: a.orders + d.orders, delivered: a.delivered + d.delivered, failed: a.failed + d.failed, sales: a.sales + Number(d.sales), profit: a.profit + Number(d.profit) }),
      { orders: 0, delivered: 0, failed: 0, sales: 0, profit: 0 });
    content = <><div className="kpis"><Val v={ui.kpi('অর্ডার', bn(tot.orders), `${bn(tot.delivered)}টি ডেলিভারি · ${bn(tot.failed)}টি বাতিল/ফেরত`)} />{' '}<Val v={ui.kpi('বিক্রি', money(tot.sales), 'বাতিল/ফেরত বাদে', 'kpi-blue')} />{' '}<Val v={ui.kpi('গড় অর্ডার', money(tot.orders - tot.failed > 0 ? Math.round(tot.sales / (tot.orders - tot.failed)) : 0), '')} />{' '}{(seeCost ? <Val v={ui.kpi('পণ্যে লাভ', money(tot.profit), 'বিক্রি − কেনা দাম − ছাড়', 'kpi-green')} /> : null)}</div><div className="chips">{jsxList([['day', 'দিন অনুযায়ী'], ['week', 'সপ্তাহ অনুযায়ী'], ['month', 'মাস অনুযায়ী']].map(([k, l]) => <a className={`chip ${unit === k ? 'on' : ''}`} href={`/admin/reports${'?' + new URLSearchParams({ from, to, tab, by: k })}`}><Val v={l} /></a>))}</div><section className="panel"><Val v={charts.combo(rows.map((d) => ({ label: unit === 'day' ? charts.dayLabel(d.period) : periodLabel(d.period, unit).replace(' থেকে', ''), bar: Number(d.sales), line: seeCost ? Number(d.profit) : d.orders })),
    { barName: 'বিক্রি', lineName: seeCost ? 'লাভ' : 'অর্ডার', barMoney: true, lineMoney: seeCost })} /></section><section className="panel table-wrap"><table className="table compact"><thead><tr><th>{(unit === 'month' ? "মাস" : (unit === 'week' ? "সপ্তাহ" : "দিন"))}</th><th className="num">অর্ডার</th><th className="num">ডেলিভারি</th><th className="num">বাতিল/ফেরত</th><th className="num">ছাড়</th><th className="num">বিক্রি</th>{(seeCost ? <th className="num">লাভ</th> : null)}</tr></thead><tbody>{jsxList(rows.slice().reverse().map((d) => <tr><td><Val v={periodLabel(d.period, unit)} /></td><td className="num">{bn(d.orders)}</td><td className="num">{bn(d.delivered)}</td><td className={`num ${d.failed ? 'warn' : ''}`}>{bn(d.failed)}</td><td className="num">{money(d.discount)}</td><td className="num"><b>{money(d.sales)}</b></td>{(seeCost ? <td className="num">{money(d.profit)}</td> : null)}</tr>))}</tbody></table></section></>;
  }

  if (tab === 'products') {
    const [rows, slow] = await Promise.all([productRows(from, to), slowRows(from, to)]);
    content = <div className="grid-2"><section className="panel table-wrap"><h2>🏆 বেশি বিক্রি</h2><table className="table compact"><thead><tr><th>পণ্য</th><th className="num">পিস</th><th className="num">অর্ডার</th><th className="num">টাকা</th>{(seeCost ? <><th className="num">লাভ</th><th className="num">মার্জিন</th></> : null)}<th className="num" title="এই সময়ে পণ্যের পেজ কতবার দেখা হয়েছে">ভিউ</th></tr></thead><tbody>{jsxList(rows.map((p) => { const mg = margin(p.revenue, p.cost); return <tr><td>{(p.product_id ? <a href={`/admin/products/${attrValue(p.product_id)}`}><Val v={p.name} /></a> : <Val v={p.name} />)}{(p.sku ? <><br /><span className="small muted"><Val v={p.sku} /></span></> : null)}</td><td className="num">{bn(p.qty)}</td><td className="num">{bn(p.orders)}</td><td className="num">{money(p.revenue)}</td>{(seeCost ? <><td className="num">{money(Number(p.revenue) - Number(p.cost))}</td><td className={`num ${mg !== null && mg < 10 ? 'warn' : ''}`}>{(mg === null ? "—" : pct(mg))}</td></> : null)}<td className="num">{bn(p.views)}</td></tr>; }))}</tbody></table>{(rows.length ? null : <p className="muted">এই সময়ে কোনো বিক্রি নেই।</p>)}</section><section className="panel table-wrap"><h2>🐢 বিক্রি হয়নি{' '}<small>{bn(slow.length)}টি</small></h2><p className="small muted">দোকানে চালু, কিন্তু এই সময়ে একটাও বিক্রি হয়নি। বেশি ভিউ কিন্তু বিক্রি নেই মানে দাম, ছবি বা বিবরণ দেখে কেউ কিনছে না — দাম/ছবি একটু ঠিক করে দেখুন।</p><table className="table compact"><thead><tr><th>পণ্য</th><th className="num">দাম</th><th className="num">স্টক</th><th className="num">ভিউ</th><th>শেষ বিক্রি</th></tr></thead><tbody>{jsxList(slow.map((p) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a>{(p.sku ? <><br /><span className="small muted"><Val v={p.sku} /></span></> : null)}</td><td className="num">{money(p.price)}</td><td className="num">{bn(p.stock)}</td><td className={`num ${p.views >= 20 ? 'warn' : ''}`}>{bn(p.views)}</td><td className="small">{(p.last_sold ? fmtDate(p.last_sold, false) : "কখনো না")}</td></tr>))}</tbody></table></section></div>;
  }

  if (tab === 'categories') {
    const rows = await categoryRows(from, to);
    content = <><section className="panel"><Val v={charts.hbars(rows.slice(0, 12).map((c) => ({ label: c.name, value: Number(c.revenue), sub: `${bn(c.qty)} পিস` })), { isMoney: true })} /></section><section className="panel table-wrap"><table className="table compact"><thead><tr><th>ক্যাটাগরি</th><th className="num">অর্ডার</th><th className="num">পিস</th><th className="num">টাকা</th>{(seeCost ? <><th className="num">লাভ</th><th className="num">মার্জিন</th></> : null)}</tr></thead><tbody>{jsxList(rows.map((c) => <tr><td><Val v={c.name} /></td><td className="num">{bn(c.orders)}</td><td className="num">{bn(c.qty)}</td><td className="num">{money(c.revenue)}</td>{(seeCost ? <><td className="num">{money(c.profit)}</td><td className="num">{(Number(c.revenue) > 0 ? pct((Number(c.profit) / Number(c.revenue)) * 100) : "—")}</td></> : null)}</tr>))}</tbody></table></section></>;
  }

  if (tab === 'customers') {
    const { top, mix, districts } = await customerRows(from, to);
    content = <><div className="kpis"><Val v={ui.kpi('মোট ক্রেতা', bn(mix!.buyers), 'এই সময়ে অর্ডার করেছেন')} />{' '}<Val v={ui.kpi('নতুন ক্রেতা', bn(mix!.new_buyers), 'প্রথমবার অর্ডার', 'kpi-blue')} />{' '}<Val v={ui.kpi('পুরোনো ক্রেতা', bn(mix!.buyers - mix!.new_buyers), mix!.buyers ? `${pct(((mix!.buyers - mix!.new_buyers) / mix!.buyers) * 100, 0)} আবার কিনেছেন` : '', 'kpi-green')} /></div><div className="grid-2"><section className="panel table-wrap"><h2>সবচেয়ে বেশি কেনাকাটা</h2><table className="table compact"><thead><tr><th>কাস্টমার</th><th className="num">অর্ডার</th><th className="num">বাতিল/ফেরত</th><th className="num">কেনাকাটা</th></tr></thead><tbody>{jsxList(top.map((c) => <tr><td>{(c.customer_id && (ctx.can('customers') || ctx.can('customers_view')) ? <a href={`/admin/customers/${attrValue(c.customer_id)}`} translate="no"><Val v={c.name} /></a> : <span translate="no"><Val v={c.name} /></span>)}<br /><span className="small muted"><Val v={c.phone} /></span></td><td className="num">{bn(c.orders)}</td><td className={`num ${c.failed ? 'warn' : ''}`}>{bn(c.failed)}</td><td className="num">{money(c.spent || 0)}</td></tr>))}</tbody></table></section><section className="panel table-wrap"><h2>জেলা অনুযায়ী</h2><table className="table compact"><thead><tr><th>জেলা</th><th className="num">অর্ডার</th><th className="num">বিক্রি</th></tr></thead><tbody>{jsxList(districts.map((d) => <tr><td><Val v={(O.findDistrict(d.district) || {}).bn || d.district} /></td><td className="num">{bn(d.orders)}</td><td className="num">{money(d.sales || 0)}</td></tr>))}</tbody></table></section></div></>;
  }

  if (tab === 'returns') {
    const { orders, products, districts } = await returnRows(from, to);
    const cancelled = orders.filter((o) => o.status === 'cancelled').length;
    content = <><div className="kpis"><Val v={ui.kpi('বাতিল', bn(cancelled), 'কুরিয়ারে যাওয়ার আগে', cancelled ? 'kpi-alert' : '')} />{' '}<Val v={ui.kpi('ফেরত', bn(orders.length - cancelled), 'কুরিয়ার থেকে ফেরত', orders.length - cancelled ? 'kpi-red' : '')} />{' '}<Val v={ui.kpi('হারানো বিক্রি', money(orders.reduce((s, o) => s + Number(o.total), 0)), '')} /></div><div className="grid-2"><section className="panel table-wrap"><h2>কোন পণ্য বেশি বাতিল/ফেরত হচ্ছে</h2><table className="table compact"><thead><tr><th>পণ্য</th><th className="num">অর্ডার</th><th className="num">পিস</th><th className="num">হার</th></tr></thead><tbody>{jsxList(products.map((p) => <tr><td>{(p.product_id ? <a href={`/admin/products/${attrValue(p.product_id)}`}><Val v={p.name} /></a> : <Val v={p.name} />)}</td><td className="num">{bn(p.orders)}</td><td className="num">{bn(p.qty)}</td><td className={`num ${p.sold && p.qty / p.sold >= 0.3 ? 'warn' : ''}`}>{(p.sold ? pct((p.qty / p.sold) * 100, 0) : "—")}</td></tr>))}</tbody></table><h2 className="mt">কোন জেলায় বেশি ফেরত</h2><table className="table compact"><thead><tr><th>জেলা</th><th className="num">অর্ডার</th><th className="num">বাতিল/ফেরত</th><th className="num">হার</th></tr></thead><tbody>{jsxList(districts.map((d) => <tr><td><Val v={(O.findDistrict(d.district) || {}).bn || d.district} /></td><td className="num">{bn(d.orders)}</td><td className="num">{bn(d.failed)}</td><td className={`num ${d.failed / d.orders >= 0.3 ? 'warn' : ''}`}>{pct((d.failed / d.orders) * 100, 0)}</td></tr>))}</tbody></table></section><section className="panel table-wrap"><h2>অর্ডারগুলো</h2><table className="table compact"><thead><tr><th>অর্ডার</th><th>কাস্টমার</th><th>অবস্থা</th><th className="num">টাকা</th></tr></thead><tbody>{jsxList(orders.map((o) => <tr><td><a href={`/admin/orders/${attrValue(o.id)}`}><Val v={o.code} /></a><br /><span className="small muted">{fmtDate(o.created_at, false)}</span></td><td><span translate="no"><Val v={o.customer_name} /></span><br /><span className="small muted"><Val v={o.phone} /></span></td><td><Val v={ui.pill(O.STATUSES[o.status], 'pill-' + o.status)} />{(o.courier_status ? <><br /><span className="small muted"><Val v={o.courier_status} /></span></> : null)}{(o.returned_to === 'damaged' ? <><br /><span className="small warn">নষ্ট মাল</span></> : null)}</td><td className="num">{money(o.total)}</td></tr>))}</tbody></table></section></div></>;
  }

  if (tab === 'profit' && seeCost) {
    const p = await profitRow(from, to);
    const gross = Number(p!.goods) - Number(p!.discount) - Number(p!.cost);
    const net = gross - Number(p!.expenses) - Number(p!.refunds);
    const goodsNet = Number(p!.goods) - Number(p!.discount);
    content = <><div className="kpis"><Val v={ui.kpi('পণ্যের বিক্রি', money(goodsNet), `ছাড় ${money(p!.discount)} বাদে`, 'kpi-blue')} />{' '}<Val v={ui.kpi('কেনা দাম', money(p!.cost), 'বিক্রি হওয়া পণ্যের')} />{' '}<Val v={ui.kpi('পণ্যে লাভ', money(gross), goodsNet > 0 ? `মার্জিন ${pct((gross / goodsNet) * 100)}` : '', 'kpi-green')} />{' '}<Val v={ui.kpi('নিট লাভ (আনুমানিক)', money(net), `খরচ ${money(p!.expenses)} আর রিফান্ড ${money(p!.refunds)} বাদে`, net >= 0 ? 'kpi-green' : 'kpi-red')} /></div><section className="panel"><table className="table compact pnl"><tbody><tr><td>পণ্যের দাম (ছাড়ের আগে)</td><td className="num">{money(p!.goods)}</td></tr><tr><td>− ছাড় (কুপন/হাতে)</td><td className="num">{money(p!.discount)}</td></tr><tr><td>− বিক্রি হওয়া পণ্যের কেনা দাম</td><td className="num">{money(p!.cost)}</td></tr><tr className="total"><td>= পণ্যে লাভ</td><td className="num">{money(gross)}</td></tr><tr><td>− দোকানের খরচ (হিসাবের "আয়-ব্যয়" থেকে)</td><td className="num">{money(p!.expenses)}</td></tr><tr><td>− রিফান্ড</td><td className="num">{money(p!.refunds)}</td></tr><tr className="total"><td>= নিট লাভ (আনুমানিক)</td><td className="num">{money(net)}</td></tr><tr><td className="muted">ডেলিভারি চার্জ নেওয়া হয়েছে (কুরিয়ারকে যায়, লাভে ধরা হয়নি)</td><td className="num muted">{money(p!.delivery)}</td></tr></tbody></table><p className="small muted">বাতিল আর ফেরত আসা অর্ডার বাদ দিয়ে হিসাব। কেনা দাম ঠিক না দেওয়া থাকলে লাভ বেশি দেখাবে — মাল কিনলে{' '}<a href="/admin/purchases/new">পারচেজ এন্ট্রি</a>{' '}দিন, আর পুরোনো পণ্যে পণ্যের "📒 কেনার ইতিহাস" পেজে কেনা দাম বসান। বিস্তারিত:{' '}<a href="/admin/accounts/pnl">লাভ-ক্ষতি</a>।</p></section></>;
  }

  const body = <><div className="title-row"><h1>রিপোর্ট</h1><div className="row-actions"><a className="btn" href={`/admin/reports/export.xlsx?from=${attrValue(from)}&to=${attrValue(to)}`}>⬇ সব রিপোর্ট Excel-এ</a>{' '}<a className="btn btn-ghost" href={`/admin/orders/export.csv?from=${attrValue(from)}&to=${attrValue(to)}`}>⬇ অর্ডার CSV</a>{' '}<a className="btn btn-ghost" href="/admin/reports/staff">স্টাফ রিপোর্ট</a></div></div><Val v={ui.dateFilter('/admin/reports', from, to, `<input type="hidden" name="tab" value="${tab}">${unit !== 'day' ? `<input type="hidden" name="by" value="${unit}">` : ''}`)} /><nav className="rs-tabs report-tabs">{jsxList(tabs.map(([k, l]) => <a className={`tab ${tab === k ? 'on' : ''}`} href={`/admin/reports${attrValue(qs({ tab: k }))}`}><Val v={l} /></a>))}</nav><Val v={content} /></>;
  return ctx.page('রিপোর্ট', body, 'reports');
}

// Everything in one Excel file: one sheet per report.
async function exportAll(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  const [days, months, products, slow, cats, cust, ret] = await Promise.all([
    salesBy(from, to, 'day'), salesBy(from, to, 'month'), productRows(from, to), slowRows(from, to), categoryRows(from, to), customerRows(from, to), returnRows(from, to)]);
  const d10 = (d?: Loose) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  const sheets = [
    { name: 'Daily sales', rows: [['Date', 'Orders', 'Delivered', 'Cancelled/Returned', 'Discount', 'Sales', ...(seeCost ? ['Profit'] : [])],
      ...days.map((d) => [d10(d.period), d.orders, d.delivered, d.failed, d.discount, d.sales, ...(seeCost ? [d.profit] : [])])] },
    { name: 'Monthly sales', rows: [['Month', 'Orders', 'Delivered', 'Cancelled/Returned', 'Sales', ...(seeCost ? ['Profit'] : [])],
      ...months.map((d) => [d10(d.period).slice(0, 7), d.orders, d.delivered, d.failed, d.sales, ...(seeCost ? [d.profit] : [])])] },
    { name: 'Products', rows: [['Product', 'SKU', 'Qty', 'Orders', 'Revenue', ...(seeCost ? ['Cost', 'Profit', 'Margin %'] : []), 'Views'],
      ...products.map((p) => [p.name, p.sku, p.qty, p.orders, p.revenue, ...(seeCost ? [p.cost, Number(p.revenue) - Number(p.cost), margin(p.revenue, p.cost) === null ? '' : Math.round(margin(p.revenue, p.cost)! * 10) / 10] : []), p.views])] },
    { name: 'Not selling', rows: [['Product', 'SKU', 'Price', 'Stock', 'Views', 'Last sold'], ...slow.map((p) => [p.name, p.sku, p.price, p.stock, p.views, p.last_sold ? d10(p.last_sold) : 'never'])] },
    { name: 'Categories', rows: [['Category', 'Orders', 'Qty', 'Revenue', ...(seeCost ? ['Profit'] : [])], ...cats.map((c) => [c.name, c.orders, c.qty, c.revenue, ...(seeCost ? [c.profit] : [])])] },
    { name: 'Top customers', rows: [['Name', 'Phone', 'Orders', 'Cancelled/Returned', 'Spent'], ...cust.top.map((c) => [c.name, c.phone, c.orders, c.failed, c.spent || 0])] },
    { name: 'Cancel & return', rows: [['Order', 'Date', 'Customer', 'Phone', 'District', 'Status', 'Total', 'Courier status'],
      ...ret.orders.map((o) => [o.code, d10(o.created_at), o.customer_name, o.phone, o.district, o.status, o.total, o.courier_status])] },
  ];
  if (seeCost) {
    const p = await profitRow(from, to);
    const gross = Number(p!.goods) - Number(p!.discount) - Number(p!.cost);
    sheets.push({ name: 'Profit', rows: [['Item', 'Amount'], ['Goods (before discount)', p!.goods], ['Discount', p!.discount], ['Cost of goods sold', p!.cost], ['Gross profit', gross],
      ['Expenses', p!.expenses], ['Refunds', p!.refunds], ['Net profit (approx.)', gross - Number(p!.expenses) - Number(p!.refunds)], ['Delivery charges collected', p!.delivery]] });
  }
  await ctx.log('export', 'order', null, `রিপোর্ট Excel ${from} → ${to}`);
  return xlsx.send(ctx.reply, `report-${from}-to-${to}.xlsx`, sheets);
}

async function staff(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const rows = await F.staffReport(from, to);
  if (ctx.query.get('csv') === '1') {
    const out = [['Staff', 'Logins', 'Confirmed', 'Cancelled', 'Edits', 'Created', 'Sent to courier', 'All actions']];
    rows.forEach((s) => out.push([s.name, s.logins, s.confirmed, s.cancelled, s.edits, s.created, s.sent, s.actions]));
    return ctx.send(200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="staff-${from}-${to}.csv"` });
  }
  const body = <><p className="crumbs"><a href="/admin/reports">← রিপোর্ট</a></p><div className="title-row"><h1>স্টাফ রিপোর্ট</h1><a className="btn btn-ghost" href={`/admin/reports/staff?from=${attrValue(from)}&to=${attrValue(to)}&csv=1`}>⬇ CSV</a></div><Val v={ui.dateFilter('/admin/reports/staff', from, to)} /><section className="panel table-wrap"><table className="table"><thead><tr><th>স্টাফ</th><th className="num">লগইন</th><th className="num">অর্ডার কনফার্ম</th><th className="num">বাতিল</th><th className="num">অর্ডার এডিট</th><th className="num">নতুন অর্ডার তৈরি</th><th className="num">কুরিয়ারে পাঠানো</th><th className="num">মোট কাজ</th><th>শেষ লগইন</th></tr></thead><tbody>{jsxList(rows.map((s) => <tr className={s.active ? '' : 'row-off'}><td>{(ctx.user.role === 'owner' ? <a href={`/admin/staff/${attrValue(s.id)}`}><Val v={s.name} /></a> : <Val v={s.name} />)}{(s.role === 'owner' ? <>{' '}<span className="pill">মালিক</span></> : null)}</td><td className="num">{bn(s.logins)}</td><td className="num">{bn(s.confirmed)}</td><td className="num">{bn(s.cancelled)}</td><td className="num">{bn(s.edits)}</td><td className="num">{bn(s.created)}</td><td className="num">{bn(s.sent)}</td><td className="num"><b>{bn(s.actions)}</b></td><td className="small">{(s.last_login ? fmtDate(s.last_login) : "—")}</td></tr>))}</tbody></table></section><section className="panel"><h2>কাজের তুলনা</h2><Val v={charts.hbars(rows.filter((r) => r.actions).map((r) => ({ label: r.name, value: r.actions, sub: `কনফার্ম ${bn(r.confirmed)}` })), { color: -1 })} /></section></>;
  return ctx.page('স্টাফ রিপোর্ট', body, 'reports');
}

// old link: /admin/reports?csv=products
async function legacyCsv(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const seeCost = ctx.can('see_cost');
  const products = await productRows(from, to);
  const out = [['Product', 'SKU', 'Qty', 'Revenue', ...(seeCost ? ['Cost', 'Profit'] : [])]];
  products.forEach((p) => out.push([p.name, p.sku, p.qty, p.revenue, ...(seeCost ? [p.cost, Number(p.revenue) - Number(p.cost)] : [])]));
  return ctx.send(200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="product-sales-${from}-${to}.csv"` });
}

export const routes = [
    { method: 'GET', path: '/admin/reports', perm: 'reports', handler: (ctx: AdminCtx) => (ctx.query.get('csv') === 'products' ? legacyCsv(ctx) : page(ctx)) },
    { method: 'GET', path: '/admin/reports/export.xlsx', perm: 'reports', handler: exportAll },
    { method: 'GET', path: '/admin/reports/staff', perm: 'reports', handler: staff },
  ];

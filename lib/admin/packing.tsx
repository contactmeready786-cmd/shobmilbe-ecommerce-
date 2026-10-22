// Admin → হিসাব → লাভ-ক্ষতি → 📦 প্যাকিং খরচ (owner only — buying prices are the owner's).
// The things parcels are packed with, ready-made sets of them, which set each category gets (a product can have its
// own on its edit page), one set for every order, and what the last parcels really used. lib/models/packing.ts.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, money, int, str, list, fmtDate, ymd } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as P from '../models/packing';
import type { AdminCtx, Caught, RouteMatch } from '../types';

const BASE = '/admin/accounts/packing';
const per = (p: string) => (p === 'line' ? 'প্রতি পণ্যে একবার (যত পিসই হোক)' : 'প্রতি পিসে');

async function page(ctx: AdminCtx) {
  const [items, sets, cats, month, recent] = await Promise.all([
    P.listItems(), P.listSets(), db.q<{ id: number; name: string; parent_id: number | null; packing_set_id: number | null }>('SELECT id, name, parent_id, packing_set_id FROM categories ORDER BY sort, id'),
    db.one<{ cost: number; orders: number }>(`SELECT coalesce(sum(cost),0)::numeric(14,2) AS cost, count(DISTINCT order_id)::int AS orders FROM order_packing
      WHERE state='used' AND date_trunc('month', created_at AT TIME ZONE 'Asia/Dhaka') = date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka')`),
    db.q<{ order_id: number; code: string; status: string; cost: number; reused: number; at: Date; what: string }>(`SELECT op.order_id, o.code, o.status,
        coalesce(sum(op.cost) FILTER (WHERE op.state='used'),0)::numeric(12,2) AS cost, count(*) FILTER (WHERE op.state='reused')::int AS reused,
        max(op.created_at) AS at, string_agg(op.name || ' × ' || trim(trailing '.' from trim(trailing '0' from op.qty::text)), ', ' ORDER BY op.id) AS what
      FROM order_packing op JOIN orders o ON o.id=op.order_id GROUP BY op.order_id, o.code, o.status ORDER BY max(op.created_at) DESC LIMIT 25`),
  ]);
  const map = new Map(items.map((i) => [i.id, i]));
  const s = ctx.settings;
  const itemOpts: [string | number, string][] = [['', '— জিনিস বাছুন —'], ...items.filter((i) => i.active).map((i): [number, string] => [i.id, `${i.name} (${money(i.unit_cost)})`])];
  const setOpts: [string | number, string][] = [['', '— নেই —'], ...sets.filter((x) => x.active).map((x): [number, string] => [x.id, `${x.name} — ${money(P.setCost(x, map))}`])];
  const setForm = (x: Partial<P.PackingSet>) => <form method="post" action={BASE} className="form"><input type="hidden" name="action" defaultValue="set" />{(x.id ? <input type="hidden" name="id" defaultValue={attrValue(x.id)} /> : null)}<div className="field-row">{ui.field('সেটের নাম', ui.input('name', x.name || '', { required: true, maxlength: 80, placeholder: 'যেমন ৩ নং বক্স সেট' }))}{ui.field('কতবার লাগবে', ui.select('per', [['piece', 'প্রতি পিসে (একটা ট্রিমার = একটা বক্স)'], ['line', 'প্রতি পণ্যে একবার (১০০টা রেজিস্টর = একটা পলি)']], x.per || 'piece'))}</div><table className="table compact"><thead><tr><th>জিনিস</th><th className="num">কতটা</th></tr></thead><tbody>{jsxList(Array.from({ length: Math.max(5, (x.items || []).length + 2) }, (_, i) => { const l = (x.items || [])[i]; return <tr><td>{ui.select('item_id[]', itemOpts, l ? l.item_id : '')}</td><td className="num">{ui.input('item_qty[]', l ? l.qty : '', { type: 'number', min: 0, step: '0.001', class: 'w-num', placeholder: '১' })}</td></tr>; }))}</tbody></table>{(x.id ? ui.check('active', x.active, 'চালু') : null)}{' '}<button className="btn btn-sm">{x.id ? '💾 সেভ' : '+ সেট বানান'}</button></form>;
  const itemForm = (i: Partial<P.PackingItem>) => <form method="post" action={BASE} className="form"><input type="hidden" name="action" defaultValue="item" />{(i.id ? <input type="hidden" name="id" defaultValue={attrValue(i.id)} /> : null)}{ui.field('নাম', ui.input('name', i.name || '', { required: true, maxlength: 80, placeholder: 'যেমন ৩ নং বক্স, টেপ, ইনভয়েস স্টিকার' }))}<div className="field-row">{ui.field('কেনা দাম (৳)', ui.input('buy_price', i.buy_price ?? '', { type: 'number', min: 0.01, step: '0.01', required: true }), 'একটা জিনিসের, বা একটা রোল / প্যাকেটের')}{ui.field('কয়টা পার্সেলে লাগে', ui.input('uses', i.uses ?? 1, { type: 'number', min: 1, max: 10000 }), 'বক্স: ১ · টেপের রোল: যেমন ২৫ (একটা রোলে কয়টা বক্স হয়)')}</div>{ui.field('দোকানের পণ্য হলে তার SKU (ঐচ্ছিক)', ui.input('product_sku', i.product_id ? `#${i.product_id}` : '', { maxlength: 60, placeholder: 'যেমন 857' }), 'দিলে প্যাকিংয়ে ব্যবহার হলে ওই পণ্যের স্টক থেকে কমবে (শুধু যেটা পুরো একটা লাগে, যেমন বক্স)')}{' '}{ui.field('নোট', ui.input('note', i.note || '', { maxlength: 200 }))}{(i.id ? ui.check('active', i.active, 'চালু') : null)}{' '}<button className="btn btn-sm">{i.id ? '💾 সেভ' : '+ যোগ করুন'}</button></form>;
  const body = <><div className="title-row"><h1>📦 প্যাকিং খরচ</h1></div>{ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">{ui.kpi('এই মাসে প্যাকিং খরচ', money(month!.cost), `${bn(month!.orders)}টি পার্সেল`, 'kpi-blue')}{' '}{ui.kpi('গড়ে প্রতি পার্সেল', month!.orders ? money(Number(month!.cost) / month!.orders) : '—', '')}{' '}{ui.kpi('জিনিস / সেট', `${bn(items.length)} / ${bn(sets.length)}`, '')}</div>
    {ui.helpBox('কীভাবে কাজ করে', <ol className="steps"><li><b>জিনিস:</b> বক্স, টেপ, স্টিকার, সেলো পলি — কেনা দাম আর কয়টা পার্সেলে লাগে। যেমন টেপের রোল ৳৫৫, একটা রোলে ২৫টা বক্স → একবারে ৳২.২০।</li><li><b>সেট:</b> কোনটার সাথে কোনটা যায় — "৩ নং বক্স সেট" = ৩ নং বক্স ১ + টেপ ১ + স্টিকার ১।</li><li><b>কোন পণ্যে কোন সেট:</b> নিচে ক্যাটাগরি ধরে একবারে, অথবা পণ্যের এডিট পেজে "📦 প্যাকিং" অংশে আলাদা করে (পণ্যেরটা আগে ধরা হয়)।</li><li>অর্ডার <b>কুরিয়ারে দিলে</b> (বা সরাসরি ডেলিভারি করলে) যা লাগল তা সেদিনের দামে লেখা হয় আর <a href="/admin/accounts/pnl">লাভ-ক্ষতিতে</a> খরচ হিসেবে কাটে। ফেরত আসা পার্সেলের বক্স ভালো থাকলে অর্ডারের পেজে "♻️ প্যাকিং আবার ব্যবহারযোগ্য" চাপুন — খরচ বাদ যাবে, বক্স স্টকে ফিরবে।</li></ol>)}
    <section className="panel"><h2>🧾 প্রতিটা অর্ডারে একবার যা লাগে</h2><form method="post" action={BASE} className="form inline-form"><input type="hidden" name="action" defaultValue="order_set" />{ui.field('সেট', ui.select('packing_order_set', setOpts, s.packing_order_set || ''), 'যেমন ইনভয়েস স্টিকার বা সেলো পলি — অর্ডারে যত পণ্যই থাকুক, একবার')}{' '}<button className="btn btn-sm">সেভ</button></form></section>
    <div className="two-col"><section className="panel table-wrap"><h2>🧰 জিনিসের তালিকা</h2>{(items.length ? <table className="table"><thead><tr><th>জিনিস</th><th className="num">কেনা দাম</th><th className="num">পার্সেল</th><th className="num">একবারে খরচ</th><th>দোকানের পণ্য</th><th></th></tr></thead><tbody>{jsxList(items.map((i) => <tr className={i.active ? '' : 'row-off'}><td><b><Val v={i.name} /></b>{(i.note ? <><br /><span className="small muted"><Val v={i.note} /></span></> : null)}</td><td className="num">{money(i.buy_price)}</td><td className="num">{bn(i.uses)}</td><td className="num"><b>{money(i.unit_cost)}</b></td><td className="small">{(i.product_id ? <a href={`/admin/products/${attrValue(i.product_id)}`}><Val v={i.product_name || '#' + i.product_id} /></a> : '—')}{(i.product_id ? <><br /><span className="muted">স্টক {bn(i.product_stock ?? 0)}</span></> : null)}</td><td><details><summary className="link-btn small">✏️ এডিট</summary>{itemForm(i)}</details></td></tr>))}</tbody></table> : <p className="muted">এখনো কিছু নেই — পাশে প্রথম জিনিসটা যোগ করুন।</p>)}</section><section className="panel"><h2>+ নতুন জিনিস</h2>{itemForm({})}</section></div>
    <div className="two-col"><section className="panel table-wrap"><h2>🎁 প্যাকিং সেট</h2>{(sets.length ? <table className="table"><thead><tr><th>সেট</th><th>যা আছে</th><th className="num">খরচ</th><th></th></tr></thead><tbody>{jsxList(sets.map((x) => <tr className={x.active ? '' : 'row-off'}><td><b><Val v={x.name} /></b><br /><span className="small muted">{per(x.per)}</span></td><td className="small">{jsxList(x.items.map((l) => <div><Val v={map.get(l.item_id)?.name || '?'} />{' '}× {bn(l.qty)}</div>))}</td><td className="num"><b>{money(P.setCost(x, map))}</b></td><td><details><summary className="link-btn small">✏️ এডিট</summary>{setForm(x)}</details></td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সেট নেই।</p>)}</section><section className="panel"><h2>+ নতুন সেট</h2>{(items.length ? setForm({}) : <p className="muted small">আগে জিনিস যোগ করুন।</p>)}</section></div>
    <section className="panel table-wrap"><h2>🗂️ ক্যাটাগরি অনুযায়ী সেট</h2><p className="small muted">ক্যাটাগরির সব পণ্যে এই সেট ধরা হবে (সাব-ক্যাটাগরিতে আলাদা না দিলে উপরেরটা)। কোনো পণ্যে আলাদা সেট লাগলে পণ্যের এডিট পেজ থেকে দিন।</p><form method="post" action={BASE}><input type="hidden" name="action" defaultValue="cats" /><table className="table compact"><thead><tr><th>ক্যাটাগরি</th><th>সেট</th></tr></thead><tbody>{jsxList(cats.map((c) => <tr><td>{c.parent_id ? '↳ ' : ''}<Val v={c.name} /><input type="hidden" name="cat_id[]" defaultValue={attrValue(c.id)} /></td><td>{ui.select('cat_set[]', setOpts, c.packing_set_id || '')}</td></tr>))}</tbody></table><button className="btn btn-sm">💾 সেভ</button></form></section>
    <section className="panel table-wrap"><h2>🕘 সাম্প্রতিক পার্সেলে যা লেগেছে</h2>{(recent.length ? <table className="table compact"><thead><tr><th>অর্ডার</th><th>যা লেগেছে</th><th className="num">খরচ</th><th>কবে</th></tr></thead><tbody>{jsxList(recent.map((r) => <tr><td><a href={`/admin/orders/${attrValue(r.order_id)}`}><b><Val v={r.code} /></b></a></td><td className="small"><Val v={r.what} />{(r.reused ? <>{' '}<span className="pill small">♻️ আবার ব্যবহার</span></> : null)}</td><td className="num">{money(r.cost)}</td><td className="small">{fmtDate(r.at)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো অর্ডার কুরিয়ারে যায়নি (বা সেট দেওয়া হয়নি)।</p>)}</section></>;
  return ctx.page('প্যাকিং খরচ', body, 'packing');
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  try {
    if (b.action === 'item') {
      let pid: number | null = null;
      const sku = str(b.product_sku, 60).trim();
      if (sku) {
        const m = /^#(\d+)$/.exec(sku);
        const row = m ? await db.one<{ id: number }>('SELECT id FROM products WHERE id=$1', [int(m[1])]) : await db.one<{ id: number }>('SELECT id FROM products WHERE lower(sku)=lower($1) LIMIT 1', [sku]);
        if (!row) throw new Error(`SKU "${sku}" এর কোনো পণ্য পাওয়া যায়নি।`);
        pid = row.id;
      }
      const id = await P.saveItem({ ...b, product_id: pid, active: b.id ? !!b.active : true });
      await ctx.log('packing_item', 'settings', id, str(b.name, 60));
    } else if (b.action === 'set') {
      const ids = list(b.item_id), qtys = list(b.item_qty);
      const id = await P.saveSet({ ...b, items: ids.map((x, i) => ({ item_id: x, qty: qtys[i] === '' || qtys[i] === undefined ? 1 : qtys[i] })), active: b.id ? !!b.active : true });
      await ctx.log('packing_set', 'settings', id, str(b.name, 60));
    } else if (b.action === 'order_set') {
      await db.setSetting('packing_order_set', String(int(b.packing_order_set) || ''));
      await ctx.log('settings', 'settings', null, 'প্রতি অর্ডারের প্যাকিং সেট');
    } else if (b.action === 'cats') {
      const ids = list(b.cat_id), sets = list(b.cat_set);
      for (let i = 0; i < ids.length; i++) await db.q('UPDATE categories SET packing_set_id=$1 WHERE id=$2', [int(sets[i]) || null, int(ids[i])]);
      await ctx.log('settings', 'settings', null, 'ক্যাটাগরির প্যাকিং সেট');
    }
  } catch (caught) { const e = caught as Caught; return ctx.fail(BASE, e.message); }
  return ctx.back(BASE, 'saved');
}

// ♻️ a returned parcel's packing is still good (from the order page)
async function reused(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const n = await db.tx((t) => P.markReused(t, id, ctx.user.id));
  await ctx.log('packing_reused', 'order', id, `${n}টি প্যাকিং জিনিস আবার ব্যবহারযোগ্য`);
  return ctx.back(`/admin/orders/${id}`, 'saved');
}
void ymd;

export const routes = [
  { method: 'GET', path: BASE, perm: 'see_cost', handler: page },
  { method: 'POST', path: BASE, perm: 'see_cost', handler: post },
  { method: 'POST', path: /^\/admin\/orders\/(\d+)\/packing-reused$/, perm: 'see_cost', handler: reused },
];

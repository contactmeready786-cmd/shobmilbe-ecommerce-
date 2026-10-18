// Admin → স্টক ও কেনাকাটা → 🏬 গুদাম ও শাখা: more than one place where goods are kept (a second store, a branch shop).
// Each has its own count; the main store (where online orders are packed) is the rest of the total stock.
import { Val, attrValue, jsxList } from '../react/html';
import { int, str, bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as W from '../models/warehouses';
import type { AdminCtx, Body, Loose, RouteMatch } from '../types';

const BASE = '/admin/warehouses';
const REASON: Record<string, string> = { transfer: '🔁 স্থানান্তর', sale: '🧾 দোকানে বিক্রি', sale_cancel: '↩️ বিক্রি বাতিল', count: '🔢 গণনা ঠিক' };

// "SKU / barcode / name" typed or scanned → one product (variants are separate products)
async function findProduct(code?: Loose) {
  const c = str(code, 100);
  if (!c) return null;
  const exact = await db.one(`SELECT id, name, stock, variant_count FROM products WHERE (upper(barcode)=upper($1) OR lower(sku)=lower($1)) AND variant_count = 0 LIMIT 1`, [c]);
  if (exact) return exact;
  const rows = await db.q(`SELECT id, name, stock FROM products WHERE name ILIKE $1 AND variant_count = 0 AND product_type='single' ORDER BY length(name) LIMIT 2`, [`%${c}%`]);
  return rows.length === 1 ? rows[0] : null;
}

function transferForm(stores?: Loose, { from = '', to = '', back = BASE }: Body = {}) {
  const opts = [['0', '🏠 মূল গুদাম (অনলাইন)'], ...stores.filter((w) => w.active).map((w) => [w.id, `${w.is_shop ? '🏪' : '🏬'} ${w.name}`])];
  return <form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="transfer" /><input type="hidden" name="back" defaultValue={attrValue(back)} />{' '}{ui.field('পণ্য (SKU, বারকোড স্ক্যান বা নাম)', ui.input('code', '', { required: true, maxlength: 100, autocomplete: 'off', placeholder: 'যেমন 125 বা SB000125' }))}<div className="field-row">{ui.field('কোথা থেকে', ui.select('from', opts, from || '0'))}{ui.field('কোথায়', ui.select('to', opts, to || (stores[0] ? stores[0].id : '0')))}{' '}{ui.field('কয়টি', ui.input('qty', '1', { type: 'number', min: 1, required: true, class: 'w-num' }))}</div>{ui.field('নোট (ঐচ্ছিক)', ui.input('note', '', { maxlength: 200 }))}{' '}<button className="btn btn-sm">🔁 স্থানান্তর করুন</button></form>;
}

async function listPage(ctx: AdminCtx) {
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
        return ctx.redirect(back + '?info=' + encodeURIComponent(`✅ "${p.name}" ${bn(int(b.qty))}টি সরানো হয়েছে।`));
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
  const body = <><div className="title-row"><h1>🏬 গুদাম ও শাখা</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(BASE)}>🔄 রিফ্রেশ</a><a className="btn btn-sm" href="/admin/pos">🧾 দোকানে বিক্রি (POS)</a></div></div>{ui.flash(ctx.flash)}{' '}{ui.helpBox('কীভাবে কাজ করে', <ol className="steps"><li><b>মূল গুদাম</b>{' '}= যেখান থেকে অনলাইন অর্ডার প্যাক হয়। পারচেজ (মাল কেনা) আর অনলাইন বিক্রি মূল গুদামের হিসাবে চলে।</li><li>আরেকটা দোকান/শাখা বা আলাদা গুদাম থাকলে নিচে যোগ করুন। তারপর "স্থানান্তর" দিয়ে মূল গুদাম থেকে পণ্য পাঠান — প্রতিটা শাখার আলাদা স্টক থাকবে।</li><li>শাখার দোকানে সরাসরি বিক্রি করতে{' '}<a href="/admin/pos">POS</a>{' '}খুলে শাখা বাছুন — বিক্রি সেই শাখার স্টক থেকে কাটবে।</li><li>মোট স্টক (সব জায়গা মিলিয়ে) আগের মতোই ইনভেন্টরি পেজে দেখা যায়।</li></ol>)}<div className="kpis kpis-tight">{ui.kpi('মোট স্টক (সব জায়গা)', bn(totals!.units), 'পিস')}{' '}{ui.kpi('🏠 মূল গুদামে', bn(totals!.units - inBranches), 'অনলাইন অর্ডার এখান থেকে', 'kpi-blue')}{' '}{ui.kpi('শাখাগুলোতে', bn(inBranches), `${bn(stores.length)}টি গুদাম/শাখা`)}{' '}{(problems.length ? ui.kpi('মিলছে না', bn(problems.length), 'নিচে দেখুন', 'kpi-alert') : null)}</div>{(problems.length ? <section className="panel"><h2>⚠️ এই পণ্যগুলোর হিসাব মিলছে না</h2><p className="small muted">শাখায় যত গোনা আছে, মোট স্টক তার চেয়ে কম (সম্ভবত অনলাইনে বিক্রি হয়েছে শাখার মাল দিয়ে)। শাখার গণনা ঠিক করুন বা ইনভেন্টরিতে মোট স্টক ঠিক করুন।</p><ul>{jsxList(problems.map((p) => <li><Val v={p.name} />{' '}(SKU{' '}<Val v={p.sku} />) — মোট{' '}{bn(p.stock)}, শাখাগুলোতে{' '}{bn(p.branches)}</li>))}</ul></section> : null)}<div className="two-col"><section className="panel table-wrap"><h2>সব জায়গা</h2><table className="table compact"><thead><tr><th>নাম</th><th>ধরন</th><th className="num">পণ্য</th><th className="num">পিস</th><th></th></tr></thead><tbody><tr><td><b>🏠 মূল গুদাম</b><br /><span className="small muted">অনলাইন অর্ডার</span></td><td className="small">মূল</td><td></td><td className="num">{bn(totals!.units - inBranches)}</td><td><a className="btn btn-sm btn-ghost" href="/admin/inventory">ইনভেন্টরি</a></td></tr>{jsxList(stores.map((w) => <tr className={w.active ? '' : 'row-off'}><td><a href={`${attrValue(BASE)}/${attrValue(w.id)}`}><b><Val v={w.name} /></b></a>{(w.address ? <><br /><span className="small muted"><Val v={w.address} /></span></> : null)}</td><td className="small">{(w.is_shop ? "🏪 দোকান (POS)" : "🏬 গুদাম")}{(w.active ? null : " · বন্ধ")}</td><td className="num">{bn(w.products)}</td><td className="num">{bn(w.units)}</td><td><a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}/${attrValue(w.id)}`}>খুলুন</a></td></tr>))}</tbody></table></section><div><section className="panel"><h2>🔁 স্থানান্তর</h2>{(stores.length ? transferForm(stores) : <p className="muted">আগে একটা শাখা/গুদাম যোগ করুন।</p>)}</section><section className="panel"><h2>+ নতুন শাখা / গুদাম</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="save" />{' '}{ui.field('নাম', ui.input('name', '', { required: true, maxlength: 80, placeholder: 'যেমন: মিরপুর শাখা' }))}<div className="field-row">{ui.field('ঠিকানা', ui.input('address', '', { maxlength: 300 }))}{ui.field('ফোন', ui.input('phone', '', { maxlength: 30 }))}</div>{ui.check('is_shop', true, 'এটা একটা দোকান (POS-এ বিক্রি হবে)')}{' '}<button className="btn btn-sm">যোগ করুন</button></form></section></div></div><section className="panel table-wrap"><h2>সাম্প্রতিক নড়াচড়া</h2>{movesTable(moves)}</section></>;
  return ctx.page('গুদাম ও শাখা', body, 'warehouses');
}

function movesTable(moves?: Loose) {
  if (!moves.length) return <p className="muted">এখনো কিছু নেই।</p>;
  return <table className="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th className="num">পরিমাণ</th><th>কোথা থেকে → কোথায়</th><th>কী</th><th>কে</th></tr></thead><tbody>{jsxList(moves.map((m) => <tr><td className="small nowrap">{fmtDate(m.created_at)}</td><td><Val v={m.name || '—'} />{' '}<span className="small muted"><Val v={m.sku || ''} /></span></td><td className="num">{bn(m.qty)}</td><td className="small">{(m.from_wh ? <Val v={m.from_name || '—'} /> : (m.reason === 'sale_cancel' ? "ক্রেতা" : "🏠 মূল"))}{' '}→{' '}{(m.to_wh ? <Val v={m.to_name || '—'} /> : (m.reason === 'sale' ? "ক্রেতা" : "🏠 মূল"))}</td><td className="small"><Val v={REASON[m.reason] || m.reason} />{(m.order_code ? <>{' '}<a href={`/admin/orders/${attrValue(m.ref_id)}`}><Val v={m.order_code} /></a></> : null)}{(m.note ? ` · ${m.note}` : null)}</td><td className="small"><Val v={m.staff_name || ''} /></td></tr>))}</tbody></table>;
}

async function storePage(ctx: AdminCtx, m: RouteMatch) {
  const w = await W.get(int(m[1]));
  if (!w) return ctx.redirect(BASE);
  const q = str(ctx.query.get('q'), 60);
  const back = `${BASE}/${w.id}`;
  const [rows, stores, moves] = await Promise.all([W.storeStock(w.id, { q }), W.list(), W.moves({ whId: w.id, limit: 40 })]);
  const body = <><p className="crumbs"><a href={attrValue(BASE)}>← সব গুদাম ও শাখা</a></p><div className="title-row"><h1>{(w.is_shop ? "🏪" : "🏬")}{' '}<Val v={w.name} /></h1><div className="row-actions">{(w.is_shop ? <a className="btn btn-sm" href={`/admin/pos?wh=${attrValue(w.id)}`}>🧾 এই শাখায় বিক্রি</a> : null)}</div></div>{ui.flash(ctx.flash)}<div className="two-col"><section className="panel table-wrap"><h2>এই জায়গার পণ্য{' '}<small>{bn(rows.length)}টি</small></h2><form method="get" action={attrValue(back)} className="filters"><input type="search" name="q" defaultValue={attrValue(q)} placeholder="নাম, SKU বা বারকোড" /><button className="btn btn-sm">খুঁজুন</button></form>{(rows.length ? <table className="table compact"><thead><tr><th></th><th>পণ্য</th><th className="num">এখানে</th><th className="num">মূল গুদামে</th><th>গণনা ঠিক করুন</th></tr></thead><tbody>{jsxList(rows.map((p) => <tr><td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" /> : <span><Val v={p.emoji || '📦'} /></span>)}</td><td><Val v={p.name} /><br /><span className="small muted">SKU{' '}<Val v={p.sku} />{' '}·{' '}<Val v={p.barcode} /></span></td><td className="num"><b>{bn(p.qty)}</b></td><td className={`num ${p.main < 0 ? 'warn' : ''}`}>{bn(p.main)}</td><td><form method="post" action={attrValue(BASE)} className="inline-form"><input type="hidden" name="action" defaultValue="count" /><input type="hidden" name="back" defaultValue={attrValue(back)} /><input type="hidden" name="wh" defaultValue={attrValue(w.id)} /><input type="hidden" name="product" defaultValue={attrValue(p.id)} />{' '}<input type="number" name="qty" defaultValue={attrValue(p.qty)} min="0" className="w-num" aria-label="গোনা পরিমাণ" /><button className="btn btn-sm btn-ghost">সেভ</button></form></td></tr>))}</tbody></table> : <p className="muted">এখানে কোনো পণ্য নেই। পাশের "স্থানান্তর" দিয়ে মূল গুদাম থেকে পণ্য আনুন।</p>)}</section><div><section className="panel"><h2>🔁 স্থানান্তর</h2>{transferForm(stores, { from: '0', to: String(w.id), back })}</section><section className="panel"><h2>✏️ তথ্য</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="save" /><input type="hidden" name="id" defaultValue={attrValue(w.id)} /><input type="hidden" name="back" defaultValue={attrValue(back)} />{' '}{ui.field('নাম', ui.input('name', w.name, { required: true, maxlength: 80 }))}<div className="field-row">{ui.field('ঠিকানা', ui.input('address', w.address, { maxlength: 300 }))}{ui.field('ফোন', ui.input('phone', w.phone, { maxlength: 30 }))}</div>{ui.field('ক্রম', ui.input('sort', w.sort, { type: 'number', class: 'w-num' }))}{' '}{ui.check('is_shop', w.is_shop, 'এটা একটা দোকান (POS-এ বিক্রি হবে)')}{' '}{ui.check('active', w.active, 'চালু')}{' '}<button className="btn btn-sm">সেভ করুন</button></form>{(ctx.can('inventory') ? <form method="post" action={attrValue(BASE)} className="mt" data-confirm="এই শাখা মুছবেন? এর সব পণ্য মূল গুদামে গণ্য হবে। রিসাইকেল বিনে থাকবে।"><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(w.id)} /><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form> : null)}</section></div></div><section className="panel table-wrap"><h2>এই জায়গার নড়াচড়া</h2>{movesTable(moves)}</section></>;
  return ctx.page(w.name, body, 'warehouses');
}

export const routes = [
    { method: '*', path: BASE, perm: 'inventory', handler: listPage },
    { method: 'GET', path: /^\/admin\/warehouses\/(\d+)$/, perm: 'inventory', handler: storePage },
  ];
export { findProduct };

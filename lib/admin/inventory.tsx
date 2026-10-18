
// ---------------------------------------------------------------- inventory
import { Val, attrValue, jsxList } from '../react/html';
import { raw, money, bn, fmtDate, int, str, list, ymd, pct, pageNum, oneOf } from '../util';
import * as catalog from '../models/catalog';
import * as finance from '../models/finance';
import * as ui from './ui';
import * as $db from '../db';
import * as $services_stockalert from '../services/stockalert';
import type { AdminCtx, Loose, RouteMatch, Caught } from '../types';
import type { ProductsRow } from '../data/rows';
const INV_PER_PAGE = 50;
const ADJUST_REASONS = [['adjust', 'হাতে বদল'], ['count', 'গণনা ঠিক করা'], ['damage', 'নষ্ট/ভাঙা → নষ্ট স্টকে'], ['lost', 'হারানো'], ['return', 'কাস্টমার ফেরত (ভালো মাল)'],
  ['damage_out', 'নষ্ট মাল ফেলে দেওয়া'], ['repair', 'মেরামত হয়ে আবার বিক্রিযোগ্য']];
async function inventoryPage(ctx: AdminCtx) {
  const low = ctx.query.get('low') === '1';
  const damaged = ctx.query.get('damaged') === '1';
  const supplierId = int(ctx.query.get('supplier')) || null;
  const q = str(ctx.query.get('q'), 60);
  const sort = oneOf(['sku', 'sku_desc', 'stock_asc', 'name'], ctx.query.get('sort'), 'sku');
  const page = pageNum(ctx.query);
  const seeCost = ctx.can('see_cost');
  const canProducts = ctx.can('products');
  const canDelete = ctx.can('products_delete');
  const canAdjust = ctx.can('inventory');
  const f = { includeInactive: true, type: 'single', lowStock: low, damaged, supplierId, q, items: true };
  const [sum, rows, total, moves, suppliers] = await Promise.all([
    catalog.inventorySummary(),
    catalog.listProducts({ ...f, sort, limit: INV_PER_PAGE, offset: (page - 1) * INV_PER_PAGE }),
    catalog.countProducts(f),
    catalog.stockMovements({ limit: 25 }),
    finance.listSuppliers(),
  ]);
  const reserved = await catalog.reservedFor(rows.map((p) => p.id));
  const supName = new Map(suppliers.map((x) => [x.id, x.name]));
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (low) qs.set('low', '1');
  if (damaged) qs.set('damaged', '1');
  if (supplierId) qs.set('supplier', String(supplierId));
  if (sort !== 'sku') qs.set('sort', sort);
  const listUrl = '/admin/inventory' + (qs.toString() ? '?' + qs : '');
  const backUrl = (() => { const x = new URLSearchParams(qs); if (page > 1) x.set('page', String(page)); const t = x.toString(); return '/admin/inventory' + (t ? '?' + t : ''); })();
  const body = <><div className="title-row"><h1>ইনভেন্টরি (স্টক){' '}<small>{bn(total)}টি</small></h1>{(canAdjust ? <div className="row-actions"><a className="btn btn-ghost" href="/admin/stock-scan">📷 স্ক্যান করে স্টক</a><a className="btn" href="/admin/purchases/new">+ মাল কিনেছি (পারচেজ)</a></div> : null)}</div>{ui.flash(ctx.flash)}<div className="kpis">{ui.kpi('মোট পণ্য', bn(sum!.products), `${bn(sum!.units)} পিস বিক্রির স্টকে`)}{' '}{(seeCost ? ui.kpi('স্টকের কেনা দাম', money(sum!.cost_value), 'এখন দোকানে যত টাকার মাল', 'kpi-blue') : null)}{' '}{ui.kpi('স্টকের বিক্রি দাম', money(sum!.sale_value), seeCost ? `সম্ভাব্য লাভ ${money(Number(sum!.sale_value) - Number(sum!.cost_value))}` : '', 'kpi-green')}{' '}{ui.kpi('স্টক কম', bn(sum!.low), `${bn(sum!.out)}টি একদম শেষ`, sum!.low ? 'kpi-alert' : '', '/admin/inventory?low=1')}{' '}{ui.kpi('নষ্ট স্টক', `${bn(sum!.damaged)} পিস`, `${bn(sum!.damaged_products)}টি পণ্যে${seeCost && Number(sum!.damaged_value) ? ` · ${money(sum!.damaged_value)} লোকসান` : ''}`, sum!.damaged ? 'kpi-alert' : '', '/admin/inventory?damaged=1')}</div><form className="toolbar" method="get" action="/admin/inventory"><input type="search" name="q" defaultValue={attrValue(q)} placeholder="পণ্যের নাম, SKU, মডেল বা বারকোড" id="inv-q" /><button type="button" className="btn btn-sm btn-ghost" data-scan-into="#inv-q" title="ক্যামেরা দিয়ে বারকোড স্ক্যান">📷</button>{' '}{(suppliers.length ? ui.select('supplier', [['', 'সব সাপ্লায়ার'], ...suppliers.map((x) => [x.id, x.name])], supplierId || '') : null)}{' '}{ui.select('sort', [['sku', 'SKU ১, ২, ৩… (ক্রমানুসারে)'], ['sku_desc', 'SKU বড় থেকে ছোট'], ['stock_asc', 'স্টক কম আগে'], ['name', 'নাম (A-Z)']], sort)}{' '}{ui.check('low', low, 'শুধু স্টক কম')}{' '}{ui.check('damaged', damaged, 'শুধু নষ্ট স্টক আছে')}{' '}<button className="btn btn-sm">খুঁজুন</button></form>{ui.helpBox('স্টকের হিসাব কীভাবে পড়বেন', <ul><li><b>বিক্রির স্টক</b>{' '}= এখন যতটা কাস্টমার অর্ডার করতে পারবে।</li><li><b>অর্ডারে আটকে</b>{' '}= নতুন/কনফার্ম/প্যাকিং/হোল্ড অর্ডারের জন্য রাখা মাল — এখনো তাকেই আছে, কিন্তু অন্য কেউ আর কিনতে পারবে না। কুরিয়ারে দিলে এটা কমে যায়।</li><li><b>তাকে মোট</b>{' '}= বিক্রির স্টক + অর্ডারে আটকে। হাতে গুনলে এই সংখ্যাটা মেলার কথা (নষ্ট মাল আলাদা)।</li><li><b>নষ্ট স্টক</b>{' '}= ভাঙা/নষ্ট মাল, আলাদা রাখা — বিক্রি হবে না। মেরামত হলে "মেরামত হয়ে আবার বিক্রিযোগ্য", ফেলে দিলে "নষ্ট মাল ফেলে দেওয়া" বেছে সংখ্যা দিন।</li></ul>)}<form method="post" action="/admin/inventory/adjust" id="inv-adjust" data-inv-form=""><input type="hidden" name="back" defaultValue={attrValue(backUrl)} /></form>{(rows.length ? <><div className="panel table-wrap"><p className="inv-scroll-hint small muted" data-inv-hint="">↔ টেবিলটা ডানে-বামে টেনে সব ঘর দেখুন — এডিট/মুছুন সবসময় ডান পাশে থাকে</p><table className="table inv-table"><thead><tr><th>ছবি</th><th>পণ্য</th><th>SKU</th><th className="num">বিক্রির স্টক</th><th className="num">অর্ডারে আটকে</th><th className="num">তাকে মোট</th><th className="num">নষ্ট</th>{(seeCost ? <><th className="num">কেনা দাম</th><th className="num">স্টকের মূল্য</th></> : null)}{(canAdjust ? <><th>স্টক বাড়ান / কমান</th><th>কারণ</th></> : null)}{(canProducts || canDelete ? <th className="inv-act-h">দোকানে · এডিট · মুছুন</th> : null)}</tr></thead><tbody>{jsxList(rows.map((p) => {
    const held = reserved.get(p.id) || 0;
    return <tr className={p.active ? '' : 'row-off'}><td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" loading="lazy" /> : <span><Val v={p.emoji} /></span>)}</td><td className="inv-name"><b className="inv-title" title={attrValue(p.name)}><Val v={p.name} /></b>{(p.model ? <>{' '}<span className="small muted"><Val v={p.model} /></span></> : null)}{(p.location ? <><br /><span className="loc-chip" title="কোথায় রাখা">📍{' '}<Val v={p.location} /></span></> : null)}{(p.active ? null : <><br /><span className="small muted">দোকানে লুকানো</span></>)}{(p.supplier_id && supName.has(p.supplier_id) ? <><br /><a className="small muted" href={`/admin/suppliers/${attrValue(p.supplier_id)}`}>🚚{' '}<Val v={supName.get(p.supplier_id)} /></a></> : null)}</td><td className="small"><Val v={p.sku || '—'} /></td><td className={`num ${p.stock <= 0 ? 'bad' : p.stock <= p.low_stock ? 'warn' : ''}`}><b>{bn(p.stock)}</b>{' '}<span className="small muted"><Val v={p.unit} /></span>{(p.stock <= 0 ? <><br /><span className="small">স্টক আউট</span></> : null)}</td><td className="num">{(held ? <a href={`/admin/orders?q=${attrValue(encodeURIComponent(p.sku || ''))}`} title="খোলা অর্ডারে রাখা">{bn(held)}</a> : <span className="muted">০</span>)}</td><td className="num">{bn(p.stock + held)}</td><td className={`num ${p.damaged_stock ? 'warn' : ''}`}>{(p.damaged_stock ? bn(p.damaged_stock) : <span className="muted">০</span>)}</td>{(seeCost ? <><td className="num">{money(p.cost_price)}</td><td className="num">{money(Number(p.cost_price) * p.stock)}</td></> : null)}{' '}{(canAdjust ? <><td><div className="stepper"><input type="hidden" name="pid[]" defaultValue={attrValue(p.id)} form="inv-adjust" />{' '}<button type="button" className="step-btn" data-step="-1" aria-label={`${attrValue(p.name)} স্টক ১ কমান`}>−</button>{' '}<input type="number" name="change[]" className="w-num" placeholder="০" form="inv-adjust" data-step-input="" aria-label={`${attrValue(p.name)} স্টক বদল`} />{' '}<button type="button" className="step-btn" data-step="1" aria-label={`${attrValue(p.name)} স্টক ১ বাড়ান`}>+</button></div></td><td>{ui.select('reason[]', ADJUST_REASONS, 'adjust', { form: 'inv-adjust' })}</td></> : null)}{' '}{(canProducts || canDelete ? <td className="inv-act"><div className="inv-act-in">{(canProducts ? <><form method="post" action={`/admin/products/${attrValue(p.id)}/active`} className="prod-toggle"><input type="hidden" name="back" defaultValue={attrValue(backUrl)} />{' '}<label className="switch switch-sm" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে লুকিয়ে যাবে">{' '}<input type="checkbox" name="active" defaultValue="1" defaultChecked={!!(p.active)} data-prod-toggle="" aria-label={`${attrValue(p.name)} দোকানে দেখাবে`} />{' '}<span className="switch-ui" aria-hidden="true"></span></label>{' '}<span className="small prod-toggle-text" data-prod-toggle-text="">{(p.active ? "চালু" : "বন্ধ")}</span><noscript><button className="btn btn-sm btn-ghost">সেভ</button></noscript></form><a className="icon-btn" href={`/admin/products/${attrValue(p.id)}`} title="এডিট করুন" aria-label={`${attrValue(p.name)} এডিট করুন`}>✏️</a></> : null)}{' '}{(canDelete ? <form method="post" action={`/admin/products/${attrValue(p.id)}/delete`} data-confirm={`'${attrValue(p.name)}' পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু দোকান থেকে সরাতে চাইলে পাশের সুইচ বন্ধ করুন।`}><input type="hidden" name="back" defaultValue={attrValue(backUrl)} />{' '}<button className="icon-btn icon-danger" title="মুছুন" aria-label={`${attrValue(p.name)} মুছুন`}>🗑️</button></form> : null)}</div></td> : null)}</tr>;
  }))}</tbody></table>{(canAdjust ? <><div className="form-actions inv-save">{ui.input('note', '', { placeholder: 'নোট (ঐচ্ছিক)', maxlength: 200, form: 'inv-adjust' })}<button className="btn" form="inv-adjust">স্টক আপডেট করুন</button></div><p className="muted small inv-help">যেসব পণ্যের স্টক বদলাতে চান শুধু সেগুলোর ঘরে{' '}<b>+</b>{' '}/{' '}<b>−</b>{' '}চাপুন অথবা সংখ্যা লিখুন। যেমন ৫টি বেশি পেলে 5, ২টি হারালে −2। নষ্ট হলে সংখ্যা দিয়ে কারণে "নষ্ট/ভাঙা → নষ্ট স্টকে" বাছুন — বিক্রির স্টক থেকে কমে নষ্ট স্টকে যাবে। তারপর "স্টক আপডেট করুন" চাপুন।</p></> : null)}</div>{ui.pager(total, page, INV_PER_PAGE, listUrl)}</> : <p className="muted panel">কিছু পাওয়া যায়নি।</p>)}<section className="panel"><h2>স্টকের সাম্প্রতিক ইতিহাস</h2>{movesTable(moves)}<p className="small"><a href="/admin/security/audit?action=stock_adjust">{(ctx.user.role === 'owner' ? "কে কখন স্টক বদলেছে — অডিট লগ →" : null)}</a></p></section></>;
  return ctx.page('ইনভেন্টরি', body, 'inventory');
}
function movesTable(moves?: Loose) {
  if (!moves.length) return <p className="muted">এখনো কোনো বদল নেই।</p>;
  return <div className="table-wrap"><table className="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th className="num">বদল</th><th className="num">পরে স্টক</th><th>কারণ</th><th>কে</th></tr></thead><tbody>{jsxList(moves.map((m: Loose) => <tr><td className="small">{fmtDate(m.created_at)}</td><td><Val v={m.product_name || '—'} /></td><td className={`num ${m.change < 0 ? 'warn' : 'good'}`}>{(m.change ? <>{(m.change > 0 ? "+" : null)}{bn(m.change)}</> : null)}{(m.damaged_change ? <><br /><span className="small warn">নষ্ট{' '}{(m.damaged_change > 0 ? "+" : null)}{bn(m.damaged_change)}</span></> : null)}</td><td className="num">{bn(m.balance ?? '')}</td><td className="small"><Val v={catalog.STOCK_REASONS[m.reason] || m.reason} />{(m.ref_type === 'order' && m.ref_id ? <>{' '}·{' '}<a href={`/admin/orders/${attrValue(m.ref_id)}`}>অর্ডার</a></> : null)}{(m.ref_type === 'purchase' && m.ref_id ? <>{' '}·{' '}<a href={`/admin/purchases/${attrValue(m.ref_id)}`}>পারচেজ</a></> : null)}{(m.note ? ` · ${m.note}` : null)}</td><td className="small"><Val v={m.staff_name || '—'} /></td></tr>))}</tbody></table></div>;
}
async function adjust(ctx: AdminCtx) {
  const b = await ctx.body();
  const pids = list(b.pid);
  const changes = list(b.change);
  const reasons = list(b.reason);
  const note = str(b.note, 200);
  let n = 0;
  const problems: unknown[] = [];
  const touched: Loose[] = [];
  const { tx } = $db;
  await tx(async (t) => {
    for (let i = 0; i < pids.length; i++) {
      const ch = int(changes[i]);
      if (!ch) continue;
      const pid = int(pids[i]);
      const reason = catalog.STOCK_REASONS[reasons[i]] ? reasons[i] : 'adjust';
      const qty = Math.abs(ch);
      let ok: unknown = true;
      // damaged goods: kept apart from the stock that can be sold
      if (reason === 'damage') ok = await catalog.changeDamaged(t, pid, { stock: -qty, damaged: qty }, 'damage', 'manual', null, note, ctx.user.id);
      else if (reason === 'damage_out') ok = await catalog.changeDamaged(t, pid, { damaged: -qty }, 'damage_out', 'manual', null, note, ctx.user.id);
      else if (reason === 'repair') ok = await catalog.changeDamaged(t, pid, { stock: qty, damaged: -qty }, 'repair', 'manual', null, note, ctx.user.id);
      else await catalog.moveStock(t, pid, ch, reason, 'manual', null, note, ctx.user.id);
      if (!ok) {
        const p = (await t.query<Pick<ProductsRow, 'name' | 'stock' | 'damaged_stock'>>('SELECT name, stock, damaged_stock FROM products WHERE id=$1', [pid])).rows[0];
        problems.push(p ? `"${p.name}": ${reason === 'damage' ? `বিক্রির স্টকে আছে ${bn(p.stock)}টি` : `নষ্ট স্টকে আছে ${bn(p.damaged_stock)}টি`}` : `#${pid}`);
        continue;
      }
      touched.push(pid);
      n++;
    }
  });
  if (n) {
    await ctx.log('stock_adjust', 'product', touched.length === 1 ? touched[0] : null, `${n}টি পণ্যের স্টক বদল${note ? ` (${note})` : ''}`);
    $services_stockalert.check(ctx.settings, touched).catch(() => {});
  }
  const back = /^\/admin\/inventory(\?[\w=&%.+-]*)?$/.test(String(b.back || '')) ? String(b.back) : '/admin/inventory';
  if (problems.length) return ctx.fail(back, `${bn(n)}টি বদল হয়েছে। এগুলো হয়নি (যথেষ্ট নেই): ${problems.join('; ')}`);
  return ctx.back(back, 'saved');
}

// ---------------------------------------------------------------- suppliers
async function suppliersPage(ctx: AdminCtx) {
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
  const body = <><div className="title-row"><h1>সাপ্লায়ার{' '}<small>{bn(rows.length)}{' '}জন</small></h1><div className="row-actions">{(seeCost ? <a className="btn btn-ghost" href="/admin/suppliers/dues">📒 বাকির খাতা</a> : null)}<a className="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a></div></div>{ui.flash(ctx.flash)}{' '}{(seeCost ? <div className="kpis">{ui.kpi('সাপ্লায়ারদের মোট পাওনা', money(totalDue), 'আপনার কাছে তারা যত টাকা পাবে', totalDue > 0 ? 'kpi-alert' : '')}</div> : null)}<div className="two-col"><section className="panel table-wrap">{(rows.length ? <table className="table"><thead><tr><th>নাম</th><th>ফোন</th><th className="num">পারচেজ</th>{(seeCost ? <><th className="num">মোট কেনা</th><th className="num">পরিশোধ</th><th className="num">বাকি</th></> : null)}<th>চালু</th><th>কাজ</th></tr></thead><tbody>{jsxList(rows.map((s) => <tr className={s.active ? '' : 'row-off'}><td><b><Val v={s.name} /></b>{(s.company ? <><br /><span className="small muted"><Val v={s.company} /></span></> : null)}</td><td className="small">{(s.phone ? <a href={`tel:${attrValue(s.phone)}`}><Val v={s.phone} /></a> : "—")}</td><td className="num">{bn(s.purchase_count)}</td>{(seeCost ? <><td className="num">{money(s.purchased)}</td><td className="num">{money(s.paid)}</td><td className={`num ${finance.supplierDue(s) > 0 ? 'warn' : ''}`}>{money(finance.supplierDue(s))}</td></> : null)}<td>{ui.rowSwitch(`/admin/toggle/supplier/${s.id}`, s.active, 'বন্ধ করলে নতুন পারচেজে এই সাপ্লায়ার আসবে না')}</td>{ui.rowActions({ edit: `/admin/suppliers/${s.id}`, editLabel: '✏️ খুলুন / এডিট' })}</tr>))}</tbody></table> : <p className="muted">এখনো কোনো সাপ্লায়ার নেই। পাশের ফর্ম থেকে যোগ করুন।</p>)}</section><section className="panel"><h2>নতুন সাপ্লায়ার</h2>{supplierForm({})}</section></div></>;
  return ctx.page('সাপ্লায়ার', body, 'suppliers');
}
function supplierForm(s: $db.pg.DbRow) {
  return <form method="post" action="/admin/suppliers" className="form">{(s.id ? <input type="hidden" name="id" defaultValue={attrValue(s.id)} /> : null)}{' '}{ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 100 }))}{' '}{ui.field('প্রতিষ্ঠান / দোকান', ui.input('company', s.company || '', { maxlength: 120 }))}<div className="field-row">{ui.field('ফোন', ui.input('phone', s.phone || '', { maxlength: 30 }))}{ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>{ui.field('ঠিকানা', ui.textarea('address', s.address || '', { rows: 2, maxlength: 400 }))}{' '}{ui.field('শুরুতে বাকি ছিল (৳)', ui.input('opening_due', s.opening_due || 0, { type: 'number' }), 'এই সফটওয়্যার শুরুর আগে তার কাছে যত টাকা বাকি ছিল')}{' '}{ui.field('নোট', ui.textarea('note', s.note || '', { rows: 2, maxlength: 1000 }))}{' '}{(s.id ? ui.check('active', s.active, 'চালু আছে') : null)}{' '}<button className="btn">{(s.id ? "সেভ করুন" : "যোগ করুন")}</button></form>;
}
async function supplierDetail(ctx: AdminCtx, m: RouteMatch) {
  const s = await finance.getSupplier(int(m[1]));
  if (!s) return ctx.redirect('/admin/suppliers');
  const seeCost = ctx.can('see_cost');
  const accounts = await finance.listAccounts();
  const due = finance.supplierDue(s);
  const body = <><p className="crumbs"><a href="/admin/suppliers">← সব সাপ্লায়ার</a></p><div className="title-row"><h1><Val v={s.name} /></h1><div className="row-actions">{(seeCost ? <a className="btn btn-ghost" href={`/admin/suppliers/${attrValue(s.id)}/ledger`}>📒 খাতা (লেজার)</a> : null)}<a className="btn" href={`/admin/purchases/new?supplier=${attrValue(s.id)}`}>+ এর কাছ থেকে কিনুন</a></div></div>{ui.flash(ctx.flash)}{' '}{(seeCost ? <div className="kpis">{ui.kpi('মোট কেনা', money(s.purchased), `${bn(s.purchase_count)}টি পারচেজ`)}{' '}{ui.kpi('পরিশোধ করেছেন', money(s.paid), '')}{' '}{ui.kpi('বাকি (তাকে দিতে হবে)', money(due), '', due > 0 ? 'kpi-alert' : 'kpi-green')}</div> : null)}<div className="two-col"><div><section className="panel"><h2>কোন পণ্য কত দামে কিনেছেন</h2>{(s.products.length ? <table className="table compact"><thead><tr><th>পণ্য</th><th className="num">মোট পরিমাণ</th>{(seeCost ? <th className="num">গড় কেনা দাম</th> : null)}<th>শেষ কেনা</th></tr></thead><tbody>{jsxList(s.products.map((p: { product_id: unknown; name: unknown; qty: unknown; avg_cost: unknown; last_date: string; }) => <tr><td>{(p.product_id ? <a href={`/admin/products/${attrValue(p.product_id)}`}><Val v={p.name} /></a> : <Val v={p.name} />)}</td><td className="num">{bn(p.qty)}</td>{(seeCost ? <td className="num">{money(p.avg_cost)}</td> : null)}<td className="small">{(p.last_date ? fmtDate(p.last_date + 'T06:00:00Z', false) : null)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কিছু কেনা হয়নি।</p>)}</section><section className="panel"><h2>পারচেজ</h2>{purchasesTable(s.purchases, seeCost)}</section>{(seeCost ? <section className="panel"><h2>পেমেন্ট</h2>{(s.payments.length ? <table className="table compact"><tbody>{jsxList(s.payments.map((t: Loose) => <tr><td className="small">{fmtDate(t.tx_date + 'T06:00:00Z', false)}</td><td><Val v={t.account_name || '—'} /></td><td className="small"><Val v={t.note} /></td><td className="num">{money(t.amount)}</td></tr>))}</tbody></table> : <p className="muted">কোনো পেমেন্ট নেই।</p>)}</section> : null)}</div><div>{(ctx.can('accounting') || seeCost ? <section className="panel" id="pay"><h2>সাপ্লায়ারকে টাকা দিন</h2><form method="post" action={`/admin/suppliers/${attrValue(s.id)}/pay`} className="form"><div className="field-row">{ui.field('টাকা', ui.input('amount', due > 0 ? due : '', { type: 'number', min: 1, required: true }))}{ui.field('তারিখ', ui.input('tx_date', ymd(), { type: 'date' }))}</div>{ui.field('কোন অ্যাকাউন্ট থেকে', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`]), ''))}{' '}{ui.field('নোট', ui.input('note', '', { maxlength: 200 }))}{' '}<button className="btn">পেমেন্ট সেভ করুন</button></form></section> : null)}<section className="panel"><h2>তথ্য এডিট</h2>{supplierForm(s)}</section></div></div></>;
  return ctx.page(s.name, body, 'suppliers');
}
async function supplierPay(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const b = await ctx.body();
  try {
    await finance.addTransaction({ type: 'expense', category: 'সাপ্লায়ার পেমেন্ট', amount: b.amount, account_id: b.account_id, supplier_id: id, tx_date: b.tx_date, note: b.note }, ctx.user.id);
  } catch (caught) { const e = caught as Caught; return ctx.fail(`/admin/suppliers/${id}`, e.message); }
  await ctx.log('supplier_pay', 'supplier', id, `৳${b.amount}`);
  return ctx.back(`/admin/suppliers/${id}`, 'paid');
}

// ---------------------------------------------------------------- purchases
function purchasesTable(rows?: Loose, seeCost?: unknown) {
  if (!rows.length) return <p className="muted">কোনো পারচেজ নেই।</p>;
  return <div className="table-wrap"><table className="table compact"><thead><tr><th>নম্বর</th><th>তারিখ</th><th>সাপ্লায়ার</th><th className="num">পরিমাণ</th>{(seeCost ? <th className="num">মোট</th> : null)}<th>অবস্থা</th></tr></thead><tbody>{jsxList(rows.map((p: Loose) => <tr><td><a href={`/admin/purchases/${attrValue(p.id)}`}><b><Val v={p.code} /></b></a></td><td className="small">{fmtDate(p.purchase_date + 'T06:00:00Z', false)}</td><td><Val v={p.supplier_name || '—'} /></td><td className="num">{bn(p.units || 0)}</td>{(seeCost ? <td className="num">{money(p.total)}</td> : null)}<td>{ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</td></tr>))}</tbody></table></div>;
}
async function purchasesPage(ctx: AdminCtx) {
  const db = $db;
  const seeCost = ctx.can('see_cost');
  const [rows, month, suppliers, restock] = await Promise.all([
    finance.listPurchases({}),
    db.one<{ n: number; total: number; units: number; waiting: number }>(`SELECT count(*)::int AS n, coalesce(sum(total),0)::numeric(14,2) AS total,
        coalesce((SELECT sum(i.qty) FROM purchase_items i JOIN purchases p2 ON p2.id=i.purchase_id
          WHERE p2.status<>'cancelled' AND date_trunc('month', p2.purchase_date) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date)),0)::int AS units,
        (SELECT count(*) FROM purchases WHERE status='ordered')::int AS waiting
      FROM purchases WHERE status<>'cancelled' AND date_trunc('month', purchase_date) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date)`),
    finance.listSuppliers(),
    // what to buy next: products that are running out, ranked by how fast they sell (last 30 days)
    db.q<{ id: number; name: string; sku: string; stock: number; low_stock: number; cost_price: number; image_id: number; emoji: string; unit: string; sold30: number; seen30: number }>(`WITH sold AS (SELECT oi.product_id, sum(oi.qty)::int AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','returned') GROUP BY oi.product_id),
          seen AS (SELECT product_id, count(DISTINCT visitor_id)::int AS n FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY product_id)
        SELECT p.id, p.name, p.sku, p.stock, p.low_stock, p.cost_price, p.image_id, p.emoji, p.unit, coalesce(sold.n,0) AS sold30, coalesce(seen.n,0) AS seen30
        FROM products p LEFT JOIN sold ON sold.product_id=p.id LEFT JOIN seen ON seen.product_id=p.id
        WHERE p.active AND p.product_type='single' AND p.stock <= greatest(p.low_stock, 0)
        ORDER BY coalesce(sold.n,0) DESC, coalesce(seen.n,0) DESC, p.stock ASC LIMIT 12`).catch(() => []),
  ]);
  const totalDue = suppliers.reduce((sum, x) => sum + Math.max(0, finance.supplierDue(x)), 0);
  const suggest = (r: $db.pg.DbRow) => Math.max(r.low_stock * 2, r.sold30 * 2 - r.stock, 5);
  const body = <><div className="title-row"><h1>পারচেজ (মাল কেনা)</h1><div className="row-actions"><a className="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a><a className="btn btn-ghost" href="/admin/suppliers">🚚 সাপ্লায়ার</a></div></div>{ui.flash(ctx.flash)}<div className="kpis kpis-tight">{(seeCost ? ui.kpi('এই মাসে মাল কেনা', money(month!.total), `${bn(month!.n)}টি পারচেজ · ${bn(month!.units)} পিস`, 'kpi-blue') : ui.kpi('এই মাসে পারচেজ', bn(month!.n), `${bn(month!.units)} পিস`))}{' '}{ui.kpi('মাল আসার অপেক্ষায়', bn(month!.waiting), 'অর্ডার দেওয়া, এখনো আসেনি', month!.waiting ? 'kpi-alert' : '')}{' '}{(seeCost ? ui.kpi('সাপ্লায়ারদের বাকি', money(totalDue), 'আপনার কাছে তারা পাবে', totalDue > 0 ? 'kpi-alert' : '', '/admin/suppliers') : null)}{' '}{ui.kpi('এখনই কেনা দরকার', bn(restock.length), 'স্টক শেষ বা কম', restock.length ? 'kpi-alert' : 'kpi-green', '#restock')}</div>{(restock.length ? <section className="panel table-wrap" id="restock"><h2>🧠 কী কিনবেন — স্টক কম, বিক্রি হচ্ছে{' '}<small>গত ৩০ দিনের বিক্রি আর কতজন দেখেছে দেখে সাজানো</small></h2><form method="get" action="/admin/purchases/new"><table className="table compact restock-table"><thead><tr><th><input type="checkbox" data-check-all="" aria-label="সব বাছুন" /></th><th>ছবি</th><th>পণ্য</th><th className="num">এখন স্টক</th><th className="num">৩০ দিনে বিক্রি</th><th className="num">দেখেছে</th><th className="num">কত কিনবেন (পরামর্শ)</th>{(seeCost ? <th className="num">শেষ কেনা দাম</th> : null)}</tr></thead><tbody>{jsxList(restock.map((r) => <tr><td><input type="checkbox" name="add" defaultValue={attrValue(r.id)} data-check-row="" defaultChecked aria-label={attrValue(r.name)} /></td><td className="thumb">{(r.image_id ? <img src={`/media/${attrValue(r.image_id)}/t`} alt="" loading="lazy" /> : <span><Val v={r.emoji || '📦'} /></span>)}</td><td><b><Val v={r.name} /></b>{(r.sku ? <><br /><span className="small muted">SKU{' '}<Val v={r.sku} /></span></> : null)}</td><td className={`num ${r.stock <= 0 ? 'bad' : 'warn'}`}>{bn(r.stock)}</td><td className="num">{bn(r.sold30)}</td><td className="num">{bn(r.seen30)}</td><td className="num"><b>{bn(suggest(r))}</b>{' '}<span className="small muted"><Val v={r.unit || 'পিস'} /></span></td>{(seeCost ? <td className="num">{(r.cost_price ? money(r.cost_price) : "—")}</td> : null)}</tr>))}</tbody></table><div className="form-actions"><button className="btn">🛒 বাছাই করা পণ্য দিয়ে পারচেজ শুরু করুন</button><span className="small muted">পারচেজ ফর্মে পণ্যগুলো আগে থেকেই বসানো থাকবে — শুধু পরিমাণ আর দাম মিলিয়ে নিন।</span></div></form></section> : null)}{' '}{ui.helpBox('পারচেজ কেন দরকার? (ধাপে ধাপে)', <ol><li>সাপ্লায়ারের কাছ থেকে মাল কিনলে{' '}<b>"+ নতুন পারচেজ"</b>{' '}চাপুন, সাপ্লায়ার বাছুন (নতুন হলে আগে "সাপ্লায়ার" পেজে যোগ করুন)।</li><li>পণ্য খুঁজে যোগ করুন, পরিমাণ আর{' '}<b>প্রতিটার কেনা দাম</b>{' '}দিন। প্যাকেটে কিনলে (যেমন ১০০০ পিস ৳২০০){' '}<b>"📦 প্যাকেট দামে"</b>{' '}চাপলে প্রতি পিসের দাম নিজে থেকে বের হবে।</li><li>"মাল বুঝে পেয়েছি" বাছলে{' '}<b>স্টক নিজে থেকে বাড়বে</b>, পণ্যের কেনা দাম আপডেট হবে, আর লাভের হিসাব ঠিক থাকবে।</li><li>যত টাকা দিয়েছেন তা লিখুন — বাকি থাকলে সাপ্লায়ারের "বাকি" তে জমা থাকবে, পরে পরিশোধ করলে সাপ্লায়ারের পেজ থেকে লিখুন।</li></ol>)}<section className="panel">{purchasesTable(rows, seeCost)}</section></>;
  return ctx.page('পারচেজ', body, 'purchases');
}
async function purchaseNew(ctx: AdminCtx) {
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
    } catch (caught) { const e = caught as Caught;
      return ctx.fail('/admin/purchases/new', e.message);
    }
  }
  // started from "কী কিনবেন": those products are put in the form already
  const addIds = [...new Set(list(ctx.query.getAll ? ctx.query.getAll('add') : ctx.query.get('add')).map((x) => int(x)).filter((x) => x > 0))].slice(0, 40);
  const prefill: unknown[] = [];
  for (const id of addIds) {
    const p = await catalog.getProduct({ id }).catch(() => null);
    if (p && p.product_type !== 'bundle') prefill.push({ id: p.id, name: p.name, sku: p.sku, stock: p.stock, price: p.price, cost: ctx.can('see_cost') ? p.cost_price : '' });
  }
  const body = <><p className="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p><h1>নতুন পারচেজ (মাল কেনা)</h1>{ui.flash(ctx.flash)}{' '}{(!suppliers.length ? <p className="flash">আগে একজন{' '}<a href="/admin/suppliers">সাপ্লায়ার যোগ করুন</a>{' '}(না করলেও চলবে)।</p> : null)}<form method="post" action="/admin/purchases/new" className="form" data-purchase-form="" data-prefill={attrValue(JSON.stringify(prefill))}><div className="two-col"><section className="panel"><h2>কী কী কিনলেন</h2><div className="item-picker"><input type="search" placeholder="পণ্যের নাম বা SKU খুঁজে যোগ করুন…" data-product-search="" data-all="1" autoComplete="off" /><ul className="picker-results" data-product-results="" hidden></ul></div><table className="table item-rows"><thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th><th className="num">প্রতিটার কেনা দাম (৳)</th><th className="num">মোট</th><th></th></tr></thead><tbody data-item-rows="" data-purchase=""></tbody></table><p className="muted small" data-no-items="">উপরে খুঁজে পণ্য যোগ করুন। নতুন পণ্য হলে আগে{' '}<a href="/admin/products/new" target="_blank">পণ্য তৈরি করুন</a>।</p><div className="field-row">{ui.field('ছাড় পেয়েছেন (৳)', ui.input('discount', 0, { type: 'number', min: 0, 'data-pc': true }))}{' '}{ui.field('গাড়ি/কুরিয়ার ভাড়া (৳)', ui.input('shipping', 0, { type: 'number', min: 0, 'data-pc': true }))}{' '}{ui.field('অন্য খরচ (৳)', ui.input('other_cost', 0, { type: 'number', min: 0, 'data-pc': true }))}{' '}{ui.field('ভ্যাট (৳, ঐচ্ছিক)', ui.input('vat', 0, { type: 'number', min: 0, 'data-pc': true }), 'চালানে ভ্যাট থাকলে')}</div><div className="order-total">সর্বমোট:{' '}<b data-grand="">৳০</b></div></section><section className="panel">{ui.field('সাপ্লায়ার', ui.select('supplier_id', [['', 'বাছাই করুন'], ...suppliers.map((s) => [s.id, s.name])], ctx.query.get('supplier') || ''))}{' '}{ui.field('তারিখ', ui.input('purchase_date', ymd(), { type: 'date', required: true }))}{' '}{ui.field('অবস্থা', ui.select('status', [['received', 'মাল বুঝে পেয়েছি (স্টকে যোগ হবে)'], ['ordered', 'অর্ডার দিয়েছি, মাল এখনো আসেনি']], 'received'))}<h2>এখনই কত টাকা দিলেন</h2><div className="field-row">{ui.field('টাকা', ui.input('paid_now', 0, { type: 'number', min: 0 }), 'বাকি থাকলে ০ রাখুন')}{' '}{ui.field('অ্যাকাউন্ট', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, a.name]), ''))}</div>{ui.field('নোট / চালান নম্বর', ui.textarea('note', '', { rows: 2, maxlength: 1000 }))}{' '}<button className="btn btn-lg btn-block">পারচেজ সেভ করুন</button></section></div></form></>;
  return ctx.page('নতুন পারচেজ', body, 'purchases');
}
async function purchaseDetail(ctx: AdminCtx, m: RouteMatch) {
  const p = await finance.getPurchase(int(m[1]));
  if (!p) return ctx.redirect('/admin/purchases');
  const seeCost = ctx.can('see_cost');
  const body = <><p className="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p><div className="title-row"><h1>পারচেজ{' '}<Val v={p.code} />{' '}{ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</h1></div>{ui.flash(ctx.flash)}<div className="two-col"><section className="panel"><table className="table"><thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th>{(seeCost ? <><th className="num">কেনা দাম</th><th className="num">বিক্রি দাম</th><th className="num">লাভ/পিস</th><th className="num">মোট</th></> : null)}</tr></thead><tbody>{jsxList(p.items.map((i: Loose) => <tr><td>{(i.product_id ? <a href={`/admin/products/${attrValue(i.product_id)}`}><Val v={i.name} /></a> : <Val v={i.name} />)}{(i.sku ? <><br /><span className="small muted"><Val v={i.sku} /></span></> : null)}</td><td className="num">{bn(i.qty)}</td>{(seeCost ? <><td className="num">{money(i.unit_cost)}</td><td className="num">{money(i.sale_price || 0)}</td><td className={`num ${i.sale_price - i.unit_cost < 0 ? 'warn' : 'good'}`}>{money((i.sale_price || 0) - i.unit_cost)}{(i.sale_price ? <><br /><span className="small">{pct(((i.sale_price - i.unit_cost) / i.sale_price) * 100)}</span></> : null)}</td><td className="num">{money(i.unit_cost * i.qty)}</td></> : null)}</tr>))}</tbody>{(seeCost ? <tfoot><tr><td colSpan={5}>পণ্যের দাম</td><td className="num">{money(p.subtotal)}</td></tr>{(p.discount ? <tr><td colSpan={5}>ছাড়</td><td className="num">−{' '}{money(p.discount)}</td></tr> : null)}{' '}{(p.shipping ? <tr><td colSpan={5}>ভাড়া</td><td className="num">{money(p.shipping)}</td></tr> : null)}{' '}{(p.other_cost ? <tr><td colSpan={5}>অন্য খরচ</td><td className="num">{money(p.other_cost)}</td></tr> : null)}{' '}{(p.vat ? <tr><td colSpan={5}>ভ্যাট</td><td className="num">{money(p.vat)}</td></tr> : null)}<tr className="total"><td colSpan={5}><b>সর্বমোট</b></td><td className="num"><b>{money(p.total)}</b></td></tr><tr><td colSpan={5}>পরিশোধ</td><td className="num">{money(p.paid)}</td></tr><tr><td colSpan={5}>বাকি</td><td className={`num ${p.total - p.paid > 0 ? 'warn' : ''}`}>{money(p.total - p.paid)}</td></tr></tfoot> : null)}</table></section><section className="panel"><p>সাপ্লায়ার:{' '}{(p.supplier_id ? <a href={`/admin/suppliers/${attrValue(p.supplier_id)}`}><Val v={p.supplier_name} /></a> : "—")}</p><p>তারিখ:{' '}{fmtDate(p.purchase_date + 'T06:00:00Z', false)}{' '}· এন্ট্রি দিয়েছেন:{' '}<Val v={p.staff_name || '—'} /></p>{(p.note ? <p className="note"><Val v={p.note} /></p> : null)}{' '}{(p.status === 'ordered' ? <form method="post" action={`/admin/purchases/${attrValue(p.id)}/status`}><input type="hidden" name="status" defaultValue="received" /><button className="btn">✅ মাল বুঝে পেয়েছি (স্টকে যোগ করুন)</button></form> : null)}{' '}{(p.status !== 'cancelled' ? <form method="post" action={`/admin/purchases/${attrValue(p.id)}/status`} className="mt" data-confirm={`এই পারচেজ বাতিল করবেন? ${p.status === 'received' ? 'যোগ হওয়া স্টক আবার কমে যাবে।' : ''}`}><input type="hidden" name="status" defaultValue="cancelled" /><button className="link-btn danger">পারচেজ বাতিল করুন</button></form> : null)}{' '}{(p.supplier_id && p.total - p.paid > 0 ? <p className="mt"><a href={`/admin/suppliers/${attrValue(p.supplier_id)}`}>সাপ্লায়ারকে বাকি টাকা দিন →</a></p> : null)}</section></div></>;
  return ctx.page(p.code, body, 'purchases');
}
async function purchaseStatus(ctx: AdminCtx, m: RouteMatch) {
  const b = await ctx.body<'status'>();
  await finance.setPurchaseStatus(int(m[1]), b.status ?? '', ctx.user.id);
  await ctx.log('purchase_status', 'purchase', int(m[1]), b.status);
  return ctx.back(`/admin/purchases/${int(m[1])}`, 'status');
}

export const routes = [
    { method: 'GET', path: '/admin/inventory', perm: 'inventory', handler: inventoryPage },
    { method: 'POST', path: '/admin/inventory/adjust', perm: 'inventory', handler: adjust },
    { method: '*', path: '/admin/suppliers', perm: 'inventory', handler: suppliersPage },
    { method: 'GET', path: /^\/admin\/suppliers\/(\d+)$/, perm: 'inventory', handler: supplierDetail },
    { method: 'POST', path: /^\/admin\/suppliers\/(\d+)\/pay$/, perm: 'inventory', handler: supplierPay },
    { method: 'GET', path: '/admin/purchases', perm: 'inventory', handler: purchasesPage },
    { method: '*', path: '/admin/purchases/new', perm: 'inventory', handler: purchaseNew },
    { method: 'GET', path: /^\/admin\/purchases\/(\d+)$/, perm: 'inventory', handler: purchaseDetail },
    { method: 'POST', path: /^\/admin\/purchases\/(\d+)\/status$/, perm: 'inventory', handler: purchaseStatus },
  ];
void raw;

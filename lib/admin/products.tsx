import { Val, RawHtml, attrValue, jsxList, renderHtml } from '../react/html';
import { money, bn, int, str, pageNum, list, youtubeId, pct, fmtDate, amount, qtyRule, shopPrice, priceProblem, PRICE_MIN, PRICE_MAX, oneOf, arr, PACK_PRESETS, packSizes } from '../util';
import * as catalog from '../models/catalog';
import * as $packing from '../models/packing';
import * as dupes from '../models/duplicates';
import * as security from '../security';
import * as db from '../db';
import * as ui from './ui';
import * as $services_barcode from '../services/barcode';
import * as $models_finance from '../models/finance';
import * as $services_autocat from '../services/autocat';
import * as $variants from './variants';
import type { AdminCtx, Body, Id, RouteMatch, Settings } from '../types';
import type { PriceTiersRow, ProductsRow } from '../data/rows';
import * as recognize from '../models/recognize';
import * as $whitencloud from '../models/whitencloud';
import { bnTitle, bnTitleSmart } from '../services/bntitle';
import { memo } from '../cache';

const PER_PAGE = 40;
const ICONS = ['📦', '📟', '🧩', '🔋', '🔥', '🔌', '👕', '👗', '👟', '👜', '⌚', '📱', '💻', '🎧', '🔊', '📷', '🎮', '💡', '🔧', '🛠️', '⚙️',
  '🧲', '🧪', '🏠', '🛋️', '🍳', '🧴', '💄', '🧸', '📚', '✏️', '⚽', '🚲', '🚗', '🌱', '🐾', '🍎', '☕', '🎁', '💍', '🕶️', '🧢', '🧥', '🩺', '🧼', '📡', '🔦', '🪛', '🧵'];

async function listPage(ctx: AdminCtx) {
  // 🇧🇩 any product still without its Bangla name gets it (once in a while; quick when there is nothing to do)
  // (never holds the page up for more than a moment: what isn't done now is done on a later visit)
  await Promise.race([memo('bn-fill', () => catalog.fillBnNames(), 300_000).catch(() => 0), new Promise((r) => setTimeout(r, 1200))]);
  const page = pageNum(ctx.query);
  const categories = await catalog.listCategories();
  const f = {
    q: str(ctx.query.get('q'), 80),
    categoryId: int(ctx.query.get('cat')) || null,
    brandId: int(ctx.query.get('brand')) || null,
    type: oneOf(['single', 'bundle'], ctx.query.get('type'), ''),
    lowStock: ctx.query.get('low') === '1',
    status: oneOf(['on', 'off'], ctx.query.get('status'), ''),
    outStock: ctx.query.get('out') === '1',
    includeInactive: true,
  };
  const sort = oneOf(['sku', 'sku_desc', 'new', 'name', 'price_asc', 'price_desc', 'stock_asc', 'popular'], ctx.query.get('sort'), 'sku');
  const [rows, total, stats, brands] = await Promise.all([
    catalog.listProducts({ ...f, sort, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), catalog.countProducts(f),
    catalog.productStats({ type: f.type }), catalog.listBrands(),
  ]);
  // 👯 how many copies the duplicate scan finds (owner, 2026-10-24) — worked out at most every 5 minutes
  const isBundleList = f.type === 'bundle';
  const dupExtra = isBundleList ? null : await memo(`dup-count:${ctx.settings.dup_level || 'normal'}:${stats?.total}:${stats?.active}`, async () => {
    const g = await dupes.scanCatalog(ctx.settings);
    return g.filter((x) => x.level === 'block').reduce((n, x) => n + x.products.length - 1, 0);
  }, 300_000).catch(() => null);
  const seeCost = ctx.can('see_cost');
  const qsBase = new URLSearchParams();
  if (f.q) qsBase.set('q', f.q);
  if (f.categoryId) qsBase.set('cat', String(f.categoryId));
  if (f.brandId) qsBase.set('brand', String(f.brandId));
  if (f.type) qsBase.set('type', f.type);
  if (f.lowStock) qsBase.set('low', '1');
  if (f.status) qsBase.set('status', f.status);
  if (f.outStock) qsBase.set('out', '1');
  if (sort !== 'sku') qsBase.set('sort', sort);
  const isBundle = f.type === 'bundle';
  const backUrl = '/admin/products' + (() => { const x = new URLSearchParams(qsBase); if (page > 1) x.set('page', String(page)); if (isBundle) x.set('type', 'bundle'); const t = x.toString(); return t ? '?' + t : ''; })();
  const body = <><div className="title-row"><h1>{(isBundle ? "বান্ডেল / প্যাকেজ" : "পণ্য")}{' '}<small>{bn(total)}টি</small></h1><div className="row-actions">{(ctx.can('products') || ctx.can('products_add') ? <><a className="btn" href={`/admin/products/new${isBundle ? '?type=bundle' : ''}`}>+{' '}{(isBundle ? "নতুন বান্ডেল" : "নতুন পণ্য")}</a>{' '}{(isBundle ? null : <><a className="btn btn-ghost" href="/admin/products/import">📥 পণ্য আমদানি</a><a className="btn btn-ghost" href="/admin/products/new?type=bundle">+ বান্ডেল</a></>)}</> : null)}</div></div>{ui.flash(ctx.flash)}{' '}{statChips(stats!, f, isBundle, dupExtra)}{' '}{(isBundle ? ui.helpBox('বান্ডেল কী?', <>কয়েকটা পণ্য একসাথে এক দামে বিক্রি করাকে বান্ডেল/প্যাকেজ বলে। যেমন "সোল্ডারিং কিট" = আয়রন + তার + স্ট্যান্ড। বান্ডেল বিক্রি হলে ভেতরের প্রতিটা পণ্যের স্টক নিজে থেকে কমবে। বান্ডেলের স্টক = ভেতরের পণ্যগুলোর মধ্যে যেটা সবচেয়ে কম আছে।</>) : null)}<form className="toolbar filters" method="get" action="/admin/products"><input type="search" name="q" defaultValue={attrValue(f.q)} placeholder="নাম, SKU, ব্র্যান্ড বা বারকোড" id="prod-q" /><button type="button" className="btn btn-sm btn-ghost" data-scan-into="#prod-q" title="ক্যামেরা দিয়ে বারকোড স্ক্যান">📷</button>{' '}{ui.select('cat', [['', 'সব ক্যাটাগরি'], ...ui.catOpts(categories)], f.categoryId || '')}{' '}{(brands.length ? ui.select('brand', [['', 'সব ব্র্যান্ড'], ...brands.map((b) => [b.id, b.name])], f.brandId || '') : null)}{' '}{ui.select('type', [['', 'সব ধরন'], ['single', 'একক পণ্য'], ['bundle', 'বান্ডেল']], f.type)}{' '}{(f.status ? <input type="hidden" name="status" defaultValue={attrValue(f.status)} /> : null)}{(f.outStock ? <input type="hidden" name="out" defaultValue="1" /> : null)}{' '}{ui.select('sort', [['sku', 'SKU ১, ২, ৩… (ক্রমানুসারে)'], ['sku_desc', 'SKU বড় থেকে ছোট'], ['new', 'নতুন আগে'], ['name', 'নাম (A-Z)'], ['price_asc', 'দাম কম→বেশি'], ['price_desc', 'দাম বেশি→কম'], ['stock_asc', 'স্টক কম আগে'], ['popular', 'বেশি বিক্রি']], sort)}{' '}{ui.check('low', f.lowStock, 'শুধু স্টক কম')}{' '}<button className="btn btn-sm">খুঁজুন</button></form>{(rows.length ? <>{bulkBar(ctx, categories, brands)}<div className="table-wrap panel"><table className="table"><thead><tr>{(canBulk(ctx) ? <th className="pick"><input type="checkbox" data-pbulk-all="" aria-label="এই পেজের সব পণ্য বাছুন" /></th> : null)}<th></th><th>পণ্য</th><th>SKU</th><th>ক্যাটাগরি</th><th className="num">দাম</th>{(seeCost ? <><th className="num">কেনা দাম</th><th className="num">লাভ</th></> : null)}<th className="num">স্টক</th><th className="num">বিক্রি</th><th>দোকানে দেখাবে</th><th>কাজ</th></tr></thead><tbody>{jsxList(rows.map((p) => {
    const cost = Number(p.cost_price) || 0;
    const margin = p.price > 0 && cost > 0 ? ((p.price - cost) / p.price) * 100 : null;
    return <tr className={p.active ? '' : 'row-off'}>{(canBulk(ctx) ? <td className="pick"><input type="checkbox" name="ids[]" defaultValue={attrValue(p.id)} form="prod-bulk" data-pbulk-row="" aria-label={`${attrValue(p.name)} বাছুন`} /></td> : null)}<td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" loading="lazy" /> : <span><Val v={p.emoji} /></span>)}</td><td><b><Val v={p.name} /></b>{(p.model ? <>{' '}<span className="small muted"><Val v={p.model} /></span></> : null)}{(p.brand ? <><br /><span className="small muted">🏷️{' '}<Val v={p.brand} /></span></> : null)}{' '}{(p.product_type === 'bundle' ? <>{' '}<span className="pill pill-bundle">বান্ডেল</span></> : null)}{(p.featured ? <>{' '}<span className="pill">জনপ্রিয়</span></> : null)}{' '}{(Number(p.old_price) > p.price ? <>{' '}<span className="pill pill-offer">অফার</span></> : null)}{(p.is_new ? <>{' '}<span className="pill pill-new">নতুন</span></> : null)}</td><td className="small"><Val v={p.sku || '—'} /></td><td className="small">{(p.category_name ? `${p.category_icon} ${p.category_name}` : "—")}</td><td className="num">{money(p.price)}{(Number(p.old_price) > p.price ? <><br /><s className="small muted">{money(p.old_price)}</s></> : null)}</td>{(seeCost ? <><td className="num">{(p.cost_price ? money(p.cost_price) : <span className="muted">—</span>)}</td><td className={`num ${margin !== null && margin < 10 ? 'warn' : 'good'}`}>{(margin !== null ? <>{money(p.price - cost)}<br /><span className="small">{pct(margin)}</span></> : "—")}</td></> : null)}<td className={`num ${p.stock <= p.low_stock ? 'warn' : ''}`}>{bn(p.stock)}</td><td className="num">{bn(p.sold_count)}</td><td>{(ctx.can('products') ? <form method="post" action={`/admin/products/${attrValue(p.id)}/active`} className="prod-toggle"><input type="hidden" name="back" defaultValue={attrValue(backUrl)} />{' '}<label className="switch" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে পুরো লুকিয়ে যাবে">{' '}<input type="checkbox" name="active" defaultValue="1" defaultChecked={!!(p.active)} data-prod-toggle="" aria-label={`${attrValue(p.name)} দোকানে দেখাবে`} />{' '}<span className="switch-ui" aria-hidden="true"></span></label>{' '}<span className="small prod-toggle-text" data-prod-toggle-text="">{(p.active ? "চালু" : "বন্ধ")}</span><noscript><button className="btn btn-sm btn-ghost">সেভ</button></noscript></form> : <span className="small">{(p.active ? "চালু" : "বন্ধ")}</span>)}</td><td className="prod-actions"><a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(p.id)}`}>{(ctx.can('products') ? "✏️ এডিট" : "👁️ দেখুন")}</a>{' '}{(p.product_type !== 'bundle' && ctx.can('products') ? <a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(p.id)}/variants`} title="সাইজ / রং / মডেল">🎨{' '}{(Number(p.variant_count) > 0 ? `${bn(p.variant_count)}টি অপশন` : "অপশন")}</a> : null)}{' '}{(ctx.can('products_delete') ? <form method="post" action={`/admin/products/${attrValue(p.id)}/delete`} data-confirm={`'${attrValue(p.name)}' পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু দোকান থেকে সরাতে চাইলে পাশের সুইচ বন্ধ করুন।`}><input type="hidden" name="back" defaultValue={attrValue(backUrl)} />{' '}<button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form> : null)}</td></tr>;
  }))}</tbody></table></div>{ui.pager(total, page, PER_PAGE, '/admin/products' + (qsBase.toString() ? '?' + qsBase : ''))}</> : ui.empty('কোনো পণ্য পাওয়া যায়নি।', <a className="btn" href="/admin/products/new">পণ্য যোগ করুন</a>))}{' '}</>;
  return ctx.page(isBundle ? 'বান্ডেল' : 'পণ্য', body, isBundle ? 'bundles' : 'products');
}

// ---------------------------------------------------------------- bulk edit (many products at once)
const canBulk = (ctx: AdminCtx) => ctx.can('products') || ctx.can('products_delete');
function bulkBar(ctx: AdminCtx, categories: catalog.Category[], brands: { name: unknown }[] = []) {
  if (!canBulk(ctx)) return '';
  const edit = ctx.can('products');
  const acts = [
    ...(edit ? [['on', '🟢 দোকানে চালু করুন'], ['off', '⚪ দোকান থেকে বন্ধ করুন'], ['category', '🗂️ ক্যাটাগরি বদলান'], ['brand', '🏷️ ব্র্যান্ড বদলান'],
      ['price_pct', '💲 দাম % বাড়ান/কমান'], ['price_add', '💲 দাম ৳ বাড়ান/কমান'], ['new_on', '🆕 "নতুন" ট্যাগ দিন'], ['new_off', '"নতুন" ট্যাগ তুলুন'],
      ['featured_on', '⭐ জনপ্রিয়-তে দেখান'], ['featured_off', 'জনপ্রিয় থেকে সরান'], ['low_stock', '🟡 "স্টক কম" সীমা বসান']] : []),
    ['labels', '🏷️ বারকোড লেবেল প্রিন্ট'],
    ...(ctx.can('products_delete') ? [['delete', '🗑️ মুছে ফেলুন (রিসাইকেল বিনে)']] : []),
  ];
  return <form method="post" action="/admin/products/bulk" id="prod-bulk" className="bulk-bar" data-pbulk="" hidden><input type="hidden" name="back" defaultValue={ctx.path + (ctx.query.toString() ? '?' + ctx.query : '')} />{' '}<b data-pbulk-count="">০</b>টি পণ্য বাছাই করা:{' '}{ui.select('action', [['', '— কী করবেন বাছুন —'], ...acts], '', { 'data-pbulk-action': true, required: true })}{' '}<span data-pbulk-for="category" hidden>{ui.select('category_id', [['', 'কোনো ক্যাটাগরি না'], ...ui.catOpts(categories)], '')}</span>{' '}<span data-pbulk-for="brand" hidden>{ui.input('brand', '', { maxlength: 60, list: 'brand-list-bulk', placeholder: 'ব্র্যান্ডের নাম (খালি = ব্র্যান্ড সরান)' })}<datalist id="brand-list-bulk">{jsxList(brands.map((x) => <option value={attrValue(x.name)}></option>))}</datalist></span>{' '}<span data-pbulk-for="price_pct" hidden>{ui.input('pct', '', { type: 'number', step: '0.1', min: -90, max: 500, placeholder: 'যেমন 10 বা -5', class: 'w-num' })}{' '}%</span>{' '}<span data-pbulk-for="price_add" hidden>৳{' '}{ui.input('add', '', { type: 'number', step: '0.01', placeholder: 'যেমন 20 বা -10', class: 'w-num' })}</span>{' '}<span data-pbulk-for="low_stock" hidden>{ui.input('low', '', { type: 'number', min: 0, placeholder: 'যেমন 5', class: 'w-num' })}</span>{' '}<span data-pbulk-for="price_pct price_add" hidden>{ui.check('keep_old', true, 'আগের দাম কাটা দাগে দেখাও (অফার)')}</span>{' '}<button className="btn btn-sm">প্রয়োগ করুন</button>{' '}<button type="button" className="link-btn small" data-pbulk-clear="">বাছাই বাতিল</button></form>;
}
// new price after a % or ৳ change: never below ৳0.01; whole taka once the price is ৳10 or more
function bulkPrice(price: unknown, { pct, add }: { pct: number; add: number }): number {
  let v = Number(price) || 0;
  if (pct) v *= 1 + pct / 100;
  if (add) v += add;
  v = Math.max(0.01, v);
  return shopPrice(v);
}
async function bulkAction(ctx: AdminCtx) {
  const b = await ctx.body();
  const back = backTo(b);
  const ids = [...new Set(list(b.ids).map((x) => int(x)).filter((x) => x > 0))].slice(0, 500);
  if (!ids.length) return ctx.fail(back, 'কোনো পণ্য বাছাই করা হয়নি।');
  const act = String(b.action || '');
  if (act === 'labels') return ctx.redirect('/admin/products/labels?ids=' + ids.join(','));
  if (act === 'delete') {
    if (!ctx.can('products_delete')) return ctx.back(back.split('?')[0], 'noperm');
    for (const id of ids) await ctx.trash('product', id);
    await ctx.log('product_bulk', 'product', null, `একসাথে ${ids.length}টি পণ্য মুছে রিসাইকেল বিনে`);
    return ctx.redirect(back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent(`${bn(ids.length)}টি পণ্য মুছে রিসাইকেল বিনে রাখা হয়েছে।`));
  }
  if (!ctx.can('products')) return ctx.back(back.split('?')[0], 'noperm');
  const simple: Record<string, [string, string]> = {
    on: ['active=true', 'দোকানে চালু'], off: ['active=false', 'দোকান থেকে বন্ধ'], new_on: ['is_new=true', '"নতুন" ট্যাগ দেওয়া'], new_off: ['is_new=false', '"নতুন" ট্যাগ তোলা'],
    featured_on: ['featured=true', 'জনপ্রিয়-তে দেখানো'], featured_off: ['featured=false', 'জনপ্রিয় থেকে সরানো'],
  };
  let what = '';
  await db.tx(async (t) => {
    if (simple[act]) {
      await t.query(`UPDATE products SET ${simple[act][0]}, updated_at=now() WHERE id = ANY($1::int[])`, [ids]);
      what = simple[act][1];
    } else if (act === 'category') {
      const cid = int(b.category_id) || null;
      await t.query('UPDATE products SET category_id=$1, updated_at=now() WHERE id = ANY($2::int[])', [cid, ids]);
      what = 'ক্যাটাগরি বদল';
    } else if (act === 'brand') {
      const bid = str(b.brand, 60) ? await catalog.brandIdFor(t, b.brand) : null;
      await t.query(`UPDATE products SET brand_id=$1, brand=coalesce((SELECT name FROM brands WHERE id=$1), ''), updated_at=now() WHERE id = ANY($2::int[])`, [bid, ids]);
      what = bid ? `ব্র্যান্ড: ${str(b.brand, 60)}` : 'ব্র্যান্ড সরানো';
    } else if (act === 'low_stock') {
      await t.query('UPDATE products SET low_stock=$1 WHERE id = ANY($2::int[])', [Math.max(0, int(b.low)), ids]);
      what = `"স্টক কম" সীমা ${int(b.low)}`;
    } else if (act === 'price_pct' || act === 'price_add') {
      const pct = act === 'price_pct' ? Math.max(-90, Math.min(500, Number(b.pct) || 0)) : 0;
      const add = act === 'price_add' ? Number(b.add) || 0 : 0;
      if (!pct && !add) throw new Error('কত বাড়াবেন/কমাবেন লিখুন।');
      const rowsP = (await t.query<Pick<ProductsRow, 'id' | 'name' | 'price' | 'old_price'>>('SELECT id, name, price, old_price FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [ids])).rows;
      const out = rowsP.filter((r) => { const v = bulkPrice(r.price, { pct, add }); return v < PRICE_MIN || v > PRICE_MAX; });
      if (out.length) throw new Error(`${bn(out.length)}টি পণ্যের নতুন দাম ৳০.৫০–৳২০০০ এর বাইরে চলে যায় (যেমন "${out[0].name}")। ওগুলো বাদ দিয়ে আবার করুন।`);
      for (const r of rowsP) {
        const price = bulkPrice(r.price, { pct, add });
        // keep_old: the old price shows crossed out when the new price is lower; otherwise the old "was" price stays as it was
        const old = b.keep_old && price < Number(r.price) ? Math.max(Number(r.old_price) || 0, Number(r.price)) : (Number(r.old_price) > price ? Number(r.old_price) : null);
        await catalog.logPriceChange(t, r.id, r, { price, old_price: old, name: r.name }, ctx.user.id, 'একসাথে বদল');
        await t.query('UPDATE products SET price=$1, old_price=$2, updated_at=now() WHERE id=$3', [price, old, r.id]);
      }
      what = act === 'price_pct' ? `দাম ${pct > 0 ? '+' : ''}${pct}%` : `দাম ${add > 0 ? '+' : ''}৳${add}`;
    } else {
      throw new Error('কী করবেন বাছুন।');
    }
  }).catch((e: Error) => { what = ''; ctx.__err = e.message; });
  if (!what) return ctx.fail(back, ctx.__err || 'কাজটা করা যায়নি।');
  await ctx.log('product_bulk', 'product', null, `${ids.length}টি পণ্য: ${what}`);
  return ctx.redirect(back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent(`✅ ${bn(ids.length)}টি পণ্যে করা হয়েছে: ${what}`));
}

// Small count chips above the list: total / on the shop / hidden / stock out / low stock. Each one is a filter.
type StatChipsProps_ = {
  status: string;
  outStock: boolean;
  lowStock: boolean;
};
function statChips(st: catalog.ProductStats, f: StatChipsProps_, isBundle: boolean, dupExtra: number | null = null) {
  const base = isBundle ? '/admin/products?type=bundle' : '/admin/products';
  const link = (extra: string) => base + (extra ? (base.includes('?') ? '&' : '?') + extra : '');
  const none = !f.status && !f.outStock && !f.lowStock;
  const word = isBundle ? 'বান্ডেল' : 'পণ্য';
  return <div className="chips status-chips stat-chips" aria-label={`${attrValue(word)}ের হিসাব`}><a className={`chip chip-all ${none ? 'on' : ''}`} href={attrValue(link(''))}>📦 মোট{' '}<Val v={word} />{' '}<b>{bn(st.total)}</b></a>{' '}<a className={`chip chip-active ${f.status === 'on' ? 'on' : ''}`} href={attrValue(link('status=on'))}>🟢 চালু (দোকানে আছে){' '}<b>{bn(st.active)}</b></a>{' '}<a className={`chip chip-hidden ${f.status === 'off' ? 'on' : ''}`} href={attrValue(link('status=off'))}>⚪ বন্ধ (লুকানো){' '}<b>{bn(st.hidden)}</b></a>{' '}<a className={`chip chip-out ${f.outStock ? 'on' : ''}`} href={attrValue(link('out=1'))}>🔴 স্টক আউট{' '}<b>{bn(st.out)}</b></a>{' '}<a className={`chip chip-low ${f.lowStock && !f.outStock ? 'on' : ''}`} href={attrValue(link('low=1'))}>🟡 স্টক কম{' '}<b>{bn(st.low)}</b></a>{(dupExtra !== null ? <>{' '}<a className="chip chip-dup" href="/admin/products/duplicates" title="একই পণ্য একাধিকবার তোলা — দেখে রাখার মতোটা রেখে বাকিগুলো মুছুন">👯 ডুপ্লিকেট পণ্য{' '}<b>{bn(dupExtra)}</b></a></> : null)}</div>;
}

const MAX_IMAGES = catalog.MAX_PRODUCT_IMAGES;
function imageSlot(i: number, id?: Id) {
  const label = i === 0 ? 'মূল ছবি' : `ছবি ${bn(i + 1)}`;
  return <div className={`slot ${id ? 'filled' : ''} ${i === 0 ? 'slot-main' : ''}`} data-slot={attrValue(i)} data-img={attrValue(id || '')}><span className="slot-no"><Val v={label} /></span>{' '}<label className="slot-add" title={`${attrValue(label)} যোগ করুন`}>{(id ? <img src={`/media/${attrValue(id)}/t`} alt={attrValue(label)} /> : <><span className="slot-plus" aria-hidden="true">＋</span><span className="slot-hint">ছবি যোগ করুন</span></>)}<input type="file" accept="image/*" multiple hidden data-slot-file="" aria-label={`${attrValue(label)} বাছুন`} /></label><div className="g-tools" hidden={!(id)}><button type="button" data-slot-move="-1" aria-label="আগে নিন">◀</button><button type="button" data-slot-change="" aria-label="ছবি বদলান">বদলান</button><button type="button" data-slot-move="1" aria-label="পরে নিন">▶</button><button type="button" data-slot-del="" aria-label="মুছুন">✕</button></div></div>;
}

// ---------------------------------------------------------------- duplicate guard
type DupMatch = Awaited<ReturnType<typeof dupes.findDuplicates>>['matches'][number];
function dupMatches(matches: DupMatch[]) {
  return <ul className="dup-list">{jsxList(matches.map((m) => <li className={`dup-item ${m.level === 'block' ? 'is-block' : 'is-warn'}`}><a className="dup-thumb" href={`/admin/products/${attrValue(m.id)}`} target="_blank" rel="noopener">{(m.image ? <img src={attrValue(m.image)} alt="" loading="lazy" /> : <span><Val v={m.emoji || '📦'} /></span>)}</a><div className="dup-info"><a href={`/admin/products/${attrValue(m.id)}`} target="_blank" rel="noopener"><b><Val v={m.name} /></b></a>{' '}<span className="small muted">{(m.sku ? `SKU ${m.sku} · ` : null)}{money(m.price)}{(m.active ? null : " · লুকানো পণ্য")}</span>{' '}<span className="dup-why">{(m.level === 'block' ? "⛔ " : "⚠️ ")}<Val v={m.reasons.join(' · ')} /></span></div>{dupActs(m)}</li>))}</ul>;
}
// "বন্ধ করুন / চালু করুন" and "মুছুন" for a product shown as a duplicate (works without leaving the page).
function dupActs(m: { id: unknown; name?: unknown; title?: unknown; active?: unknown }) {
  return <div className="dup-acts" data-dup-acts="" data-id={attrValue(m.id)} data-name={attrValue(m.name || m.title || '')}><button type="button" className="btn btn-sm btn-ghost" data-dup-act="toggle" data-on={m.active ? '1' : ''}>{(m.active ? "🚫 বন্ধ করুন" : "✅ চালু করুন")}</button>{' '}<button type="button" className="btn btn-sm btn-danger" data-dup-act="delete">🗑️ মুছুন</button></div>;
}
type DupPanelProps = {
  dup: Awaited<ReturnType<typeof dupes.findDuplicates>> | null | undefined;
  canOverride: boolean;
  allow: boolean;
  id: unknown;
};
function dupPanel({ dup, canOverride, allow, id }: DupPanelProps) {
  const blocked = dup && dup.blocked;
  const showSwitch = blocked || allow;
  return <section className={`panel dup-box ${blocked ? 'is-block' : dup && dup.matches.length ? 'is-warn' : ''}`} data-dup-box="" data-dup-id={attrValue(id || '')} data-can-override={canOverride ? '1' : ''}><h2>🔍 ডুপ্লিকেট যাচাই</h2><div data-dup-result="">{(id && allow && !blocked ? <p className="good small" data-dup-settled="">✅ আপনি এই পণ্যটাকে আলাদা পণ্য হিসেবে রেখেছেন — ডুপ্লিকেট তালিকা আর দেখানো হবে না।</p> : dup && dup.matches.length ? <><p className="dup-head">{(blocked ? "এই পণ্যটি দোকানে আগে থেকেই আছে বলে মনে হচ্ছে, তাই সেভ আটকানো হয়েছে। নিচের পণ্যগুলো দেখুন:" : "কাছাকাছি কিছু পণ্য পাওয়া গেছে। একবার দেখে নিন (সেভ আটকাবে না):")}</p>{dupMatches(dup.matches)}</> : <p className="muted small" data-dup-idle="">নাম লিখলে আর ছবি দিলে নিজে থেকেই যাচাই হবে — একই পণ্য আগে থেকে আছে কি না (নাম, ছবি আর বিবরণ মিলিয়ে)।</p>)}</div>{(!id ? <p className="dup-cancel small" data-dup-cancel="" hidden={!(blocked)}>এই নতুন পণ্যটা রাখতে না চাইলে{' '}<a className="btn btn-ghost btn-sm" href="/admin/products">✕ বাতিল করুন — সেভ হবে না</a></p> : null)}{' '}{(canOverride ? <div className="dup-allow" data-dup-allow="" hidden={!(showSwitch)}>{ui.switchRow('allow_duplicate', allow, 'এটা আলাদা পণ্য — তবুও প্রকাশ করুন', 'নিশ্চিত হলে চালু করুন (যেমন একই ছবির আলাদা রং/মাপ)। চালু করে সেভ দিলে এই পণ্যটি আর আটকাবে না।')}</div> : <p className="small muted dup-noperm" data-dup-noperm="" hidden={!(blocked)}>এটা সত্যিই আলাদা পণ্য হলে মালিককে বলুন — তিনি "তবুও প্রকাশ করুন" সুইচ চালু করতে পারবেন।</p>)}</section>;
}
const canOverride = (ctx: AdminCtx) => ctx.can('dup_override');
const guardOn = (ctx: AdminCtx) => ctx.settings.dup_guard !== '0';

// 🇧🇩 the Bangla name for an English one, while the form is filled (lib/services/bntitle.ts)
async function bnTitleApi(ctx: AdminCtx) {
  return ctx.json(200, { bn: await bnTitleSmart(str(ctx.query.get('name'), 200)) });
}

// Live check while the form is being filled (name typed, picture added).
async function dupCheckApi(ctx: AdminCtx) {
  if (!(await security.hit(db, 'dupchk:' + ctx.user.id, 900, 3600))) return ctx.json(429, { error: 'অনেক বেশি যাচাই হয়েছে, একটু পরে চেষ্টা করুন।' });
  const b = await ctx.body();
  if (!str(b.name) && !(Array.isArray(b.images) && b.images.length)) return ctx.json(200, { blocked: false, matches: [] });
  const r = await dupes.findDuplicates({ id: b.id, name: str(b.name, 140), description: b.description, images: Array.isArray(b.images) ? b.images.slice(0, 10) : [],
    product_type: b.product_type, youtube_url: b.youtube_url }, ctx.settings);
  // editing a saved product: a twin the owner already kept as "আলাদা পণ্য" is settled — not shown again (owner, 2026-10-24)
  if (int(b.id)) { r.matches = r.matches.filter((m) => !m.allowed); r.blocked = r.matches.some((m) => m.level === 'block'); }
  return ctx.json(200, { ...r, html: r.matches.length ? renderHtml(dupMatches(r.matches)) : '' });
}

// On save. When editing, only NEW matches block — a product that already had a twin before this
// feature existed can still have its price or stock changed.
async function dupCheckOnSave(ctx: AdminCtx, b: Body, id?: Id) {
  if (!guardOn(ctx) || b.allow_duplicate) return null;
  const now = await dupes.findDuplicates({ ...b, id }, ctx.settings);
  if (!now.blocked) return null;
  if (id) {
    const cur = await catalog.getProduct({ id });
    if (cur) {
      const before = await dupes.findDuplicates({ ...cur, images: cur.images }, ctx.settings);
      const old = new Set(before.matches.filter((m) => m.level === 'block').map((m) => m.id));
      if (now.matches.filter((m) => m.level === 'block').every((m) => old.has(m.id))) return null;
    }
  }
  return now;
}


// 📒 Small "কেনা-বেচার হিসাব" box on the product form (owner only): last buys and what the sales earned.
function ledgerBox(p: ProductDraft, L: NonNullable<Awaited<ReturnType<typeof catalog.productLedger>>>) {
  const s = L.sales;
  return <section className="panel"><h2>📒 কেনা-বেচার হিসাব</h2><table className="table compact ledger-sum"><tbody><tr><td>মোট কেনা হয়েছে</td><td className="num">{bn(L.boughtQty)}টি</td></tr><tr><td>বিক্রি হয়েছে (বাতিল/ফেরত বাদে)</td><td className="num">{bn(s.qty)}টি</td></tr><tr><td>বিক্রি থেকে টাকা</td><td className="num">{money(s.revenue)}</td></tr><tr><td>যে মাল বিক্রি হলো তার কেনা দাম</td><td className="num">{money(s.cost)}</td></tr><tr className="total"><td>লাভ (নিজে থেকে হিসাব)</td><td className={`num ${s.profit < 0 ? 'warn' : 'good'}`}><b>{money(s.profit)}</b></td></tr></tbody></table>{(s.no_cost_qty ? <p className="small warn">{bn(s.no_cost_qty)}টি বিক্রির সময় কেনা দাম দেওয়া ছিল না — সেগুলোর লাভ বেশি দেখাচ্ছে।</p> : null)}{' '}{(L.buys.length ? <><p className="small"><b>শেষ কেনা:</b></p><ul className="timeline">{jsxList(L.buys.slice(0, 3).map((b) => <li>{bn(b.change)}টি ×{' '}{(b.unit_cost !== null ? money(b.unit_cost) : "—")}{(b.supplier_name ? ` · ${b.supplier_name}` : null)}{(b.purchase_status === 'cancelled' ? " (বাতিল)" : null)}<br /><span className="small muted">{(b.purchase_date ? fmtDate(b.purchase_date + 'T06:00:00Z', false) : fmtDate(b.created_at, false))}{' '}·{' '}{(b.reason === 'opening' ? "শুরুর স্টক" : <Val v={b.purchase_code || 'পারচেজ'} />)}</span></li>))}</ul></> : <p className="small muted">এখনো কোনো পারচেজ এন্ট্রি নেই।</p>)}{' '}<a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(p.id)}/ledger`}>সব হিসাব দেখুন →</a></section>;
}

// 📦 প্যাক / বান্ডেল: tick the packs this product is sold in (25 / 50 / 100 pieces, or your own numbers).
// The price above stays per piece; the customer picks a pack and the total is worked out (pieces × price).
function packBox(p: ProductDraft) {
  // a saved product: its pack_sizes; the form sent back with an error: what was ticked / typed
  const chosen = p.pack_form !== undefined ? packSizes(([] as unknown[]).concat(p.pack ?? [], String(p.pack_custom ?? '').split(/[^0-9]+/))) : packSizes(p.pack_sizes);
  const custom = chosen.filter((n) => !PACK_PRESETS.includes(n));
  const hasVariants = Number(p.variant_count) > 0;
  return <section className="panel" data-pack-box=""><h2>📦 প্যাক / বান্ডেল আকারে বিক্রি</h2><input type="hidden" name="pack_form" defaultValue="1" />{(
    <><p className="small muted">যেমন প্যাকেজিং বক্স বা পলি — যে প্যাকগুলোতে বিক্রি করবেন শুধু সেগুলোতে টিক দিন। কাস্টমার শুধু এই প্যাকগুলোই বাছাই করতে পারবে। কোনোটায় টিক না দিলে পণ্যটি সাধারণভাবে (পিস হিসেবে) বিক্রি হবে।</p>{(hasVariants ? <p className="small"><b>🎨 এই পণ্যের ভ্যারিয়েন্ট আছে:</b> এখানে টিক দেওয়া প্যাকগুলো <b>সব ভ্যারিয়েন্টে</b> চলবে (যেমন সাদা / Small, সিলভার / Large — প্রতিটা ২৫ / ৫০ / ১০০ পিসে)। প্রতিটা ভ্যারিয়েন্টের ১ পিসের দাম ভ্যারিয়েন্ট পাতায় আলাদা করে দিন।</p> : null)}<div className="check-row">{jsxList(PACK_PRESETS.map((n) => <label className="check"><input type="checkbox" name="pack" defaultValue={String(n)} defaultChecked={chosen.includes(n)} />{' '}<span>{bn(n)} পিস</span></label>))}</div>{ui.field('অন্য প্যাক (ঐচ্ছিক)', ui.input('pack_custom', custom.join(', '), { maxlength: 40, placeholder: 'যেমন: 10, 200' }), 'কমা দিয়ে আলাদা করে লিখুন। ২ থেকে ৯৯৯ পিস।')}<ul className="small muted"><li>উপরের <b>বিক্রির দাম</b> (ভ্যারিয়েন্ট থাকলে প্রতিটা ভ্যারিয়েন্টের দাম) হবে <b>১ পিসের দাম</b>। কাস্টমার ১০০ পিসের প্যাক নিলে দাম নিজে থেকে হিসাব হবে (১০০ × ১ পিসের দাম)।</li><li>স্টক পিস হিসেবে থাকে — ১০০ পিসের প্যাক বিক্রি হলে স্টক থেকে ১০০ কমবে।</li><li>একই প্যাক একাধিকবার নেওয়া যাবে (যেমন ২৫ পিসের ২টা = ৫০ পিস), তবে সবসময় সবচেয়ে ছোট প্যাকের গুণিতকে।</li></ul></>)}</section>;
}

/** What the product form shows: a saved product, a new one's starting values, or what the owner just sent (with an error). */
type DraftBundleLine = { product_id: number; name: string; sku?: string | null; price: number; stock: number; qty: number; image_id?: number | null; emoji?: string | null };
type ProductDraft = Record<string, unknown> & { id?: Id | null; name?: string; sku?: string | null; barcode?: string | null; warranty?: string | null; images?: number[];
  bundle?: DraftBundleLine[]; variants?: { variant_label: string }[]; variant_count?: number; vb_rows?: VbRow[]; vb_unit?: string; flash_price?: unknown; price?: unknown };
type FormExtras = Awaited<ReturnType<typeof formExtras>>;
type ProductFormProps = Partial<Omit<FormExtras, 'tiers' | 'links'>> & {
  product: ProductDraft | null; categories: catalog.Category[]; error?: string | null; seeCost: boolean; dup?: Awaited<ReturnType<typeof dupes.findDuplicates>> | null;
  canOverride: boolean; guardOn?: boolean; settings?: Settings; nextSku?: string; tiers?: { min_qty: unknown; price: unknown }[]; links?: Record<string, string[]>;
};
// 🎨 রং / সাইজ, right in the product form (owner, 2026-10-22): type the colours and the sizes, press "টেবিল তৈরি করুন"
// (client/admin/vbuilder.ts) → one row per colour × size with its own selling price, buying price, stock and photo.
// Saved with the product (catalog.saveVariants); the packs ticked above (25 / 50 / 100) go to every variant.
// The shop then shows: রং → সাইজ → প্যাক → অর্ডার.
export type VbRow = { id: number; brand?: string; color: string; size: string; price: string; cost: string; stock: string; img: string; on: boolean; del: boolean;
  /** 📐 optional measure (boxes): দৈর্ঘ্য, প্রস্থ, উচ্চতা — the unit is one for the whole product (vb_unit) */
  dl?: string; dw?: string; dh?: string; cur?: { cost: number; stock: number; barcode?: string } };
const VB_COLORS = ['সাদা', 'কালো', 'সিলভার', 'প্রাইভেসি', 'লাল', 'নীল', 'সবুজ', 'হলুদ', 'গোল্ডেন', 'ধূসর', 'গোলাপি', 'বাদামি', 'স্বচ্ছ'];
const VB_SIZES = ['Small', 'Medium', 'Large', 'XL', 'XXL', 'ছোট', 'মাঝারি', 'বড়'];
// 🏷️ brands (owner, 2026-10-22: boxes / poly come as Daraz, Cartup or non-brand); ones the owner types are remembered
// (setting vb_brands) and shown as buttons on every product after that
const VB_BRANDS = ['Daraz', 'Cartup', 'নন-ব্র্যান্ড'];
const vbClean = (v: unknown) => String(v ?? '').replace(/\//g, '-').replace(/\s+/g, ' ').trim().slice(0, 28);
/** "সাদা / Small" → [সাদা, Small]; one part → a colour when the option's name says রং, else a size */
function vbSplit(label: string, title: string): [string, string, string] {
  const parts = String(label || '').split('/').map((x) => x.trim()).filter(Boolean);
  const names = String(title || '').split('/').map((x) => x.trim());
  // the option names say which part is which ("ব্র্যান্ড / রং / সাইজ")
  if (names.length === parts.length && names.some((n) => /ব্র্যান্ড|brand/i.test(n))) {
    const out: [string, string, string] = ['', '', ''];
    names.forEach((n, i) => { const k = /ব্র্যান্ড|brand/i.test(n) ? 0 : /রং|রঙ|colou?r/i.test(n) ? 1 : 2; out[k] = out[k] ? `${out[k]} - ${parts[i]}` : parts[i]; });
    return out;
  }
  if (parts.length >= 2) return ['', parts[0], parts.slice(1).join(' - ')];
  return /রং|রঙ|colou?r/i.test(title || '') ? ['', parts[0] || '', ''] : ['', '', parts[0] || ''];
}
const VB_UNITS = ['সেমি', 'ইঞ্চি', 'মিমি'];
/** "30 × 20 × 10 সেমি" → [30, 20, 10, সেমি] (what the table shows back) */
function dimsParts(d: unknown): [string, string, string, string] {
  const m = String(d || '').match(/^\s*([\d.]*|-)\s*×\s*([\d.]*|-)\s*×\s*([\d.]*|-)\s*(\S*)\s*$/);
  if (!m) return ['', '', '', ''];
  const z = (x: string) => (x === '-' ? '' : x);
  return [z(m[1]), z(m[2]), z(m[3]), m[4] || ''];
}
const num = (v: unknown) => { const n = String(v ?? '').replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/[^\d.]/g, ''); return n.slice(0, 7); };
/** the three numbers + unit → the text saved on the variant ('' when nothing was given) */
export function dimsText(l: unknown, w: unknown, h: unknown, unit: unknown): string {
  const [a, b, c] = [num(l), num(w), num(h)];
  if (!a && !b && !c) return '';
  return `${a || '-'} × ${b || '-'} × ${c || '-'} ${VB_UNITS.includes(String(unit)) ? String(unit) : 'সেমি'}`;
}
function vbRowsFromVariants(variants: catalog.Product[], images: number[], title: string): VbRow[] {
  return variants.map((v) => {
    const [brand, color, size] = vbSplit(v.variant_label, title);
    const k = v.image_id ? images.indexOf(int(v.image_id)) : -1;
    const [dl, dw, dh] = dimsParts(v.dims);
    return { id: v.id, brand, color, size, price: String(v.price ?? ''), cost: '', stock: '', img: k >= 0 ? String(k + 1) : '', on: !!v.active, del: false, dl, dw, dh, cur: { cost: Number(v.cost_price) || 0, stock: Number(v.stock) || 0, barcode: v.barcode || '' } };
  });
}
export function vbRowsFromBody(b: Body): VbRow[] {
  const L = (k: string) => ([] as unknown[]).concat(b[k] === undefined ? [] : b[k]);
  const ids = L('vb_id'); const bs = L('vb_brand'); const cs = L('vb_color'); const ss = L('vb_size'); const pr = L('vb_price'); const co = L('vb_cost');
  const st = L('vb_stock'); const im = L('vb_img'); const on = L('vb_on'); const dl = L('vb_del'); const DL = L('vb_dl'); const DW = L('vb_dw'); const DH = L('vb_dh');
  return cs.map((c, i) => ({ id: int(ids[i]), brand: vbClean(bs[i]), color: vbClean(c), size: vbClean(ss[i]), price: str(pr[i], 20), cost: str(co[i], 20), stock: str(st[i], 10), img: str(im[i], 3), on: on[i] !== '0', del: dl[i] === '1' && int(ids[i]) > 0, dl: num(DL[i]), dw: num(DW[i]), dh: num(DH[i]) }))
    .filter((r) => r.brand || r.color || r.size).slice(0, catalog.MAX_VARIANTS);
}
function vbRow(r: VbRow | null, seeCost: boolean, nImg: number, tpl = false, unit = 'সেমি') {
  const x = r || { id: 0, brand: '', color: '', size: '', price: '', cost: '', stock: '', img: '', on: true, del: false };
  const old = !!x.id;
  return <tr data-vb-row="" data-b={x.brand || ''} data-c={x.color} data-s={x.size} className={x.on ? '' : 'row-off'} hidden={x.del} data-deleted={x.del ? '1' : undefined}>
    <td><input disabled={tpl} type="hidden" name="vb_del" defaultValue={x.del ? '1' : '0'} /><input disabled={tpl} type="hidden" name="vb_id" defaultValue={x.id ? String(x.id) : ''} /><input disabled={tpl} type="hidden" name="vb_brand" defaultValue={x.brand || ''} /><input disabled={tpl} type="hidden" name="vb_color" defaultValue={x.color} /><input disabled={tpl} type="hidden" name="vb_size" defaultValue={x.size} /><span className="vb-brand" data-vb-btext=""><Val v={x.brand || '—'} /></span>{(x.brand ? <>{' '}<button type="button" className="link-btn small" data-vb-rename="0" title="নাম বদলান" aria-label="ব্র্যান্ডের নাম বদলান">✏️</button></> : null)}</td><td><b data-vb-ctext=""><Val v={x.color || '—'} /></b>{(x.color ? <>{' '}<button type="button" className="link-btn small" data-vb-rename="1" title="নাম বদলান" aria-label="রঙের নাম বদলান">✏️</button></> : null)}{(x.cur && x.cur.barcode ? <><br /><span className="small muted mono" title="এই রং-সাইজের নিজের বারকোড"><Val v={x.cur.barcode} /></span></> : null)}</td>
    <td><span data-vb-stext=""><Val v={x.size || '—'} /></span>{(x.size ? <>{' '}<button type="button" className="link-btn small" data-vb-rename="2" title="নাম বদলান" aria-label="সাইজের নাম বদলান">✏️</button></> : null)}</td>
    <td><input disabled={tpl} name="vb_price" type="number" step="0.01" min="0" className="w-num" defaultValue={x.price} aria-label="বিক্রির দাম (১ পিস)" /></td>
    {(seeCost ? <td>{(old ? <><input disabled={tpl} type="hidden" name="vb_cost" defaultValue="" /><span className="small">{money(x.cur ? x.cur.cost : 0)}</span></> : <input disabled={tpl} name="vb_cost" type="number" step="0.01" min="0" className="w-num" defaultValue={x.cost} aria-label="কেনা দাম (১ পিস)" />)}</td> : null)}
    <td>{(old ? <><input disabled={tpl} type="hidden" name="vb_stock" defaultValue="" /><span className="small">{bn(x.cur ? x.cur.stock : 0)}</span></> : <input disabled={tpl} name="vb_stock" type="number" min="0" className="w-num" defaultValue={x.stock} aria-label="স্টক (পিস)" />)}</td>
    <td className="vb-dims"><input disabled={tpl} name="vb_dl" inputMode="decimal" className="w-dim" defaultValue={x.dl || ''} placeholder="দৈ" aria-label="দৈর্ঘ্য" />×<input disabled={tpl} name="vb_dw" inputMode="decimal" className="w-dim" defaultValue={x.dw || ''} placeholder="প্র" aria-label="প্রস্থ" />×<input disabled={tpl} name="vb_dh" inputMode="decimal" className="w-dim" defaultValue={x.dh || ''} placeholder="উ" aria-label="উচ্চতা" /> <span className="vb-unit-tag" data-vb-unit-tag="">{unit}</span></td>
    <td><select disabled={tpl} name="vb_img" defaultValue={x.img} aria-label="ছবি"><option value="">—</option>{jsxList(Array.from({ length: Math.max(8, nImg) }, (_, i) => <option value={String(i + 1)}>ছবি {bn(i + 1)}</option>))}</select></td>
    <td><select disabled={tpl} name="vb_on" defaultValue={x.on ? '1' : '0'} aria-label="দোকানে"><option value="1">চালু</option><option value="0">বন্ধ</option></select></td>
    <td><button type="button" className="btn btn-sm btn-ghost vb-del" data-vb-del="" title="মুছে ফেলুন" aria-label="এই রং/সাইজ মুছে ফেলুন">🗑️ মুছুন</button></td>
  </tr>;
}
function variantBuilder(p: ProductDraft, rows: VbRow[], seeCost: boolean, settings: Settings = {} as Settings) {
  const nImg = (p.images || []).length;
  const colors = [...new Set(rows.map((r) => r.color).filter(Boolean))].join(', ');
  const sizes = [...new Set(rows.map((r) => r.size).filter(Boolean))].join(', ');
  const brands = [...new Set(rows.map((r) => r.brand || '').filter(Boolean))].join(', ');
  const brandChips = [...new Set([...VB_BRANDS, ...db.jsonSetting<string[]>(settings, 'vb_brands', [])])].slice(0, 24);
  // the unit the owner chose (kept when the form comes back with a problem), else the one the saved measures use
  const unit = (p.vb_unit && VB_UNITS.includes(p.vb_unit) ? p.vb_unit : '') || (p.variants || []).map((v) => dimsParts((v as { dims?: string }).dims)[3]).find((u) => VB_UNITS.includes(u)) || 'সেমি';
  const chips = (kind: string, items: string[]) => <span className="vb-chips">{jsxList(items.map((t) => <button type="button" className="chip" data-vb-chip={kind} data-v={t}>+ {t}</button>))}</span>;
  return <section className="panel vb" data-vb="" id="variants"><h2>🎨 রং / সাইজ (ভ্যারিয়েন্ট)</h2><input type="hidden" name="vb_form" defaultValue="1" />
    <p className="small muted">একই পণ্য কয়েক রঙে বা সাইজে থাকলে (যেমন পলি: সাদা / সিলভার / প্রাইভেসি × Small / Medium / Large) — নিচে রং আর সাইজ লিখুন, তারপর <b>"📋 দামের টেবিল তৈরি করুন"</b> চাপুন। প্রতিটা রং-সাইজের আলাদা বিক্রির দাম, কেনা দাম, স্টক আর ছবি দিন। না লাগলে খালি রাখুন।</p>
    {ui.field('ব্র্যান্ড (ঐচ্ছিক, কমা দিয়ে আলাদা করে)', <><input name="vb_brands" defaultValue={brands} maxLength={300} placeholder="যেমন: Daraz, Cartup, নন-ব্র্যান্ড" data-vb-brands="" />{chips('brand', brandChips)}<span className="vb-own"><input data-vb-own="brand" maxLength={28} placeholder="নিজে লিখুন, যেমন: অন্য কোম্পানির নাম" aria-label="নিজে লিখুন" /><button type="button" className="btn btn-sm btn-ghost" data-vb-ownadd="brand">+ যোগ করুন</button></span></>)}
    {ui.field('রং (কমা দিয়ে আলাদা করে)', <><input name="vb_colors" defaultValue={colors} maxLength={300} placeholder="যেমন: সাদা, সিলভার, প্রাইভেসি" data-vb-colors="" />{chips('color', VB_COLORS)}<span className="vb-own"><input data-vb-own="color" maxLength={28} placeholder="নিজে লিখুন, যেমন: বাদামি ক্রাফট" aria-label="নিজে লিখুন" /><button type="button" className="btn btn-sm btn-ghost" data-vb-ownadd="color">+ যোগ করুন</button></span></>)}
    {ui.field('সাইজ / নম্বর (কমা দিয়ে আলাদা করে)', <><input name="vb_sizes" defaultValue={sizes} maxLength={300} placeholder="যেমন: Small, Medium, Large — বা বক্স: ১ নং, ২ নং, ৩ নং" data-vb-sizes="" />{chips('size', VB_SIZES)}<span className="vb-own"><input data-vb-own="size" maxLength={28} placeholder="নিজে লিখুন, যেমন: ৩ নং বক্স" aria-label="নিজে লিখুন" /><button type="button" className="btn btn-sm btn-ghost" data-vb-ownadd="size">+ যোগ করুন</button></span></>)}
    {ui.field('মাপের একক (মাপ দিলে) — ভুল হলে এখানে বদলে সেভ করুন, সব সাইজের মাপ নতুন এককে হয়ে যাবে', <select name="vb_unit" defaultValue={unit} data-vb-unit="">{jsxList(VB_UNITS.map((u) => <option value={u}>{u}</option>))}</select>, 'বক্সের মতো পণ্যে প্রতিটা সাইজের দৈর্ঘ্য × প্রস্থ × উচ্চতা টেবিলে দিন — কাস্টমার সাইজ বাছলে মাপটা দেখবে। না লাগলে খালি রাখুন।')}
    <p><button type="button" className="btn btn-sm" data-vb-make="">📋 দামের টেবিল তৈরি করুন</button>{' '}<span className="small muted">নাম ভুল হলে: টেবিলে নামের পাশের ✏️ চাপুন, অথবা উপরের তালিকায় শুধু নামটা ঠিক করে আবার এই বোতাম চাপুন — একই সারির নাম বদলাবে, স্টক-দাম-বিক্রি একই থাকবে। তারপর সেভ করুন।</span></p>
    <div className="table-wrap"><table className="table compact vb-table"><thead><tr><th>ব্র্যান্ড</th><th>রং</th><th>সাইজ</th><th>বিক্রির দাম ৳ (১ পিস)</th>{(seeCost ? <th>কেনা দাম ৳ (১ পিস)</th> : null)}<th>স্টক (পিস)</th><th>মাপ (দৈ × প্র × উ) <span className="small muted">ঐচ্ছিক</span></th><th>ছবি</th><th>দোকানে</th><th></th></tr></thead>
      <tbody data-vb-body="">{jsxList(rows.map((r) => vbRow(r, seeCost, nImg, false, unit)))}</tbody></table></div>
    {(rows.some((r) => r.id && !r.del) ? <p><a className="btn btn-sm btn-ghost" href={`/admin/products/labels?ids=${rows.filter((r) => r.id && !r.del).map((r) => r.id).join(',')}`} target="_blank" rel="noopener">🏷️ সব রং/সাইজের বারকোড লেবেল প্রিন্ট</a>{' '}<span className="small muted">প্রতিটা রং-সাইজের প্যাকেটে তার নিজের লেবেল লাগান — প্যাক করা আর কুরিয়ারে দেওয়ার সময় স্ক্যান করলে ঠিক সেটাই মেলে।</span></p> : null)}<p className="small muted" data-vb-empty="" hidden={rows.some((r) => !r.del)}>এখনো কোনো রং/সাইজ নেই।</p><p className="note small" data-vb-renamed="" hidden>✏️ নাম বদলানো হয়েছে — "পরিবর্তন সেভ করুন" চাপলে দোকানেও নতুন নাম দেখাবে। স্টক, দাম আর বিক্রির হিসাব একই থাকবে।</p><p className="note small" data-vb-delnote="" hidden>🗑️ মুছে ফেলা রং/সাইজ "সেভ" চাপলে রিসাইকেল বিনে যাবে।</p>
    <table hidden data-vb-template=""><tbody>{vbRow(null, seeCost, nImg, true, unit)}</tbody></table>
    <ul className="small muted"><li><b>ছবি:</b> উপরে পণ্যের ছবিগুলো তুলুন (ছবি ১, ২, ৩…), তারপর প্রতিটা রঙের সারিতে তার ছবির নম্বর বাছুন — একই রঙের বাকি সারিতে নিজে থেকে বসে যাবে। কাস্টমার রং বাছলে বড় ছবিটা বদলে যাবে।</li>
      <li><b>প্যাক:</b> উপরের "📦 প্যাক / বান্ডেল" অংশে ২৫ / ৫০ / ১০০ টিক দিলে সব রং-সাইজে চলবে — দাম হবে প্যাকের পিস × সেই রং-সাইজের ১ পিসের দাম।</li>
      <li>পুরোনো রং/সাইজের স্টক আর কেনা দাম এখানে বদলায় না (স্টক বাড়ে পারচেজে)। তালিকা থেকে রং/সাইজ বাদ দিলে সেটা "বন্ধ" হয়; একদম সরাতে সারির পাশের <b>🗑️ মুছুন</b> চাপুন, তারপর সেভ (মুছে ফেলাগুলো রিসাইকেল বিনে যায়, দরকারে ফেরানো যায়)। SKU/বারকোড দেখতে: {(p.id ? <a href={`/admin/products/${attrValue(p.id)}/variants`}>ভ্যারিয়েন্টের বিস্তারিত পাতা</a> : 'সেভ করার পর ভ্যারিয়েন্ট পাতায়')}।</li></ul>
  </section>;
}

// 📦 প্যাকিং খরচ (owner only): which packing set this product is sent in, and its real profit per piece.
function packingPanel(p: ProductDraft, packing: NonNullable<FormExtras['packing']>) {
  const own = int(p.packing_set_id);
  const set = own ? packing.sets.find((x) => x.id === own) : null;
  const cost = set ? set.cost : packing.now ? packing.now.cost : 0;
  const price = Number(p.price) || 0, buy = Number(p.cost_price) || 0;
  return <section className="panel"><h2>📦 প্যাকিং খরচ{' '}<small>শুধু আপনি দেখবেন</small></h2><input type="hidden" name="packing_form" defaultValue="1" />
    {ui.field('কোন প্যাকিং সেটে যায়', ui.select('packing_set_id', [['', packing.now && !own ? `ক্যাটাগরি অনুযায়ী — ${packing.now.setName} (${money(packing.now.cost)})` : 'ক্যাটাগরি অনুযায়ী'], ...packing.sets.map((x) => [x.id, `${x.name} — ${money(x.cost)}${x.per === 'line' ? ' (পণ্যে একবার)' : ' / পিস'}`])], own || ''),
      <>বক্স, টেপ, স্টিকার — সেট বানানো আর দাম বদলানো: <a href="/admin/accounts/packing">প্যাকিং খরচ</a>। অর্ডার কুরিয়ারে দিলে নিজে থেকে খরচ হিসেবে লেখা হয়।</>)}
    {(price && buy ? <p className="small">১ পিসে: বিক্রি {money(price)} − কেনা {money(buy)} − প্যাকিং {money(cost)} = <b className={price - buy - cost > 0 ? 'good' : 'warn'}>আসল লাভ {money(price - buy - cost)}</b>{(!cost ? <span className="muted"> (প্যাকিং সেট দেওয়া নেই)</span> : null)}</p> : null)}
  </section>;
}

function productForm({ product, categories, error, seeCost, dup, canOverride, guardOn = true, settings = {} as Settings, nextSku = '', brands = [], locations = [], suppliers = [], prices = [], canDelete = true, tiers = [], links = { related: [], cross: [], upsell: [] }, canStock = false, ledger = null, packing = null }: ProductFormProps) {
  const p: ProductDraft = product || { active: true, stock: 10, emoji: '📦', images: [], bundle: [], product_type: 'single', low_stock: 3, unit: 'পিস' };
  const isNew = !p.id;
  const bundle = p.product_type === 'bundle';
  return <><p className="crumbs"><a href={`/admin/products${bundle ? '?type=bundle' : ''}`}>← সব{' '}{(bundle ? "বান্ডেল" : "পণ্য")}</a></p><div className="title-row"><h1>{(isNew ? (bundle ? "নতুন বান্ডেল / প্যাকেজ" : "নতুন পণ্য আপলোড") : <Val v={p.name} />)}</h1>{(isNew ? (bundle ? null : <div className="row-actions"><a className="btn btn-ghost btn-sm" href="/admin/products/import">📥 অনেক পণ্য একসাথে আমদানি করুন</a></div>) : <div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/p/${attrValue(p.slug)}`} target="_blank" rel="noopener">দোকানে দেখুন ↗</a><form method="post" action={`/admin/products/${attrValue(p.id)}/duplicate`}><button className="btn btn-ghost btn-sm">কপি করুন</button></form></div>)}</div>{(error ? <p className="flash flash-error"><Val v={error} /></p> : null)}<form method="post" action={isNew ? '/admin/products/new' : `/admin/products/${p.id}`} className="form product-form" data-product-form=""><input type="hidden" name="product_type" defaultValue={bundle ? 'bundle' : 'single'} />{' '}{(guardOn ? dupPanel({ dup, canOverride, allow: !!p.allow_duplicate, id: p.id }) : null)}<div className="two-col"><div><section className="panel"><h2>মূল তথ্য</h2>{ui.field('পণ্যের নাম', ui.input('name', p.name || '', { required: true, maxlength: 140, placeholder: 'যেমন: PAM8403 Mini Amplifier Board' }))}{ui.field('🇧🇩 বাংলা নাম', ui.input('name_bn', String(p.name_bn ?? '') || bnTitle(String(p.name || '')), { maxlength: 200, placeholder: 'ইংরেজি নাম লিখলে নিজে থেকে বসবে', 'data-bn-name': true, 'data-auto': p.name_bn_auto === false ? '' : '1' }), 'ইংরেজি নাম লিখলে বা বদলালে নিজে থেকে বাংলায় বসে। চাইলে নিজে বদলে দিন — তখন আপনারটাই থাকবে। দোকানে ইংরেজি নামের নিচে দেখায়।')}<div className="field-row">{(isNew ? ui.field('SKU (পণ্যের কোড)', ui.input('sku', p.sku || '', { maxlength: 60, placeholder: `নিজে থেকে বসবে: ${bn(nextSku || '')}`.trim() }),
      <>খালি রাখুন — সেভ করলে <b>নিজে থেকে পরের নম্বর</b> ({bn(nextSku || '১')}) বসে যাবে: ১, ২, ৩… এভাবে। চাইলে নিজের কোডও লিখতে পারেন।</>) : ui.field('SKU (পণ্যের কোড)', ui.input('sku', p.sku || '', { maxlength: 60 }), 'অর্ডার আর ইনভয়েসে দেখাবে। খালি করে সেভ দিলে আগের SKU-ই থাকবে।'))}{' '}{ui.field('ক্যাটাগরি', ui.select('category_id', [['', 'কোনোটি না'], ...ui.catOpts(categories)], p.category_id || ''))}</div><div className="field-row">{ui.field('ব্র্যান্ড (ঐচ্ছিক)', ui.input('brand', p.brand || '', { maxlength: 60, list: 'brand-list', autocomplete: 'off', placeholder: 'লিখুন বা তালিকা থেকে বাছুন' }), <>নতুন নাম লিখলে নিজে থেকে নতুন ব্র্যান্ড তৈরি হবে। <a href="/admin/brands" target="_blank" rel="noopener">সব ব্র্যান্ড</a></>)}{' '}<datalist id="brand-list">{jsxList(brands.map((b: { name: unknown; }) => <option value={attrValue(b.name)}></option>))}</datalist>{' '}{ui.field('মডেল / পার্ট নম্বর (ঐচ্ছিক)', ui.input('model', p.model || '', { maxlength: 80, placeholder: 'যেমন: PAM8403, LM7805, DS18B20' }), 'কোম্পানির দেওয়া কোড। সার্চে আর Google-এ কাজে লাগে।')}</div><div className="field-row warranty-row" data-warranty="">{ui.field('🛡️ ওয়ারেন্টি', ui.select('warranty', [['', 'ওয়ারেন্টি নেই'], ...Object.entries(catalog.WARRANTY), ['custom', '✍️ নিজে লিখুন…']], String(p.warranty || '').startsWith('c:') ? 'custom' : (p.warranty || ''), { 'data-warranty-sel': true }), 'পণ্যের পেজে আর ইনভয়েসে দেখাবে।')}{' '}{ui.field('ওয়ারেন্টির ধরন', ui.select('warranty_type', [['', '— উল্লেখ নেই —'], ...Object.entries(catalog.WARRANTY_TYPES)], p.warranty_type || ''), 'রিপ্লেসমেন্ট = বদলে দেবেন · সার্ভিস = মেরামত করে দেবেন')}{' '}<span data-warranty-custom="" hidden={!(String(p.warranty || '').startsWith('c:'))}>{ui.field('নিজের মতো লিখুন', ui.input('warranty_custom', String(p.warranty || '').startsWith('c:') ? p.warranty!.slice(2) : '', { maxlength: 60, placeholder: 'যেমন: ১০ বছর মোটর ওয়ারেন্টি' }))}</span></div><div className="field-row barcode-row">{ui.field('🔢 বারকোড', ui.input('barcode', p.barcode || '', { maxlength: 40, placeholder: isNew ? 'খালি রাখুন — নিজে থেকে বসবে (SB…)' : '', class: 'mono', autocomplete: 'off' }),
    'প্রতিটা পণ্যের নিজস্ব। খালি রাখলে দোকানের নিজের কোড বসে (যেমন SB000123)। পণ্যের প্যাকেটে কোম্পানির বারকোড থাকলে সেটা স্ক্যান করে/লিখে দিতে পারেন।')}{' '}{(!isNew && p.barcode ? <div className="bc-preview"><RawHtml html={$services_barcode.svg(p.barcode, { height: 46, module: 2, fontSize: 13 })} />{' '}<a className="btn btn-sm btn-ghost" href={`/admin/products/labels?ids=${attrValue(p.id)}`} target="_blank">🏷️ লেবেল প্রিন্ট</a></div> : null)}</div><div className="field-row">{ui.field('একক', ui.select('unit', [['পিস', 'পিস'], ['সেট', 'সেট'], ['প্যাক', 'প্যাক'], ['কেজি', 'কেজি'], ['গ্রাম', 'গ্রাম'], ['মিটার', 'মিটার'], ['জোড়া', 'জোড়া'], ['লিটার', 'লিটার']], p.unit || 'পিস'))}{' '}{ui.field('📍 কোথায় রাখা', ui.input('location', p.location || '', { maxlength: 40, placeholder: 'যেমন: বক্স ৩', list: 'loc-list', autocomplete: 'off' }), 'কোন বক্স/তাকে আছে। শুধু অ্যাডমিনে দেখায় — প্যাক করার সময় খুঁজে পেতে।')}{' '}<datalist id="loc-list">{jsxList(locations.map((x: { location: unknown; }) => <option value={attrValue(x.location)}></option>))}</datalist></div></section><section className="panel"><h2>দাম ও স্টক</h2>{(Number(p.variant_count) > 0 ? <p className="note small">এই পণ্যে ভ্যারিয়েন্ট আছে — দোকানে দাম দেখাবে সবচেয়ে কম দামের ভ্যারিয়েন্টের, আর স্টক = সব ভ্যারিয়েন্টের যোগফল ({bn(p.stock)}টি)। দাম/স্টক বদলাতে "ভ্যারিয়েন্ট এডিট" এ যান।</p> : null)}<div className="field-row">{ui.field('বিক্রির দাম (৳)', ui.input('price', p.price ?? '', { type: 'number', min: 0.5, max: 2000, required: true, 'data-price': true }), '৳০.৫০ থেকে ৳২০০০ পর্যন্ত। ৳১০-এর নিচে পয়সা থাকে (০.২৫, ১.৭৫); ৳১০ বা বেশি হলে পয়সা পরের টাকায় উঠে যায় (১০.০৪ → ১১)।')}{' '}{ui.field('আগের দাম (৳, ঐচ্ছিক)', ui.input('old_price', p.old_price ?? '', { type: 'number', min: 0 }), 'দিলে "% ছাড়" ব্যাজ দেখাবে')}{' '}{(!seeCost ? null : (isNew || bundle ? ui.field(isNew && !bundle ? 'কেনা দাম (৳, প্রতি পিস)' : 'কেনা দাম (৳)', ui.input('cost_price', p.cost_price ?? '', { type: 'number', min: 0, step: '0.01', 'data-cost': true }),
    isNew && !bundle ? 'শুধু আপনি দেখবেন। শুরুর স্টক এই দামে কেনা হিসেবে আজকের তারিখে খাতায় উঠবে।' : 'শুধু আপনি দেখবেন। লাভ হিসাবের জন্য') : <div className="field"><span className="label">কেনা দাম (গড়, প্রতি পিস)</span><b className="ro-value">{(Number(p.cost_price) > 0 ? money(p.cost_price) : <span className="warn">দেওয়া নেই</span>)}</b>{' '}<input type="hidden" defaultValue={attrValue(p.cost_price ?? '')} data-cost="" />{' '}<small>পারচেজ এন্ট্রি দিলে নিজে থেকে বদলায়।{' '}<a href={`/admin/products/${attrValue(p.id)}/ledger`}>📒 কেনার ইতিহাস / ভুল হলে ঠিক করুন →</a></small></div>))}</div>{(seeCost ? <p className="margin-box" data-margin=""></p> : null)}<p className="small-rule-hint" data-small-rule={attrValue(JSON.stringify({ on: settings.small_qty_on !== '0', cap: Number(settings.small_max_price) || 5, minVal: Number(settings.small_min_value) || 10, maxVal: Number(settings.small_max_value) || 100, maxQty: Number(settings.max_qty_per_item) || 10 }))} hidden></p>{(bundle ? <p className="muted small">বান্ডেলের নিজের স্টক নেই — ভেতরের পণ্যগুলোর স্টক থেকে হিসাব হয়।</p> : <><div className="field-row">{(Number(p.variant_count) > 0 ? null : (isNew ? ui.field('শুরুর স্টক (এখন হাতে কয়টি আছে)', ui.input('stock', p.stock ?? 0, { type: 'number', min: 0, required: true }), 'পরে স্টক বাড়বে পারচেজ দিয়ে, কমবে অর্ডার দিয়ে।') : <div className="field"><span className="label">স্টক (কয়টি আছে)</span><b className={`ro-value ${Number(p.own_stock ?? p.stock) <= Number(p.low_stock) ? 'warn' : ''}`}>{bn(p.own_stock ?? p.stock ?? 0)}টি</b>{' '}{(Number(p.own_stock ?? p.stock ?? 0) < 0 ? <small><b className="warn">⏳{' '}{bn(-Number(p.own_stock ?? p.stock))}টি প্রি-অর্ডারে বাকি</b>{' '}— মাল কিনে পারচেজ দিলে নিজে থেকে মিটে যাবে।</small> : null)}{' '}{(canStock ? <small className="stock-acts"><a className="btn btn-sm" href={`/admin/purchases/new?add=${attrValue(p.id)}`}>➕ মাল কিনেছি</a>{' '}<a className="btn btn-sm btn-ghost" href={`/admin/inventory?q=${attrValue(encodeURIComponent(p.sku || p.name || ''))}`}>🔧 স্টক ঠিক করুন</a></small> : <small>স্টক বদলায় পারচেজ, অর্ডার আর ইনভেন্টরির এন্ট্রি দিয়ে।</small>)}</div>))}{' '}{ui.field('স্টক এর কম হলে সতর্ক করুন', ui.input('low_stock', p.low_stock ?? 3, { type: 'number', min: 0 }))}{' '}{ui.field('ওজন (গ্রাম, কুরিয়ারের জন্য)', ui.input('weight_g', p.weight_g || '', { type: 'number', min: 0 }))}</div><input type="hidden" name="preorder_form" defaultValue="1" />{' '}{ui.switchRow('preorder', !!p.preorder, '⏳ প্রি-অর্ডার নিন (স্টক শেষ হলেও)', 'চালু থাকলে স্টক শেষ হলেও কাস্টমার অর্ডার করতে পারবেন — পণ্যের পেজে "প্রি-অর্ডার" লেখা থাকবে। অর্ডারে কয়টা পরে পাঠাতে হবে লেখা থাকে; মাল কিনে পারচেজ এন্ট্রি দিলে আগে প্রি-অর্ডারগুলো মেটে।')}{' '}{ui.field('মাল আসতে আনুমানিক কত দিন (কাস্টমারকে দেখাবে)', ui.input('preorder_days', p.preorder_days || '', { type: 'number', min: 0, max: 180, placeholder: 'যেমন 7' }))}{' '}{(p.damaged_stock ? <p className="small warn">নষ্ট/ভাঙা স্টক আলাদা রাখা আছে:{' '}<b>{bn(p.damaged_stock)}টি</b>{' '}(বিক্রি হবে না) —{' '}<a href={`/admin/inventory?q=${attrValue(encodeURIComponent(p.sku || p.name || ''))}`}>ইনভেন্টরিতে দেখুন</a></p> : null)}</>)}{' '}{(suppliers.length ? ui.field('যে সাপ্লায়ার থেকে সাধারণত কেনা হয় (ঐচ্ছিক)', ui.select('supplier_id', [['', '— বাছাই করা নেই —'], ...suppliers.map((x) => [x.id, x.name + (x.company ? ` (${x.company})` : '')])], p.supplier_id || ''),
    'শুধু অ্যাডমিনে দেখা যায়, কাস্টমার কখনো দেখবে না। পারচেজের সময় কাজে লাগে।') : null)}</section>{(bundle ? <section className="panel" data-bundle=""><h2>বান্ডেলে কী কী থাকবে</h2><div className="item-picker"><input type="search" placeholder="পণ্য খুঁজে যোগ করুন…" data-bundle-search="" autoComplete="off" /><ul className="picker-results" data-bundle-results="" hidden></ul></div><div className="table-wrap"><table className="table item-rows bundle-rows"><thead><tr><th>ছবি</th><th>পণ্য</th><th className="num">একক দাম</th><th className="num">পরিমাণ (কমান / বাড়ান)</th><th className="num">মোট</th><th className="num">স্টক</th><th>কাজ</th></tr></thead><tbody data-bundle-rows="">{jsxList((p.bundle || []).map((b) => <tr data-row="" data-price={attrValue(b.price)}><td className="b-img">{(b.image_id ? <img src={`/media/${attrValue(b.image_id)}/t`} alt="" loading="lazy" /> : <span className="pe"><Val v={b.emoji || '📦'} /></span>)}</td><td className="b-name"><b><Val v={b.name} /></b>{(b.sku ? <><br /><span className="small muted">SKU{' '}<Val v={b.sku} /></span></> : null)}<input type="hidden" name="bundle_id[]" defaultValue={attrValue(b.product_id)} /></td><td className="num">{money(b.price)}</td><td className="num"><span className="qty-step"><button type="button" className="qs-btn" data-bq="-1" aria-label="কমান">−</button><input type="number" name="bundle_qty[]" defaultValue={attrValue(b.qty)} min="1" className="w-num" data-qty="" /><button type="button" className="qs-btn" data-bq="1" aria-label="বাড়ান">+</button></span></td><td className="num" data-line="">{money(b.price * b.qty)}</td><td className="num">{bn(b.stock)}</td><td className="b-act"><a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(b.product_id)}`} target="_blank" rel="noopener" title="এই পণ্যটি এডিট করুন (নতুন ট্যাবে)">✏️ এডিট</a><button type="button" className="btn btn-sm btn-danger" data-remove-row="" title="বান্ডেল থেকে সরান">🗑️ মুছুন</button></td></tr>))}</tbody></table></div><p className="muted small" data-bundle-empty="" hidden={!!((p.bundle || []).length)}>এখনো কোনো পণ্য যোগ হয়নি — উপরে খুঁজে যোগ করুন।</p><p className="muted small" data-bundle-sum=""></p></section> : null)}<section className="panel"><h2>বিবরণ</h2>{ui.field('ছোট বিবরণ (Short description)', ui.textarea('short_description', p.short_description || '', { rows: 3, maxlength: 1000 }), 'পণ্যের পেজে দামের ঠিক নিচে "📝 সংক্ষেপে" বক্সে দেখাবে। ২-৪ লাইনে মূল কথা।')}{' '}{ui.field('বিস্তারিত বিবরণ (Long description)', ui.textarea('description', p.description || '', { rows: 10, maxlength: 20000 }),
    <>পেজের নিচে "📋 পণ্যের বিস্তারিত বিবরণ" অংশে দেখাবে। নতুন লাইন = নতুন প্যারাগ্রাফ। <b>## শিরোনাম</b> লিখলে বড় হেডিং, <b>- </b> দিয়ে শুরু করলে বুলেট পয়েন্ট, <b>**মোটা লেখা**</b>।</>)}</section>{(bundle ? null : packBox(p))}{' '}{(p.product_type === 'bundle' ? null : extrasBox(p, tiers, links, settings))}<section className="panel"><h2>SEO (গুগলে কেমন দেখাবে)</h2>{(isNew ? null : ui.field('পণ্যের লিংক (URL)', <span className="slug-field"><span className="muted">/p/</span>{ui.input('slug', p.slug || '', { maxlength: 80, pattern: '[^/?#]+', spellcheck: 'false' })}</span>,
    'ইংরেজি ছোট হাতের অক্ষর আর - দিয়ে লিখুন (যেমন pam8403-amplifier-board)। বদলালে পুরোনো লিংক থেকেও নতুন লিংকে নিয়ে যাবে — Google বা ফেসবুকে শেয়ার করা লিংক নষ্ট হবে না।'))}{' '}{ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120, placeholder: 'খালি রাখলে পণ্যের নাম' }))}{' '}{ui.field('SEO কিওয়ার্ড', ui.input('seo_keywords', p.seo_keywords || '', { maxlength: 300, placeholder: 'যেমন: amplifier board price in bd, PAM8403, অ্যামপ্লিফায়ার' }), 'কমা (,) দিয়ে আলাদা করে লিখুন। মানুষ গুগলে যে শব্দ লিখে খোঁজে সেগুলো দিন — বাংলা ও ইংরেজি দুটোই দিতে পারেন।')}{' '}{ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'খালি রাখলে ছোট বিবরণ' }))}{' '}{ui.check('noindex', !!p.noindex, 'গুগল সার্চে এই পণ্যের পেজ দেখাবে না (noindex) — দোকানে আর ফিডে ঠিকই থাকবে')}</section></div><div><section className="panel"><h2>ছবি{' '}<small>সর্বোচ্চ{' '}{bn(MAX_IMAGES)}টি</small></h2><div className="slots" data-slots=""><Val v={Array.from({ length: MAX_IMAGES }, (_, i) => imageSlot(i, (p.images || [])[i]))} /></div><input type="hidden" name="images" defaultValue={attrValue((p.images || []).slice(0, MAX_IMAGES).join(','))} data-slots-value="" />{' '}{((p.images || []).length > MAX_IMAGES ? <p className="warn small">এই পণ্যে আগে{' '}{bn(p.images!.length)}টি ছবি ছিল। এখন সর্বোচ্চ{' '}{bn(MAX_IMAGES)}টি রাখা যায়, তাই সেভ করলে শেষের{' '}{bn(p.images!.length - MAX_IMAGES)}টি বাদ যাবে।</p> : null)}<p className="muted small">প্রতিটা ঘরের{' '}<b>＋</b>{' '}চাপ দিয়ে সেই ঘরে ছবি দিন।{' '}<b>১ নম্বর ঘরের ছবিটাই মূল ছবি</b>{' '}— দোকানে প্রথমে এটাই দেখাবে, তারপর ২, ৩… এভাবে। ◀ ▶ দিয়ে ছবি আগে-পরে সরান, ✕ দিয়ে মুছুন। মোবাইলের বড় ছবি দিলেও নিজে থেকে ছোট হয়ে যাবে।</p>{ui.field('ছবি না থাকলে এই ইমোজি দেখাবে', ui.input('emoji', p.emoji || '📦', { maxlength: 8, class: 'w-emoji' }))}</section><section className="panel"><h2>ভিডিও (YouTube)</h2>{ui.field('YouTube লিংক', ui.input('youtube_url', p.youtube_url || '', { maxlength: 1500, placeholder: 'https://www.youtube.com/watch?v=...', 'data-yt': true }), 'YouTube এর যেকোনো লিংক দিন — সাধারণ ভিডিও, Shorts, youtu.be, বা মোবাইল থেকে "Share" করা লিংক। নিচে ভিডিওর ছবি দেখা গেলে বুঝবেন লিংক ঠিক আছে। পণ্যের পেজে ছবির নিচে "ভিডিও দেখুন" বাটন আসবে।')}<div className="yt-preview" data-yt-preview="">{(youtubeId(p.youtube_url) ? <img src={`https://i.ytimg.com/vi/${attrValue(youtubeId(p.youtube_url))}/hqdefault.jpg`} alt="" /> : null)}</div></section><section className="panel"><h2>দেখানো</h2>{ui.check('active', p.active, 'দোকানে দেখাও')}{' '}{ui.check('featured', p.featured, 'হোমপেজের "জনপ্রিয় পণ্য"-তে দেখাও')}{' '}{ui.check('is_new', p.is_new, '"নতুন" ট্যাগ দেখাও')}<p className="small muted">নতুন তোলা পণ্যে{' '}{(Number(settings.new_badge_days) > 0 ? `${bn(settings.new_badge_days)} দিন` : "কোনো দিন না")}{' '}পর্যন্ত এমনিতেই "নতুন" ট্যাগ থাকে (<a href="/admin/settings#new-badge">বদলান</a>)। এখানে টিক দিলে সবসময় থাকবে।</p></section>{(ledger && !bundle && !(Number(p.variant_count) > 0) ? ledgerBox(p, ledger) : null)}{' '}{(!isNew && prices.length ? <section className="panel"><h2>দামের ইতিহাস</h2><ul className="timeline">{jsxList(prices.map((h) => <li>{(h.action === 'cost_change' ? "🔒 " : null)}<Val v={h.detail.replace(/^[^:]*:\s*/, '')} /><br /><span className="small muted">{fmtDate(h.created_at)}{' '}·{' '}<Val v={h.staff_name || 'সিস্টেম'} /></span></li>))}</ul>{(seeCost ? <p className="small muted">🔒 = কেনা দাম, শুধু আপনি দেখছেন।{' '}<a href="/admin/security/audit?action=price_change">সব দাম বদল →</a></p> : null)}</section> : null)}</div></div>{(bundle ? null : variantBuilder(p, p.vb_rows || [], seeCost, settings))}{(packing && !bundle ? packingPanel(p, packing) : null)}<div className="form-actions sticky-actions"><button className="btn btn-lg" data-save="">{(isNew ? (bundle ? "বান্ডেল যোগ করুন" : "পণ্য যোগ করুন") : "পরিবর্তন সেভ করুন")}</button></div></form>{(isNew || !canDelete ? null : <form method="post" action={`/admin/products/${attrValue(p.id)}/delete`} className="danger-zone" data-confirm="এই পণ্যটি মুছবেন? দোকান থেকে সাথে সাথে সরে যাবে, তবে রিসাইকেল বিনে থাকবে — মালিক চাইলে ফেরত আনতে পারবেন। শুধু লুকাতে চাইলে 'দোকানে দেখাও' টিক তুলে দিন।"><button className="btn btn-danger btn-sm">পণ্যটি মুছে ফেলুন</button></form>)}</>;
}

type ProductBody = Body & { bundle: { product_id: unknown; qty: unknown }[] };
function bodyToProduct(b: Body): ProductBody {
  const ids = list(b.bundle_id);
  const qtys = list(b.bundle_qty);
  return { ...b, bundle: ids.map((id, i) => ({ product_id: id, qty: qtys[i] })) };
}

async function formExtras(ctx: AdminCtx, id?: Id) {
  const finance = $models_finance;
  const [brands, suppliers, prices, locations] = await Promise.all([
    catalog.listBrands(), finance.listSuppliers({ includeInactive: false }).catch(() => []),
    id ? catalog.priceHistory(id as number, { withCost: ctx.can('see_cost'), limit: 15 }) : [],
    catalog.listLocations().catch(() => []),
  ]);
  const [tiers, links]: [{ min_qty: unknown; price: unknown }[], Record<string, string[]>] = id ? await Promise.all([db.q<Pick<PriceTiersRow, 'min_qty' | 'price'>>('SELECT min_qty, price FROM price_tiers WHERE product_id=$1 ORDER BY min_qty', [id]), catalog.linkedSkus(id)])
    : [[], { related: [], cross: [], upsell: [] }];
  // 📒 sales & profit of this product (owner only) — worked out from its orders, never typed
  const ledger = id && ctx.can('see_cost') ? await catalog.productLedger(id, { limit: 5 }).catch(() => null) : null;
  // 📦 packing sets and what this product's set costs (owner only — costs)
  const packing = ctx.can('see_cost') ? await (async () => {
    const [sets, map] = await Promise.all([$packing.listSets(), $packing.itemMap()]);
    return { sets: sets.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, per: x.per, cost: $packing.setCost(x, map) })), now: id ? await $packing.costForProduct(id as number) : null };
  })().catch(() => null) : null;
  return { brands, locations, suppliers: suppliers.filter((x) => x.active !== false), prices, canDelete: ctx.can('products_delete'), tiers, links,
    canStock: ctx.can('inventory'), ledger, packing };
}
// "১০টি বা বেশি নিলে ৳x করে" rows + linked products (related / goes with / better option), saved after the product.
async function saveExtras(pid: number, b: Body, settings: Settings): Promise<string[]> {
  const price = Number((await db.one<{ price: number }>('SELECT price FROM products WHERE id=$1', [pid]))!.price);
  const qs = list(b.tier_qty); const ps = list(b.tier_price);
  const tiers = new Map<number, number>();
  const problems: string[] = [];
  for (let i = 0; i < qs.length; i++) {
    const n = int(qs[i]); const pr = shopPrice(amount(ps[i]));
    if (!n && !ps[i]) continue;
    if (n < 2 || !(pr >= PRICE_MIN) || pr >= price) { problems.push(`${bn(n || 0)}টি — দাম ৳০.৫০ বা বেশি আর আসল দাম ${money(price)} এর কম হতে হবে, পরিমাণ কমপক্ষে ২`); continue; }
    tiers.set(n, pr);
  }
  const maxQ = qtyRule(settings, price).max;
  const unreachable = [...tiers.keys()].filter((n) => n > maxQ);
  if (unreachable.length) problems.push(`${unreachable.map((n) => bn(n)).join(', ')}টির ধাপ সেভ হয়েছে, কিন্তু অনলাইনে এই পণ্য একবারে সর্বোচ্চ ${bn(maxQ)}টি অর্ডার করা যায় — তাই কাস্টমার এই দাম পাবে না (দোকানে দেখাবেও না)। চাইলে সেটিংসে "একসাথে সর্বোচ্চ" সংখ্যা বাড়ান`);
  const missing: string[] = [];
  await db.tx(async (t) => {
    await t.query('DELETE FROM price_tiers WHERE product_id=$1', [pid]);
    for (const [n, pr] of [...tiers.entries()].slice(0, 6)) await t.query('INSERT INTO price_tiers(product_id, min_qty, price) VALUES($1,$2,$3)', [pid, n, pr]);
    for (const k of ['related', 'cross', 'upsell']) {
      if (b[`${k}_skus`] !== undefined) missing.push(...await catalog.setLinks(t, pid, k, b[`${k}_skus`]));
    }
  });
  if (missing.length) problems.push(`এই SKU পাওয়া যায়নি: ${missing.join(', ')}`);
  return problems;
}
function extrasBox(p: ProductDraft, tiers: { min_qty: unknown; price: unknown }[], links: Record<string, string[]>, settings: Settings) {
  const rows = (tiers || []).slice(0, 6);
  const blank = Math.max(1, 3 - rows.length);
  const row = (t: { min_qty?: unknown; price?: unknown }) => <div className="field-row tier-row">{ui.field('কমপক্ষে কয়টা নিলে', ui.input('tier_qty[]', t.min_qty || '', { type: 'number', min: 2, class: 'w-num', placeholder: 'যেমন 10' }))}{' '}{ui.field('প্রতি পিস দাম (৳)', ui.input('tier_price[]', t.price ?? '', { type: 'number', min: 0.01, step: '0.01', class: 'w-num', placeholder: 'যেমন 4.5' }))}</div>;
  return <><section className="panel"><h2>📦 বেশি কিনলে কম দাম{' '}<small>পাইকারি দাম</small></h2>{(p.flash_price ? <p className="flash">⚡ এই পণ্যে এখন ফ্ল্যাশ সেল চলছে — দোকানে দাম{' '}{money(p.flash_price)}।{' '}<a href="/admin/marketing/flash">ফ্ল্যাশ সেল দেখুন →</a></p> : null)}<p className="muted small">যেমন "১০টি বা বেশি নিলে ৳৪.৫০ করে", "৫০টি বা বেশি নিলে ৳৪ করে"। কাস্টমার কার্টে পরিমাণ বাড়ালে কম দাম নিজে থেকে বসবে, আর পণ্যের পেজে একটা ছোট টেবিল দেখাবে। খালি রাখলে কিছু হবে না। ফ্ল্যাশ সেলের সাথে মিলিয়ে দুইবার ছাড় হয় না — যেটা কম সেটাই বসে।</p>{(Number(p.price) > 0 ? <p className="small warn">মনে রাখবেন: অনলাইনে এই পণ্য একবারে সর্বোচ্চ{' '}{bn(qtyRule(settings, p.price).max)}টি অর্ডার করা যায় (সেটিংস থেকে বদলানো যায়) — তার বেশির ধাপ কাস্টমার পাবে না।</p> : null)}<div data-repeat="tiers"><Val v={rows.map(row)} /><Val v={Array.from({ length: blank }, () => row({}))} /></div><button type="button" className="btn btn-sm btn-ghost" data-repeat-add="tiers">+ আরও ধাপ</button></section><section className="panel"><h2>🔗 সাথে দেখানোর পণ্য</h2><p className="muted small">পণ্যের SKU কমা দিয়ে লিখুন (যেমন: 12, 45, 101)। খালি রাখলে "একই রকম আরও পণ্য" একই ক্যাটাগরি থেকে নিজে থেকে আসবে।</p>{ui.field('এর সাথে যা লাগবে (ক্রস-সেল)', ui.input('cross_skus', links.cross.join(', '), { maxlength: 400, placeholder: 'যেমন সোল্ডারিং আয়রনের সাথে তার, ফ্লাক্স' }), 'পণ্যের পেজে আর কার্টে "এগুলোও লাগতে পারে" হিসেবে দেখাবে')}{' '}{ui.field('আরও ভালো বিকল্প (আপসেল)', ui.input('upsell_skus', links.upsell.join(', '), { maxlength: 400, placeholder: 'একটু দামি কিন্তু ভালো মডেল' }))}{' '}{ui.field('একই রকম পণ্য (নিজে বেছে দিন)', ui.input('related_skus', links.related.join(', '), { maxlength: 400 }))}</section></>;
}
/** Saves the colour × size table of the product form as the product's variants (see variantBuilder). Rows taken away
 * are switched off (not deleted). Returns an error text, or null. */
async function saveVb(pid: number, rows0: VbRow[], ctx: AdminCtx, seeCost: boolean, unit = 'সেমি'): Promise<string | null> {
  const old0 = await catalog.listVariants(pid);
  // 🗑️ rows the owner deleted: into the recycle bin (restorable), like the variants page does
  const gone = new Set<number>();
  for (const r of rows0.filter((x) => x.del && x.id)) {
    const v = old0.find((o) => o.id === r.id);
    if (!v) continue;
    await ctx.trash('product', v.id);
    await ctx.log('product_delete', 'product', v.id, `ভ্যারিয়েন্ট মুছে ফেলা: ${v.name}`);
    gone.add(v.id);
  }
  const rows = rows0.filter((r) => !r.del);
  const old = old0.filter((v) => !gone.has(v.id));
  if (gone.size && !rows.length && !old.length) { await db.tx((t) => catalog.syncVariants(t, pid)); return null; }
  if (!rows.length && !old.length) return null;
  const full = await catalog.getProduct({ id: pid });
  const images = (full && full.images) || [];
  const byId = new Map(old.map((v) => [v.id, v]));
  const used = new Set<number>();
  const hasB = rows.some((r) => r.brand);
  const hasC = rows.some((r) => r.color);
  const hasS = rows.some((r) => r.size);
  const out: Body[] = rows.filter((r) => r.id || r.on || str(r.price)).map((r) => {
    const v = r.id ? byId.get(r.id) : undefined;
    if (v) used.add(v.id);
    const label = [r.brand, r.color, r.size].filter(Boolean).join(' / ');
    const n = int(r.img);
    return { id: v ? v.id : 0, label, price: r.price, old_price: v ? v.old_price : null, sku: v ? v.sku : '', cost_price: v ? undefined : (str(r.cost) ? r.cost : (full ? full.cost_price : 0)),
      stock: v ? undefined : r.stock, image_id: n > 0 && images[n - 1] ? images[n - 1] : null, active: r.on, dims: dimsText(r.dl, r.dw, r.dh, unit) };
  });
  for (const v of old) if (!used.has(v.id)) out.push({ id: v.id, label: v.variant_label, price: v.price, old_price: v.old_price, sku: v.sku, image_id: v.image_id, active: false });
  const title = hasB ? ['ব্র্যান্ড', hasC ? 'রং' : '', hasS ? 'সাইজ' : ''].filter(Boolean).join(' / ') : hasC && hasS ? 'রং / সাইজ' : hasC ? 'রং' : hasS ? (full && full.variant_title && !/\//.test(full.variant_title) && !/রং/.test(full.variant_title) ? full.variant_title : 'সাইজ') : (full ? full.variant_title : '');
  try {
    await catalog.saveVariants(pid, { title, rows: out }, ctx.user.id, { withCost: seeCost });
  } catch (e) { return e instanceof Error ? e.message : 'রং/সাইজ সেভ হয়নি।'; }
  // 🏷️ brands typed by hand become buttons for the next products
  const typed = [...new Set(rows.map((r) => r.brand || '').filter((x) => x && !VB_BRANDS.includes(x)))];
  if (typed.length) {
    const had = db.jsonSetting<string[]>(ctx.settings, 'vb_brands', []);
    const all = [...new Set([...had, ...typed])].slice(-20);
    if (all.length !== had.length) await db.setSetting('vb_brands', JSON.stringify(all));
  }
  await ctx.log('product_edit', 'product', pid, `রং/সাইজ: ${out.filter((r) => r.active).map((r) => str(r.label, 30)).join(', ').slice(0, 300)}`);
  return null;
}

async function formPage(ctx: AdminCtx, m: RouteMatch | null) {
  const id = m && m[1] ? int(m[1]) : null;
  // a variant is edited on its main product's variants page
  if (id) {
    const v = await db.one<Pick<ProductsRow, 'parent_id'>>('SELECT parent_id FROM products WHERE id=$1', [id]);
    if (v && v.parent_id) return ctx.redirect(`/admin/products/${v.parent_id}/variants`);
  }
  const categories = await catalog.listCategories();
  const seeCost = ctx.can('see_cost');
  const extras = await formExtras(ctx, id);
  if (ctx.method === 'POST') {
    const b = bodyToProduct(await ctx.body());
    const cur = id ? await catalog.getProduct({ id }) : null;
    if (!seeCost && id) b.cost_price = cur ? cur.cost_price : 0;
    // Only the owner, or staff given that permission, may switch "publish anyway" on or off.
    if (!canOverride(ctx)) b.allow_duplicate = cur ? cur.allow_duplicate : false;
    else b.allow_duplicate = !!b.allow_duplicate;
    // 🎨 the colour × size table (variantBuilder): the main price is the cheapest one; a new product's pieces are the variants'
    const vb = b.vb_form === '1' && b.product_type !== 'bundle' ? vbRowsFromBody(b) : [];
    const vbOn = vb.filter((r) => r.on && !r.del && str(r.price));
    if (vbOn.length) {
      if (!str(b.price)) b.price = String(Math.min(...vbOn.map((r) => amount(r.price))));
      if (!id) b.stock = 0;
    }
    let error = !str(b.name) ? 'পণ্যের নাম লিখুন।' : null;
    if (!error && !(cur && cur.variant_count > 0) && !vbOn.length) error = priceProblem(shopPrice(amount(b.price)), 'বিক্রির দাম');
    if (!error) for (const r of vb.filter((x) => !x.del)) {
      const label = [r.brand, r.color, r.size].filter(Boolean).join(' / ');
      const pp = r.on ? priceProblem(shopPrice(amount(r.price)), `"${label}" এর বিক্রির দাম`) : null;
      if (pp) { error = pp; break; }
    }
    const vbLive = vb.filter((r) => !r.del);
    if (!error && new Set(vbLive.map((r) => `${r.brand || ''}|${r.color}|${r.size}`.toLowerCase())).size !== vbLive.length) error = 'একই রং-সাইজ দুইবার আছে — টেবিলটা আবার তৈরি করুন।';
    if (!error && vb.some((r) => r.del) && !ctx.can('products_delete')) error = 'রং/সাইজ মোছার অনুমতি আপনার নেই — মোছার বদলে "বন্ধ" করে দিন।';
    if (!error && b.sku && await catalog.skuTaken(str(b.sku, 60), id)) error = 'এই SKU অন্য একটা পণ্যে আছে। আলাদা SKU দিন।';
    if (!error && b.youtube_url && !youtubeId(b.youtube_url)) error = 'YouTube লিংকটি ঠিক নেই।';
    if (!error && b.product_type === 'bundle' && !b.bundle.length) error = 'বান্ডেলে অন্তত একটি পণ্য যোগ করুন।';
    const dup = error ? null : await dupCheckOnSave(ctx, b, id);
    if (dup) {
      error = canOverride(ctx)
        ? 'সেভ হয়নি — একই রকম পণ্য দোকানে আগে থেকেই আছে (নিচে দেখুন)। এটা সত্যিই আলাদা পণ্য হলে "তবুও প্রকাশ করুন" সুইচ চালু করে আবার সেভ দিন।'
        : 'সেভ হয়নি — একই রকম পণ্য দোকানে আগে থেকেই আছে (নিচে দেখুন)। আলাদা পণ্য হলে মালিককে জানান।';
      await ctx.log('product_dup_blocked', 'product', id, `${str(b.name, 80)} ≈ ${dup.matches.filter((m) => m.level === 'block').map((m) => '#' + m.id).join(', ')}`);
    }
    if (error) {
      const images = String(b.images || '').split(',').map((x) => int(x)).filter(Boolean);
      const parts = b.bundle.length ? await catalog.getProductsByIds(b.bundle.map((x) => x.product_id), { includeInactive: true }) : [];
      const product: ProductDraft = { ...b, id, images, active: !!b.active, featured: !!b.featured,
        bundle: b.bundle.map((x) => { const pp = parts.find((y) => y.id === int(x.product_id)); return pp ? { product_id: pp.id, name: pp.name, sku: pp.sku, price: pp.price, stock: pp.stock, qty: int(x.qty, 1) } : null; }).filter((x) => x !== null) };
      if (cur) product.slug = cur.slug;
      product.specs = catalog.cleanSpecs(b.spec_key, b.spec_val);
      product.is_new = !!b.is_new;
      product.vb_unit = str(b.vb_unit, 10);
      if (b.vb_form === '1') product.vb_rows = vb.map((r) => {
        const v = r.id && cur ? (cur.variants || []).find((x) => x.id === r.id) : undefined;
        return v ? { ...r, cur: { cost: Number(v.cost_price) || 0, stock: Number(v.stock) || 0 } } : { ...r, id: 0 };
      });
      extras.tiers = list(b.tier_qty).map((n, i) => ({ min_qty: n, price: list(b.tier_price)[i] })).filter((t) => t.min_qty || t.price);
      extras.links = { related: [str(b.related_skus, 400)].filter(Boolean), cross: [str(b.cross_skus, 400)].filter(Boolean), upsell: [str(b.upsell_skus, 400)].filter(Boolean) };
      return ctx.page('পণ্য', productForm({ product, categories, error, seeCost, dup, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku: id ? '' : await catalog.nextSku(), ...extras }), id ? 'products' : 'product-new', { status: 400 });
    }
    const pid = await catalog.saveProduct({ ...b, id }, ctx.user.id);
    const vbProblem = b.vb_form === '1' && b.product_type !== 'bundle' ? await saveVb(pid, vb, ctx, seeCost, str(b.vb_unit, 10)) : null;
    if (vbProblem) return ctx.fail(`/admin/products/${pid}#variants`, `পণ্য সেভ হয়েছে, কিন্তু রং/সাইজ সেভ হয়নি: ${vbProblem}`);
    const extraProblems = b.tier_qty !== undefined || b.cross_skus !== undefined ? await saveExtras(pid, b, ctx.settings) : [];
    await ctx.log(id ? 'product_edit' : 'product_add', 'product', pid, str(b.name, 100));
    if (extraProblems.length) return ctx.fail(`/admin/products/${pid}`, `পণ্য সেভ হয়েছে, তবে: ${extraProblems.join('; ')}`);
    if (b.allow_duplicate && !(cur && cur.allow_duplicate)) await ctx.log('product_dup_allow', 'product', pid, `ডুপ্লিকেট হলেও প্রকাশের অনুমতি: ${str(b.name, 80)}`);
    return ctx.back(`/admin/products/${pid}`, id ? 'saved' : 'added');
  }
  if (id) {
    const product = await catalog.getProduct({ id });
    if (!product) return ctx.redirect('/admin/products');
    const draft: ProductDraft = product;
    draft.vb_rows = vbRowsFromVariants(await catalog.listVariants(id), product.images || [], product.variant_title || '');
    return ctx.page(product.name, <>{ui.flash(ctx.flash)}{productForm({ product, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, ...extras })}</>, product.product_type === 'bundle' ? 'bundles' : 'products');
  }
  const type = ctx.query.get('type') === 'bundle' ? 'bundle' : 'single';
  const fresh: ProductDraft = { active: true, stock: type === 'bundle' ? 0 : 10, emoji: '📦', images: [], bundle: [], product_type: type, low_stock: 3, unit: type === 'bundle' ? 'সেট' : 'পিস',
    category_id: int(ctx.query.get('cat')) || null };
  // came from 📷 স্ক্যান করে স্টক: a barcode no product has yet → it goes on the new product (with box and count)
  if (type === 'single') {
    if (ctx.query.get('barcode')) fresh.barcode = String(ctx.query.get('barcode')).toUpperCase().replace(/[^\x21-\x7e]/g, '').slice(0, 40);
    if (ctx.query.get('location')) fresh.location = catalog.cleanLocation(ctx.query.get('location'));
    if (ctx.query.get('stock') !== null && ctx.query.get('stock') !== '') fresh.stock = Math.max(0, Math.min(100000, int(ctx.query.get('stock'))));
  }
  const nextSku = await catalog.nextSku();
  return ctx.page('নতুন পণ্য', productForm({ product: fresh, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku, ...extras }), type === 'bundle' ? 'bundles' : 'product-new');
}

// Where to go after a list action: back to the same list page (only our own product list).
type BackToProps = {
  back?: unknown;
};
function backTo(b: BackToProps) {
  const v = String(b.back || '');
  return /^\/admin\/(products(\/duplicates)?|inventory)(\?[\w=&%.+-]*)?$/.test(v) ? v : '/admin/products';
}
async function remove(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const b = await ctx.body();
  const p = await catalog.getProduct({ id });
  await ctx.trash('product', id);
  const parentId = p && p.parent_id;
  if (parentId) await db.tx((t) => catalog.syncVariants(t, parentId));
  await ctx.log('product_delete', 'product', id, `${p ? p.name : ''} → রিসাইকেল বিনে`);
  return ctx.back(backTo(b), 'deleted');
}
// Show / hide one product on the shop (the switch in the product list). SKU and everything else stay the same.
async function setActive(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const p = await db.one<Pick<ProductsRow, 'name' | 'parent_id'>>('UPDATE products SET active=$1, updated_at=now() WHERE id=$2 RETURNING name, parent_id', [on, id]);
  const parentId = p && p.parent_id;
  if (parentId) await db.tx((t) => catalog.syncVariants(t, parentId));
  if (p) await ctx.log('product_edit', 'product', id, `${on ? 'দোকানে চালু' : 'দোকান থেকে বন্ধ'}: ${p.name}`);
  if (String(ctx.req.headers.accept || '').includes('application/json')) {
    return p ? ctx.json(200, { ok: true, active: on }) : ctx.json(404, { error: 'পণ্যটি পাওয়া যায়নি।' });
  }
  return ctx.back(backTo(b), 'saved');
}
async function duplicate(ctx: AdminCtx, m: RouteMatch) {
  const nid = await catalog.duplicateProduct(int(m[1]), ctx.user.id);
  if (!nid) return ctx.back('/admin/products');
  await ctx.log('product_add', 'product', nid, 'কপি');
  return ctx.back(`/admin/products/${nid}`, 'copied');
}

// ---------------------------------------------------------------- duplicates page
async function duplicatesPage(ctx: AdminCtx) {
  const may = canOverride(ctx);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!may) return ctx.back('/admin/products/duplicates', 'noperm');
    if (b.form === 'settings') {
      const lvl = typeof b.dup_level === 'string' && Object.keys(dupes.LEVELS).includes(b.dup_level) ? b.dup_level : 'normal';
      await db.setSetting('dup_guard', b.dup_guard ? '1' : '0');
      await db.setSetting('dup_level', lvl);
      await ctx.reloadSettings();
      await ctx.log('settings', 'product', null, `ডুপ্লিকেট যাচাই: ${b.dup_guard ? 'চালু' : 'বন্ধ'}, মাত্রা ${dupes.LEVELS[lvl].label}`);
      return ctx.back('/admin/products/duplicates', 'saved');
    }
    if (b.form === 'allow' && int(b.id)) {
      await db.q('UPDATE products SET allow_duplicate=true WHERE id=$1', [int(b.id)]);
      await ctx.log('product_dup_allow', 'product', int(b.id), 'ডুপ্লিকেট তালিকা থেকে "আলাদা পণ্য" হিসেবে অনুমোদিত');
      return ctx.back('/admin/products/duplicates', 'saved');
    }
    return ctx.back('/admin/products/duplicates');
  }
  const showAllowed = ctx.query.get('all') === '1';
  const dupBack = '/admin/products/duplicates' + (showAllowed ? '?all=1' : '');
  await recognize.importCloud($whitencloud.RAW, String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || ''), true).catch(() => 0); // ☁️ the cloud AI's newest picture descriptions
  const [groups, rc] = await Promise.all([dupes.scanCatalog(ctx.settings, { includeAllowed: showAllowed }), recognize.progress()]);
  // what the cards compare (one query for every product shown)
  type Extra = { stock: number; sold_count: number; pics: number; desc_len: number; excerpt: string; category: string };
  const NO_EXTRA: Extra = { stock: 0, sold_count: 0, pics: 0, desc_len: 0, excerpt: '', category: '' };
  const shown = [...new Set(groups.flatMap((g) => g.products.map((x) => x.id)))];
  const extra = new Map((shown.length ? await db.q<Extra & { id: number }>(`SELECT p.id, p.stock, p.sold_count,
      (SELECT count(*)::int FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id) AS pics,
      length(regexp_replace(coalesce(p.description, ''), '<[^>]*>', '', 'g'))::int AS desc_len,
      left(regexp_replace(regexp_replace(coalesce(nullif(p.short_description, ''), p.description, ''), '<[^>]*>', ' ', 'g'), '\\s+', ' ', 'g'), 160) AS excerpt,
      coalesce(c.name, '') AS category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id = ANY($1::int[])`, [shown]) : []).map((r) => [r.id, r]));
  const sure = groups.filter((g) => g.level === 'block');
  const maybe = groups.filter((g) => g.level === 'warn');
  const on = guardOn(ctx);
  const canDel = ctx.can('products_delete');
  let gi = 0;
  const card = (g: (typeof groups)[number]) => {
    const why = [...new Set(g.pairs.flatMap((pp) => pp.reasons))];
    // 🆚 side by side (owner, 2026-10-24): every product of the group as a card — picture, name, SKU, price, stock, sold,
    // how many pictures, how long the description is, its start — so the owner can see which one is best, keep it
    // ("✅ এটা রাখুন, বাকিগুলো মুছুন") and send the others to the recycle bin. Every card in a group matches every other.
    const fid = `dupdel-${++gi}`;
    const best = (k: (x: Extra) => number) => Math.max(...g.products.map((x) => k(extra.get(x.id) || NO_EXTRA)));
    const top = { pics: best((e) => e.pics), desc: best((e) => e.desc_len), sold: best((e) => e.sold_count) };
    const keepOnly = (x: (typeof g.products)[number]) => <form method="post" action="/admin/products/bulk" data-confirm={`শুধু '${attrValue(x.title)}' থাকবে — বাকি ${bn(g.products.length - 1)}টি মুছে রিসাইকেল বিনে যাবে (পরে ফেরত আনা যায়)। করবেন?`}><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="back" defaultValue={attrValue(dupBack)} />{jsxList(g.products.filter((y) => y.id !== x.id).map((y) => <input type="hidden" name="ids[]" defaultValue={attrValue(y.id)} />))}<button className="btn btn-sm">✅ এটা রাখুন, বাকি {bn(g.products.length - 1)}টি মুছুন</button></form>;
    const star = (on: boolean) => (on ? <b className="good"> ★</b> : null);
    return <div className={`panel dup-group ${g.level === 'block' ? 'is-block' : 'is-warn'}`}>
      <p className="dup-head">{(g.level === 'block' ? '⛔ ' : '⚠️ ')}এই {bn(g.products.length)}টি পণ্য একই মনে হচ্ছে</p>
      <p className="dup-why small">{why.join(' · ')}</p>
      <div className="dup-cmp">{jsxList(g.products.map((x, i) => {
        const e = extra.get(x.id) || NO_EXTRA;
        return <article className={`dup-card ${x.active ? '' : 'dup-off'}`}>
          {(canDel ? <label className="dup-pick" title="মুছে ফেলার জন্য বাছুন"><input type="checkbox" name="ids[]" form={fid} defaultValue={attrValue(x.id)} aria-label={`${attrValue(x.title)} মুছুন`} />{' '}<span className="small">মুছুন</span></label> : null)}
          <a className="dup-pic" href={`/admin/products/${attrValue(x.id)}`} target="_blank" rel="noopener">{(x.image_id ? <img src={`/media/${attrValue(x.image_id)}/t`} alt="" loading="lazy" /> : <span><Val v={x.emoji || '📦'} /></span>)}</a>
          <a className="dup-title" href={`/admin/products/${attrValue(x.id)}`} target="_blank" rel="noopener"><b><Val v={x.title} /></b></a>
          <dl className="dup-facts">
            <dt>SKU</dt><dd><Val v={x.sku || '—'} />{(i === 0 ? <span className="small muted"> · সবচেয়ে পুরোনো</span> : null)}</dd>
            <dt>দাম</dt><dd>{money(x.price)}</dd>
            <dt>স্টক / বিক্রি</dt><dd>{bn(e.stock)}টি / {bn(e.sold_count)}টি{star(top.sold > 0 && e.sold_count === top.sold)}</dd>
            <dt>ছবি</dt><dd>{bn(e.pics)}টি{star(top.pics > 1 && e.pics === top.pics)}</dd>
            <dt>বিবরণ</dt><dd>{(e.desc_len ? `${bn(e.desc_len)} অক্ষর` : <span className="warn">নেই</span>)}{star(top.desc > 0 && e.desc_len === top.desc)}</dd>
            <dt>ক্যাটাগরি</dt><dd><Val v={e.category || '—'} /></dd>
            <dt>দোকানে</dt><dd>{(x.active ? 'দেখাচ্ছে' : <span className="muted">লুকানো</span>)}{(x.allow_duplicate ? ' · অনুমোদিত' : null)}</dd>
          </dl>
          {(e.excerpt ? <p className="dup-desc small muted"><Val v={e.excerpt} /></p> : null)}
          <div className="dup-card-acts">{(canDel ? keepOnly(x) : null)}<a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(x.id)}`} target="_blank" rel="noopener">✏️ এডিট</a>{(may && i > 0 && !x.allow_duplicate ? <form method="post" action="/admin/products/duplicates"><input type="hidden" name="form" defaultValue="allow" /><input type="hidden" name="id" defaultValue={attrValue(x.id)} /><button className="btn btn-ghost btn-sm" title="এটা আলাদা পণ্য, তালিকা থেকে সরান">আলাদা পণ্য ✓</button></form> : null)}</div>
        </article>;
      }))}</div>
      {(canDel ? <form method="post" action="/admin/products/bulk" id={fid} className="dup-group-acts" data-confirm="টিক দেওয়া পণ্যগুলো মুছে রিসাইকেল বিনে যাবে (পরে ফেরত আনা যায়)। যেটা রাখবেন সেটায় টিক নেই তো?"><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="back" defaultValue={attrValue(dupBack)} /><button className="btn btn-sm btn-danger">🗑️ টিক দেওয়াগুলো মুছুন</button>{' '}<span className="small muted">★ = এই দলে সবচেয়ে বেশি (ছবি / বিবরণ / বিক্রি)। ভালোটায় "✅ এটা রাখুন" চাপুন — অথবা মুছতে চাওয়াগুলোয় টিক দিন।</span></form> : null)}
    </div>;
  };
  const body = <><p className="crumbs"><a href="/admin/products">← সব পণ্য</a></p><h1>ডুপ্লিকেট পণ্য{' '}<small>{bn(sure.length)}টি নিশ্চিত,{' '}{bn(maybe.length)}টি সম্ভাব্য</small></h1>{ui.flash(ctx.flash)}<section className="panel" data-recognize=""><h2>🧠 ছবি দেখে চেনা (AI)</h2><p className="small">নাম আলাদা হলেও, অন্য অ্যাঙ্গেল বা অন্য ব্যাকগ্রাউন্ডের ছবি হলেও — AI ছবি দেখে একই পণ্য চিনতে পারে। প্রতিটা ছবি একবার AI-কে দেখানো হয় — <b>☁️ অনলাইনে, নিজে থেকেই</b> (GitHub-এর কম্পিউটারে, ফ্রি; আপনার ল্যাপটপ বা ফোনে কোনো চাপ নেই)। নতুন ছবিও কিছুক্ষণের মধ্যে চেনা হয়ে যায়। চাইলে নিচের বোতাম দিয়ে এই কম্পিউটারেও চালাতে পারেন।</p><p className="small" data-rc-status="" aria-live="polite">{bn(rc.done)} / {bn(rc.total)}টি ছবি AI চিনে রেখেছে।{(recognize.lastImportNote ? <span className="small muted"> (অনলাইন থেকে আনা যায়নি: <Val v={recognize.lastImportNote} />)</span> : null)}</p>{(rc.done < rc.total ? <button type="button" className="btn btn-sm" data-rc-run="">▶ এখনই সব ছবি চিনুন</button> : null)}</section><section className="panel"><h2>ডুপ্লিকেট আটকানো</h2><form method="post" action="/admin/products/duplicates" className="dup-set"><input type="hidden" name="form" defaultValue="settings" />{' '}<label className="nav-chip dup-chip" title="নতুন পণ্য যোগ বা এডিট করার সময় নাম, ছবি আর বিবরণ মিলিয়ে দেখা হবে। আগে থেকে থাকলে সেভ আটকে যাবে।">{' '}<span className="nav-chip-t">একই পণ্য দুইবার উঠতে দেবেন না</span>{' '}<span className="switch switch-sm"><input type="checkbox" name="dup_guard" defaultValue="1" defaultChecked={!!(on)} disabled={!(may)} /><span className="switch-ui" aria-hidden="true"></span></span>{' '}</label>{' '}<label className="dup-level">কতটা কড়া{' '}{ui.select('dup_level', Object.entries(dupes.LEVELS).map(([k, v]) => [k, v.label]), ctx.settings.dup_level || 'normal', { disabled: !may })}</label>{' '}{(may ? <button className="btn btn-sm">💾 সেভ করুন</button> : <span className="small muted">শুধু মালিক বা অনুমতি পাওয়া স্টাফ বদলাতে পারবে।</span>)}</form><p className="small muted dup-hint">কড়া = একটু মিল থাকলেই আটকাবে · নরম = শুধু খুব বেশি মিল থাকলে আটকাবে।</p>{ui.helpBox('কীভাবে মেলানো হয়?', <ul><li><b>ছবি:</b>{' '}প্রতিটা ছবির একটা "ছবির ছাপ" রাখা হয়। একই ছবি ছোট-বড় করলে, আবার সেভ করলে, চারপাশে সাদা জায়গা থাকলে বা উল্টো (mirror) করলেও ধরা পড়বে।</li><li><b>নাম:</b>{' '}শব্দের ক্রম আলাদা হলেও, বানান একটু এদিক-ওদিক হলেও, বাংলা/ইংরেজি সংখ্যা (১২ = 12), "60 watt" = "60W" — সব মেলানো হয়। "New", "Original", "BD" এর মতো শব্দ বাদ দিয়ে দেখা হয়।</li><li><b>মাপ/মডেল আলাদা হলে আলাদা পণ্য:</b>{' '}যেমন "Soldering Iron 40W" আর "60W" — নামের কারণে আটকাবে না।</li><li><b>বিবরণ:</b>{' '}বিস্তারিত বিবরণ হুবহু এক হলে সেটাও ধরা হয়।</li><li>লুকানো পণ্যের সাথেও মেলানো হয়। একক পণ্য একক পণ্যের সাথে, বান্ডেল বান্ডেলের সাথে মেলানো হয়।</li><li>একদম অন্য কোণ থেকে তোলা আলাদা ছবি হলে ছবি দিয়ে ধরা কঠিন — তখন নাম দিয়ে ধরা হয়।</li></ul>)}</section><h2>এখন দোকানে যা আছে</h2><p className="muted small">পুরো দোকান মিলিয়ে দেখা হয়েছে। ভুল পণ্যটা খুলে মুছে দিন বা লুকান। আসলে আলাদা পণ্য হলে "আলাদা পণ্য ✓" চাপুন — তালিকা থেকে সরে যাবে।{' '}{(showAllowed ? <>{' '}<a href="/admin/products/duplicates">অনুমোদিতগুলো লুকান</a></> : <>{' '}<a href="/admin/products/duplicates?all=1">অনুমোদিতগুলোও দেখুন</a></>)}</p><p className="small muted" data-fp-status="" hidden></p>{(groups.length ? <>{(sure.length ? <><h3>⛔ প্রায় নিশ্চিত ডুপ্লিকেট</h3><Val v={sure.map(card)} /></> : null)}{' '}{(maybe.length ? <><h3>⚠️ হতে পারে — একবার দেখে নিন</h3><Val v={maybe.map(card)} /></> : null)}</> : ui.empty('কোনো ডুপ্লিকেট পণ্য পাওয়া যায়নি। 👍'))}</>;
  return ctx.page('ডুপ্লিকেট পণ্য', body, 'duplicates');
}

// ---------------------------------------------------------------- categories
// Where categories show on the storefront: the bar above the banner (every page)
// and the box grid on the home page (a home-page section).
async function saveCategoryDisplay(ctx: AdminCtx, b: Body) {
  const top = b.show_cat_strip ? '1' : '0';
  await db.setSetting('show_cat_strip', top);
  const sections = db.jsonSetting<string[]>(ctx.settings, 'home_sections', []).filter((x) => x !== 'categories');
  if (b.show_cat_grid) sections.splice(sections[0] === 'slider' ? 1 : 0, 0, 'categories');
  await db.setSetting('home_sections', JSON.stringify(sections));
  await ctx.reloadSettings();
  await ctx.log('settings', 'category', null, `ক্যাটাগরি দেখানো: উপরে ${top === '1' ? 'চালু' : 'বন্ধ'}, নিচে ${b.show_cat_grid ? 'চালু' : 'বন্ধ'}`);
}
function displaySwitch(name: string, on: boolean, title: string, desc: string) {
  return <label className="switch-row">{' '}<span className="switch-text"><b><Val v={title} /></b><small><Val v={desc} /></small></span>{' '}<span className="switch"><input type="checkbox" name={attrValue(name)} defaultValue="1" defaultChecked={!!(on)} data-autosubmit="" /><span className="switch-ui" aria-hidden="true"></span></span>{' '}<span className="switch-state" data-on="চালু" data-off="বন্ধ"></span>{' '}</label>;
}

async function categoriesPage(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'display') {
      await saveCategoryDisplay(ctx, b);
      return ctx.back('/admin/categories', 'saved');
    }
    if (str(b.name)) {
      const cid = await catalog.saveCategory({ id: int(b.id) || null, name: b.name, icon: b.icon, sort: b.sort, active: b.id ? !!b.active : true, imageId: b.image_id,
        parentId: 'parent_id' in b ? b.parent_id : undefined,
        seo: 'seo_title' in b ? { title: b.seo_title, description: b.seo_description, text: b.cat_text, bannerId: b.banner_id, noindex: !!b.noindex } : undefined,
        sizeChart: 'size_chart' in b ? b.size_chart : undefined, noFreeDelivery: b.nofree_form === '1' ? !!b.no_free_delivery : undefined });
      if (int(b.banner_id)) await catalog.claimMedia(int(b.banner_id), 'category', cid);
      await ctx.log('category_save', 'category', int(b.id) || null, str(b.name, 60));
    }
    return ctx.back('/admin/categories', 'saved');
  }
  const categories = await catalog.listCategories();
  const tree = catalog.categoryOptions(categories); // menu order, with depth
  const { byId } = catalog.categoryTree(categories);
  // where a category may be put: anywhere except inside itself or its own sub-categories
  const parentChoices = (c: catalog.CategoryNode | null) => {
    const inside = new Set<unknown>();
    const walk = (n: catalog.CategoryNode) => { inside.add(n.id); n.children.forEach(walk); };
    if (c) walk(byId.get(c.id)!);
    return [['', '— মূল ক্যাটাগরি (কোনোটির ভেতরে না)'], ...ui.catOpts(categories).filter(([id]) => !inside.has(id))];
  };
  const showTop = ctx.settings.show_cat_strip !== '0';
  const showGrid = db.jsonSetting<string[]>(ctx.settings, 'home_sections', []).includes('categories');
  const body = <><h1>ক্যাটাগরি{' '}<small>{bn(categories.length)}টি</small></h1>{ui.flash(ctx.flash)}<section className="panel"><h2>দোকানে ক্যাটাগরি কোথায় দেখাবে</h2><form method="post" action="/admin/categories" className="switch-list two-col" data-switch-form=""><input type="hidden" name="form" defaultValue="display" />{' '}{displaySwitch('show_cat_strip', showTop, 'উপরের ক্যাটাগরি বার (ব্যানারের উপরে)', 'হেডারের ঠিক নিচে, প্রতিটা পেজে এক লাইনে ক্যাটাগরির নাম। (মোবাইলে এই বার এমনিতেই লুকানো থাকে, মেনুতে ক্যাটাগরি পাওয়া যায়।)')}{' '}{displaySwitch('show_cat_grid', showGrid, 'নিচের ক্যাটাগরি বক্স (হোমপেজে)', 'হোমপেজে ব্যানারের নিচে আইকনসহ ছোট ছোট বক্স।')}<noscript><button className="btn btn-sm">সেভ করুন</button></noscript></form></section><section className="panel"><h2>🤖 স্বয়ংক্রিয়ভাবে সাজান</h2><p className="muted small">প্রতিটা পণ্যের নাম পড়ে ঠিক মূল ক্যাটাগরি → সাব-ক্যাটাগরিতে বসিয়ে দেয় (রিমোট হলে এসি/টিভি আর কোম্পানি অনুযায়ী আলাদা)। আগে দেখে নিয়ে তারপর সেভ করবেন।</p><a className="btn btn-sm" href="/admin/categories/auto">পণ্যগুলো স্বয়ংক্রিয়ভাবে সাজান →</a></section><div className="two-col"><section className="panel"><h2>সব ক্যাটাগরি{' '}<small>মূল ক্যাটাগরি আর তার ভেতরের সাব-ক্যাটাগরি</small></h2><div className="cat-admin-grid cat-tree">{jsxList(tree.map((c) => <form method="post" action="/admin/categories" className={`cat-card depth-${attrValue(Math.min(c.depth!, 3))} ${c.active === false ? 'row-off' : ''}`}><input type="hidden" name="id" defaultValue={attrValue(c.id)} /><div className="cat-card-top"><input name="icon" defaultValue={attrValue(c.icon)} maxLength={8} className="w-emoji" data-icon-input="" aria-label="আইকন" />{' '}<input name="name" defaultValue={attrValue(c.name)} required maxLength={60} aria-label="নাম" /></div><div className="cat-card-bottom"><label className="small">ক্রম{' '}<input name="sort" type="number" defaultValue={attrValue(c.sort)} className="w-num" /></label>{' '}{ui.check('active', c.active !== false, 'দেখাও')}{' '}<span className="small muted">{bn(c.product_count)}টি পণ্য{(c.total_count! > c.product_count ? ` (ভেতরেসহ ${bn(c.total_count)}টি)` : null)}</span></div><label className="small cat-parent">কোথায় থাকবে{' '}{ui.select('parent_id', parentChoices(c), c.parent_id || '')}</label><details className="cat-seo"><summary className="small">🔎 SEO, বিবরণ ও ব্যানার{(c.seo_title || c.description || c.banner_id ? " ✓" : null)}</summary>{ui.field('SEO টাইটেল', ui.input('seo_title', c.seo_title || '', { maxlength: 120, placeholder: `খালি রাখলে: ${c.name}` }))}{' '}{ui.field('SEO বিবরণ', ui.textarea('seo_description', c.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'গুগলে নামের নিচে যে ২ লাইন দেখায়' }))}{' '}{ui.field('পণ্যের উপরে দেখানোর লেখা (ঐচ্ছিক)', ui.textarea('cat_text', c.description || '', { rows: 2, maxlength: 3000 }))}{' '}{ui.imagePicker('banner_id', c.banner_id, { label: 'চওড়া ব্যানার ছবি (ঐচ্ছিক)', hint: 'ক্যাটাগরির পেজের উপরে দেখাবে। ১২০০×৩০০ এর মতো চওড়া ছবি দিন।', wide: true })}{' '}{ui.check('noindex', !!c.noindex, 'গুগল সার্চে এই ক্যাটাগরির পেজ দেখাবে না (noindex)')}</details><details className="cat-seo"><summary className="small">🚚 ডেলিভারি{(c.no_free_delivery ? " — ফ্রি ডেলিভারি নয়" : null)}</summary><input type="hidden" name="nofree_form" defaultValue="1" />{ui.check('no_free_delivery', !!c.no_free_delivery, 'এই ক্যাটাগরির (আর এর ভেতরের সব) পণ্যে ফ্রি ডেলিভারি নয় — এদের দাম "৳… বা বেশি কিনলে ডেলিভারি ফ্রি" হিসাবে ধরা হবে না (যেমন প্যাকেজিং ম্যাটেরিয়ালস)')}</details><details className="cat-seo"><summary className="small">📏 সাইজ গাইড{(c.size_chart ? " ✓" : null)}</summary>{ui.field('সাইজ চার্ট (এই ক্যাটাগরি আর এর ভেতরের সব পণ্যে "সাইজ গাইড দেখুন" হিসেবে দেখাবে)', ui.textarea('size_chart', c.size_chart || '', { rows: 6, maxlength: 3000,
    placeholder: '| সাইজ | বুক (ইঞ্চি) | লম্বা (ইঞ্চি) |\n|---|---|---|\n| M | 38 | 27 |\n| L | 40 | 28 |\n| XL | 42 | 29 |' }),
    'টেবিল বানাতে প্রতি লাইনে | দিয়ে ঘর আলাদা করুন (উদাহরণ ঘরে দেখুন)। নিচে সাধারণ লেখাও দিতে পারেন, যেমন "কীভাবে মাপ নেবেন"। খালি রাখলে উপরের (মূল) ক্যাটাগরির গাইড দেখাবে।')}</details><div className="cat-card-actions"><button className="btn btn-sm btn-ghost">সেভ</button>{' '}<a className="small" href={`/admin/products?cat=${attrValue(c.id)}`}>পণ্য দেখুন</a>{' '}<button className="link-btn danger small" formAction={`/admin/categories/${attrValue(c.id)}/delete`} data-confirm-btn={`'${attrValue(c.name)}' ক্যাটাগরি মুছবেন? পণ্যগুলো মুছবে না, শুধু ক্যাটাগরিহীন হবে। ভেতরের সাব-ক্যাটাগরিগুলো এক ধাপ উপরে চলে যাবে।`}>মুছুন</button></div></form>))}</div></section><section className="panel"><h2>নতুন ক্যাটাগরি</h2><form method="post" action="/admin/categories" className="form"><div className="field-row">{ui.field('আইকন', ui.input('icon', '📦', { maxlength: 8, class: 'w-emoji', 'data-icon-input': true }))}{' '}{ui.field('নাম', ui.input('name', '', { required: true, maxlength: 60, placeholder: 'যেমন: মোবাইল এক্সেসরিজ' }))}</div>{ui.field('কোথায় থাকবে', ui.select('parent_id', parentChoices(null), ''), 'মূল ক্যাটাগরি, নাকি অন্য কোনো ক্যাটাগরির ভেতরে সাব-ক্যাটাগরি')}{' '}{ui.field('ক্রম', ui.input('sort', categories.length, { type: 'number' }), 'ছোট সংখ্যা আগে দেখাবে')}{' '}<button className="btn">যোগ করুন</button></form><h2>আইকন বাছুন</h2><p className="muted small">নিচের যেকোনো আইকনে চাপ দিলে শেষে যে আইকন বক্সে ক্লিক করেছিলেন সেখানে বসে যাবে।</p><div className="icon-grid" data-icon-grid="">{jsxList(ICONS.map((i) => <button type="button" data-icon={attrValue(i)}><Val v={i} /></button>))}</div></section></div></>;
  return ctx.page('ক্যাটাগরি', body, 'categories');
}
// ---------------------------------------------------------------- automatic sorting
async function autoPage(ctx: AdminCtx) {
  const autocat = $services_autocat;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ids = list(b.id).map((x) => int(x)).filter(Boolean);
    if (!ids.length) return ctx.fail('/admin/categories/auto', 'কোনো পণ্য বাছা হয়নি।');
    const r = await autocat.apply({ ids });
    await ctx.log('category_save', 'category', null, `স্বয়ংক্রিয় ক্যাটাগরি: ${r.moved}টি পণ্য সাজানো হলো`);
    return ctx.redirect('/admin/categories?info=' + encodeURIComponent(`✅ ${bn(r.moved)}টি পণ্য ঠিক ক্যাটাগরি / সাব-ক্যাটাগরিতে বসানো হয়েছে।`));
  }
  const rows = await autocat.preview();
  const change = rows.filter((r) => r.to && !r.same);
  const same = rows.filter((r) => r.same);
  const unknown = rows.filter((r) => !r.to);
  const groups = new Map();
  rows.filter((r) => r.to).forEach((r) => groups.set(r.path, (groups.get(r.path) || 0) + 1));
  const body = <><p className="crumbs"><a href="/admin/categories">← ক্যাটাগরি</a></p><h1>🤖 পণ্য স্বয়ংক্রিয়ভাবে সাজান</h1>{ui.flash(ctx.flash)}<p className="muted">প্রতিটা পণ্যের নাম পড়ে ঠিক করা হয়েছে কোনটা কোন মূল ক্যাটাগরি → সাব-ক্যাটাগরিতে যাবে। নিচে দেখে নিন; কোনোটা ভুল মনে হলে তার টিক তুলে দিন, তারপর সেভ করুন। দরকারি ক্যাটাগরিগুলো নিজে থেকে তৈরি হবে।</p><div className="kpis">{ui.kpi('বদলাবে', bn(change.length), 'নতুন জায়গায় যাবে', 'kpi-blue')}{' '}{ui.kpi('আগে থেকেই ঠিক আছে', bn(same.length), '', 'kpi-green')}{' '}{ui.kpi('চেনা যায়নি', bn(unknown.length), 'হাতে ক্যাটাগরি দিন', unknown.length ? 'kpi-alert' : '')}</div><details className="help"><summary>📂 কোন ক্যাটাগরিতে কয়টা পণ্য যাবে</summary><div><ul className="auto-groups">{jsxList([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, n]) => <li><Val v={path} />{' '}—{' '}<b>{bn(n)}</b></li>))}</ul></div></details>{(change.length ? <form method="post" action="/admin/categories/auto" className="panel"><div className="row-actions"><button className="btn btn-lg">✅ টিক দেওয়া{' '}{bn(change.length)}টি পণ্য সাজিয়ে সেভ করুন</button>{' '}<label className="check"><input type="checkbox" defaultChecked data-check-all="" />{' '}<span>সব বাছুন</span></label></div><div className="table-wrap"><table className="table"><thead><tr><th></th><th>পণ্য</th><th>এখন</th><th>যাবে</th></tr></thead><tbody>{jsxList(change.map((r) => <tr><td><input type="checkbox" name="id[]" defaultValue={attrValue(r.id)} defaultChecked data-check-row="" /></td><td><a href={`/admin/products/${attrValue(r.id)}`} target="_blank" rel="noopener"><Val v={r.name} /></a></td><td className="small muted"><Val v={r.from || '—'} /></td><td className="small"><b><Val v={r.path} /></b></td></tr>))}</tbody></table></div></form> : ui.empty('সব পণ্য আগে থেকেই ঠিক ক্যাটাগরিতে আছে। 👍'))}{' '}{(unknown.length ? <section className="panel"><h2>চেনা যায়নি — হাতে ক্যাটাগরি দিন</h2><ul className="small">{jsxList(unknown.map((r) => <li><a href={`/admin/products/${attrValue(r.id)}`}><Val v={r.name} /></a>{(r.from ? <>{' '}<span className="muted">(এখন:{' '}<Val v={r.from} />)</span></> : null)}</li>))}</ul></section> : null)}</>;
  return ctx.page('স্বয়ংক্রিয় ক্যাটাগরি', body, 'categories');
}

async function deleteCategory(ctx: AdminCtx, m: RouteMatch) {
  await ctx.trash('category', int(m[1]));
  await ctx.log('category_delete', 'category', int(m[1]), '');
  return ctx.back('/admin/categories', 'deleted');
}

export const routes = [
    { method: 'GET', path: '/admin/products', perm: 'products', handler: listPage },
    { method: 'POST', path: '/admin/products/bulk', perm: (ctx: AdminCtx) => (ctx.can('products') ? 'products' : 'products_delete'), handler: bulkAction },
    { method: '*', path: '/admin/products/duplicates', perm: 'products', handler: duplicatesPage },
    { method: 'POST', path: '/admin/api/products/dup-check', perm: 'products', handler: dupCheckApi },
    { method: 'GET', path: '/admin/api/products/bn-title', perm: 'products', handler: bnTitleApi },
    { method: '*', path: '/admin/products/new', perm: 'products', handler: (ctx: AdminCtx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/products\/(\d+)$/, perm: 'products', handler: formPage },
    { method: '*', path: /^\/admin\/products\/(\d+)\/variants$/, perm: 'products', handler: (ctx: AdminCtx, m: RouteMatch) => $variants.page(ctx, m) },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/active$/, perm: 'products', handler: setActive },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/delete$/, perm: 'products', handler: remove },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/duplicate$/, perm: 'products', handler: duplicate },
    { method: '*', path: '/admin/categories', perm: 'products', handler: categoriesPage },
    { method: '*', path: '/admin/categories/auto', perm: 'products', handler: autoPage },
    { method: 'POST', path: /^\/admin\/categories\/(\d+)\/delete$/, perm: 'products', handler: deleteCategory },
  ];

// Admin → পণ্য → (a product) → 🎨 ভ্যারিয়েন্ট: the sizes / colours / models of one product.
// Every row is a variant with its own price, stock, SKU and barcode. The shop shows a picker on the product page.
import { Val, attrValue, jsxList } from '../react/html';
import { int, str, bn, money } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as catalog from '../models/catalog';
import type { AdminCtx, Body, RouteMatch, Caught } from '../types';
import type { ProductsRow } from '../data/rows';

const PRESET_TITLES = ['রং', 'সাইজ', 'মডেল', 'রং / সাইজ', 'ধরন', 'ভোল্টেজ', 'ক্ষমতা (ওয়াট)', 'দৈর্ঘ্য', 'প্যাক'];

type RowHtmlProps_ = {
  seeCost: boolean;
  images: number[];
  i: number;
  blank?: boolean;
};
type RowHtmlProps = {
  active?: boolean;
  id?: number;
  variant_label?: string | null;
  price?: number | string;
  old_price?: number | string | null;
  cost_price?: number | null;
  stock?: number;
  sku?: string | null;
  barcode?: string | null;
  image_id?: number | null;
};
function rowHtml(v: RowHtmlProps, { seeCost, images, i, blank = false }: RowHtmlProps_) {
  const n = blank ? '' : i;
  return <tr className={v.active === false ? 'row-off' : ''} data-var-row=""><td><input type="hidden" name="vid" defaultValue={attrValue(v.id || '')} />{' '}<input name="vlabel" defaultValue={attrValue(v.variant_label || '')} maxLength={60} placeholder="যেমন: লাল / XL" className="w-md" required={!(blank)} aria-label={`ভ্যারিয়েন্টের নাম ${attrValue(n)}`} /></td><td><input name="vprice" type="number" step="0.01" min="0" defaultValue={attrValue(v.price ?? '')} className="w-num" aria-label="বিক্রির দাম" /></td><td><input name="vold" type="number" step="0.01" min="0" defaultValue={attrValue(v.old_price ?? '')} className="w-num" aria-label="আগের দাম" /></td>{(!seeCost ? null : (v.id ? <td><input type="hidden" name="vcost" defaultValue="" /><b>{(Number(v.cost_price) > 0 ? money(v.cost_price) : <span className="warn">—</span>)}</b><br /><a className="small" href={`/admin/products/${attrValue(v.id)}/ledger`}>📒 হিসাব</a></td> : <td><input name="vcost" type="number" step="0.01" min="0" defaultValue={attrValue(v.cost_price ?? '')} className="w-num" aria-label="কেনা দাম" /></td>))}{' '}{(v.id ? <td><input type="hidden" name="vstock" defaultValue="" /><b>{bn(v.stock ?? 0)}</b><br /><a className="small" href={`/admin/inventory?q=${attrValue(encodeURIComponent(v.sku || ''))}`}>ঠিক করুন</a></td> : <td><input name="vstock" type="number" min="0" defaultValue={attrValue(v.stock ?? '')} className="w-num" placeholder="শুরুর স্টক" aria-label="শুরুর স্টক" /></td>)}<td><input name="vsku" defaultValue={attrValue(v.sku || '')} maxLength={60} className="w-sm" placeholder="নিজে বসবে" aria-label="SKU" />{(v.barcode ? <><br /><span className="small muted mono"><Val v={v.barcode} /></span></> : null)}</td><td>{(images.length ? ui.select('vimage', [['', '— মূল ছবি —'], ...images.map((id: unknown, k: number) => [id, `ছবি ${bn(k + 1)}`])], v.image_id || '', { 'aria-label': 'ছবি', 'data-var-img': true }) : <><input type="hidden" name="vimage" defaultValue="" /><span className="small muted">ছবি নেই</span></>)}</td><td><label className="switch" title="বন্ধ = দোকানে এই অপশন দেখাবে না"><input type="checkbox" name={`vactive_${attrValue(blank ? 'new' : v.id || 'new')}`} defaultValue="1" defaultChecked={!(v.active === false)} data-var-active="" /><span className="switch-ui" aria-hidden="true"></span></label>{' '}<input type="hidden" name="vactive" defaultValue={v.active === false ? '0' : '1'} data-var-active-val="" /></td><td>{(v.id ? <label className="check small"><input type="checkbox" name="vremove" defaultValue={attrValue(v.id)} />{' '}<span>মুছুন</span></label> : <span className="small muted">নতুন</span>)}</td></tr>;
}

/** "সাদা, সিলভার" × "Small, Large" → ["সাদা / Small", "সাদা / Large", "সিলভার / Small", "সিলভার / Large"]; only the first list → itself */
function comboLabels(a: unknown, b: unknown): string[] {
  const split = (v: unknown) => [...new Set(String(v ?? '').split(/[,،\n]+/).map((x) => x.replace(/\//g, '-').trim().slice(0, 28)).filter(Boolean))].slice(0, 12);
  const A = split(a), B = split(b);
  return (B.length ? A.flatMap((x) => B.map((y) => `${x} / ${y}`)) : A).slice(0, catalog.MAX_VARIANTS);
}

async function page(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const p = await catalog.getProduct({ id });
  if (!p) return ctx.redirect('/admin/products');
  if (p.parent_id) return ctx.redirect(`/admin/products/${p.parent_id}/variants`);
  const seeCost = ctx.can('see_cost');
  const back = `/admin/products/${id}/variants`;
  if (ctx.method === 'POST') {
    if (ctx.readOnly) return ctx.back(back, 'noperm');
    const b = await ctx.body();
    // ✨ make every combination at once: রং (সাদা, সিলভার, প্রাইভেসি) × সাইজ (Small, Medium, Large) → "সাদা / Small" …
    if (b.gen === '1') {
      const labels = comboLabels(b.gen_vals1, b.gen_vals2);
      if (!labels.length) return ctx.fail(back, 'প্রথম ঘরে অন্তত একটা অপশন লিখুন (কমা দিয়ে আলাদা করে)।');
      const old = await catalog.listVariants(id);
      const have = new Set(old.map((v) => v.variant_label.toLowerCase()));
      const fresh = labels.filter((l) => !have.has(l.toLowerCase()));
      if (!fresh.length) return ctx.fail(back, 'এই সবগুলো ভ্যারিয়েন্ট আগে থেকেই আছে।');
      const price = str(b.gen_price) || String(p.price);
      const title = [str(b.gen_title1, 18), str(b.gen_vals2) ? str(b.gen_title2, 18) : ''].filter(Boolean).join(' / ') || p.variant_title;
      try {
        await catalog.saveVariants(id, { title, rows: [
          ...old.map((v) => ({ id: v.id, label: v.variant_label, price: v.price, old_price: v.old_price, sku: v.sku, image_id: v.image_id, active: v.active })),
          ...fresh.map((label) => ({ label, price, active: true })),
        ] }, ctx.user.id, { withCost: false });
      } catch (caught) { return ctx.fail(back, (caught as Caught).message); }
      await ctx.log('product_edit', 'product', id, `ভ্যারিয়েন্ট তৈরি: ${fresh.join(', ').slice(0, 300)}`);
      return ctx.back(back, 'saved');
    }
    const L = (k: string) => ([] as unknown[]).concat(b[k] === undefined ? [] : b[k]);
    const ids = L('vid'); const labels = L('vlabel'); const prices = L('vprice'); const olds = L('vold'); const costs = L('vcost');
    const stocks = L('vstock'); const skus = L('vsku'); const imgs = L('vimage'); const actives = L('vactive');
    const remove = new Set(L('vremove').map((x) => int(x)));
    // the "remove" ticks only count when the delete permission is there; deleted variants go to the recycle bin
    if (remove.size && !ctx.can('products_delete')) return ctx.fail(back, 'ভ্যারিয়েন্ট মোছার অনুমতি আপনার নেই।');
    const rows = labels.map((label, i) => ({ id: int(ids[i]), label, price: prices[i], old_price: olds[i], cost_price: seeCost ? costs[i] : undefined,
      stock: stocks[i], sku: skus[i], image_id: imgs[i], active: actives[i] !== '0' })).filter((r) => r.id || str(r.label));
    try {
      // removed variants: into the recycle bin first (restorable), then the rest is saved
      for (const rid of remove) {
        const own = await db.one<Pick<ProductsRow, 'id' | 'name'>>('SELECT id, name FROM products WHERE id=$1 AND parent_id=$2', [rid, id]);
        if (own) { await ctx.trash('product', rid); await ctx.log('product_delete', 'product', rid, `ভ্যারিয়েন্ট মুছে ফেলা: ${own.name}`); }
      }
      await catalog.saveVariants(id, { title: b.variant_title, rows: rows.filter((r) => !remove.has(r.id)) }, ctx.user.id, { withCost: seeCost });
    } catch (caught) { const e = caught as Caught;
      if (remove.size) await db.tx((t) => catalog.syncVariants(t, id)).catch(() => {});
      return ctx.fail(back, e.message);
    }
    await ctx.log('product_edit', 'product', id, `ভ্যারিয়েন্ট সেভ: ${rows.filter((r) => !remove.has(r.id)).map((r) => str(r.label, 30)).join(', ').slice(0, 300)}`);
    return ctx.back(back, 'saved');
  }
  const variants = await catalog.listVariants(id);
  const images = p.images || [];
  const blanks = variants.length ? 2 : 4;
  const body = <><p className="crumbs"><a href={`/admin/products/${attrValue(id)}`}>←{' '}<Val v={p.name} /></a></p><div className="title-row"><h1>🎨 ভ্যারিয়েন্ট{' '}<small><Val v={p.name} /></small></h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/p/${attrValue(p.slug)}`} target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div></div>{ui.flash(ctx.flash)}{' '}{ui.helpBox('ভ্যারিয়েন্ট কীভাবে কাজ করে', <ol className="steps"><li>একই পণ্যের আলাদা সাইজ/রং/মডেল থাকলে প্রতিটা এক সারিতে লিখুন — নাম (যেমন{' '}<b>লাল</b>,{' '}<b>XL</b>,{' '}<b>লাল / XL</b>), দাম, আর নতুন হলে শুরুর স্টক ও কেনা দাম।</li><li>প্রতিটা ভ্যারিয়েন্টের নিজের{' '}<b>SKU আর বারকোড</b>{' '}থাকে (খালি রাখলে নিজে থেকে বসে) — অর্ডার, ইনভেন্টরি, POS আর কুরিয়ার স্ক্যানে আলাদা পণ্য হিসেবে চলে।</li><li>দোকানে মূল পণ্যের দাম দেখাবে{' '}<b>সবচেয়ে কম দামেরটার</b>{' '}("৳১৫০ থেকে"), আর পণ্যের পেজে কাস্টমার বাছাই করবে। স্টক শেষ হওয়া অপশন কাটা দাগে দেখাবে।</li><li>কোনো অপশন সাময়িক লুকাতে সুইচ বন্ধ করুন। মুছলে রিসাইকেল বিনে যায়।</li><li>ছবি: মূল পণ্যের ছবিগুলো থেকে প্রতিটা অপশনের ছবি বাছাই করা যায় — কাস্টমার অপশন বাছলে বড় ছবিটা বদলে যাবে।</li></ol>)}{' '}{(images.length ? <div className="panel var-pics"><p className="small muted">মূল পণ্যের ছবি:</p><div className="var-pic-row">{jsxList(images.map((mid, k) => <figure><img src={`/media/${attrValue(mid)}/t`} alt="" /><figcaption className="small">ছবি{' '}{bn(k + 1)}</figcaption></figure>))}</div></div> : null)}{(ctx.readOnly ? null : <form method="post" action={attrValue(back)} className="form panel var-gen"><input type="hidden" name="gen" defaultValue="1" /><h2>✨ একবারে সব ভ্যারিয়েন্ট তৈরি করুন</h2><p className="small muted">যেমন পলি: প্রথম ঘরে রংগুলো, দ্বিতীয় ঘরে সাইজগুলো — কমা দিয়ে আলাদা করে। "সাদা / Small", "সাদা / Medium" … সবগুলো একসাথে তৈরি হবে; আগে থেকে থাকাগুলো বাদ যাবে। তারপর নিচের তালিকায় প্রতিটার দাম, স্টক আর ছবি ঠিক করে সেভ করুন। শুধু একটা ধরন (যেমন শুধু সাইজ) হলে দ্বিতীয় ঘর খালি রাখুন।</p><div className="field-row">{ui.field('প্রথম অপশন', <input name="gen_title1" defaultValue="রং" maxLength={18} />)}{ui.field('তার অপশনগুলো', <input name="gen_vals1" maxLength={300} placeholder="যেমন: সাদা, সিলভার, প্রাইভেসি" />)}</div><div className="field-row">{ui.field('দ্বিতীয় অপশন (ঐচ্ছিক)', <input name="gen_title2" defaultValue="সাইজ" maxLength={18} />)}{ui.field('তার অপশনগুলো', <input name="gen_vals2" maxLength={300} placeholder="যেমন: Small, Medium, Large" />)}</div>{ui.field('সবগুলোর শুরুর দাম ৳ (১ পিস — পরে আলাদা করে বদলাবেন)', <input name="gen_price" type="number" step="0.01" min="0" className="w-num" defaultValue={attrValue(variants.length ? '' : p.price)} />)}<button className="btn btn-sm">✨ তৈরি করুন</button></form>)}{(String(p.pack_sizes || '').trim() ? <p className="note small">📦 এই পণ্য প্যাকে বিক্রি হয় ({String(p.pack_sizes).split(',').map((n) => bn(n.trim())).join(' / ')} পিস) — সব ভ্যারিয়েন্টে একই প্যাক চলবে। প্রতিটার দাম = ১ পিসের দাম। প্যাক বদলাতে <a href={`/admin/products/${attrValue(id)}`}>মূল পণ্যের পাতায়</a> যান।</p> : null)}<form method="post" action={attrValue(back)} className="form panel" data-var-form="">{ui.field('অপশনের নাম (কাস্টমার যা দেখবে)', <><input name="variant_title" defaultValue={attrValue(p.variant_title || '')} maxLength={40} list="var-titles" placeholder="যেমন: রং, সাইজ, মডেল" /><datalist id="var-titles">{jsxList(PRESET_TITLES.map((t) => <option value={attrValue(t)}></option>))}</datalist></>, 'পণ্যের পেজে লেখা থাকবে: "রং: লাল"')}<div className="table-wrap"><table className="table compact var-table"><thead><tr><th>নাম</th><th>বিক্রির দাম ৳</th><th>আগের দাম ৳</th>{(seeCost ? <th>কেনা দাম ৳</th> : null)}<th>স্টক</th><th>SKU</th><th>ছবি</th><th>দোকানে</th><th></th></tr></thead><tbody data-var-body=""><Val v={variants.map((v, i) => rowHtml(v, { seeCost, images, i: i + 1 }))} />{' '}<Val v={Array.from({ length: blanks }, (_, i) => rowHtml({ price: p.variant_count ? '' : p.price }, { seeCost, images, i: variants.length + i + 1, blank: true }))} /></tbody></table></div><template data-var-template="">{rowHtml({}, { seeCost, images, i: 0, blank: true })}</template><p><button type="button" className="btn btn-sm btn-ghost" data-var-add="">+ আরও একটা সারি</button>{' '}<span className="small muted">খালি সারি সেভ হয় না। সর্বোচ্চ{' '}{bn(catalog.MAX_VARIANTS)}টি।</span></p>{(variants.length ? <p className="small muted">এখন মোট স্টক:{' '}<b>{bn(variants.reduce((t, v) => t + Math.max(0, v.stock), 0))}টি</b>{' '}· দাম{' '}{money(Math.min(...variants.map((v) => Number(v.price))))}{' '}থেকে। আগের ভ্যারিয়েন্টের স্টক আর কেনা দাম এখানে বদলায় না — স্টক বাড়ে পারচেজ দিয়ে, কমে অর্ডার দিয়ে, গরমিল হলে ইনভেন্টরিতে "ঠিক করুন"।</p> : (p.stock > 0 ? <p className="note small">এই পণ্যের এখনকার স্টক{' '}{bn(p.stock)}টি — প্রথম ভ্যারিয়েন্ট সেভ করলে এই স্টক প্রথম ভ্যারিয়েন্টে চলে যাবে (চাইলে পরে ভাগ করে দিন)।</p> : null))}{' '}{(ctx.readOnly ? <p className="muted">আপনার শুধু দেখার অনুমতি আছে।</p> : <button className="btn">সেভ করুন</button>)}</form></>;
  return ctx.page(`ভ্যারিয়েন্ট — ${p.name}`, body, 'products');
}

export const routes = [];
export { page };

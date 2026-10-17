// Admin → পণ্য → (a product) → 🎨 ভ্যারিয়েন্ট: the sizes / colours / models of one product.
// Every row is a variant with its own price, stock, SKU and barcode. The shop shows a picker on the product page.
import { toHtml, Val, attrValue, attrProps, jsxList } from '../react/html';
import { html, raw, int, str, bn, money } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as catalog from '../models/catalog';
import type { AdminCtx, Body, Id, Loose } from '../types';

const PRESET_TITLES = ['রং', 'সাইজ', 'মডেল', 'রং / সাইজ', 'ধরন', 'ভোল্টেজ', 'ক্ষমতা (ওয়াট)', 'দৈর্ঘ্য', 'প্যাক'];

function rowHtml(v: Loose, { seeCost, images, i, blank = false }: Body) {
  const n = blank ? '' : i;
  return toHtml(<tr className={attrValue(v.active === false ? 'row-off' : '')} data-var-row=""><td><input type="hidden" name="vid" defaultValue={attrValue(v.id || '')} />{' '}<input name="vlabel" defaultValue={attrValue(v.variant_label || '')} maxLength={60} placeholder="যেমন: লাল / XL" className="w-md" {...attrProps(blank ? '' : raw('required'))} aria-label={`ভ্যারিয়েন্টের নাম ${attrValue(n)}`} /></td><td><input name="vprice" type="number" step="0.01" min="0" defaultValue={attrValue(v.price ?? '')} className="w-num" aria-label="বিক্রির দাম" /></td><td><input name="vold" type="number" step="0.01" min="0" defaultValue={attrValue(v.old_price ?? '')} className="w-num" aria-label="আগের দাম" /></td>{(!seeCost ? null : (v.id ? <td><input type="hidden" name="vcost" defaultValue="" /><b>{(Number(v.cost_price) > 0 ? <Val v={money(v.cost_price)} /> : <span className="warn">—</span>)}</b><br /><a className="small" href={`/admin/products/${attrValue(v.id)}/ledger`}>📒 হিসাব</a></td> : <td><input name="vcost" type="number" step="0.01" min="0" defaultValue={attrValue(v.cost_price ?? '')} className="w-num" aria-label="কেনা দাম" /></td>))}{' '}{(v.id ? <td><input type="hidden" name="vstock" defaultValue="" /><b><Val v={bn(v.stock ?? 0)} /></b><br /><a className="small" href={`/admin/inventory?q=${attrValue(encodeURIComponent(v.sku || ''))}`}>ঠিক করুন</a></td> : <td><input name="vstock" type="number" min="0" defaultValue={attrValue(v.stock ?? '')} className="w-num" placeholder="শুরুর স্টক" aria-label="শুরুর স্টক" /></td>)}<td><input name="vsku" defaultValue={attrValue(v.sku || '')} maxLength={60} className="w-sm" placeholder="নিজে বসবে" aria-label="SKU" />{(v.barcode ? <><br /><span className="small muted mono"><Val v={v.barcode} /></span></> : null)}</td><td>{(images.length ? <Val v={ui.select('vimage', [['', '— মূল ছবি —'], ...images.map((id?: Loose, k?: Loose) => [id, `ছবি ${bn(k + 1)}`])], v.image_id || '', { 'aria-label': 'ছবি', 'data-var-img': true })} /> : <><input type="hidden" name="vimage" defaultValue="" /><span className="small muted">ছবি নেই</span></>)}</td><td><label className="switch" title="বন্ধ = দোকানে এই অপশন দেখাবে না"><input type="checkbox" name={`vactive_${attrValue(blank ? 'new' : v.id || 'new')}`} defaultValue="1" {...attrProps(v.active === false ? '' : raw('checked'))} data-var-active="" /><span className="switch-ui" aria-hidden="true"></span></label>{' '}<input type="hidden" name="vactive" defaultValue={attrValue(v.active === false ? '0' : '1')} data-var-active-val="" /></td><td>{(v.id ? <label className="check small"><input type="checkbox" name="vremove" defaultValue={attrValue(v.id)} />{' '}<span>মুছুন</span></label> : <span className="small muted">নতুন</span>)}</td></tr>);
}

async function page(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  const p = await catalog.getProduct({ id });
  if (!p) return ctx.redirect('/admin/products');
  if (p.parent_id) return ctx.redirect(`/admin/products/${p.parent_id}/variants`);
  const seeCost = ctx.can('see_cost');
  const back = `/admin/products/${id}/variants`;
  if (ctx.method === 'POST') {
    if (ctx.readOnly) return ctx.back(back, 'noperm');
    const b = await ctx.body();
    const L = (k?: Loose) => ([] as Loose[]).concat(b[k] === undefined ? [] : b[k]);
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
        const own = await db.one('SELECT id, name FROM products WHERE id=$1 AND parent_id=$2', [rid, id]);
        if (own) { await ctx.trash('product', rid); await ctx.log('product_delete', 'product', rid, `ভ্যারিয়েন্ট মুছে ফেলা: ${own.name}`); }
      }
      await catalog.saveVariants(id, { title: b.variant_title, rows: rows.filter((r) => !remove.has(r.id)) }, ctx.user.id, { withCost: seeCost });
    } catch (e: Loose) {
      if (remove.size) await db.tx((t) => catalog.syncVariants(t, id)).catch(() => {});
      return ctx.fail(back, e.message);
    }
    await ctx.log('product_edit', 'product', id, `ভ্যারিয়েন্ট সেভ: ${rows.filter((r) => !remove.has(r.id)).map((r) => str(r.label, 30)).join(', ').slice(0, 300)}`);
    return ctx.back(back, 'saved');
  }
  const variants = await catalog.listVariants(id);
  const images = p.images || [];
  const blanks = variants.length ? 2 : 4;
  const body = toHtml(<><p className="crumbs"><a href={`/admin/products/${attrValue(id)}`}>←{' '}<Val v={p.name} /></a></p><div className="title-row"><h1>🎨 ভ্যারিয়েন্ট{' '}<small><Val v={p.name} /></small></h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/p/${attrValue(p.slug)}`} target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div></div><Val v={ui.flash(ctx.flash)} />{' '}<Val v={ui.helpBox('ভ্যারিয়েন্ট কীভাবে কাজ করে', toHtml(<ol className="steps"><li>একই পণ্যের আলাদা সাইজ/রং/মডেল থাকলে প্রতিটা এক সারিতে লিখুন — নাম (যেমন{' '}<b>লাল</b>,{' '}<b>XL</b>,{' '}<b>লাল / XL</b>), দাম, আর নতুন হলে শুরুর স্টক ও কেনা দাম।</li><li>প্রতিটা ভ্যারিয়েন্টের নিজের{' '}<b>SKU আর বারকোড</b>{' '}থাকে (খালি রাখলে নিজে থেকে বসে) — অর্ডার, ইনভেন্টরি, POS আর কুরিয়ার স্ক্যানে আলাদা পণ্য হিসেবে চলে।</li><li>দোকানে মূল পণ্যের দাম দেখাবে{' '}<b>সবচেয়ে কম দামেরটার</b>{' '}("৳১৫০ থেকে"), আর পণ্যের পেজে কাস্টমার বাছাই করবে। স্টক শেষ হওয়া অপশন কাটা দাগে দেখাবে।</li><li>কোনো অপশন সাময়িক লুকাতে সুইচ বন্ধ করুন। মুছলে রিসাইকেল বিনে যায়।</li><li>ছবি: মূল পণ্যের ছবিগুলো থেকে প্রতিটা অপশনের ছবি বাছাই করা যায় — কাস্টমার অপশন বাছলে বড় ছবিটা বদলে যাবে।</li></ol>))} />{' '}{(images.length ? <div className="panel var-pics"><p className="small muted">মূল পণ্যের ছবি:</p><div className="var-pic-row">{jsxList(images.map((mid?: Loose, k?: Loose) => <figure><img src={`/media/${attrValue(mid)}/t`} alt="" /><figcaption className="small">ছবি{' '}<Val v={bn(k + 1)} /></figcaption></figure>))}</div></div> : null)}<form method="post" action={attrValue(back)} className="form panel" data-var-form=""><Val v={ui.field('অপশনের নাম (কাস্টমার যা দেখবে)', toHtml(<><input name="variant_title" defaultValue={attrValue(p.variant_title || '')} maxLength={40} list="var-titles" placeholder="যেমন: রং, সাইজ, মডেল" /><datalist id="var-titles">{jsxList(PRESET_TITLES.map((t) => <option value={attrValue(t)}></option>))}</datalist></>), 'পণ্যের পেজে লেখা থাকবে: "রং: লাল"')} /><div className="table-wrap"><table className="table compact var-table"><thead><tr><th>নাম</th><th>বিক্রির দাম ৳</th><th>আগের দাম ৳</th>{(seeCost ? <th>কেনা দাম ৳</th> : null)}<th>স্টক</th><th>SKU</th><th>ছবি</th><th>দোকানে</th><th></th></tr></thead><tbody data-var-body=""><Val v={variants.map((v, i) => rowHtml(v, { seeCost, images, i: i + 1 }))} />{' '}<Val v={Array.from({ length: blanks }, (_, i) => rowHtml({ price: p.variant_count ? '' : p.price }, { seeCost, images, i: variants.length + i + 1, blank: true }))} /></tbody></table></div><template data-var-template=""><Val v={rowHtml({}, { seeCost, images, i: 0, blank: true })} /></template><p><button type="button" className="btn btn-sm btn-ghost" data-var-add="">+ আরও একটা সারি</button>{' '}<span className="small muted">খালি সারি সেভ হয় না। সর্বোচ্চ{' '}<Val v={bn(catalog.MAX_VARIANTS)} />টি।</span></p>{(variants.length ? <p className="small muted">এখন মোট স্টক:{' '}<b><Val v={bn(variants.reduce((t, v) => t + Math.max(0, v.stock), 0))} />টি</b>{' '}· দাম{' '}<Val v={money(Math.min(...variants.map((v) => Number(v.price))))} />{' '}থেকে। আগের ভ্যারিয়েন্টের স্টক আর কেনা দাম এখানে বদলায় না — স্টক বাড়ে পারচেজ দিয়ে, কমে অর্ডার দিয়ে, গরমিল হলে ইনভেন্টরিতে "ঠিক করুন"।</p> : (p.stock > 0 ? <p className="note small">এই পণ্যের এখনকার স্টক{' '}<Val v={bn(p.stock)} />টি — প্রথম ভ্যারিয়েন্ট সেভ করলে এই স্টক প্রথম ভ্যারিয়েন্টে চলে যাবে (চাইলে পরে ভাগ করে দিন)।</p> : null))}{' '}{(ctx.readOnly ? <p className="muted">আপনার শুধু দেখার অনুমতি আছে।</p> : <button className="btn">সেভ করুন</button>)}</form></>);
  return ctx.page(`ভ্যারিয়েন্ট — ${p.name}`, body, 'products');
}

export const routes = [];
export { page };

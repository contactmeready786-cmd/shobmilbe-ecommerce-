'use strict';
// Admin → পণ্য → (a product) → 🎨 ভ্যারিয়েন্ট: the sizes / colours / models of one product.
// Every row is a variant with its own price, stock, SKU and barcode. The shop shows a picker on the product page.
const { html, raw, int, str, bn, money } = require('../util');
const db = require('../db');
const ui = require('./ui');
const catalog = require('../models/catalog');

const PRESET_TITLES = ['রং', 'সাইজ', 'মডেল', 'রং / সাইজ', 'ধরন', 'ভোল্টেজ', 'ক্ষমতা (ওয়াট)', 'দৈর্ঘ্য', 'প্যাক'];

function rowHtml(v, { seeCost, images, i, blank = false }) {
  const n = blank ? '' : i;
  return html`<tr class="${v.active === false ? 'row-off' : ''}" data-var-row>
    <td><input type="hidden" name="vid" value="${v.id || ''}">
      <input name="vlabel" value="${v.variant_label || ''}" maxlength="60" placeholder="যেমন: লাল / XL" class="w-md" ${blank ? '' : raw('required')} aria-label="ভ্যারিয়েন্টের নাম ${n}"></td>
    <td><input name="vprice" type="number" step="0.01" min="0" value="${v.price ?? ''}" class="w-num" aria-label="বিক্রির দাম"></td>
    <td><input name="vold" type="number" step="0.01" min="0" value="${v.old_price ?? ''}" class="w-num" aria-label="আগের দাম"></td>
    ${seeCost ? html`<td><input name="vcost" type="number" step="0.01" min="0" value="${v.cost_price ?? ''}" class="w-num" aria-label="কেনা দাম"></td>` : ''}
    <td><input name="vstock" type="number" min="0" value="${v.stock ?? (blank ? '' : 0)}" class="w-num" aria-label="স্টক"></td>
    <td><input name="vsku" value="${v.sku || ''}" maxlength="60" class="w-sm" placeholder="নিজে বসবে" aria-label="SKU">${v.barcode ? html`<br><span class="small muted mono">${v.barcode}</span>` : ''}</td>
    <td>${images.length ? ui.select('vimage', [['', '— মূল ছবি —'], ...images.map((id, k) => [id, `ছবি ${bn(k + 1)}`])], v.image_id || '', { 'aria-label': 'ছবি', 'data-var-img': true })
    : html`<input type="hidden" name="vimage" value=""><span class="small muted">ছবি নেই</span>`}</td>
    <td><label class="switch" title="বন্ধ = দোকানে এই অপশন দেখাবে না"><input type="checkbox" name="vactive_${blank ? 'new' : v.id || 'new'}" value="1" ${v.active === false ? '' : raw('checked')} data-var-active><span class="switch-ui" aria-hidden="true"></span></label>
      <input type="hidden" name="vactive" value="${v.active === false ? '0' : '1'}" data-var-active-val></td>
    <td>${v.id ? html`<label class="check small"><input type="checkbox" name="vremove" value="${v.id}"> <span>মুছুন</span></label>` : html`<span class="small muted">নতুন</span>`}</td>
  </tr>`;
}

async function page(ctx, m) {
  const id = int(m[1]);
  const p = await catalog.getProduct({ id });
  if (!p) return ctx.redirect(ctx.res, '/admin/products');
  if (p.parent_id) return ctx.redirect(ctx.res, `/admin/products/${p.parent_id}/variants`);
  const seeCost = ctx.can('see_cost');
  const back = `/admin/products/${id}/variants`;
  if (ctx.method === 'POST') {
    if (ctx.readOnly) return ctx.back(back, 'noperm');
    const b = await ctx.body();
    const L = (k) => [].concat(b[k] === undefined ? [] : b[k]);
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
    } catch (e) {
      if (remove.size) await db.tx((t) => catalog.syncVariants(t, id)).catch(() => {});
      return ctx.fail(back, e.message);
    }
    await ctx.log('product_edit', 'product', id, `ভ্যারিয়েন্ট সেভ: ${rows.filter((r) => !remove.has(r.id)).map((r) => str(r.label, 30)).join(', ').slice(0, 300)}`);
    return ctx.back(back, 'saved');
  }
  const variants = await catalog.listVariants(id);
  const images = p.images || [];
  const blanks = variants.length ? 2 : 4;
  const body = html`<p class="crumbs"><a href="/admin/products/${id}">← ${p.name}</a></p>
<div class="title-row"><h1>🎨 ভ্যারিয়েন্ট <small>${p.name}</small></h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="/p/${p.slug}" target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('ভ্যারিয়েন্ট কীভাবে কাজ করে', html`<ol class="steps">
  <li>একই পণ্যের আলাদা সাইজ/রং/মডেল থাকলে প্রতিটা এক সারিতে লিখুন — নাম (যেমন <b>লাল</b>, <b>XL</b>, <b>লাল / XL</b>), দাম আর স্টক।</li>
  <li>প্রতিটা ভ্যারিয়েন্টের নিজের <b>SKU আর বারকোড</b> থাকে (খালি রাখলে নিজে থেকে বসে) — অর্ডার, ইনভেন্টরি, POS আর কুরিয়ার স্ক্যানে আলাদা পণ্য হিসেবে চলে।</li>
  <li>দোকানে মূল পণ্যের দাম দেখাবে <b>সবচেয়ে কম দামেরটার</b> ("৳১৫০ থেকে"), আর পণ্যের পেজে কাস্টমার বাছাই করবে। স্টক শেষ হওয়া অপশন কাটা দাগে দেখাবে।</li>
  <li>কোনো অপশন সাময়িক লুকাতে সুইচ বন্ধ করুন। মুছলে রিসাইকেল বিনে যায়।</li>
  <li>ছবি: মূল পণ্যের ছবিগুলো থেকে প্রতিটা অপশনের ছবি বাছাই করা যায় — কাস্টমার অপশন বাছলে বড় ছবিটা বদলে যাবে।</li>
</ol>`)}
${images.length ? html`<div class="panel var-pics"><p class="small muted">মূল পণ্যের ছবি:</p><div class="var-pic-row">${images.map((mid, k) => html`<figure><img src="/media/${mid}/t" alt=""><figcaption class="small">ছবি ${bn(k + 1)}</figcaption></figure>`)}</div></div>` : ''}
<form method="post" action="${back}" class="form panel" data-var-form>
  ${ui.field('অপশনের নাম (কাস্টমার যা দেখবে)', html`<input name="variant_title" value="${p.variant_title || ''}" maxlength="40" list="var-titles" placeholder="যেমন: রং, সাইজ, মডেল"><datalist id="var-titles">${PRESET_TITLES.map((t) => html`<option value="${t}">`)}</datalist>`, 'পণ্যের পেজে লেখা থাকবে: "রং: লাল"')}
  <div class="table-wrap"><table class="table compact var-table">
    <thead><tr><th>নাম</th><th>বিক্রির দাম ৳</th><th>আগের দাম ৳</th>${seeCost ? html`<th>কেনা দাম ৳</th>` : ''}<th>স্টক</th><th>SKU</th><th>ছবি</th><th>দোকানে</th><th></th></tr></thead>
    <tbody data-var-body>
      ${variants.map((v, i) => rowHtml(v, { seeCost, images, i: i + 1 }))}
      ${Array.from({ length: blanks }, (_, i) => rowHtml({ price: p.variant_count ? '' : p.price }, { seeCost, images, i: variants.length + i + 1, blank: true }))}
    </tbody>
  </table></div>
  <template data-var-template>${rowHtml({}, { seeCost, images, i: 0, blank: true })}</template>
  <p><button type="button" class="btn btn-sm btn-ghost" data-var-add>+ আরও একটা সারি</button> <span class="small muted">খালি সারি সেভ হয় না। সর্বোচ্চ ${bn(catalog.MAX_VARIANTS)}টি।</span></p>
  ${variants.length ? html`<p class="small muted">এখন মোট স্টক: <b>${bn(variants.reduce((t, v) => t + Math.max(0, v.stock), 0))}টি</b> · দাম ${money(Math.min(...variants.map((v) => Number(v.price))))} থেকে। স্টক বদলালে ইনভেন্টরির ইতিহাসে লেখা থাকে।</p>`
    : p.stock > 0 ? html`<p class="note small">এই পণ্যের এখনকার স্টক ${bn(p.stock)}টি — প্রথম ভ্যারিয়েন্ট সেভ করলে এই স্টক প্রথম ভ্যারিয়েন্টে চলে যাবে (চাইলে পরে ভাগ করে দিন)।</p>` : ''}
  ${ctx.readOnly ? html`<p class="muted">আপনার শুধু দেখার অনুমতি আছে।</p>` : html`<button class="btn">সেভ করুন</button>`}
</form>`;
  return ctx.page(`ভ্যারিয়েন্ট — ${p.name}`, body, 'products');
}

module.exports = { page, routes: [] };

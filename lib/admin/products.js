'use strict';
const { html, raw, money, bn, int, str, pageNum, list, youtubeId, pct, fmtDate, amount, qtyRule } = require('../util');
const catalog = require('../models/catalog');
const dupes = require('../models/duplicates');
const security = require('../security');
const db = require('../db');
const ui = require('./ui');
const navswitch = require('./navswitch');

const PER_PAGE = 40;
const ICONS = ['📦', '📟', '🧩', '🔋', '🔥', '🔌', '👕', '👗', '👟', '👜', '⌚', '📱', '💻', '🎧', '🔊', '📷', '🎮', '💡', '🔧', '🛠️', '⚙️',
  '🧲', '🧪', '🏠', '🛋️', '🍳', '🧴', '💄', '🧸', '📚', '✏️', '⚽', '🚲', '🚗', '🌱', '🐾', '🍎', '☕', '🎁', '💍', '🕶️', '🧢', '🧥', '🩺', '🧼', '📡', '🔦', '🪛', '🧵'];

async function listPage(ctx) {
  const page = pageNum(ctx.query);
  const categories = await catalog.listCategories();
  const f = {
    q: str(ctx.query.get('q'), 80),
    categoryId: int(ctx.query.get('cat')) || null,
    brandId: int(ctx.query.get('brand')) || null,
    type: ['single', 'bundle'].includes(ctx.query.get('type')) ? ctx.query.get('type') : '',
    lowStock: ctx.query.get('low') === '1',
    status: ['on', 'off'].includes(ctx.query.get('status')) ? ctx.query.get('status') : '',
    outStock: ctx.query.get('out') === '1',
    includeInactive: true,
  };
  const sort = ['sku', 'sku_desc', 'new', 'name', 'price_asc', 'price_desc', 'stock_asc', 'popular'].includes(ctx.query.get('sort')) ? ctx.query.get('sort') : 'sku';
  const [rows, total, stats, brands] = await Promise.all([
    catalog.listProducts({ ...f, sort, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), catalog.countProducts(f),
    catalog.productStats({ type: f.type }), catalog.listBrands(),
  ]);
  const seeCost = ctx.can('see_cost');
  const qsBase = new URLSearchParams();
  if (f.q) qsBase.set('q', f.q);
  if (f.categoryId) qsBase.set('cat', f.categoryId);
  if (f.brandId) qsBase.set('brand', f.brandId);
  if (f.type) qsBase.set('type', f.type);
  if (f.lowStock) qsBase.set('low', '1');
  if (f.status) qsBase.set('status', f.status);
  if (f.outStock) qsBase.set('out', '1');
  if (sort !== 'sku') qsBase.set('sort', sort);
  const isBundle = f.type === 'bundle';
  const backUrl = '/admin/products' + (() => { const x = new URLSearchParams(qsBase); if (page > 1) x.set('page', page); if (isBundle) x.set('type', 'bundle'); const t = x.toString(); return t ? '?' + t : ''; })();
  const body = html`
<div class="title-row"><h1>${isBundle ? 'বান্ডেল / প্যাকেজ' : 'পণ্য'} <small>${bn(total)}টি</small></h1>
  <div class="row-actions">
    ${ctx.can('products') || ctx.can('products_add') ? html`<a class="btn" href="/admin/products/new${isBundle ? '?type=bundle' : ''}">+ ${isBundle ? 'নতুন বান্ডেল' : 'নতুন পণ্য'}</a>
    ${isBundle ? '' : html`<a class="btn btn-ghost" href="/admin/products/import">📥 পণ্য আমদানি</a><a class="btn btn-ghost" href="/admin/products/new?type=bundle">+ বান্ডেল</a>`}` : ''}
  </div>
</div>
${ui.flash(ctx.flash)}
${statChips(stats, f, isBundle)}
${isBundle ? '' : navswitch.box(ctx, { urls: ['/products', '/products?sort=offer'], footer: ['products', 'offer'], back: '/admin/products' })}
${isBundle ? ui.helpBox('বান্ডেল কী?', html`কয়েকটা পণ্য একসাথে এক দামে বিক্রি করাকে বান্ডেল/প্যাকেজ বলে। যেমন "সোল্ডারিং কিট" = আয়রন + তার + স্ট্যান্ড। বান্ডেল বিক্রি হলে ভেতরের প্রতিটা পণ্যের স্টক নিজে থেকে কমবে। বান্ডেলের স্টক = ভেতরের পণ্যগুলোর মধ্যে যেটা সবচেয়ে কম আছে।`) : ''}
<form class="toolbar filters" method="get" action="/admin/products">
  <input type="search" name="q" value="${f.q}" placeholder="নাম, SKU, ব্র্যান্ড বা বারকোড" id="prod-q"><button type="button" class="btn btn-sm btn-ghost" data-scan-into="#prod-q" title="ক্যামেরা দিয়ে বারকোড স্ক্যান">📷</button>
  ${ui.select('cat', [['', 'সব ক্যাটাগরি'], ...ui.catOpts(categories)], f.categoryId || '')}
  ${brands.length ? ui.select('brand', [['', 'সব ব্র্যান্ড'], ...brands.map((b) => [b.id, b.name])], f.brandId || '') : ''}
  ${ui.select('type', [['', 'সব ধরন'], ['single', 'একক পণ্য'], ['bundle', 'বান্ডেল']], f.type)}
  ${f.status ? html`<input type="hidden" name="status" value="${f.status}">` : ''}${f.outStock ? html`<input type="hidden" name="out" value="1">` : ''}
  ${ui.select('sort', [['sku', 'SKU ১, ২, ৩… (ক্রমানুসারে)'], ['sku_desc', 'SKU বড় থেকে ছোট'], ['new', 'নতুন আগে'], ['name', 'নাম (A-Z)'], ['price_asc', 'দাম কম→বেশি'], ['price_desc', 'দাম বেশি→কম'], ['stock_asc', 'স্টক কম আগে'], ['popular', 'বেশি বিক্রি']], sort)}
  ${ui.check('low', f.lowStock, 'শুধু স্টক কম')}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${rows.length ? html`${bulkBar(ctx, categories, brands)}<div class="table-wrap panel"><table class="table">
<thead><tr>${canBulk(ctx) ? html`<th class="pick"><input type="checkbox" data-pbulk-all aria-label="এই পেজের সব পণ্য বাছুন"></th>` : ''}<th></th><th>পণ্য</th><th>SKU</th><th>ক্যাটাগরি</th><th class="num">দাম</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">লাভ</th>` : ''}<th class="num">স্টক</th><th class="num">বিক্রি</th><th>দোকানে দেখাবে</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((p) => {
    const margin = p.price > 0 && p.cost_price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : null;
    return html`<tr class="${p.active ? '' : 'row-off'}">
  ${canBulk(ctx) ? html`<td class="pick"><input type="checkbox" name="ids[]" value="${p.id}" form="prod-bulk" data-pbulk-row aria-label="${p.name} বাছুন"></td>` : ''}
  <td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="" loading="lazy">` : html`<span>${p.emoji}</span>`}</td>
  <td><b>${p.name}</b>${p.model ? html` <span class="small muted">${p.model}</span>` : ''}${p.brand ? html`<br><span class="small muted">🏷️ ${p.brand}</span>` : ''}
    ${p.product_type === 'bundle' ? html` <span class="pill pill-bundle">বান্ডেল</span>` : ''}${p.featured ? html` <span class="pill">জনপ্রিয়</span>` : ''}
    ${p.old_price > p.price ? html` <span class="pill pill-offer">অফার</span>` : ''}${p.is_new ? html` <span class="pill pill-new">নতুন</span>` : ''}</td>
  <td class="small">${p.sku || '—'}</td>
  <td class="small">${p.category_name ? `${p.category_icon} ${p.category_name}` : '—'}</td>
  <td class="num">${money(p.price)}${p.old_price > p.price ? html`<br><s class="small muted">${money(p.old_price)}</s>` : ''}</td>
  ${seeCost ? html`<td class="num">${p.cost_price ? money(p.cost_price) : html`<span class="muted">—</span>`}</td>
  <td class="num ${margin !== null && margin < 10 ? 'warn' : 'good'}">${margin !== null ? html`${money(p.price - p.cost_price)}<br><span class="small">${pct(margin)}</span>` : '—'}</td>` : ''}
  <td class="num ${p.stock <= p.low_stock ? 'warn' : ''}">${bn(p.stock)}</td>
  <td class="num">${bn(p.sold_count)}</td>
  <td>${ctx.can('products') ? html`<form method="post" action="/admin/products/${p.id}/active" class="prod-toggle">
    <input type="hidden" name="back" value="${backUrl}">
    <label class="switch" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে পুরো লুকিয়ে যাবে">
      <input type="checkbox" name="active" value="1" ${p.active ? raw('checked') : ''} data-prod-toggle aria-label="${p.name} দোকানে দেখাবে">
      <span class="switch-ui" aria-hidden="true"></span></label>
    <span class="small prod-toggle-text" data-prod-toggle-text>${p.active ? 'চালু' : 'বন্ধ'}</span>
    <noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript>
  </form>` : html`<span class="small">${p.active ? 'চালু' : 'বন্ধ'}</span>`}</td>
  <td class="prod-actions">
    <a class="btn btn-sm btn-ghost" href="/admin/products/${p.id}">${ctx.can('products') ? '✏️ এডিট' : '👁️ দেখুন'}</a>
    ${ctx.can('products_delete') ? html`<form method="post" action="/admin/products/${p.id}/delete" data-confirm="'${p.name}' পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু দোকান থেকে সরাতে চাইলে পাশের সুইচ বন্ধ করুন।">
      <input type="hidden" name="back" value="${backUrl}">
      <button class="btn btn-sm btn-danger">🗑️ মুছুন</button>
    </form>` : ''}
  </td>
</tr>`;
  })}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, '/admin/products' + (qsBase.toString() ? '?' + qsBase : ''))}`
    : ui.empty('কোনো পণ্য পাওয়া যায়নি।', html`<a class="btn" href="/admin/products/new">পণ্য যোগ করুন</a>`)}
`;
  return ctx.page(isBundle ? 'বান্ডেল' : 'পণ্য', body, isBundle ? 'bundles' : 'products');
}

// ---------------------------------------------------------------- bulk edit (many products at once)
const canBulk = (ctx) => ctx.can('products') || ctx.can('products_delete');
function bulkBar(ctx, categories, brands = []) {
  if (!canBulk(ctx)) return '';
  const edit = ctx.can('products');
  const acts = [
    ...(edit ? [['on', '🟢 দোকানে চালু করুন'], ['off', '⚪ দোকান থেকে বন্ধ করুন'], ['category', '🗂️ ক্যাটাগরি বদলান'], ['brand', '🏷️ ব্র্যান্ড বদলান'],
      ['price_pct', '💲 দাম % বাড়ান/কমান'], ['price_add', '💲 দাম ৳ বাড়ান/কমান'], ['new_on', '🆕 "নতুন" ট্যাগ দিন'], ['new_off', '"নতুন" ট্যাগ তুলুন'],
      ['featured_on', '⭐ জনপ্রিয়-তে দেখান'], ['featured_off', 'জনপ্রিয় থেকে সরান'], ['low_stock', '🟡 "স্টক কম" সীমা বসান']] : []),
    ['labels', '🏷️ বারকোড লেবেল প্রিন্ট'],
    ...(ctx.can('products_delete') ? [['delete', '🗑️ মুছে ফেলুন (রিসাইকেল বিনে)']] : []),
  ];
  return html`<form method="post" action="/admin/products/bulk" id="prod-bulk" class="bulk-bar" data-pbulk hidden>
    <input type="hidden" name="back" value="${ctx.path + (ctx.query.toString() ? '?' + ctx.query : '')}">
    <b data-pbulk-count>০</b>টি পণ্য বাছাই করা:
    ${ui.select('action', [['', '— কী করবেন বাছুন —'], ...acts], '', { 'data-pbulk-action': true, required: true })}
    <span data-pbulk-for="category" hidden>${ui.select('category_id', [['', 'কোনো ক্যাটাগরি না'], ...ui.catOpts(categories)], '')}</span>
    <span data-pbulk-for="brand" hidden>${ui.input('brand', '', { maxlength: 60, list: 'brand-list-bulk', placeholder: 'ব্র্যান্ডের নাম (খালি = ব্র্যান্ড সরান)' })}<datalist id="brand-list-bulk">${brands.map((x) => html`<option value="${x.name}">`)}</datalist></span>
    <span data-pbulk-for="price_pct" hidden>${ui.input('pct', '', { type: 'number', step: '0.1', min: -90, max: 500, placeholder: 'যেমন 10 বা -5', class: 'w-num' })} %</span>
    <span data-pbulk-for="price_add" hidden>৳ ${ui.input('add', '', { type: 'number', step: '0.01', placeholder: 'যেমন 20 বা -10', class: 'w-num' })}</span>
    <span data-pbulk-for="low_stock" hidden>${ui.input('low', '', { type: 'number', min: 0, placeholder: 'যেমন 5', class: 'w-num' })}</span>
    <span data-pbulk-for="price_pct price_add" hidden>${ui.check('keep_old', true, 'আগের দাম কাটা দাগে দেখাও (অফার)')}</span>
    <button class="btn btn-sm">প্রয়োগ করুন</button>
    <button type="button" class="link-btn small" data-pbulk-clear>বাছাই বাতিল</button>
  </form>`;
}
// new price after a % or ৳ change: never below ৳0.01; whole taka once the price is ৳10 or more
function bulkPrice(price, { pct, add }) {
  let v = Number(price) || 0;
  if (pct) v *= 1 + pct / 100;
  if (add) v += add;
  v = Math.max(0.01, v);
  return v >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
}
async function bulkAction(ctx) {
  const b = await ctx.body();
  const back = backTo(b);
  const ids = [...new Set(list(b.ids).map((x) => int(x)).filter((x) => x > 0))].slice(0, 500);
  if (!ids.length) return ctx.fail(back, 'কোনো পণ্য বাছাই করা হয়নি।');
  const act = String(b.action || '');
  if (act === 'labels') return ctx.redirect(ctx.res, '/admin/products/labels?ids=' + ids.join(','));
  if (act === 'delete') {
    if (!ctx.can('products_delete')) return ctx.back(back.split('?')[0], 'noperm');
    for (const id of ids) await ctx.trash('product', id);
    await ctx.log('product_bulk', 'product', null, `একসাথে ${ids.length}টি পণ্য মুছে রিসাইকেল বিনে`);
    return ctx.redirect(ctx.res, back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent(`${bn(ids.length)}টি পণ্য মুছে রিসাইকেল বিনে রাখা হয়েছে।`));
  }
  if (!ctx.can('products')) return ctx.back(back.split('?')[0], 'noperm');
  const simple = {
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
      const rowsP = (await t.query('SELECT id, name, price, old_price FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [ids])).rows;
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
  }).catch((e) => { what = ''; ctx.__err = e.message; });
  if (!what) return ctx.fail(back, ctx.__err || 'কাজটা করা যায়নি।');
  await ctx.log('product_bulk', 'product', null, `${ids.length}টি পণ্য: ${what}`);
  return ctx.redirect(ctx.res, back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent(`✅ ${bn(ids.length)}টি পণ্যে করা হয়েছে: ${what}`));
}

// Small count chips above the list: total / on the shop / hidden / stock out / low stock. Each one is a filter.
function statChips(st, f, isBundle) {
  const base = isBundle ? '/admin/products?type=bundle' : '/admin/products';
  const link = (extra) => base + (extra ? (base.includes('?') ? '&' : '?') + extra : '');
  const none = !f.status && !f.outStock && !f.lowStock;
  const word = isBundle ? 'বান্ডেল' : 'পণ্য';
  return html`<div class="chips status-chips stat-chips" aria-label="${word}ের হিসাব">
  <a class="chip chip-all ${none ? 'on' : ''}" href="${link('')}">📦 মোট ${word} <b>${bn(st.total)}</b></a>
  <a class="chip chip-active ${f.status === 'on' ? 'on' : ''}" href="${link('status=on')}">🟢 চালু (দোকানে আছে) <b>${bn(st.active)}</b></a>
  <a class="chip chip-hidden ${f.status === 'off' ? 'on' : ''}" href="${link('status=off')}">⚪ বন্ধ (লুকানো) <b>${bn(st.hidden)}</b></a>
  <a class="chip chip-out ${f.outStock ? 'on' : ''}" href="${link('out=1')}">🔴 স্টক আউট <b>${bn(st.out)}</b></a>
  <a class="chip chip-low ${f.lowStock && !f.outStock ? 'on' : ''}" href="${link('low=1')}">🟡 স্টক কম <b>${bn(st.low)}</b></a>
</div>`;
}

const MAX_IMAGES = catalog.MAX_PRODUCT_IMAGES;
function imageSlot(i, id) {
  const label = i === 0 ? 'মূল ছবি' : `ছবি ${bn(i + 1)}`;
  return html`<div class="slot ${id ? 'filled' : ''} ${i === 0 ? 'slot-main' : ''}" data-slot="${i}" data-img="${id || ''}">
    <span class="slot-no">${label}</span>
    <label class="slot-add" title="${label} যোগ করুন">${id ? html`<img src="/media/${id}/t" alt="${label}">` : html`<span class="slot-plus" aria-hidden="true">＋</span><span class="slot-hint">ছবি যোগ করুন</span>`}<input type="file" accept="image/*" multiple hidden data-slot-file aria-label="${label} বাছুন"></label>
    <div class="g-tools" ${id ? '' : raw('hidden')}><button type="button" data-slot-move="-1" aria-label="আগে নিন">◀</button><button type="button" data-slot-change aria-label="ছবি বদলান">বদলান</button><button type="button" data-slot-move="1" aria-label="পরে নিন">▶</button><button type="button" data-slot-del aria-label="মুছুন">✕</button></div>
  </div>`;
}

// ---------------------------------------------------------------- duplicate guard
function dupMatches(matches) {
  return html`<ul class="dup-list">${matches.map((m) => html`<li class="dup-item ${m.level === 'block' ? 'is-block' : 'is-warn'}">
    <a class="dup-thumb" href="/admin/products/${m.id}" target="_blank" rel="noopener">${m.image ? html`<img src="${m.image}" alt="" loading="lazy">` : html`<span>${m.emoji || '📦'}</span>`}</a>
    <div class="dup-info">
      <a href="/admin/products/${m.id}" target="_blank" rel="noopener"><b>${m.name}</b></a>
      <span class="small muted">${m.sku ? `SKU ${m.sku} · ` : ''}${money(m.price)}${m.active ? '' : ' · লুকানো পণ্য'}</span>
      <span class="dup-why">${m.level === 'block' ? '⛔ ' : '⚠️ '}${m.reasons.join(' · ')}</span>
    </div>
    ${dupActs(m)}
  </li>`)}</ul>`;
}
// "বন্ধ করুন / চালু করুন" and "মুছুন" for a product shown as a duplicate (works without leaving the page).
function dupActs(m) {
  return html`<div class="dup-acts" data-dup-acts data-id="${m.id}" data-name="${m.name || m.title || ''}">
    <button type="button" class="btn btn-sm btn-ghost" data-dup-act="toggle" data-on="${m.active ? '1' : ''}">${m.active ? '🚫 বন্ধ করুন' : '✅ চালু করুন'}</button>
    <button type="button" class="btn btn-sm btn-danger" data-dup-act="delete">🗑️ মুছুন</button>
  </div>`;
}
function dupPanel({ dup, canOverride, allow, id }) {
  const blocked = dup && dup.blocked;
  const showSwitch = blocked || allow;
  return html`<section class="panel dup-box ${blocked ? 'is-block' : dup && dup.matches.length ? 'is-warn' : ''}" data-dup-box data-dup-id="${id || ''}" data-can-override="${canOverride ? '1' : ''}">
    <h2>🔍 ডুপ্লিকেট যাচাই</h2>
    <div data-dup-result>${dup && dup.matches.length ? html`<p class="dup-head">${blocked
      ? 'এই পণ্যটি দোকানে আগে থেকেই আছে বলে মনে হচ্ছে, তাই সেভ আটকানো হয়েছে। নিচের পণ্যগুলো দেখুন:'
      : 'কাছাকাছি কিছু পণ্য পাওয়া গেছে। একবার দেখে নিন (সেভ আটকাবে না):'}</p>${dupMatches(dup.matches)}`
      : html`<p class="muted small" data-dup-idle>নাম লিখলে আর ছবি দিলে নিজে থেকেই যাচাই হবে — একই পণ্য আগে থেকে আছে কি না (নাম, ছবি আর বিবরণ মিলিয়ে)।</p>`}</div>
    ${!id ? html`<p class="dup-cancel small" data-dup-cancel ${blocked ? '' : raw('hidden')}>এই নতুন পণ্যটা রাখতে না চাইলে <a class="btn btn-ghost btn-sm" href="/admin/products">✕ বাতিল করুন — সেভ হবে না</a></p>` : ''}
    ${canOverride ? html`<div class="dup-allow" data-dup-allow ${showSwitch ? '' : raw('hidden')}>
      ${ui.switchRow('allow_duplicate', allow, 'এটা আলাদা পণ্য — তবুও প্রকাশ করুন', 'নিশ্চিত হলে চালু করুন (যেমন একই ছবির আলাদা রং/মাপ)। চালু করে সেভ দিলে এই পণ্যটি আর আটকাবে না।')}
    </div>` : html`<p class="small muted dup-noperm" data-dup-noperm ${blocked ? '' : raw('hidden')}>এটা সত্যিই আলাদা পণ্য হলে মালিককে বলুন — তিনি "তবুও প্রকাশ করুন" সুইচ চালু করতে পারবেন।</p>`}
  </section>`;
}
const canOverride = (ctx) => ctx.can('dup_override');
const guardOn = (ctx) => ctx.settings.dup_guard !== '0';

// Live check while the form is being filled (name typed, picture added).
async function dupCheckApi(ctx) {
  if (!(await security.hit(db, 'dupchk:' + ctx.user.id, 900, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেক বেশি যাচাই হয়েছে, একটু পরে চেষ্টা করুন।' });
  const b = await ctx.body();
  if (!str(b.name) && !(Array.isArray(b.images) && b.images.length)) return ctx.json(ctx.res, 200, { blocked: false, matches: [] });
  const r = await dupes.findDuplicates({ id: b.id, name: str(b.name, 140), description: b.description, images: Array.isArray(b.images) ? b.images.slice(0, 10) : [],
    product_type: b.product_type, youtube_url: b.youtube_url }, ctx.settings);
  return ctx.json(ctx.res, 200, { ...r, html: r.matches.length ? String(dupMatches(r.matches)) : '' });
}

// On save. When editing, only NEW matches block — a product that already had a twin before this
// feature existed can still have its price or stock changed.
async function dupCheckOnSave(ctx, b, id) {
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

function specsBox(specs) {
  const rows = (Array.isArray(specs) ? specs : []).filter((r) => Array.isArray(r) && r[0]);
  const blank = Math.max(2, 4 - rows.length);
  const row = (k, v) => html`<div class="field-row spec-row">
    <input name="spec_key[]" value="${k}" maxlength="60" placeholder="যেমন: ভোল্টেজ" aria-label="বিষয়">
    <input name="spec_val[]" value="${v}" maxlength="300" placeholder="যেমন: 5V DC" aria-label="মান"></div>`;
  return html`<section class="panel">
    <h2>স্পেসিফিকেশন <small>পণ্যের পেজে টেবিল আকারে দেখাবে</small></h2>
    <p class="muted small">বাম ঘরে বিষয়, ডান ঘরে মান। যেমন "ভোল্টেজ — 5V DC", "পাওয়ার — 3W × 2", "মাপ — 25 × 20 mm"। খালি সারি সেভ হবে না।</p>
    <div data-repeat="specs">${rows.map((r) => row(r[0], r[1]))}${Array.from({ length: blank }, () => row('', ''))}</div>
    <button type="button" class="btn btn-sm btn-ghost" data-repeat-add="specs">+ আরও সারি</button>
  </section>`;
}

function productForm({ product, categories, error, seeCost, dup, canOverride, guardOn = true, settings = {}, nextSku = '', brands = [], suppliers = [], prices = [], canDelete = true, tiers = [], links = { related: [], cross: [], upsell: [] } }) {
  const p = product || { active: true, stock: 10, emoji: '📦', images: [], bundle: [], product_type: 'single', low_stock: 3, unit: 'পিস' };
  const isNew = !p.id;
  const bundle = p.product_type === 'bundle';
  return html`<p class="crumbs"><a href="/admin/products${bundle ? '?type=bundle' : ''}">← সব ${bundle ? 'বান্ডেল' : 'পণ্য'}</a></p>
<div class="title-row"><h1>${isNew ? (bundle ? 'নতুন বান্ডেল / প্যাকেজ' : 'নতুন পণ্য আপলোড') : p.name}</h1>
  ${isNew ? (bundle ? '' : html`<div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/products/import">📥 অনেক পণ্য একসাথে আমদানি করুন</a></div>`) : html`<div class="row-actions"><a class="btn btn-ghost btn-sm" href="/p/${p.slug}" target="_blank" rel="noopener">দোকানে দেখুন ↗</a>
    <form method="post" action="/admin/products/${p.id}/duplicate"><button class="btn btn-ghost btn-sm">কপি করুন</button></form></div>`}
</div>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${p.id}`}" class="form product-form" data-product-form>
  <input type="hidden" name="product_type" value="${bundle ? 'bundle' : 'single'}">
  ${guardOn ? dupPanel({ dup, canOverride, allow: !!p.allow_duplicate, id: p.id }) : ''}
  <div class="two-col">
    <div>
      <section class="panel">
        <h2>মূল তথ্য</h2>
        ${ui.field('পণ্যের নাম', ui.input('name', p.name || '', { required: true, maxlength: 140, placeholder: 'যেমন: PAM8403 Mini Amplifier Board' }))}
        <div class="field-row">
          ${isNew
    ? ui.field('SKU (পণ্যের কোড)', ui.input('sku', p.sku || '', { maxlength: 60, placeholder: `নিজে থেকে বসবে: ${bn(nextSku || '')}`.trim() }),
      raw(`খালি রাখুন — সেভ করলে <b>নিজে থেকে পরের নম্বর</b> (${bn(nextSku || '১')}) বসে যাবে: ১, ২, ৩… এভাবে। চাইলে নিজের কোডও লিখতে পারেন।`))
    : ui.field('SKU (পণ্যের কোড)', ui.input('sku', p.sku || '', { maxlength: 60 }), 'অর্ডার আর ইনভয়েসে দেখাবে। খালি করে সেভ দিলে আগের SKU-ই থাকবে।')}
          ${ui.field('ক্যাটাগরি', ui.select('category_id', [['', 'কোনোটি না'], ...ui.catOpts(categories)], p.category_id || ''))}
        </div>
        <div class="field-row">
          ${ui.field('ব্র্যান্ড (ঐচ্ছিক)', ui.input('brand', p.brand || '', { maxlength: 60, list: 'brand-list', autocomplete: 'off', placeholder: 'লিখুন বা তালিকা থেকে বাছুন' }), raw('নতুন নাম লিখলে নিজে থেকে নতুন ব্র্যান্ড তৈরি হবে। <a href="/admin/brands" target="_blank" rel="noopener">সব ব্র্যান্ড</a>'))}
          <datalist id="brand-list">${brands.map((b) => html`<option value="${b.name}">`)}</datalist>
          ${ui.field('মডেল / পার্ট নম্বর (ঐচ্ছিক)', ui.input('model', p.model || '', { maxlength: 80, placeholder: 'যেমন: PAM8403, LM7805, DS18B20' }), 'কোম্পানির দেওয়া কোড। সার্চে আর Google-এ কাজে লাগে।')}
        </div>
        <div class="field-row warranty-row" data-warranty>
          ${ui.field('🛡️ ওয়ারেন্টি', ui.select('warranty', [['', 'ওয়ারেন্টি নেই'], ...Object.entries(catalog.WARRANTY), ['custom', '✍️ নিজে লিখুন…']], String(p.warranty || '').startsWith('c:') ? 'custom' : (p.warranty || ''), { 'data-warranty-sel': true }), 'পণ্যের পেজে আর ইনভয়েসে দেখাবে।')}
          ${ui.field('ওয়ারেন্টির ধরন', ui.select('warranty_type', [['', '— উল্লেখ নেই —'], ...Object.entries(catalog.WARRANTY_TYPES)], p.warranty_type || ''), 'রিপ্লেসমেন্ট = বদলে দেবেন · সার্ভিস = মেরামত করে দেবেন')}
          <span data-warranty-custom ${String(p.warranty || '').startsWith('c:') ? '' : raw('hidden')}>${ui.field('নিজের মতো লিখুন', ui.input('warranty_custom', String(p.warranty || '').startsWith('c:') ? p.warranty.slice(2) : '', { maxlength: 60, placeholder: 'যেমন: ১০ বছর মোটর ওয়ারেন্টি' }))}</span>
        </div>
        <div class="field-row barcode-row">
          ${ui.field('🔢 বারকোড', ui.input('barcode', p.barcode || '', { maxlength: 40, placeholder: isNew ? 'খালি রাখুন — নিজে থেকে বসবে (SB…)' : '', class: 'mono', autocomplete: 'off' }),
    raw('প্রতিটা পণ্যের নিজস্ব। খালি রাখলে দোকানের নিজের কোড বসে (যেমন SB000123)। পণ্যের প্যাকেটে কোম্পানির বারকোড থাকলে সেটা স্ক্যান করে/লিখে দিতে পারেন।'))}
          ${!isNew && p.barcode ? html`<div class="bc-preview">${raw(require('../services/barcode').svg(p.barcode, { height: 46, module: 2, fontSize: 13 }))}
            <a class="btn btn-sm btn-ghost" href="/admin/products/labels?ids=${p.id}" target="_blank">🏷️ লেবেল প্রিন্ট</a></div>` : ''}
        </div>
        <div class="field-row">
          ${ui.field('একক', ui.select('unit', [['পিস', 'পিস'], ['সেট', 'সেট'], ['প্যাক', 'প্যাক'], ['কেজি', 'কেজি'], ['গ্রাম', 'গ্রাম'], ['মিটার', 'মিটার'], ['জোড়া', 'জোড়া'], ['লিটার', 'লিটার']], p.unit || 'পিস'))}
        </div>
      </section>

      <section class="panel">
        <h2>দাম ও স্টক</h2>
        <div class="field-row">
          ${ui.field('বিক্রির দাম (৳)', ui.input('price', p.price ?? '', { type: 'number', min: 0, required: true, 'data-price': true }))}
          ${ui.field('আগের দাম (৳, ঐচ্ছিক)', ui.input('old_price', p.old_price ?? '', { type: 'number', min: 0 }), 'দিলে "% ছাড়" ব্যাজ দেখাবে')}
          ${seeCost ? ui.field('কেনা দাম (৳)', ui.input('cost_price', p.cost_price ?? '', { type: 'number', min: 0, 'data-cost': true }), 'শুধু আপনি দেখবেন। লাভ হিসাবের জন্য') : ''}
        </div>
        ${seeCost ? html`<p class="margin-box" data-margin></p>` : ''}
        <p class="small-rule-hint" data-small-rule='${JSON.stringify({ on: settings.small_qty_on !== '0', cap: Number(settings.small_max_price) || 5, minVal: Number(settings.small_min_value) || 10, maxVal: Number(settings.small_max_value) || 100, maxQty: Number(settings.max_qty_per_item) || 10 })}' hidden></p>
        ${bundle ? html`<p class="muted small">বান্ডেলের নিজের স্টক নেই — ভেতরের পণ্যগুলোর স্টক থেকে হিসাব হয়।</p>` : html`<div class="field-row">
          ${ui.field('স্টক (কয়টি আছে)', ui.input('stock', p.own_stock ?? p.stock ?? 0, { type: 'number', min: 0, required: true }), isNew ? '' : 'বদলালে ইনভেন্টরি ইতিহাসে লেখা থাকবে')}
          ${ui.field('স্টক এর কম হলে সতর্ক করুন', ui.input('low_stock', p.low_stock ?? 3, { type: 'number', min: 0 }))}
          ${ui.field('ওজন (গ্রাম, কুরিয়ারের জন্য)', ui.input('weight_g', p.weight_g || '', { type: 'number', min: 0 }))}
        </div>
        ${p.damaged_stock ? html`<p class="small warn">নষ্ট/ভাঙা স্টক আলাদা রাখা আছে: <b>${bn(p.damaged_stock)}টি</b> (বিক্রি হবে না) — <a href="/admin/inventory?q=${encodeURIComponent(p.sku || p.name || '')}">ইনভেন্টরিতে দেখুন</a></p>` : ''}`}
        ${suppliers.length ? ui.field('যে সাপ্লায়ার থেকে সাধারণত কেনা হয় (ঐচ্ছিক)', ui.select('supplier_id', [['', '— বাছাই করা নেই —'], ...suppliers.map((x) => [x.id, x.name + (x.company ? ` (${x.company})` : '')])], p.supplier_id || ''),
    'শুধু অ্যাডমিনে দেখা যায়, কাস্টমার কখনো দেখবে না। পারচেজের সময় কাজে লাগে।') : ''}
      </section>

      ${bundle ? html`<section class="panel" data-bundle>
        <h2>বান্ডেলে কী কী থাকবে</h2>
        <div class="item-picker">
          <input type="search" placeholder="পণ্য খুঁজে যোগ করুন…" data-bundle-search autocomplete="off">
          <ul class="picker-results" data-bundle-results hidden></ul>
        </div>
        <div class="table-wrap"><table class="table item-rows bundle-rows"><thead><tr><th>ছবি</th><th>পণ্য</th><th class="num">একক দাম</th><th class="num">পরিমাণ (কমান / বাড়ান)</th><th class="num">মোট</th><th class="num">স্টক</th><th>কাজ</th></tr></thead>
          <tbody data-bundle-rows>${(p.bundle || []).map((b) => html`<tr data-row data-price="${b.price}">
            <td class="b-img">${b.image_id ? html`<img src="/media/${b.image_id}/t" alt="" loading="lazy">` : html`<span class="pe">${b.emoji || '📦'}</span>`}</td>
            <td class="b-name"><b>${b.name}</b>${b.sku ? html`<br><span class="small muted">SKU ${b.sku}</span>` : ''}<input type="hidden" name="bundle_id[]" value="${b.product_id}"></td>
            <td class="num">${money(b.price)}</td>
            <td class="num"><span class="qty-step"><button type="button" class="qs-btn" data-bq="-1" aria-label="কমান">−</button><input type="number" name="bundle_qty[]" value="${b.qty}" min="1" class="w-num" data-qty><button type="button" class="qs-btn" data-bq="1" aria-label="বাড়ান">+</button></span></td>
            <td class="num" data-line>${money(b.price * b.qty)}</td>
            <td class="num">${bn(b.stock)}</td>
            <td class="b-act"><a class="btn btn-sm btn-ghost" href="/admin/products/${b.product_id}" target="_blank" rel="noopener" title="এই পণ্যটি এডিট করুন (নতুন ট্যাবে)">✏️ এডিট</a><button type="button" class="btn btn-sm btn-danger" data-remove-row title="বান্ডেল থেকে সরান">🗑️ মুছুন</button></td></tr>`)}</tbody></table></div>
        <p class="muted small" data-bundle-empty ${(p.bundle || []).length ? raw('hidden') : ''}>এখনো কোনো পণ্য যোগ হয়নি — উপরে খুঁজে যোগ করুন।</p>
        <p class="muted small" data-bundle-sum></p>
      </section>` : ''}

      <section class="panel">
        <h2>বিবরণ</h2>
        ${ui.field('ছোট বিবরণ (Short description)', ui.textarea('short_description', p.short_description || '', { rows: 3, maxlength: 1000 }), 'পণ্যের পেজে দামের ঠিক নিচে "📝 সংক্ষেপে" বক্সে দেখাবে। ২-৪ লাইনে মূল কথা।')}
        ${ui.field('বিস্তারিত বিবরণ (Long description)', ui.textarea('description', p.description || '', { rows: 10, maxlength: 20000 }),
    raw('পেজের নিচে "📋 পণ্যের বিস্তারিত বিবরণ" অংশে দেখাবে। নতুন লাইন = নতুন প্যারাগ্রাফ। <b>## শিরোনাম</b> লিখলে বড় হেডিং, <b>- </b> দিয়ে শুরু করলে বুলেট পয়েন্ট, <b>**মোটা লেখা**</b>।'))}
      </section>

      ${specsBox(p.specs)}

      ${p.product_type === 'bundle' ? '' : extrasBox(p, tiers, links, settings)}

      <section class="panel">
        <h2>SEO (গুগলে কেমন দেখাবে)</h2>
        ${isNew ? '' : ui.field('পণ্যের লিংক (URL)', html`<span class="slug-field"><span class="muted">/p/</span>${ui.input('slug', p.slug || '', { maxlength: 80, pattern: '[^/?#]+', spellcheck: 'false' })}</span>`,
    'ইংরেজি ছোট হাতের অক্ষর আর - দিয়ে লিখুন (যেমন pam8403-amplifier-board)। বদলালে পুরোনো লিংক থেকেও নতুন লিংকে নিয়ে যাবে — Google বা ফেসবুকে শেয়ার করা লিংক নষ্ট হবে না।')}
        ${ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120, placeholder: 'খালি রাখলে পণ্যের নাম' }))}
        ${ui.field('SEO কিওয়ার্ড', ui.input('seo_keywords', p.seo_keywords || '', { maxlength: 300, placeholder: 'যেমন: amplifier board price in bd, PAM8403, অ্যামপ্লিফায়ার' }), 'কমা (,) দিয়ে আলাদা করে লিখুন। মানুষ গুগলে যে শব্দ লিখে খোঁজে সেগুলো দিন — বাংলা ও ইংরেজি দুটোই দিতে পারেন।')}
        ${ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'খালি রাখলে ছোট বিবরণ' }))}
        ${ui.check('noindex', !!p.noindex, 'গুগল সার্চে এই পণ্যের পেজ দেখাবে না (noindex) — দোকানে আর ফিডে ঠিকই থাকবে')}
      </section>
    </div>

    <div>
      <section class="panel">
        <h2>ছবি <small>সর্বোচ্চ ${bn(MAX_IMAGES)}টি</small></h2>
        <div class="slots" data-slots>
          ${Array.from({ length: MAX_IMAGES }, (_, i) => imageSlot(i, (p.images || [])[i]))}
        </div>
        <input type="hidden" name="images" value="${(p.images || []).slice(0, MAX_IMAGES).join(',')}" data-slots-value>
        ${(p.images || []).length > MAX_IMAGES ? html`<p class="warn small">এই পণ্যে আগে ${bn(p.images.length)}টি ছবি ছিল। এখন সর্বোচ্চ ${bn(MAX_IMAGES)}টি রাখা যায়, তাই সেভ করলে শেষের ${bn(p.images.length - MAX_IMAGES)}টি বাদ যাবে।</p>` : ''}
        <p class="muted small">প্রতিটা ঘরের <b>＋</b> চাপ দিয়ে সেই ঘরে ছবি দিন। <b>১ নম্বর ঘরের ছবিটাই মূল ছবি</b> — দোকানে প্রথমে এটাই দেখাবে, তারপর ২, ৩… এভাবে। ◀ ▶ দিয়ে ছবি আগে-পরে সরান, ✕ দিয়ে মুছুন। মোবাইলের বড় ছবি দিলেও নিজে থেকে ছোট হয়ে যাবে।</p>
        ${ui.field('ছবি না থাকলে এই ইমোজি দেখাবে', ui.input('emoji', p.emoji || '📦', { maxlength: 8, class: 'w-emoji' }))}
      </section>

      <section class="panel">
        <h2>ভিডিও (YouTube)</h2>
        ${ui.field('YouTube লিংক', ui.input('youtube_url', p.youtube_url || '', { maxlength: 1500, placeholder: 'https://www.youtube.com/watch?v=...', 'data-yt': true }), 'YouTube এর যেকোনো লিংক দিন — সাধারণ ভিডিও, Shorts, youtu.be, বা মোবাইল থেকে "Share" করা লিংক। নিচে ভিডিওর ছবি দেখা গেলে বুঝবেন লিংক ঠিক আছে। পণ্যের পেজে ছবির নিচে "ভিডিও দেখুন" বাটন আসবে।')}
        <div class="yt-preview" data-yt-preview>${youtubeId(p.youtube_url) ? html`<img src="https://i.ytimg.com/vi/${youtubeId(p.youtube_url)}/hqdefault.jpg" alt="">` : ''}</div>
      </section>

      <section class="panel">
        <h2>দেখানো</h2>
        ${ui.check('active', p.active, 'দোকানে দেখাও')}
        ${ui.check('featured', p.featured, 'হোমপেজের "জনপ্রিয় পণ্য"-তে দেখাও')}
        ${ui.check('is_new', p.is_new, '"নতুন" ট্যাগ দেখাও')}
        <p class="small muted">নতুন তোলা পণ্যে ${Number(settings.new_badge_days) > 0 ? `${bn(settings.new_badge_days)} দিন` : 'কোনো দিন না'} পর্যন্ত এমনিতেই "নতুন" ট্যাগ থাকে (<a href="/admin/settings#new-badge">বদলান</a>)। এখানে টিক দিলে সবসময় থাকবে।</p>
      </section>

      ${!isNew && prices.length ? html`<section class="panel">
        <h2>দামের ইতিহাস</h2>
        <ul class="timeline">${prices.map((h) => html`<li>${h.action === 'cost_change' ? '🔒 ' : ''}${h.detail.replace(/^[^:]*:\s*/, '')}<br><span class="small muted">${fmtDate(h.created_at)} · ${h.staff_name || 'সিস্টেম'}</span></li>`)}</ul>
        ${seeCost ? html`<p class="small muted">🔒 = কেনা দাম, শুধু আপনি দেখছেন। <a href="/admin/security/audit?action=price_change">সব দাম বদল →</a></p>` : ''}
      </section>` : ''}
    </div>
  </div>
  <div class="form-actions sticky-actions">
    <button class="btn btn-lg" data-save>${isNew ? (bundle ? 'বান্ডেল যোগ করুন' : 'পণ্য যোগ করুন') : 'পরিবর্তন সেভ করুন'}</button>
  </div>
</form>
${isNew || !canDelete ? '' : html`<form method="post" action="/admin/products/${p.id}/delete" class="danger-zone" data-confirm="এই পণ্যটি মুছবেন? দোকান থেকে সাথে সাথে সরে যাবে, তবে রিসাইকেল বিনে থাকবে — মালিক চাইলে ফেরত আনতে পারবেন। শুধু লুকাতে চাইলে 'দোকানে দেখাও' টিক তুলে দিন।">
  <button class="btn btn-danger btn-sm">পণ্যটি মুছে ফেলুন</button>
</form>`}`;
}

function bodyToProduct(b) {
  const ids = list(b.bundle_id);
  const qtys = list(b.bundle_qty);
  return { ...b, bundle: ids.map((id, i) => ({ product_id: id, qty: qtys[i] })) };
}

async function formExtras(ctx, id) {
  const finance = require('../models/finance');
  const [brands, suppliers, prices] = await Promise.all([
    catalog.listBrands(), finance.listSuppliers({ includeInactive: false }).catch(() => []),
    id ? catalog.priceHistory(id, { withCost: ctx.can('see_cost'), limit: 15 }) : [],
  ]);
  const [tiers, links] = id ? await Promise.all([db.q('SELECT min_qty, price FROM price_tiers WHERE product_id=$1 ORDER BY min_qty', [id]), catalog.linkedSkus(id)])
    : [[], { related: [], cross: [], upsell: [] }];
  return { brands, suppliers: suppliers.filter((x) => x.active !== false), prices, canDelete: ctx.can('products_delete'), tiers, links };
}
// "১০টি বা বেশি নিলে ৳x করে" rows + linked products (related / goes with / better option), saved after the product.
async function saveExtras(pid, b, settings = {}) {
  const price = Number((await db.one('SELECT price FROM products WHERE id=$1', [pid])).price);
  const qs = list(b.tier_qty); const ps = list(b.tier_price);
  const tiers = new Map();
  const problems = [];
  for (let i = 0; i < qs.length; i++) {
    const n = int(qs[i]); const pr = amount(ps[i]);
    if (!n && !ps[i]) continue;
    if (n < 2 || !(pr > 0) || pr >= price) { problems.push(`${bn(n || 0)}টি — দাম ৳০ এর বেশি আর আসল দাম ${money(price)} এর কম হতে হবে, পরিমাণ কমপক্ষে ২`); continue; }
    tiers.set(n, pr);
  }
  const maxQ = qtyRule(settings, price).max;
  const unreachable = [...tiers.keys()].filter((n) => n > maxQ);
  if (unreachable.length) problems.push(`${unreachable.map((n) => bn(n)).join(', ')}টির ধাপ সেভ হয়েছে, কিন্তু অনলাইনে এই পণ্য একবারে সর্বোচ্চ ${bn(maxQ)}টি অর্ডার করা যায় — তাই কাস্টমার এই দাম পাবে না (দোকানে দেখাবেও না)। চাইলে সেটিংসে "একসাথে সর্বোচ্চ" সংখ্যা বাড়ান`);
  const missing = [];
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
function extrasBox(p, tiers, links, settings = {}) {
  const rows = (tiers || []).slice(0, 6);
  const blank = Math.max(1, 3 - rows.length);
  const row = (t) => html`<div class="field-row tier-row">
    ${ui.field('কমপক্ষে কয়টা নিলে', ui.input('tier_qty[]', t.min_qty || '', { type: 'number', min: 2, class: 'w-num', placeholder: 'যেমন 10' }))}
    ${ui.field('প্রতি পিস দাম (৳)', ui.input('tier_price[]', t.price ?? '', { type: 'number', min: 0.01, step: '0.01', class: 'w-num', placeholder: 'যেমন 4.5' }))}
  </div>`;
  return html`<section class="panel">
    <h2>📦 বেশি কিনলে কম দাম <small>পাইকারি দাম</small></h2>
    ${p.flash_price ? html`<p class="flash">⚡ এই পণ্যে এখন ফ্ল্যাশ সেল চলছে — দোকানে দাম ${money(p.flash_price)}। <a href="/admin/marketing/flash">ফ্ল্যাশ সেল দেখুন →</a></p>` : ''}
    <p class="muted small">যেমন "১০টি বা বেশি নিলে ৳৪.৫০ করে", "৫০টি বা বেশি নিলে ৳৪ করে"। কাস্টমার কার্টে পরিমাণ বাড়ালে কম দাম নিজে থেকে বসবে, আর পণ্যের পেজে একটা ছোট টেবিল দেখাবে। খালি রাখলে কিছু হবে না। ফ্ল্যাশ সেলের সাথে মিলিয়ে দুইবার ছাড় হয় না — যেটা কম সেটাই বসে।</p>
    ${Number(p.price) > 0 ? html`<p class="small warn">মনে রাখবেন: অনলাইনে এই পণ্য একবারে সর্বোচ্চ ${bn(qtyRule(settings, p.price).max)}টি অর্ডার করা যায় (সেটিংস থেকে বদলানো যায়) — তার বেশির ধাপ কাস্টমার পাবে না।</p>` : ''}
    <div data-repeat="tiers">${rows.map(row)}${Array.from({ length: blank }, () => row({}))}</div>
    <button type="button" class="btn btn-sm btn-ghost" data-repeat-add="tiers">+ আরও ধাপ</button>
  </section>
  <section class="panel">
    <h2>🔗 সাথে দেখানোর পণ্য</h2>
    <p class="muted small">পণ্যের SKU কমা দিয়ে লিখুন (যেমন: 12, 45, 101)। খালি রাখলে "একই রকম আরও পণ্য" একই ক্যাটাগরি থেকে নিজে থেকে আসবে।</p>
    ${ui.field('এর সাথে যা লাগবে (ক্রস-সেল)', ui.input('cross_skus', links.cross.join(', '), { maxlength: 400, placeholder: 'যেমন সোল্ডারিং আয়রনের সাথে তার, ফ্লাক্স' }), 'পণ্যের পেজে আর কার্টে "এগুলোও লাগতে পারে" হিসেবে দেখাবে')}
    ${ui.field('আরও ভালো বিকল্প (আপসেল)', ui.input('upsell_skus', links.upsell.join(', '), { maxlength: 400, placeholder: 'একটু দামি কিন্তু ভালো মডেল' }))}
    ${ui.field('একই রকম পণ্য (নিজে বেছে দিন)', ui.input('related_skus', links.related.join(', '), { maxlength: 400 }))}
  </section>`;
}
async function formPage(ctx, m) {
  const id = m && m[1] ? int(m[1]) : null;
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
    let error = !str(b.name) ? 'পণ্যের নাম লিখুন।' : null;
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
      const product = { ...b, id, images, active: !!b.active, featured: !!b.featured,
        bundle: b.bundle.map((x) => { const pp = parts.find((y) => y.id === int(x.product_id)); return pp ? { product_id: pp.id, name: pp.name, sku: pp.sku, price: pp.price, stock: pp.stock, qty: int(x.qty, 1) } : null; }).filter(Boolean) };
      if (cur) product.slug = cur.slug;
      product.specs = catalog.cleanSpecs(b.spec_key, b.spec_val);
      product.is_new = !!b.is_new;
      extras.tiers = list(b.tier_qty).map((n, i) => ({ min_qty: n, price: list(b.tier_price)[i] })).filter((t) => t.min_qty || t.price);
      extras.links = { related: [str(b.related_skus, 400)].filter(Boolean), cross: [str(b.cross_skus, 400)].filter(Boolean), upsell: [str(b.upsell_skus, 400)].filter(Boolean) };
      return ctx.page('পণ্য', productForm({ product, categories, error, seeCost, dup, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku: id ? '' : await catalog.nextSku(), ...extras }), id ? 'products' : 'product-new', { status: 400 });
    }
    const pid = await catalog.saveProduct({ ...b, id }, ctx.user.id);
    const extraProblems = b.tier_qty !== undefined || b.cross_skus !== undefined ? await saveExtras(pid, b, ctx.settings) : [];
    await ctx.log(id ? 'product_edit' : 'product_add', 'product', pid, str(b.name, 100));
    if (extraProblems.length) return ctx.fail(`/admin/products/${pid}`, `পণ্য সেভ হয়েছে, তবে: ${extraProblems.join('; ')}`);
    if (b.allow_duplicate && !(cur && cur.allow_duplicate)) await ctx.log('product_dup_allow', 'product', pid, `ডুপ্লিকেট হলেও প্রকাশের অনুমতি: ${str(b.name, 80)}`);
    return ctx.back(`/admin/products/${pid}`, id ? 'saved' : 'added');
  }
  if (id) {
    const product = await catalog.getProduct({ id });
    if (!product) return ctx.redirect(ctx.res, '/admin/products');
    return ctx.page(product.name, html`${ui.flash(ctx.flash)}${productForm({ product, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, ...extras })}`, product.product_type === 'bundle' ? 'bundles' : 'products');
  }
  const type = ctx.query.get('type') === 'bundle' ? 'bundle' : 'single';
  const fresh = { active: true, stock: type === 'bundle' ? 0 : 10, emoji: '📦', images: [], bundle: [], product_type: type, low_stock: 3, unit: type === 'bundle' ? 'সেট' : 'পিস',
    category_id: int(ctx.query.get('cat')) || null };
  const nextSku = await catalog.nextSku();
  return ctx.page('নতুন পণ্য', productForm({ product: fresh, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku, ...extras }), type === 'bundle' ? 'bundles' : 'product-new');
}

// Where to go after a list action: back to the same list page (only our own product list).
function backTo(b) {
  const v = String(b.back || '');
  return /^\/admin\/(products(\/duplicates)?|inventory)(\?[\w=&%.+-]*)?$/.test(v) ? v : '/admin/products';
}
async function remove(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const p = await catalog.getProduct({ id });
  await ctx.trash('product', id);
  await ctx.log('product_delete', 'product', id, `${p ? p.name : ''} → রিসাইকেল বিনে`);
  return ctx.back(backTo(b), 'deleted');
}
// Show / hide one product on the shop (the switch in the product list). SKU and everything else stay the same.
async function setActive(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const p = await db.one('UPDATE products SET active=$1, updated_at=now() WHERE id=$2 RETURNING name', [on, id]);
  if (p) await ctx.log('product_edit', 'product', id, `${on ? 'দোকানে চালু' : 'দোকান থেকে বন্ধ'}: ${p.name}`);
  if (String(ctx.req.headers.accept || '').includes('application/json')) {
    return p ? ctx.json(ctx.res, 200, { ok: true, active: on }) : ctx.json(ctx.res, 404, { error: 'পণ্যটি পাওয়া যায়নি।' });
  }
  return ctx.back(backTo(b), 'saved');
}
async function duplicate(ctx, m) {
  const nid = await catalog.duplicateProduct(int(m[1]), ctx.user.id);
  if (!nid) return ctx.back('/admin/products');
  await ctx.log('product_add', 'product', nid, 'কপি');
  return ctx.back(`/admin/products/${nid}`, 'copied');
}

// ---------------------------------------------------------------- duplicates page
async function duplicatesPage(ctx) {
  const may = canOverride(ctx);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!may) return ctx.back('/admin/products/duplicates', 'noperm');
    if (b.form === 'settings') {
      const lvl = Object.keys(dupes.LEVELS).includes(b.dup_level) ? b.dup_level : 'normal';
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
  const groups = await dupes.scanCatalog(ctx.settings, { includeAllowed: showAllowed });
  const sure = groups.filter((g) => g.level === 'block');
  const maybe = groups.filter((g) => g.level === 'warn');
  const on = guardOn(ctx);
  const card = (g) => {
    const why = [...new Set(g.pairs.flatMap((pp) => pp.reasons))];
    return html`<div class="panel dup-group ${g.level === 'block' ? 'is-block' : 'is-warn'}">
      <p class="dup-why">${g.level === 'block' ? '⛔ ' : '⚠️ '}${why.join(' · ')}</p>
      <ul class="dup-list">${g.products.map((x, i) => html`<li class="dup-item">
        <a class="dup-thumb" href="/admin/products/${x.id}">${x.image_id ? html`<img src="/media/${x.image_id}/t" alt="" loading="lazy">` : html`<span>${x.emoji || '📦'}</span>`}</a>
        <div class="dup-info">
          <a href="/admin/products/${x.id}"><b>${x.title}</b></a>
          <span class="small muted">${i === 0 ? 'সবচেয়ে পুরোনো · ' : ''}${x.sku ? `SKU ${x.sku} · ` : ''}${money(x.price)}${x.active ? '' : ' · লুকানো'}${x.allow_duplicate ? ' · অনুমোদিত' : ''}</span>
        </div>
        <div class="dup-row-acts">
        ${may && i > 0 && !x.allow_duplicate ? html`<form method="post" action="/admin/products/duplicates"><input type="hidden" name="form" value="allow"><input type="hidden" name="id" value="${x.id}">
          <button class="btn btn-ghost btn-sm" title="এটা আলাদা পণ্য, তালিকা থেকে সরান">আলাদা পণ্য ✓</button></form>` : ''}
        <form method="post" action="/admin/products/${x.id}/active" class="prod-toggle">
          <input type="hidden" name="back" value="${dupBack}">
          <label class="switch" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে লুকিয়ে যাবে"><input type="checkbox" name="active" value="1" ${x.active ? raw('checked') : ''} data-prod-toggle aria-label="${x.title} দোকানে দেখাবে"><span class="switch-ui" aria-hidden="true"></span></label>
          <span class="small prod-toggle-text" data-prod-toggle-text>${x.active ? 'চালু' : 'বন্ধ'}</span>
          <noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript>
        </form>
        <a class="btn btn-sm btn-ghost" href="/admin/products/${x.id}">✏️ এডিট</a>
        <form method="post" action="/admin/products/${x.id}/delete" data-confirm="'${x.title}' পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু লুকাতে চাইলে পাশের সুইচ বন্ধ করুন।">
          <input type="hidden" name="back" value="${dupBack}">
          <button class="btn btn-sm btn-danger">🗑️ মুছুন</button>
        </form>
        </div>
      </li>`)}</ul>
    </div>`;
  };
  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>ডুপ্লিকেট পণ্য <small>${bn(sure.length)}টি নিশ্চিত, ${bn(maybe.length)}টি সম্ভাব্য</small></h1>
${ui.flash(ctx.flash)}
<section class="panel">
  <h2>ডুপ্লিকেট আটকানো</h2>
  <form method="post" action="/admin/products/duplicates" class="dup-set">
    <input type="hidden" name="form" value="settings">
    <label class="nav-chip dup-chip" title="নতুন পণ্য যোগ বা এডিট করার সময় নাম, ছবি আর বিবরণ মিলিয়ে দেখা হবে। আগে থেকে থাকলে সেভ আটকে যাবে।">
      <span class="nav-chip-t">একই পণ্য দুইবার উঠতে দেবেন না</span>
      <span class="switch switch-sm"><input type="checkbox" name="dup_guard" value="1" ${on ? raw('checked') : ''} ${may ? '' : raw('disabled')}><span class="switch-ui" aria-hidden="true"></span></span>
    </label>
    <label class="dup-level">কতটা কড়া ${ui.select('dup_level', Object.entries(dupes.LEVELS).map(([k, v]) => [k, v.label]), ctx.settings.dup_level || 'normal', { disabled: !may })}</label>
    ${may ? html`<button class="btn btn-sm">💾 সেভ করুন</button>` : html`<span class="small muted">শুধু মালিক বা অনুমতি পাওয়া স্টাফ বদলাতে পারবে।</span>`}
  </form>
  <p class="small muted dup-hint">কড়া = একটু মিল থাকলেই আটকাবে · নরম = শুধু খুব বেশি মিল থাকলে আটকাবে।</p>
  ${ui.helpBox('কীভাবে মেলানো হয়?', html`<ul>
    <li><b>ছবি:</b> প্রতিটা ছবির একটা "ছবির ছাপ" রাখা হয়। একই ছবি ছোট-বড় করলে, আবার সেভ করলে, চারপাশে সাদা জায়গা থাকলে বা উল্টো (mirror) করলেও ধরা পড়বে।</li>
    <li><b>নাম:</b> শব্দের ক্রম আলাদা হলেও, বানান একটু এদিক-ওদিক হলেও, বাংলা/ইংরেজি সংখ্যা (১২ = 12), "60 watt" = "60W" — সব মেলানো হয়। "New", "Original", "BD" এর মতো শব্দ বাদ দিয়ে দেখা হয়।</li>
    <li><b>মাপ/মডেল আলাদা হলে আলাদা পণ্য:</b> যেমন "Soldering Iron 40W" আর "60W" — নামের কারণে আটকাবে না।</li>
    <li><b>বিবরণ:</b> বিস্তারিত বিবরণ হুবহু এক হলে সেটাও ধরা হয়।</li>
    <li>লুকানো পণ্যের সাথেও মেলানো হয়। একক পণ্য একক পণ্যের সাথে, বান্ডেল বান্ডেলের সাথে মেলানো হয়।</li>
    <li>একদম অন্য কোণ থেকে তোলা আলাদা ছবি হলে ছবি দিয়ে ধরা কঠিন — তখন নাম দিয়ে ধরা হয়।</li>
  </ul>`)}
</section>
<h2>এখন দোকানে যা আছে</h2>
<p class="muted small">পুরো দোকান মিলিয়ে দেখা হয়েছে। ভুল পণ্যটা খুলে মুছে দিন বা লুকান। আসলে আলাদা পণ্য হলে "আলাদা পণ্য ✓" চাপুন — তালিকা থেকে সরে যাবে।
${showAllowed ? html` <a href="/admin/products/duplicates">অনুমোদিতগুলো লুকান</a>` : html` <a href="/admin/products/duplicates?all=1">অনুমোদিতগুলোও দেখুন</a>`}</p>
<p class="small muted" data-fp-status hidden></p>
${groups.length ? html`${sure.length ? html`<h3>⛔ প্রায় নিশ্চিত ডুপ্লিকেট</h3>${sure.map(card)}` : ''}
  ${maybe.length ? html`<h3>⚠️ হতে পারে — একবার দেখে নিন</h3>${maybe.map(card)}` : ''}`
    : ui.empty('কোনো ডুপ্লিকেট পণ্য পাওয়া যায়নি। 👍')}`;
  return ctx.page('ডুপ্লিকেট পণ্য', body, 'duplicates');
}

// ---------------------------------------------------------------- categories
// Where categories show on the storefront: the bar above the banner (every page)
// and the box grid on the home page (a home-page section).
async function saveCategoryDisplay(ctx, b) {
  const top = b.show_cat_strip ? '1' : '0';
  await db.setSetting('show_cat_strip', top);
  const sections = db.jsonSetting(ctx.settings, 'home_sections', []).filter((x) => x !== 'categories');
  if (b.show_cat_grid) sections.splice(sections[0] === 'slider' ? 1 : 0, 0, 'categories');
  await db.setSetting('home_sections', JSON.stringify(sections));
  await ctx.reloadSettings();
  await ctx.log('settings', 'category', null, `ক্যাটাগরি দেখানো: উপরে ${top === '1' ? 'চালু' : 'বন্ধ'}, নিচে ${b.show_cat_grid ? 'চালু' : 'বন্ধ'}`);
}
function displaySwitch(name, on, title, desc) {
  return html`<label class="switch-row">
    <span class="switch-text"><b>${title}</b><small>${desc}</small></span>
    <span class="switch"><input type="checkbox" name="${name}" value="1" ${on ? raw('checked') : ''} data-autosubmit><span class="switch-ui" aria-hidden="true"></span></span>
    <span class="switch-state" data-on="চালু" data-off="বন্ধ"></span>
  </label>`;
}

async function categoriesPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'display') {
      await saveCategoryDisplay(ctx, b);
      return ctx.back('/admin/categories', 'saved');
    }
    if (str(b.name)) {
      const cid = await catalog.saveCategory({ id: int(b.id) || null, name: b.name, icon: b.icon, sort: b.sort, active: b.id ? !!b.active : true, imageId: b.image_id,
        parentId: 'parent_id' in b ? b.parent_id : undefined,
        seo: 'seo_title' in b ? { title: b.seo_title, description: b.seo_description, text: b.cat_text, bannerId: b.banner_id, noindex: !!b.noindex } : undefined });
      if (int(b.banner_id)) await catalog.claimMedia(b.banner_id, 'category', cid);
      await ctx.log('category_save', 'category', int(b.id) || null, str(b.name, 60));
    }
    return ctx.back('/admin/categories', 'saved');
  }
  const categories = await catalog.listCategories();
  const tree = catalog.categoryOptions(categories); // menu order, with depth
  const { byId } = catalog.categoryTree(categories);
  // where a category may be put: anywhere except inside itself or its own sub-categories
  const parentChoices = (c) => {
    const inside = new Set();
    const walk = (n) => { inside.add(n.id); n.children.forEach(walk); };
    if (c) walk(byId.get(c.id));
    return [['', '— মূল ক্যাটাগরি (কোনোটির ভেতরে না)'], ...ui.catOpts(categories).filter(([id]) => !inside.has(id))];
  };
  const showTop = ctx.settings.show_cat_strip !== '0';
  const showGrid = db.jsonSetting(ctx.settings, 'home_sections', []).includes('categories');
  const body = html`<h1>ক্যাটাগরি <small>${bn(categories.length)}টি</small></h1>
${ui.flash(ctx.flash)}
<section class="panel">
  <h2>দোকানে ক্যাটাগরি কোথায় দেখাবে</h2>
  <form method="post" action="/admin/categories" class="switch-list two-col" data-switch-form>
    <input type="hidden" name="form" value="display">
    ${displaySwitch('show_cat_strip', showTop, 'উপরের ক্যাটাগরি বার (ব্যানারের উপরে)', 'হেডারের ঠিক নিচে, প্রতিটা পেজে এক লাইনে ক্যাটাগরির নাম। (মোবাইলে এই বার এমনিতেই লুকানো থাকে, মেনুতে ক্যাটাগরি পাওয়া যায়।)')}
    ${displaySwitch('show_cat_grid', showGrid, 'নিচের ক্যাটাগরি বক্স (হোমপেজে)', 'হোমপেজে ব্যানারের নিচে আইকনসহ ছোট ছোট বক্স।')}
    <noscript><button class="btn btn-sm">সেভ করুন</button></noscript>
  </form>
</section>
<section class="panel">
  <h2>🤖 স্বয়ংক্রিয়ভাবে সাজান</h2>
  <p class="muted small">প্রতিটা পণ্যের নাম পড়ে ঠিক মূল ক্যাটাগরি → সাব-ক্যাটাগরিতে বসিয়ে দেয় (রিমোট হলে এসি/টিভি আর কোম্পানি অনুযায়ী আলাদা)। আগে দেখে নিয়ে তারপর সেভ করবেন।</p>
  <a class="btn btn-sm" href="/admin/categories/auto">পণ্যগুলো স্বয়ংক্রিয়ভাবে সাজান →</a>
</section>
<div class="two-col">
  <section class="panel">
    <h2>সব ক্যাটাগরি <small>মূল ক্যাটাগরি আর তার ভেতরের সাব-ক্যাটাগরি</small></h2>
    <div class="cat-admin-grid cat-tree">
      ${tree.map((c) => html`<form method="post" action="/admin/categories" class="cat-card depth-${Math.min(c.depth, 3)} ${c.active === false ? 'row-off' : ''}">
        <input type="hidden" name="id" value="${c.id}">
        <div class="cat-card-top">
          <input name="icon" value="${c.icon}" maxlength="8" aria-label="আইকন" class="w-emoji" data-icon-input>
          <input name="name" value="${c.name}" required maxlength="60" aria-label="নাম">
        </div>
        <div class="cat-card-bottom">
          <label class="small">ক্রম <input name="sort" type="number" value="${c.sort}" class="w-num"></label>
          ${ui.check('active', c.active !== false, 'দেখাও')}
          <span class="small muted">${bn(c.product_count)}টি পণ্য${c.total_count > c.product_count ? ` (ভেতরেসহ ${bn(c.total_count)}টি)` : ''}</span>
        </div>
        <label class="small cat-parent">কোথায় থাকবে ${ui.select('parent_id', parentChoices(c), c.parent_id || '')}</label>
        <details class="cat-seo"><summary class="small">🔎 SEO, বিবরণ ও ব্যানার${c.seo_title || c.description || c.banner_id ? ' ✓' : ''}</summary>
          ${ui.field('SEO টাইটেল', ui.input('seo_title', c.seo_title || '', { maxlength: 120, placeholder: `খালি রাখলে: ${c.name}` }))}
          ${ui.field('SEO বিবরণ', ui.textarea('seo_description', c.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'গুগলে নামের নিচে যে ২ লাইন দেখায়' }))}
          ${ui.field('পণ্যের উপরে দেখানোর লেখা (ঐচ্ছিক)', ui.textarea('cat_text', c.description || '', { rows: 2, maxlength: 3000 }))}
          ${ui.imagePicker('banner_id', c.banner_id, { label: 'চওড়া ব্যানার ছবি (ঐচ্ছিক)', hint: 'ক্যাটাগরির পেজের উপরে দেখাবে। ১২০০×৩০০ এর মতো চওড়া ছবি দিন।', wide: true })}
          ${ui.check('noindex', !!c.noindex, 'গুগল সার্চে এই ক্যাটাগরির পেজ দেখাবে না (noindex)')}
        </details>
        <div class="cat-card-actions">
          <button class="btn btn-sm btn-ghost">সেভ</button>
          <a class="small" href="/admin/products?cat=${c.id}">পণ্য দেখুন</a>
          <button class="link-btn danger small" formaction="/admin/categories/${c.id}/delete" data-confirm-btn="'${c.name}' ক্যাটাগরি মুছবেন? পণ্যগুলো মুছবে না, শুধু ক্যাটাগরিহীন হবে। ভেতরের সাব-ক্যাটাগরিগুলো এক ধাপ উপরে চলে যাবে।">মুছুন</button>
        </div>
      </form>`)}
    </div>
  </section>
  <section class="panel">
    <h2>নতুন ক্যাটাগরি</h2>
    <form method="post" action="/admin/categories" class="form">
      <div class="field-row">
        ${ui.field('আইকন', ui.input('icon', '📦', { maxlength: 8, class: 'w-emoji', 'data-icon-input': true }))}
        ${ui.field('নাম', ui.input('name', '', { required: true, maxlength: 60, placeholder: 'যেমন: মোবাইল এক্সেসরিজ' }))}
      </div>
      ${ui.field('কোথায় থাকবে', ui.select('parent_id', parentChoices(null), ''), 'মূল ক্যাটাগরি, নাকি অন্য কোনো ক্যাটাগরির ভেতরে সাব-ক্যাটাগরি')}
      ${ui.field('ক্রম', ui.input('sort', categories.length, { type: 'number' }), 'ছোট সংখ্যা আগে দেখাবে')}
      <button class="btn">যোগ করুন</button>
    </form>
    <h2>আইকন বাছুন</h2>
    <p class="muted small">নিচের যেকোনো আইকনে চাপ দিলে শেষে যে আইকন বক্সে ক্লিক করেছিলেন সেখানে বসে যাবে।</p>
    <div class="icon-grid" data-icon-grid>${ICONS.map((i) => html`<button type="button" data-icon="${i}">${i}</button>`)}</div>
  </section>
</div>`;
  return ctx.page('ক্যাটাগরি', body, 'categories');
}
// ---------------------------------------------------------------- automatic sorting
async function autoPage(ctx) {
  const autocat = require('../services/autocat');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ids = list(b.id).map((x) => int(x)).filter(Boolean);
    if (!ids.length) return ctx.fail('/admin/categories/auto', 'কোনো পণ্য বাছা হয়নি।');
    const r = await autocat.apply({ ids });
    await ctx.log('category_save', 'category', null, `স্বয়ংক্রিয় ক্যাটাগরি: ${r.moved}টি পণ্য সাজানো হলো`);
    return ctx.redirect(ctx.res, '/admin/categories?info=' + encodeURIComponent(`✅ ${bn(r.moved)}টি পণ্য ঠিক ক্যাটাগরি / সাব-ক্যাটাগরিতে বসানো হয়েছে।`));
  }
  const rows = await autocat.preview();
  const change = rows.filter((r) => r.to && !r.same);
  const same = rows.filter((r) => r.same);
  const unknown = rows.filter((r) => !r.to);
  const groups = new Map();
  rows.filter((r) => r.to).forEach((r) => groups.set(r.path, (groups.get(r.path) || 0) + 1));
  const body = html`<p class="crumbs"><a href="/admin/categories">← ক্যাটাগরি</a></p>
<h1>🤖 পণ্য স্বয়ংক্রিয়ভাবে সাজান</h1>
${ui.flash(ctx.flash)}
<p class="muted">প্রতিটা পণ্যের নাম পড়ে ঠিক করা হয়েছে কোনটা কোন মূল ক্যাটাগরি → সাব-ক্যাটাগরিতে যাবে। নিচে দেখে নিন; কোনোটা ভুল মনে হলে তার টিক তুলে দিন, তারপর সেভ করুন। দরকারি ক্যাটাগরিগুলো নিজে থেকে তৈরি হবে।</p>
<div class="kpis">
  ${ui.kpi('বদলাবে', bn(change.length), 'নতুন জায়গায় যাবে', 'kpi-blue')}
  ${ui.kpi('আগে থেকেই ঠিক আছে', bn(same.length), '', 'kpi-green')}
  ${ui.kpi('চেনা যায়নি', bn(unknown.length), 'হাতে ক্যাটাগরি দিন', unknown.length ? 'kpi-alert' : '')}
</div>
<details class="help"><summary>📂 কোন ক্যাটাগরিতে কয়টা পণ্য যাবে</summary><div><ul class="auto-groups">${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, n]) => html`<li>${path} — <b>${bn(n)}</b></li>`)}</ul></div></details>
${change.length ? html`<form method="post" action="/admin/categories/auto" class="panel">
  <div class="row-actions"><button class="btn btn-lg">✅ টিক দেওয়া ${bn(change.length)}টি পণ্য সাজিয়ে সেভ করুন</button>
    <label class="check"><input type="checkbox" checked data-check-all> <span>সব বাছুন</span></label></div>
  <div class="table-wrap"><table class="table">
    <thead><tr><th></th><th>পণ্য</th><th>এখন</th><th>যাবে</th></tr></thead>
    <tbody>${change.map((r) => html`<tr><td><input type="checkbox" name="id[]" value="${r.id}" checked data-check-row></td>
      <td><a href="/admin/products/${r.id}" target="_blank" rel="noopener">${r.name}</a></td>
      <td class="small muted">${r.from || '—'}</td><td class="small"><b>${r.path}</b></td></tr>`)}</tbody>
  </table></div>
</form>` : ui.empty('সব পণ্য আগে থেকেই ঠিক ক্যাটাগরিতে আছে। 👍')}
${unknown.length ? html`<section class="panel"><h2>চেনা যায়নি — হাতে ক্যাটাগরি দিন</h2><ul class="small">${unknown.map((r) => html`<li><a href="/admin/products/${r.id}">${r.name}</a>${r.from ? html` <span class="muted">(এখন: ${r.from})</span>` : ''}</li>`)}</ul></section>` : ''}`;
  return ctx.page('স্বয়ংক্রিয় ক্যাটাগরি', body, 'categories');
}

async function deleteCategory(ctx, m) {
  await ctx.trash('category', int(m[1]));
  await ctx.log('category_delete', 'category', int(m[1]), '');
  return ctx.back('/admin/categories', 'deleted');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/products', perm: 'products', handler: listPage },
    { method: 'POST', path: '/admin/products/bulk', perm: (ctx) => (ctx.can('products') ? 'products' : 'products_delete'), handler: bulkAction },
    { method: '*', path: '/admin/products/duplicates', perm: 'products', handler: duplicatesPage },
    { method: 'POST', path: '/admin/api/products/dup-check', perm: 'products', handler: dupCheckApi },
    { method: '*', path: '/admin/products/new', perm: 'products', handler: (ctx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/products\/(\d+)$/, perm: 'products', handler: formPage },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/active$/, perm: 'products', handler: setActive },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/delete$/, perm: 'products', handler: remove },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/duplicate$/, perm: 'products', handler: duplicate },
    { method: '*', path: '/admin/categories', perm: 'products', handler: categoriesPage },
    { method: '*', path: '/admin/categories/auto', perm: 'products', handler: autoPage },
    { method: 'POST', path: /^\/admin\/categories\/(\d+)\/delete$/, perm: 'products', handler: deleteCategory },
  ],
};

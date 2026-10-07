'use strict';
const { html, raw, money, bn, int, str, pageNum, list, youtubeId, pct } = require('../util');
const catalog = require('../models/catalog');
const ui = require('./ui');

const PER_PAGE = 40;
const ICONS = ['📦', '📟', '🧩', '🔋', '🔥', '🔌', '👕', '👗', '👟', '👜', '⌚', '📱', '💻', '🎧', '🔊', '📷', '🎮', '💡', '🔧', '🛠️', '⚙️',
  '🧲', '🧪', '🏠', '🛋️', '🍳', '🧴', '💄', '🧸', '📚', '✏️', '⚽', '🚲', '🚗', '🌱', '🐾', '🍎', '☕', '🎁', '💍', '🕶️', '🧢', '🧥', '🩺', '🧼', '📡', '🔦', '🪛', '🧵'];

async function listPage(ctx) {
  const page = pageNum(ctx.query);
  const categories = await catalog.listCategories();
  const f = {
    q: str(ctx.query.get('q'), 80),
    categoryId: int(ctx.query.get('cat')) || null,
    type: ['single', 'bundle'].includes(ctx.query.get('type')) ? ctx.query.get('type') : '',
    lowStock: ctx.query.get('low') === '1',
    includeInactive: true,
  };
  const sort = ['new', 'name', 'price_asc', 'price_desc', 'stock_asc', 'popular'].includes(ctx.query.get('sort')) ? ctx.query.get('sort') : 'new';
  const [rows, total] = await Promise.all([
    catalog.listProducts({ ...f, sort, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), catalog.countProducts(f),
  ]);
  const seeCost = ctx.can('see_cost');
  const qsBase = new URLSearchParams();
  if (f.q) qsBase.set('q', f.q);
  if (f.categoryId) qsBase.set('cat', f.categoryId);
  if (f.type) qsBase.set('type', f.type);
  if (f.lowStock) qsBase.set('low', '1');
  if (sort !== 'new') qsBase.set('sort', sort);
  const isBundle = f.type === 'bundle';
  const body = html`
<div class="title-row"><h1>${isBundle ? 'বান্ডেল / প্যাকেজ' : 'পণ্য'} <small>${bn(total)}টি</small></h1>
  <div class="row-actions">
    <a class="btn" href="/admin/products/new${isBundle ? '?type=bundle' : ''}">+ ${isBundle ? 'নতুন বান্ডেল' : 'নতুন পণ্য'}</a>
    ${isBundle ? '' : html`<a class="btn btn-ghost" href="/admin/products/new?type=bundle">+ বান্ডেল</a>`}
  </div>
</div>
${ui.flash(ctx.flash)}
${isBundle ? ui.helpBox('বান্ডেল কী?', html`কয়েকটা পণ্য একসাথে এক দামে বিক্রি করাকে বান্ডেল/প্যাকেজ বলে। যেমন "সোল্ডারিং কিট" = আয়রন + তার + স্ট্যান্ড। বান্ডেল বিক্রি হলে ভেতরের প্রতিটা পণ্যের স্টক নিজে থেকে কমবে। বান্ডেলের স্টক = ভেতরের পণ্যগুলোর মধ্যে যেটা সবচেয়ে কম আছে।`) : ''}
<form class="toolbar filters" method="get" action="/admin/products">
  <input type="search" name="q" value="${f.q}" placeholder="নাম, SKU বা ব্র্যান্ড">
  ${ui.select('cat', [['', 'সব ক্যাটাগরি'], ...categories.map((c) => [c.id, `${c.icon} ${c.name}`])], f.categoryId || '')}
  ${ui.select('type', [['', 'সব ধরন'], ['single', 'একক পণ্য'], ['bundle', 'বান্ডেল']], f.type)}
  ${ui.select('sort', [['new', 'নতুন আগে'], ['name', 'নাম (A-Z)'], ['price_asc', 'দাম কম→বেশি'], ['price_desc', 'দাম বেশি→কম'], ['stock_asc', 'স্টক কম আগে'], ['popular', 'বেশি বিক্রি']], sort)}
  ${ui.check('low', f.lowStock, 'শুধু স্টক কম')}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${rows.length ? html`<div class="table-wrap panel"><table class="table">
<thead><tr><th></th><th>পণ্য</th><th>SKU</th><th>ক্যাটাগরি</th><th class="num">দাম</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">লাভ</th>` : ''}<th class="num">স্টক</th><th class="num">বিক্রি</th><th>দোকানে</th></tr></thead>
<tbody>${rows.map((p) => {
    const margin = p.price > 0 && p.cost_price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : null;
    return html`<tr class="${p.active ? '' : 'row-off'}">
  <td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="" loading="lazy">` : html`<span>${p.emoji}</span>`}</td>
  <td><a href="/admin/products/${p.id}"><b>${p.name}</b></a>
    ${p.product_type === 'bundle' ? html` <span class="pill pill-bundle">বান্ডেল</span>` : ''}${p.featured ? html` <span class="pill">জনপ্রিয়</span>` : ''}
    ${p.old_price > p.price ? html` <span class="pill pill-offer">অফার</span>` : ''}</td>
  <td class="small">${p.sku || '—'}</td>
  <td class="small">${p.category_name ? `${p.category_icon} ${p.category_name}` : '—'}</td>
  <td class="num">${money(p.price)}${p.old_price > p.price ? html`<br><s class="small muted">${money(p.old_price)}</s>` : ''}</td>
  ${seeCost ? html`<td class="num">${p.cost_price ? money(p.cost_price) : html`<span class="muted">—</span>`}</td>
  <td class="num ${margin !== null && margin < 10 ? 'warn' : 'good'}">${margin !== null ? html`${money(p.price - p.cost_price)}<br><span class="small">${pct(margin)}</span>` : '—'}</td>` : ''}
  <td class="num ${p.stock <= p.low_stock ? 'warn' : ''}">${bn(p.stock)}</td>
  <td class="num">${bn(p.sold_count)}</td>
  <td class="small">${p.active ? 'দেখা যাচ্ছে' : 'লুকানো'}</td>
</tr>`;
  })}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, '/admin/products' + (qsBase.toString() ? '?' + qsBase : ''))}`
    : ui.empty('কোনো পণ্য পাওয়া যায়নি।', html`<a class="btn" href="/admin/products/new">পণ্য যোগ করুন</a>`)}`;
  return ctx.page(isBundle ? 'বান্ডেল' : 'পণ্য', body, isBundle ? 'bundles' : 'products');
}

function productForm({ product, categories, error, seeCost }) {
  const p = product || { active: true, stock: 10, emoji: '📦', images: [], bundle: [], product_type: 'single', low_stock: 3, unit: 'পিস' };
  const isNew = !p.id;
  const bundle = p.product_type === 'bundle';
  return html`<p class="crumbs"><a href="/admin/products${bundle ? '?type=bundle' : ''}">← সব ${bundle ? 'বান্ডেল' : 'পণ্য'}</a></p>
<div class="title-row"><h1>${isNew ? (bundle ? 'নতুন বান্ডেল / প্যাকেজ' : 'নতুন পণ্য আপলোড') : p.name}</h1>
  ${isNew ? '' : html`<div class="row-actions"><a class="btn btn-ghost btn-sm" href="/p/${p.slug}" target="_blank" rel="noopener">দোকানে দেখুন ↗</a>
    <form method="post" action="/admin/products/${p.id}/duplicate"><button class="btn btn-ghost btn-sm">কপি করুন</button></form></div>`}
</div>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${p.id}`}" class="form product-form" data-product-form>
  <input type="hidden" name="product_type" value="${bundle ? 'bundle' : 'single'}">
  <div class="two-col">
    <div>
      <section class="panel">
        <h2>মূল তথ্য</h2>
        ${ui.field('পণ্যের নাম', ui.input('name', p.name || '', { required: true, maxlength: 140, placeholder: 'যেমন: PAM8403 Mini Amplifier Board' }))}
        <div class="field-row">
          ${ui.field('SKU (পণ্যের কোড)', ui.input('sku', p.sku || '', { maxlength: 60, placeholder: 'যেমন: SM-1001' }), 'নিজের সুবিধামতো কোড; অর্ডার আর ইনভয়েসে দেখাবে')}
          ${ui.field('ক্যাটাগরি', ui.select('category_id', [['', 'কোনোটি না'], ...categories.map((c) => [c.id, `${c.icon} ${c.name}`])], p.category_id || ''))}
        </div>
        <div class="field-row">
          ${ui.field('ব্র্যান্ড (ঐচ্ছিক)', ui.input('brand', p.brand || '', { maxlength: 60 }))}
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
        ${bundle ? html`<p class="muted small">বান্ডেলের নিজের স্টক নেই — ভেতরের পণ্যগুলোর স্টক থেকে হিসাব হয়।</p>` : html`<div class="field-row">
          ${ui.field('স্টক (কয়টি আছে)', ui.input('stock', p.own_stock ?? p.stock ?? 0, { type: 'number', min: 0, required: true }), isNew ? '' : 'বদলালে ইনভেন্টরি ইতিহাসে লেখা থাকবে')}
          ${ui.field('স্টক এর কম হলে সতর্ক করুন', ui.input('low_stock', p.low_stock ?? 3, { type: 'number', min: 0 }))}
          ${ui.field('ওজন (গ্রাম, কুরিয়ারের জন্য)', ui.input('weight_g', p.weight_g || '', { type: 'number', min: 0 }))}
        </div>`}
      </section>

      ${bundle ? html`<section class="panel" data-bundle>
        <h2>বান্ডেলে কী কী থাকবে</h2>
        <div class="item-picker">
          <input type="search" placeholder="পণ্য খুঁজে যোগ করুন…" data-bundle-search autocomplete="off">
          <ul class="picker-results" data-bundle-results hidden></ul>
        </div>
        <table class="table item-rows"><thead><tr><th>পণ্য</th><th class="num">একক দাম</th><th class="num">পরিমাণ</th><th class="num">স্টক</th><th></th></tr></thead>
          <tbody data-bundle-rows>${(p.bundle || []).map((b) => html`<tr data-row data-price="${b.price}">
            <td>${b.name}${b.sku ? html`<br><span class="small muted">${b.sku}</span>` : ''}<input type="hidden" name="bundle_id[]" value="${b.product_id}"></td>
            <td class="num">${money(b.price)}</td>
            <td class="num"><input type="number" name="bundle_qty[]" value="${b.qty}" min="1" class="w-num" data-qty></td>
            <td class="num">${bn(b.stock)}</td>
            <td><button type="button" class="link-btn danger" data-remove-row>✕</button></td></tr>`)}</tbody></table>
        <p class="muted small" data-bundle-sum></p>
      </section>` : ''}

      <section class="panel">
        <h2>বিবরণ</h2>
        ${ui.field('ছোট বিবরণ (Short description)', ui.textarea('short_description', p.short_description || '', { rows: 3, maxlength: 1000 }), 'পণ্যের পেজে দামের নিচে দেখাবে। ২-৪ লাইনে মূল কথা।')}
        ${ui.field('বিস্তারিত বিবরণ (Long description)', ui.textarea('description', p.description || '', { rows: 10, maxlength: 20000 }),
    raw('পেজের নিচে "বিস্তারিত" ট্যাবে দেখাবে। নতুন লাইন = নতুন প্যারাগ্রাফ। <b>## শিরোনাম</b> লিখলে বড় হেডিং, <b>- </b> দিয়ে শুরু করলে বুলেট পয়েন্ট, <b>**মোটা লেখা**</b>।'))}
      </section>

      <section class="panel">
        <h2>SEO (গুগলে কেমন দেখাবে)</h2>
        ${ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120, placeholder: 'খালি রাখলে পণ্যের নাম' }))}
        ${ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'খালি রাখলে ছোট বিবরণ' }))}
      </section>
    </div>

    <div>
      <section class="panel">
        <h2>ছবি <small>সর্বোচ্চ ৮টি</small></h2>
        <div class="gallery-edit" data-gallery>
          ${(p.images || []).map((id) => html`<figure data-img="${id}"><img src="/media/${id}/t" alt=""><div class="g-tools">
            <button type="button" data-move="-1" aria-label="আগে">◀</button><button type="button" data-move="1" aria-label="পরে">▶</button><button type="button" data-del aria-label="মুছুন">✕</button></div></figure>`)}
          <label class="g-add" data-gallery-add>＋<span>ছবি যোগ করুন</span><input type="file" accept="image/*" multiple hidden data-gallery-file></label>
        </div>
        <input type="hidden" name="images" value="${(p.images || []).join(',')}" data-gallery-value>
        <p class="muted small">প্রথম ছবিটাই মূল ছবি। মোবাইলের ছবি দিলেও চলবে, নিজে থেকে ছোট হয়ে যাবে। বাম-ডান বাটন দিয়ে ক্রম বদলান।</p>
        ${ui.field('ছবি না থাকলে এই ইমোজি দেখাবে', ui.input('emoji', p.emoji || '📦', { maxlength: 8, class: 'w-emoji' }))}
      </section>

      <section class="panel">
        <h2>ভিডিও (YouTube)</h2>
        ${ui.field('YouTube লিংক', ui.input('youtube_url', p.youtube_url || '', { type: 'url', maxlength: 200, placeholder: 'https://www.youtube.com/watch?v=...', 'data-yt': true }), 'পণ্যের পেজে ছবির পাশে ভিডিও দেখাবে। Shorts লিংকও চলবে।')}
        <div class="yt-preview" data-yt-preview>${youtubeId(p.youtube_url) ? html`<img src="https://i.ytimg.com/vi/${youtubeId(p.youtube_url)}/hqdefault.jpg" alt="">` : ''}</div>
      </section>

      <section class="panel">
        <h2>দেখানো</h2>
        ${ui.check('active', p.active, 'দোকানে দেখাও')}
        ${ui.check('featured', p.featured, 'হোমপেজের "জনপ্রিয় পণ্য"-তে দেখাও')}
      </section>
    </div>
  </div>
  <div class="form-actions sticky-actions">
    <button class="btn btn-lg" data-save>${isNew ? (bundle ? 'বান্ডেল যোগ করুন' : 'পণ্য যোগ করুন') : 'পরিবর্তন সেভ করুন'}</button>
  </div>
</form>
${isNew ? '' : html`<form method="post" action="/admin/products/${p.id}/delete" class="danger-zone" data-confirm="এই পণ্যটি পুরোপুরি মুছে ফেলবেন? আর ফেরত আনা যাবে না। শুধু লুকাতে চাইলে 'দোকানে দেখাও' টিক তুলে দিন।">
  <button class="btn btn-danger btn-sm">পণ্যটি মুছে ফেলুন</button>
</form>`}`;
}

function bodyToProduct(b) {
  const ids = list(b.bundle_id);
  const qtys = list(b.bundle_qty);
  return { ...b, bundle: ids.map((id, i) => ({ product_id: id, qty: qtys[i] })) };
}

async function formPage(ctx, m) {
  const id = m && m[1] ? int(m[1]) : null;
  const categories = await catalog.listCategories();
  const seeCost = ctx.can('see_cost');
  if (ctx.method === 'POST') {
    const b = bodyToProduct(await ctx.body());
    if (!seeCost && id) {
      const cur = await catalog.getProduct({ id });
      b.cost_price = cur ? cur.cost_price : 0;
    }
    let error = !str(b.name) ? 'পণ্যের নাম লিখুন।' : null;
    if (!error && b.sku && await catalog.skuTaken(str(b.sku, 60), id)) error = 'এই SKU অন্য একটা পণ্যে আছে। আলাদা SKU দিন।';
    if (!error && b.youtube_url && !youtubeId(b.youtube_url)) error = 'YouTube লিংকটি ঠিক নেই।';
    if (!error && b.product_type === 'bundle' && !b.bundle.length) error = 'বান্ডেলে অন্তত একটি পণ্য যোগ করুন।';
    if (error) {
      const images = String(b.images || '').split(',').map((x) => int(x)).filter(Boolean);
      const parts = b.bundle.length ? await catalog.getProductsByIds(b.bundle.map((x) => x.product_id), { includeInactive: true }) : [];
      const product = { ...b, id, images, active: !!b.active, featured: !!b.featured,
        bundle: b.bundle.map((x) => { const pp = parts.find((y) => y.id === int(x.product_id)); return pp ? { product_id: pp.id, name: pp.name, sku: pp.sku, price: pp.price, stock: pp.stock, qty: int(x.qty, 1) } : null; }).filter(Boolean) };
      if (id) { const cur = await catalog.getProduct({ id }); product.slug = cur && cur.slug; }
      return ctx.page('পণ্য', productForm({ product, categories, error, seeCost }), id ? 'products' : 'product-new', { status: 400 });
    }
    const pid = await catalog.saveProduct({ ...b, id }, ctx.user.id);
    await ctx.log(id ? 'product_edit' : 'product_add', 'product', pid, str(b.name, 100));
    return ctx.back(`/admin/products/${pid}`, id ? 'saved' : 'added');
  }
  if (id) {
    const product = await catalog.getProduct({ id });
    if (!product) return ctx.redirect(ctx.res, '/admin/products');
    return ctx.page(product.name, html`${ui.flash(ctx.flash)}${productForm({ product, categories, seeCost })}`, product.product_type === 'bundle' ? 'bundles' : 'products');
  }
  const type = ctx.query.get('type') === 'bundle' ? 'bundle' : 'single';
  const fresh = { active: true, stock: type === 'bundle' ? 0 : 10, emoji: '📦', images: [], bundle: [], product_type: type, low_stock: 3, unit: type === 'bundle' ? 'সেট' : 'পিস',
    category_id: int(ctx.query.get('cat')) || null };
  return ctx.page('নতুন পণ্য', productForm({ product: fresh, categories, seeCost }), type === 'bundle' ? 'bundles' : 'product-new');
}

async function remove(ctx, m) {
  const id = int(m[1]);
  const p = await catalog.getProduct({ id });
  await catalog.deleteProduct(id);
  await ctx.log('product_delete', 'product', id, p ? p.name : '');
  return ctx.back('/admin/products', 'deleted');
}
async function duplicate(ctx, m) {
  const nid = await catalog.duplicateProduct(int(m[1]), ctx.user.id);
  if (!nid) return ctx.back('/admin/products');
  await ctx.log('product_add', 'product', nid, 'কপি');
  return ctx.back(`/admin/products/${nid}`, 'copied');
}

// ---------------------------------------------------------------- categories
async function categoriesPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (str(b.name)) {
      await catalog.saveCategory({ id: int(b.id) || null, name: b.name, icon: b.icon, sort: b.sort, active: b.id ? !!b.active : true, imageId: b.image_id });
      await ctx.log('category_save', 'category', int(b.id) || null, str(b.name, 60));
    }
    return ctx.back('/admin/categories', 'saved');
  }
  const categories = await catalog.listCategories();
  const body = html`<h1>ক্যাটাগরি <small>${bn(categories.length)}টি</small></h1>
${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel">
    <h2>সব ক্যাটাগরি</h2>
    <div class="cat-admin-grid">
      ${categories.map((c) => html`<form method="post" action="/admin/categories" class="cat-card ${c.active === false ? 'row-off' : ''}">
        <input type="hidden" name="id" value="${c.id}">
        <div class="cat-card-top">
          <input name="icon" value="${c.icon}" maxlength="8" aria-label="আইকন" class="w-emoji" data-icon-input>
          <input name="name" value="${c.name}" required maxlength="60" aria-label="নাম">
        </div>
        <div class="cat-card-bottom">
          <label class="small">ক্রম <input name="sort" type="number" value="${c.sort}" class="w-num"></label>
          ${ui.check('active', c.active !== false, 'দেখাও')}
          <span class="small muted">${bn(c.product_count)}টি পণ্য</span>
        </div>
        <div class="cat-card-actions">
          <button class="btn btn-sm btn-ghost">সেভ</button>
          <a class="small" href="/admin/products?cat=${c.id}">পণ্য দেখুন</a>
          <button class="link-btn danger small" formaction="/admin/categories/${c.id}/delete" data-confirm-btn="'${c.name}' ক্যাটাগরি মুছবেন? পণ্যগুলো মুছবে না, শুধু ক্যাটাগরিহীন হবে।">মুছুন</button>
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
async function deleteCategory(ctx, m) {
  await catalog.deleteCategory(int(m[1]));
  await ctx.log('category_delete', 'category', int(m[1]), '');
  return ctx.back('/admin/categories', 'deleted');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/products', perm: 'products', handler: listPage },
    { method: '*', path: '/admin/products/new', perm: 'products', handler: (ctx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/products\/(\d+)$/, perm: 'products', handler: formPage },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/delete$/, perm: 'products', handler: remove },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/duplicate$/, perm: 'products', handler: duplicate },
    { method: '*', path: '/admin/categories', perm: 'products', handler: categoriesPage },
    { method: 'POST', path: /^\/admin\/categories\/(\d+)\/delete$/, perm: 'products', handler: deleteCategory },
  ],
};

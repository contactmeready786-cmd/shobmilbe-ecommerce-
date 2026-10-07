'use strict';
const { html, raw, money, bn, int, str, pageNum, list, youtubeId, pct } = require('../util');
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
  const backUrl = '/admin/products' + (() => { const x = new URLSearchParams(qsBase); if (page > 1) x.set('page', page); if (isBundle) x.set('type', 'bundle'); const t = x.toString(); return t ? '?' + t : ''; })();
  const body = html`
<div class="title-row"><h1>${isBundle ? 'বান্ডেল / প্যাকেজ' : 'পণ্য'} <small>${bn(total)}টি</small></h1>
  <div class="row-actions">
    <a class="btn" href="/admin/products/new${isBundle ? '?type=bundle' : ''}">+ ${isBundle ? 'নতুন বান্ডেল' : 'নতুন পণ্য'}</a>
    ${isBundle ? '' : html`<a class="btn btn-ghost" href="/admin/products/import">📥 পণ্য আমদানি</a><a class="btn btn-ghost" href="/admin/products/new?type=bundle">+ বান্ডেল</a>`}
  </div>
</div>
${ui.flash(ctx.flash)}
${isBundle ? '' : navswitch.box(ctx, { urls: ['/products', '/products?sort=offer'], footer: ['products', 'offer'], back: '/admin/products' })}
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
<thead><tr><th></th><th>পণ্য</th><th>SKU</th><th>ক্যাটাগরি</th><th class="num">দাম</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">লাভ</th>` : ''}<th class="num">স্টক</th><th class="num">বিক্রি</th><th>দোকানে দেখাবে</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((p) => {
    const margin = p.price > 0 && p.cost_price > 0 ? ((p.price - p.cost_price) / p.price) * 100 : null;
    return html`<tr class="${p.active ? '' : 'row-off'}">
  <td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="" loading="lazy">` : html`<span>${p.emoji}</span>`}</td>
  <td><b>${p.name}</b>
    ${p.product_type === 'bundle' ? html` <span class="pill pill-bundle">বান্ডেল</span>` : ''}${p.featured ? html` <span class="pill">জনপ্রিয়</span>` : ''}
    ${p.old_price > p.price ? html` <span class="pill pill-offer">অফার</span>` : ''}</td>
  <td class="small">${p.sku || '—'}</td>
  <td class="small">${p.category_name ? `${p.category_icon} ${p.category_name}` : '—'}</td>
  <td class="num">${money(p.price)}${p.old_price > p.price ? html`<br><s class="small muted">${money(p.old_price)}</s>` : ''}</td>
  ${seeCost ? html`<td class="num">${p.cost_price ? money(p.cost_price) : html`<span class="muted">—</span>`}</td>
  <td class="num ${margin !== null && margin < 10 ? 'warn' : 'good'}">${margin !== null ? html`${money(p.price - p.cost_price)}<br><span class="small">${pct(margin)}</span>` : '—'}</td>` : ''}
  <td class="num ${p.stock <= p.low_stock ? 'warn' : ''}">${bn(p.stock)}</td>
  <td class="num">${bn(p.sold_count)}</td>
  <td><form method="post" action="/admin/products/${p.id}/active" class="prod-toggle">
    <input type="hidden" name="back" value="${backUrl}">
    <label class="switch" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে পুরো লুকিয়ে যাবে">
      <input type="checkbox" name="active" value="1" ${p.active ? raw('checked') : ''} data-prod-toggle aria-label="${p.name} দোকানে দেখাবে">
      <span class="switch-ui" aria-hidden="true"></span></label>
    <span class="small prod-toggle-text" data-prod-toggle-text>${p.active ? 'চালু' : 'বন্ধ'}</span>
    <noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript>
  </form></td>
  <td class="prod-actions">
    <a class="btn btn-sm btn-ghost" href="/admin/products/${p.id}">✏️ এডিট</a>
    <form method="post" action="/admin/products/${p.id}/delete" data-confirm="'${p.name}' পণ্যটি স্থায়ীভাবে মুছে ফেলবেন? আর ফেরত আনা যাবে না। শুধু দোকান থেকে সরাতে চাইলে পাশের সুইচ বন্ধ করুন।">
      <input type="hidden" name="back" value="${backUrl}">
      <button class="btn btn-sm btn-danger">🗑️ মুছুন</button>
    </form>
  </td>
</tr>`;
  })}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, '/admin/products' + (qsBase.toString() ? '?' + qsBase : ''))}`
    : ui.empty('কোনো পণ্য পাওয়া যায়নি।', html`<a class="btn" href="/admin/products/new">পণ্য যোগ করুন</a>`)}
${ctx.can('owner') && !isBundle ? html`<details class="danger-zone">
  <summary class="danger">🗑️ সব পণ্য একবারে মুছে ফেলুন (শুধু মালিক)</summary>
  <form method="post" action="/admin/products/delete-all" class="form narrow-form" data-confirm="সত্যিই দোকানের সব পণ্য স্থায়ীভাবে মুছে ফেলবেন? আর ফেরত আনা যাবে না।">
    <p>দোকানের <b>সব পণ্য, বান্ডেল, তাদের ছবি আর স্টকের ইতিহাস</b> স্থায়ীভাবে মুছে যাবে, আর <b>SKU আবার ০ থেকে শুরু হবে</b> (পরের নতুন পণ্য পাবে SKU ১)। আগের অর্ডারগুলো মুছবে না — সেখানে পণ্যের নাম আর দাম থেকে যাবে। ক্যাটাগরিও থাকবে।</p>
    ${ui.field('নিশ্চিত হলে নিচে লিখুন: সব মুছুন', ui.input('confirm', '', { required: true, autocomplete: 'off' }))}
    <button class="btn btn-danger">সব পণ্য স্থায়ীভাবে মুছে ফেলুন</button>
  </form>
</details>` : ''}`;
  return ctx.page(isBundle ? 'বান্ডেল' : 'পণ্য', body, isBundle ? 'bundles' : 'products');
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
  </li>`)}</ul>`;
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

function productForm({ product, categories, error, seeCost, dup, canOverride, guardOn = true, settings = {}, nextSku = '' }) {
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
        <p class="small-rule-hint" data-small-rule='${JSON.stringify({ on: settings.small_qty_on !== '0', cap: Number(settings.small_max_price) || 5, minVal: Number(settings.small_min_value) || 10, maxVal: Number(settings.small_max_value) || 100, maxQty: Number(settings.max_qty_per_item) || 10 })}' hidden></p>
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
        ${ui.field('ছোট বিবরণ (Short description)', ui.textarea('short_description', p.short_description || '', { rows: 3, maxlength: 1000 }), 'পণ্যের পেজে দামের ঠিক নিচে "📝 সংক্ষেপে" বক্সে দেখাবে। ২-৪ লাইনে মূল কথা।')}
        ${ui.field('বিস্তারিত বিবরণ (Long description)', ui.textarea('description', p.description || '', { rows: 10, maxlength: 20000 }),
    raw('পেজের নিচে "📋 পণ্যের বিস্তারিত বিবরণ" অংশে দেখাবে। নতুন লাইন = নতুন প্যারাগ্রাফ। <b>## শিরোনাম</b> লিখলে বড় হেডিং, <b>- </b> দিয়ে শুরু করলে বুলেট পয়েন্ট, <b>**মোটা লেখা**</b>।'))}
      </section>

      <section class="panel">
        <h2>SEO (গুগলে কেমন দেখাবে)</h2>
        ${ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120, placeholder: 'খালি রাখলে পণ্যের নাম' }))}
        ${ui.field('SEO কিওয়ার্ড', ui.input('seo_keywords', p.seo_keywords || '', { maxlength: 300, placeholder: 'যেমন: amplifier board price in bd, PAM8403, অ্যামপ্লিফায়ার' }), 'কমা (,) দিয়ে আলাদা করে লিখুন। মানুষ গুগলে যে শব্দ লিখে খোঁজে সেগুলো দিন — বাংলা ও ইংরেজি দুটোই দিতে পারেন।')}
        ${ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300, placeholder: 'খালি রাখলে ছোট বিবরণ' }))}
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
      return ctx.page('পণ্য', productForm({ product, categories, error, seeCost, dup, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku: id ? '' : await catalog.nextSku() }), id ? 'products' : 'product-new', { status: 400 });
    }
    const pid = await catalog.saveProduct({ ...b, id }, ctx.user.id);
    await ctx.log(id ? 'product_edit' : 'product_add', 'product', pid, str(b.name, 100));
    if (b.allow_duplicate && !(cur && cur.allow_duplicate)) await ctx.log('product_dup_allow', 'product', pid, `ডুপ্লিকেট হলেও প্রকাশের অনুমতি: ${str(b.name, 80)}`);
    return ctx.back(`/admin/products/${pid}`, id ? 'saved' : 'added');
  }
  if (id) {
    const product = await catalog.getProduct({ id });
    if (!product) return ctx.redirect(ctx.res, '/admin/products');
    return ctx.page(product.name, html`${ui.flash(ctx.flash)}${productForm({ product, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings })}`, product.product_type === 'bundle' ? 'bundles' : 'products');
  }
  const type = ctx.query.get('type') === 'bundle' ? 'bundle' : 'single';
  const fresh = { active: true, stock: type === 'bundle' ? 0 : 10, emoji: '📦', images: [], bundle: [], product_type: type, low_stock: 3, unit: type === 'bundle' ? 'সেট' : 'পিস',
    category_id: int(ctx.query.get('cat')) || null };
  const nextSku = await catalog.nextSku();
  return ctx.page('নতুন পণ্য', productForm({ product: fresh, categories, seeCost, canOverride: canOverride(ctx), guardOn: guardOn(ctx), settings: ctx.settings, nextSku }), type === 'bundle' ? 'bundles' : 'product-new');
}

// Where to go after a list action: back to the same list page (only our own product list).
function backTo(b) {
  const v = String(b.back || '');
  return /^\/admin\/products(\?[\w=&%.+-]*)?$/.test(v) ? v : '/admin/products';
}
async function remove(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const p = await catalog.getProduct({ id });
  await catalog.deleteProduct(id);
  await ctx.log('product_delete', 'product', id, p ? p.name : '');
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
async function removeAll(ctx) {
  const b = await ctx.body();
  if (String(b.confirm || '').replace(/\s+/g, ' ').trim() !== 'সব মুছুন') return ctx.fail('/admin/products', 'মোছা হয়নি — ঘরে ঠিকভাবে "সব মুছুন" লিখুন।');
  const n = await catalog.deleteAllProducts();
  await ctx.log('product_delete', 'product', null, `সব পণ্য মুছে ফেলা হয়েছে (${n}টি), SKU আবার ১ থেকে শুরু`);
  return ctx.redirect(ctx.res, '/admin/products?info=' + encodeURIComponent(`${bn(n)}টি পণ্য স্থায়ীভাবে মুছে ফেলা হয়েছে। এখন থেকে নতুন পণ্যের SKU আবার ১ থেকে শুরু হবে।`));
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
        ${may && i > 0 && !x.allow_duplicate ? html`<form method="post" action="/admin/products/duplicates"><input type="hidden" name="form" value="allow"><input type="hidden" name="id" value="${x.id}">
          <button class="btn btn-ghost btn-sm" title="এটা আলাদা পণ্য, তালিকা থেকে সরান">আলাদা পণ্য ✓</button></form>` : ''}
      </li>`)}</ul>
    </div>`;
  };
  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>ডুপ্লিকেট পণ্য <small>${bn(sure.length)}টি নিশ্চিত, ${bn(maybe.length)}টি সম্ভাব্য</small></h1>
${ui.flash(ctx.flash)}
<section class="panel">
  <h2>ডুপ্লিকেট আটকানো</h2>
  <form method="post" action="/admin/products/duplicates" class="form">
    <input type="hidden" name="form" value="settings">
    ${ui.switchRow('dup_guard', on, 'একই পণ্য দুইবার উঠতে দেবেন না', 'নতুন পণ্য যোগ বা এডিট করার সময় নাম, ছবি আর বিবরণ মিলিয়ে দেখা হবে। আগে থেকে থাকলে সেভ আটকে যাবে।')}
    ${ui.field('কতটা কড়াভাবে মেলাবে', ui.select('dup_level', Object.entries(dupes.LEVELS).map(([k, v]) => [k, v.label]), ctx.settings.dup_level || 'normal', { disabled: !may }),
    'কড়া = একটু মিল থাকলেই আটকাবে (মাঝে মাঝে আলাদা পণ্যও আটকাতে পারে)। নরম = শুধু খুব বেশি মিল থাকলে আটকাবে।')}
    ${may ? html`<button class="btn btn-sm">সেভ করুন</button>` : html`<p class="small muted">এই সেটিং শুধু মালিক বা অনুমতি পাওয়া স্টাফ বদলাতে পারবে।</p>`}
  </form>
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
      await catalog.saveCategory({ id: int(b.id) || null, name: b.name, icon: b.icon, sort: b.sort, active: b.id ? !!b.active : true, imageId: b.image_id });
      await ctx.log('category_save', 'category', int(b.id) || null, str(b.name, 60));
    }
    return ctx.back('/admin/categories', 'saved');
  }
  const categories = await catalog.listCategories();
  const showTop = ctx.settings.show_cat_strip !== '0';
  const showGrid = db.jsonSetting(ctx.settings, 'home_sections', []).includes('categories');
  const body = html`<h1>ক্যাটাগরি <small>${bn(categories.length)}টি</small></h1>
${ui.flash(ctx.flash)}
<section class="panel">
  <h2>দোকানে ক্যাটাগরি কোথায় দেখাবে</h2>
  <form method="post" action="/admin/categories" class="switch-list" data-switch-form>
    <input type="hidden" name="form" value="display">
    ${displaySwitch('show_cat_strip', showTop, 'উপরের ক্যাটাগরি বার (ব্যানারের উপরে)', 'হেডারের ঠিক নিচে, প্রতিটা পেজে এক লাইনে ক্যাটাগরির নাম। (মোবাইলে এই বার এমনিতেই লুকানো থাকে, মেনুতে ক্যাটাগরি পাওয়া যায়।)')}
    ${displaySwitch('show_cat_grid', showGrid, 'নিচের ক্যাটাগরি বক্স (হোমপেজে)', 'হোমপেজে ব্যানারের নিচে আইকনসহ ছোট ছোট বক্স।')}
    <noscript><button class="btn btn-sm">সেভ করুন</button></noscript>
  </form>
</section>
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
    { method: '*', path: '/admin/products/duplicates', perm: 'products', handler: duplicatesPage },
    { method: 'POST', path: '/admin/api/products/dup-check', perm: 'products', handler: dupCheckApi },
    { method: '*', path: '/admin/products/new', perm: 'products', handler: (ctx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/products\/(\d+)$/, perm: 'products', handler: formPage },
    { method: 'POST', path: '/admin/products/delete-all', perm: 'owner', handler: removeAll },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/active$/, perm: 'products', handler: setActive },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/delete$/, perm: 'products', handler: remove },
    { method: 'POST', path: /^\/admin\/products\/(\d+)\/duplicate$/, perm: 'products', handler: duplicate },
    { method: '*', path: '/admin/categories', perm: 'products', handler: categoriesPage },
    { method: 'POST', path: /^\/admin\/categories\/(\d+)\/delete$/, perm: 'products', handler: deleteCategory },
  ],
};

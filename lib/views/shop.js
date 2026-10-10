'use strict';
const security = require('../security');
const { html, raw, esc, money, bn, fmtDate, youtubeId, contact, roundOff, qtyRule, minOrder } = require('../util');
const O = require('../models/orders');
const md = require('./md');
const { categoryTree } = require('../models/catalog');
const U = require('../services/uiswitch');

function img(p, cls = '', thumb = true) {
  if (p.image_id) return html`<img class="${cls}" src="/media/${p.image_id}${thumb ? '/t' : ''}" alt="${p.name}" loading="lazy" decoding="async" draggable="false">`;
  return html`<span class="emoji ${cls}" aria-hidden="true">${p.emoji || '📦'}</span>`;
}
function discount(p) {
  if (!p.old_price || p.old_price <= p.price) return 0;
  return Math.round(((p.old_price - p.price) / p.old_price) * 100);
}

// ★★★★☆ for a rating (rounded to the nearest whole star)
function stars(r) {
  const n = Math.max(0, Math.min(5, Math.round(Number(r) || 0)));
  return html`<span class="stars" aria-label="${bn(Number(r || 0).toFixed(1))} / ৫">${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(5 - n)}</span></span>`;
}
const wishOn = (s) => !s || s.wishlist_on !== '0';
function wishBtn(p, s, cls = '') {
  return wishOn(s) ? html`<button type="button" class="wish-btn ${cls}" data-wish="${p.id}" aria-label="${p.name} পছন্দের তালিকায় রাখুন" aria-pressed="false" title="পছন্দের তালিকায় রাখুন">♡</button>` : '';
}

// "নতুন": ticked by hand, or added within the last N days (Admin → সেটিংস)
function isNewP(p, s) {
  if (p.is_new) return true;
  const days = Number(s && s.new_badge_days !== undefined ? s.new_badge_days : 14);
  return days > 0 && !!p.created_at && Date.now() - new Date(p.created_at).getTime() < days * 864e5;
}
function productCard(p, settings, badge = '') {
  const S = settings || {};
  if (!badge && isNewP(p, settings) && U.on(S, 'ui_card_new')) badge = 'নতুন';
  if (badge === 'নতুন' && !U.on(S, 'ui_card_new')) badge = '';
  const off = U.on(S, 'ui_card_discount') ? discount(p) : 0;
  const out = p.stock <= 0;
  return html`<article class="card ${out ? 'is-out' : ''}">
  <a class="card-pic" href="/p/${p.slug}" tabindex="-1" aria-hidden="true">
    ${img(p)}
    ${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}
    ${p.product_type === 'bundle' ? html`<span class="badge-bundle">প্যাকেজ</span>` : ''}
    ${p.flash_ends ? html`<span class="badge-flash">⚡ ফ্ল্যাশ সেল</span>` : badge ? html`<span class="badge-tag">${badge}</span>` : ''}
  </a>
  ${wishBtn(p, settings, 'card-wish')}
  <div class="card-body">
    ${p.category_name && U.on(S, 'ui_card_category') ? html`<span class="card-cat">${p.category_name}</span>` : ''}
    <h3 class="card-title"><a href="/p/${p.slug}">${p.name}</a></h3>
    ${p.rating_count > 0 && U.on(S, 'ui_card_rating') && U.on(S, 'reviews_on') ? html`<p class="card-rating">${stars(p.rating_avg)} <span>(${bn(p.rating_count)})</span></p>` : ''}
    <div class="price-row">
      <span class="price">${money(p.price)}</span>${p.variant_count > 0 ? html`<span class="per-pc">থেকে</span>` : qtyRule(settings || {}, p.price).cheap ? html`<span class="per-pc">/পিস</span>` : ''}
      ${p.old_price > p.price ? html`<s class="old-price">${money(p.old_price)}</s>` : ''}
    </div>
    ${p.flash_ends && U.on(S, 'ui_card_flash_timer') ? html`<p class="card-flash">⚡ শেষ হবে <b class="countdown" data-countdown="${new Date(p.flash_ends).toISOString()}"></b></p>` : ''}
    ${out
    ? (p.preorder && p.product_type !== 'bundle' ? html`<a class="btn btn-block btn-ghost" href="/p/${p.slug}">⏳ প্রি-অর্ডার করুন</a>` : html`<button class="btn btn-block" disabled>স্টকে নেই</button>`)
    : p.variant_count > 0 ? html`<div class="card-actions"><a class="btn btn-block btn-add" href="/p/${p.slug}">অপশন বাছুন (${bn(p.variant_count)})</a></div>`
    : html`<div class="card-actions">
        <button class="btn btn-block btn-add" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}">কার্টে যোগ করুন</button>
        ${S.show_buy_now_on_card === '1' ? html`<button class="btn btn-block btn-amber btn-buy" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}" data-buy-now>${U.text(S, 'uit_buy_now')}</button>` : ''}
      </div>`}
  </div>
</article>`;
}
function productGrid(products, settings, emptyMsg) {
  if (!products.length) return html`<div class="empty"><p>${emptyMsg || 'কোনো পণ্য পাওয়া যায়নি।'}</p><a class="btn" href="/products">সব পণ্য দেখুন</a></div>`;
  return html`<div class="grid">${products.map((p) => productCard(p, settings))}</div>`;
}
// The shop's four promises — small and in one row (inside the blue banner, or a thin strip under the pictures).
function trustItems(s, cls) {
  const phone = contact(s).phone;
  return html`<ul class="trust-row ${cls}">
    <li><span class="tr-ic" aria-hidden="true">🚚</span><span><b>সারা দেশে ডেলিভারি</b><small>ঢাকায় ${money(s.delivery_dhaka)}, বাইরে ${money(s.delivery_outside)}</small></span></li>
    <li><span class="tr-ic" aria-hidden="true">💵</span><span><b>ক্যাশ অন ডেলিভারি</b><small>পণ্য হাতে পেয়ে টাকা</small></span></li>
    <li><span class="tr-ic" aria-hidden="true">🔁</span><span><b>সহজ রিটার্ন</b><small>সমস্যা থাকলে ফেরত</small></span></li>
    <li>${phone ? html`<a href="tel:${phone}" class="tr-link"><span class="tr-ic" aria-hidden="true">📞</span><span><b>সাহায্য দরকার?</b><small>${phone}</small></span></a>`
    : html`<span class="tr-ic" aria-hidden="true">📞</span><span><b>সাহায্য দরকার?</b><small>আমাদের মেসেজ দিন</small></span>`}</li>
  </ul>`;
}
function section(title, link, content) {
  return html`<section class="home-sec"><div class="section-head"><h2>${title}</h2>${link ? html`<a href="${link}">সব দেখুন →</a>` : ''}</div>${content}</section>`;
}
// Home page boxes: only the main categories (no drop-downs); the count includes their sub-categories.
function catGrid(categories) {
  const { roots } = categoryTree(categories);
  return html`<nav class="cat-grid" aria-label="ক্যাটাগরি">${roots.map((c) => html`<a class="cat-box" href="/products?cat=${c.slug}">
    <span class="cat-ic" aria-hidden="true">${c.image_id ? html`<img src="/media/${c.image_id}/t" alt="" draggable="false">` : c.icon}</span>
    <span class="cat-name">${c.name}</span><span class="cat-count">${bn(c.total_count)}টি</span></a>`)}</nav>`;
}
// "হোম / ইলেকট্রনিক্স / সার্কিট ও মডিউল" — every step is a link except the last
function catCrumbs(node, last = true) {
  if (!node) return '';
  return html`${node.path.map((x, i) => (last && i === node.path.length - 1 ? html` / <span>${x.name}</span>` : html` / <a href="/products?cat=${x.slug}">${x.name}</a>`))}`;
}

// A row of products that slides sideways (arrows on computers, swipe on phones).
// auto = moves on by itself, one card at a time, and stops while someone is looking at it.
function rail(title, link, products, s, { badge = '', auto = false, sub = '', chips = null } = {}) {
  if (!products || !products.length) return '';
  return html`<section class="home-sec rail-sec">
    <div class="section-head"><div><h2>${title}</h2>${sub ? html`<p class="sec-sub">${sub}</p>` : ''}</div>
      <div class="rail-head-r">${link ? html`<a href="${link}">সব দেখুন →</a>` : ''}
        <button type="button" class="rail-btn" data-rail-prev aria-label="আগের পণ্য">‹</button><button type="button" class="rail-btn" data-rail-next aria-label="পরের পণ্য">›</button></div></div>
    ${chips && chips.length ? html`<div class="chips rail-chips">${chips.map((c) => html`<a class="chip" href="/products?cat=${c.slug}">${c.name}</a>`)}</div>` : ''}
    <div class="rail" data-rail ${auto ? raw('data-rail-auto') : ''}>${products.map((p) => productCard(p, s, typeof badge === 'function' ? badge(p) : badge))}</div>
  </section>`;
}

// ---------------------------------------------------------------- home
function home({ settings: s, sections, data }) {
  const parts = sections.map((key) => {
    if (key === 'slider') {
      if (!data.slides.length || s.slider_on === '0') {
        // no banner pictures yet: the blue welcome banner, with the shop's promises inside it
        return html`<section class="hero"><div class="wrap hero-row"><div class="hero-text">
          <h1>${s.hero_title || 'দরকারি সব পার্টস, এক দোকানে'}</h1><p>${s.tagline}</p>
          <div class="hero-actions"><a class="btn btn-amber" href="/products">কেনাকাটা শুরু করুন</a><a class="btn btn-ghost-light" href="/track">অর্ডার ট্র্যাক করুন</a></div>
          ${sections.includes('trust') ? trustItems(s, 'hero-trust') : ''}
        </div></div></section>`;
      }
      return html`<section class="slider ${s.slider_effect === 'fade' ? 'fx-fade' : 'fx-slide'}" data-slider data-interval="${Math.min(15, Math.max(1, Number(s.slider_interval) || 4))}" aria-roledescription="carousel">
        <div class="slides">${data.slides.slice(0, 5).map((b, i) => html`<a class="slide ${i === 0 ? 'on' : ''}" href="${security.safeUrl(b.link)}" ${b.link ? '' : raw('tabindex="-1"')}>
          <img src="/media/${b.image_id}" alt="${b.title || s.store_name}" ${i ? raw('loading="lazy"') : raw('fetchpriority="high"')} draggable="false">
          ${b.title || b.subtitle ? html`<span class="slide-text"><b>${b.title}</b>${b.subtitle ? html`<span>${b.subtitle}</span>` : ''}${b.button ? html`<em class="btn btn-amber btn-sm">${b.button}</em>` : ''}</span>` : ''}
        </a>`)}</div>
        ${data.slides.length > 1 ? html`<div class="dots">${data.slides.slice(0, 5).map((_, i) => html`<button type="button" data-dot="${i}" class="${i === 0 ? 'on' : ''}" aria-label="স্লাইড ${bn(i + 1)}"></button>`)}</div>` : ''}
      </section>`;
    }
    if (key === 'categories' && data.categories.length) return html`<div class="wrap">${section(U.text(s, 'uit_home_categories'), '', catGrid(data.categories))}</div>`;
    if (key === 'trust') return sections.includes('slider') && !data.slides.length ? '' : html`<div class="wrap">${trustItems(s, 'trust-strip')}</div>`;
    if (key === 'flash') {
      if (!data.flash || !data.flash.products.length) return '';
      return html`<div class="wrap flash-sec">${rail(`⚡ ${data.flash.sale.title}`, '/products?sort=offer', data.flash.products, s,
        { sub: html`অফার শেষ হবে <b class="countdown" data-countdown="${new Date(data.flash.sale.ends_at).toISOString()}"></b>` })}</div>`;
    }
    if (key === 'new') return html`<div class="wrap">${rail(U.text(s, 'uit_home_new'), '/products?sort=new', data.latest, s, { auto: true, badge: (p) => (isNewP(p, s) ? 'নতুন' : ''), sub: U.text(s, 'uit_home_new_sub') })}</div>`;
    if (key === 'offers') return html`<div class="wrap">${rail(U.text(s, 'uit_home_offers'), '/products?sort=offer', data.offers, s, { sub: U.text(s, 'uit_home_offers_sub') })}</div>`;
    if (key === 'bestsellers') return html`<div class="wrap">${rail(U.text(s, 'uit_home_bestsellers'), '/products?sort=popular', data.best, s, { badge: 'বেস্ট সেলার', sub: U.text(s, 'uit_home_bestsellers_sub') })}</div>`;
    if (key === 'popular') return html`<div class="wrap">${rail(U.text(s, 'uit_home_popular'), '/products', data.popular, s, { badge: 'জনপ্রিয়', sub: U.text(s, 'uit_home_popular_sub') })}</div>`;
    if (key === 'featured') return html`<div class="wrap">${rail(U.text(s, 'uit_home_featured'), '/products', data.featured, s, { sub: U.text(s, 'uit_home_featured_sub') })}</div>`;
    if (key === 'budget') return html`<div class="wrap">${rail(U.text(s, 'uit_home_budget'), '/products?sort=price_asc', data.budget, s, { sub: U.text(s, 'uit_home_budget_sub') })}</div>`;
    if (key === 'cat_rows') {
      return html`<div class="wrap">${(data.catRows || []).map((r) => rail(`${r.cat.icon} ${r.cat.name}`, `/products?cat=${r.cat.slug}`, r.products, s, { chips: r.chips }))}</div>`;
    }
    if (key === 'promo' && data.promos.length) {
      return html`<div class="wrap"><div class="promos">${data.promos.map((b) => html`<a href="${security.safeUrl(b.link)}" class="promo"><img src="/media/${b.image_id}" alt="${b.title || ''}" loading="lazy" draggable="false"></a>`)}</div></div>`;
    }
    // the owner's own rows (Admin → হোমপেজের সারি)
    if (/^x\d+$/.test(key)) {
      const c = data.custom && data.custom[key];
      if (!c || !c.products.length) return '';
      const sub = c.row.sub;
      if (c.row.style === 'grid') {
        return html`<div class="wrap"><section class="home-sec"><div class="section-head"><div><h2>${c.row.title}</h2>${sub ? html`<p class="sec-sub">${sub}</p>` : ''}</div><a href="${c.link}">সব দেখুন →</a></div>
          <div class="grid">${c.products.map((p) => productCard(p, s, c.row.badge))}</div></section></div>`;
      }
      return html`<div class="wrap">${rail(c.row.title, c.link, c.products, s, { badge: c.row.badge, sub })}</div>`;
    }
    if (key === 'blog' && data.posts.length) {
      return html`<div class="wrap">${section(U.text(s, 'uit_home_blog'), '/blog', html`<div class="post-grid">${data.posts.map(postCard)}</div>`)}</div>`;
    }
    return '';
  });
  return html`${parts}${U.on(s, 'ui_recent') ? html`<div class="wrap">${recentBox(s)}</div>` : ''}`;
}

// ---------------------------------------------------------------- listing
function listing({ products, categories, category, brand = null, q, sort, settings, total, page, perPage, filters = {}, brandList = [], fallback = [] }) {
  const title = brand ? brand.name : category ? category.name : q ? `"${q}" এর ফলাফল` : sort === 'offer' ? 'অফারের পণ্য' : 'সব পণ্য';
  const base = new URLSearchParams();
  if (category) base.set('cat', category.slug);
  if (q) base.set('q', q);
  if (sort) base.set('sort', sort);
  if (filters.pmin) base.set('pmin', filters.pmin);
  if (filters.pmax) base.set('pmax', filters.pmax);
  (filters.brands || []).forEach((b) => base.append('b', b));
  if (filters.stock) base.set('stock', '1');
  const nFilters = (filters.pmin || filters.pmax ? 1 : 0) + (filters.brands || []).length + (filters.stock ? 1 : 0);
  const pages = Math.ceil(total / perPage);
  const listPath = brand ? `/brand/${brand.slug}` : '/products';
  const pageLink = (n) => { const p = new URLSearchParams(base); if (n > 1) p.set('page', n); return listPath + (p.toString() ? '?' + p : ''); };
  const intro = brand || category;
  const { roots, byId } = categoryTree(categories);
  const here = category ? byId.get(category.id) : null;
  // chips: inside a category → its sub-categories (or, at the bottom level, its neighbours); otherwise the main categories
  const holder = here ? (here.children.some((k) => k.total_count > 0) ? here : (here.parent_id ? byId.get(here.parent_id) : null)) : null;
  const chips = (holder ? holder.children : roots).filter((k) => k.total_count > 0 || !holder);
  const allHref = holder ? `/products?cat=${holder.slug}` : (q ? `/products?q=${encodeURIComponent(q)}` : '/products');
  return html`<div class="wrap section">
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>${brand ? html` / <a href="/products">সব পণ্য</a> / <span>${brand.name}</span>` : here ? catCrumbs(here) : html` / <span>${title}</span>`}</nav>
  ${!brand && category && category.banner_id && page === 1 ? html`<div class="cat-banner"><img src="/media/${category.banner_id}" alt="${category.name}" fetchpriority="high" draggable="false"></div>` : ''}
  <div class="listing-head">
    <h1>${brand && brand.logo_id ? html`<img class="brand-logo" src="/media/${brand.logo_id}/t" alt="" draggable="false">` : ''}${title} <small>${bn(total)}টি পণ্য</small></h1>
    <form class="sort" method="get" action="${listPath}">
      ${category && !brand ? html`<input type="hidden" name="cat" value="${category.slug}">` : ''}
      ${q ? html`<input type="hidden" name="q" value="${q}">` : ''}
      <label for="sort">সাজান</label>
      <select id="sort" name="sort" data-autosubmit>
        ${[['', 'জনপ্রিয়'], ['new', 'নতুন আগে'], ['popular', 'বেশি বিক্রি'], ['offer', 'অফার'], ['price_asc', 'দাম: কম থেকে বেশি'], ['price_desc', 'দাম: বেশি থেকে কম']]
    .map(([v, l]) => html`<option value="${v}" ${sort === v ? raw('selected') : ''}>${l}</option>`)}
      </select>
      ${filters.pmin ? html`<input type="hidden" name="pmin" value="${filters.pmin}">` : ''}${filters.pmax ? html`<input type="hidden" name="pmax" value="${filters.pmax}">` : ''}
      ${(filters.brands || []).map((b) => html`<input type="hidden" name="b" value="${b}">`)}${filters.stock ? html`<input type="hidden" name="stock" value="1">` : ''}
    </form>
  </div>
  ${settings.ui_filters === '0' ? '' : filterBox({ listPath, category, brand, q, sort, filters, brandList, nFilters })}
  ${intro && intro.description && page === 1 ? html`<div class="listing-intro rich">${raw(md.render(intro.description))}</div>` : ''}
  ${brand ? '' : html`<div class="chips cat-chips" role="list">
    <a role="listitem" class="chip ${(!category || (holder && holder.id === category.id)) ? 'on' : ''}" href="${allHref}">${holder ? `সব ${holder.name}` : 'সব'}</a>
    ${chips.map((c) => html`<a role="listitem" class="chip ${category && category.id === c.id ? 'on' : ''}" href="/products?cat=${c.slug}">${c.depth === 0 ? html`${c.icon} ` : ''}${c.name}</a>`)}
  </div>`}
  ${productGrid(products, settings, nFilters ? 'এই ফিল্টারে কোনো পণ্য নেই — ফিল্টার কমিয়ে দেখুন।' : q ? `"${q}" নামে কোনো পণ্য পাওয়া যায়নি। অন্য নামে খুঁজে দেখুন, অথবা আমাদের WhatsApp/ফোনে জিজ্ঞেস করুন — আনিয়ে দেওয়ার চেষ্টা করব।` : 'এখানে এখনো পণ্য নেই।')}
  ${fallback.length ? html`<section class="no-results-more"><h2>🔥 বেশি বিক্রি হওয়া পণ্য</h2>${productGrid(fallback, settings, '')}</section>` : ''}
  ${pages > 1 ? html`<nav class="pager" aria-label="পেজ">${page > 1 ? html`<a href="${pageLink(page - 1)}">← আগের</a>` : ''}
    ${Array.from({ length: pages }, (_, i) => i + 1).filter((n) => Math.abs(n - page) < 3 || n === 1 || n === pages)
    .map((n) => (n === page ? html`<b>${bn(n)}</b>` : html`<a href="${pageLink(n)}">${bn(n)}</a>`))}
    ${page < pages ? html`<a href="${pageLink(page + 1)}">পরের →</a>` : ''}</nav>` : ''}
</div>`;
}

// "1-2" → "১-২ দিনে"
function delText(v, def) {
  const m = String(v || def).match(/^(\d{1,2})(?:-(\d{1,2}))?$/) || String(def).match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  return `${bn(m[1])}${m[2] && m[2] !== m[1] ? '-' + bn(m[2]) : ''} দিনে`;
}

// 🔎 Filter box on shop lists: price from–to, brands, only in stock. A plain form (works without JavaScript too).
function filterBox({ listPath, category, brand, q, sort, filters, brandList, nFilters }) {
  const clear = new URLSearchParams();
  if (category && !brand) clear.set('cat', category.slug);
  if (q) clear.set('q', q);
  if (sort) clear.set('sort', sort);
  const clearHref = listPath + (clear.toString() ? '?' + clear : '');
  const showBrands = brandList.length > 1 || (filters.brands || []).length;
  return html`<details class="filters" ${nFilters ? raw('open') : ''}>
    <summary class="btn btn-sm btn-ghost">⚙️ ফিল্টার${nFilters ? html` <b class="filter-n">${bn(nFilters)}</b>` : ''}</summary>
    <form class="filter-form" method="get" action="${listPath}">
      ${category && !brand ? html`<input type="hidden" name="cat" value="${category.slug}">` : ''}${q ? html`<input type="hidden" name="q" value="${q}">` : ''}${sort ? html`<input type="hidden" name="sort" value="${sort}">` : ''}
      <fieldset class="f-price"><legend>দাম (৳)</legend>
        <input name="pmin" inputmode="decimal" placeholder="সর্বনিম্ন" value="${filters.pmin || ''}" aria-label="সর্বনিম্ন দাম" maxlength="8">
        <span aria-hidden="true">–</span>
        <input name="pmax" inputmode="decimal" placeholder="সর্বোচ্চ" value="${filters.pmax || ''}" aria-label="সর্বোচ্চ দাম" maxlength="8">
      </fieldset>
      ${showBrands ? html`<fieldset class="f-brands"><legend>ব্র্যান্ড</legend><div class="f-brand-list">
        ${brandList.map((b) => html`<label class="check"><input type="checkbox" name="b" value="${b.id}" ${(filters.brands || []).includes(b.id) ? raw('checked') : ''}> <span translate="no">${b.name}</span> <small class="muted">(${bn(b.n)})</small></label>`)}
      </div></fieldset>` : ''}
      <label class="check f-stock"><input type="checkbox" name="stock" value="1" ${filters.stock ? raw('checked') : ''}> <span>শুধু স্টকে আছে এমন পণ্য</span></label>
      <div class="f-actions"><button class="btn btn-sm">ফিল্টার করুন</button>${nFilters ? html`<a class="btn btn-sm btn-ghost" href="${clearHref}">✕ সব মুছুন</a>` : ''}</div>
    </form>
  </details>`;
}

// ---------------------------------------------------------------- product page
// YouTube video that loads only when tapped (keeps the page fast), with a link in case the owner blocked embedding.
function videoBox(yt, title) {
  return html`<div class="video yt-lite" data-yt-lite="${yt}">
    <button type="button" class="yt-play" aria-label="ভিডিও চালান">
      <img src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="${title} — ভিডিও" loading="lazy" draggable="false">
      <span class="yt-big" aria-hidden="true">▶</span>
    </button>
  </div>
  <p class="small muted yt-alt">ভিডিও না চললে <a href="https://www.youtube.com/watch?v=${yt}" target="_blank" rel="noopener">সরাসরি YouTube-এ দেখুন ↗</a></p>`;
}

const WA_ICON = '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-1-2.2-1-.3-.1-.5-.2-.7.1l-1 1.3c-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.3c.2.2 2.3 3.5 5.5 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.6-.5Z"/></svg>';

function specTable(specs) {
  return html`<table class="spec-table"><tbody>${specs.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table>`;
}
function tierBox(p, tiers, maxQty = Infinity) {
  if (!tiers || !tiers.length) return '';
  // only steps a customer can actually order online (the per-product maximum still applies)
  const rows = tiers.slice().sort((a, b) => a.min_qty - b.min_qty).filter((t) => t.price < p.price && t.min_qty <= maxQty);
  if (!rows.length) return '';
  return html`<div class="tier-box"><p class="pdp-label">📦 বেশি কিনলে কম দাম</p><table class="tier-table"><tbody>
    <tr><td>${bn(1)}–${bn(rows[0].min_qty - 1)}টি</td><td><b>${money(p.price)}</b> করে</td></tr>
    ${rows.map((t, i) => html`<tr><td>${bn(t.min_qty)}${rows[i + 1] ? `–${bn(rows[i + 1].min_qty - 1)}` : '+'}টি</td><td><b>${money(t.price)}</b> করে <span class="good small">(${bn(Math.round((1 - t.price / p.price) * 100))}% কম)</span></td></tr>`)}
  </tbody></table><p class="small muted">কার্টে পরিমাণ বাড়ালে কম দাম নিজে থেকেই বসে যাবে।</p></div>`;
}
function reviewsBlock(p, s, reviews, stats) {
  if (s.reviews_on === '0' || !stats.count) return '';
  const dist = [5, 4, 3, 2, 1].map((n) => [n, (stats.dist || {})[n] || 0]);
  return html`<section class="reviews" id="reviews">
  <div class="section-head"><h2>⭐ কাস্টমারদের রিভিউ ${stats.count ? html`<small>${bn(stats.count)}টি</small>` : ''}</h2></div>
  <div class="reviews-grid">
    <div class="review-summary panel">
      ${stats.count ? html`<p class="big-rating">${bn(Number(stats.avg).toFixed(1))}<small>/৫</small></p>${stars(stats.avg)}
        <ul class="rating-bars">${dist.map(([n, c]) => html`<li><span>${bn(n)}★</span><span class="bar"><i style="width:${stats.count ? Math.round((c / stats.count) * 100) : 0}%"></i></span><span>${bn(c)}</span></li>`)}</ul>`
    : html`<p class="muted">এখনো কোনো রিভিউ নেই।</p>`}
    </div>
    <div class="review-list">${reviews.length ? html`<ul>${reviews.map((r) => html`<li class="review">
      <p>${stars(r.rating)} <b>${r.name || 'কাস্টমার'}</b>${r.verified ? html` <span class="verified">✓ যাচাই করা ক্রেতা</span>` : ''} <span class="small muted">${fmtDate(r.created_at).split(',')[0]}</span></p>
      <p class="review-body">${r.body}</p>
      ${r.photos && r.photos.length ? html`<div class="review-photos">${r.photos.map((pid) => html`<a href="/media/${pid}" target="_blank" rel="noopener"><img src="/media/${pid}/t" alt="ক্রেতার তোলা ছবি" loading="lazy" draggable="false"></a>`)}</div>` : ''}
      ${r.reply ? html`<p class="review-reply"><b>${s.store_name}:</b> ${r.reply}</p>` : ''}
    </li>`)}</ul>` : ''}</div>
  </div>
</section>`;
}
// 🔔 "স্টকে এলে জানাও": the customer leaves a mobile number; an SMS goes out when the product is back.
function notifyBox(productId, s, hidden = false) {
  if (!U.on(s, 'ui_restock_notify')) return '';
  return html`<form class="notify-box" data-notify data-product="${productId}" ${hidden ? raw('hidden') : ''} novalidate>
    <p><b>🔔 ${U.text(s, 'uit_restock_title')}</b><br><span class="small muted">মোবাইল নম্বর দিন — পণ্যটা আবার এলেই আপনাকে SMS করে জানাব।</span></p>
    <div class="coupon-row"><input name="phone" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength="20" required aria-label="মোবাইল নম্বর"><button class="btn btn-sm">জানাবেন</button></div>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="small" data-notify-msg role="status"></p>
  </form>`;
}
// The size / colour / model picker. Each variant carries what the page needs to switch to it without reloading.
function variantPicker(p, V, sel, big) {
  return html`<div class="var-pick" data-variants>
    <p class="var-head">${p.variant_title || 'অপশন'}: <b data-var-name>${sel.variant_label}</b></p>
    <div class="var-list" role="radiogroup" aria-label="${p.variant_title || 'অপশন'} বাছাই করুন">
      ${V.map((v) => html`<button type="button" role="radio" aria-checked="${v.id === sel.id ? 'true' : 'false'}" class="var-opt ${v.id === sel.id ? 'on' : ''} ${v.stock <= 0 ? 'is-out' : ''}"
        data-var="${v.id}" data-label="${v.variant_label}" data-name="${v.name}" data-price="${v.price}" data-old="${v.old_price || ''}" data-stock="${v.stock}" data-low="${v.low_stock}"
        data-sku="${v.sku || ''}" data-img="${v.image_id ? big(v.image_id) : ''}" data-flash="${v.flash_ends ? new Date(v.flash_ends).toISOString() : ''}">
        ${v.image_id ? html`<img src="/media/${v.image_id}/t" alt="" loading="lazy" draggable="false">` : ''}<span>${v.variant_label}</span>${v.stock <= 0 ? html`<small>স্টকে নেই</small>` : ''}</button>`)}
    </div>
  </div>`;
}
// Questions & answers on a product: what others asked and the shop's answers, plus a small form to ask.
function questionsBlock(p, s, questions) {
  if (!U.on(s, 'ui_qa')) return '';
  return html`<section class="qa" id="qa">
  <div class="section-head"><h2>❓ ${U.text(s, 'uit_qa_title')} ${questions.length ? html`<small>${bn(questions.length)}টি</small>` : ''}</h2></div>
  <div class="qa-grid">
    <div>${questions.length ? html`<ul class="qa-list">${questions.map((x) => html`<li>
      <p class="qa-q"><b>প্রশ্ন:</b> ${x.question} <span class="small muted">— ${x.name || 'একজন কাস্টমার'}, ${fmtDate(x.created_at).split(',')[0]}</span></p>
      <p class="qa-a"><b>${s.store_name}:</b> ${x.answer}</p></li>`)}</ul>` : html`<p class="muted">এখনো কেউ প্রশ্ন করেননি। এই পণ্য নিয়ে কিছু জানার থাকলে প্রথম প্রশ্নটা আপনিই করুন।</p>`}</div>
    <form class="form panel qa-form" data-qa-form data-product="${p.id}" novalidate>
      <h3>প্রশ্ন করুন</h3>
      <label class="field"><span>আপনার প্রশ্ন</span><textarea name="question" rows="3" maxlength="500" required minlength="5" placeholder="যেমন: এটা কি ১২ ভোল্টে চলবে?"></textarea></label>
      <div class="field-row">
        <label class="field"><span>আপনার নাম</span><input name="name" maxlength="60" autocomplete="name"></label>
        <label class="field"><span>মোবাইল (ঐচ্ছিক — উত্তর দিলে SMS পাবেন)</span><input name="phone" inputmode="tel" maxlength="20" autocomplete="tel"></label>
      </div>
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-block">প্রশ্ন পাঠান</button>
      <p class="small" data-qa-msg role="status"></p>
      <p class="small muted">উত্তর দেওয়ার পর প্রশ্ন-উত্তর এখানে সবাই দেখতে পাবে।</p>
    </form>
  </div>
</section>`;
}
function productPage({ product: p, related, settings: s, inlineProducts = {}, categories = [], tiers = [], offers = [], reviews = [], reviewStats = { count: 0 }, cross = [], upsell = [], questions = [], selectedVariant = 0 }) {
  const specs = U.on(s, 'ui_pdp_specs') ? (Array.isArray(p.specs) ? p.specs : []).filter((r) => Array.isArray(r) && r[0] && r[1]) : [];
  const catNode = p.category_id ? categoryTree(categories).byId.get(p.category_id) : null;
  // a product with variants shows the chosen one's price, stock and SKU (first in-stock one unless ?v= says otherwise)
  const V = Array.isArray(p.variants) ? p.variants : [];
  const sel = V.length ? (V.find((v) => v.id === selectedVariant && v.stock > 0) || V.find((v) => v.stock > 0) || V.find((v) => v.id === selectedVariant) || V[0]) : null;
  const cur = sel || p;
  const off = discount(cur);
  const out = cur.stock <= 0;
  const yt = U.on(s, 'ui_pdp_video') ? youtubeId(p.youtube_url) : null;
  const images = p.images && p.images.length ? p.images : [];
  // big picture: the watermarked copy when the watermark is on (thumbnails and cards stay as they are)
  const big = (id) => (s.wm_on === '1' && s.wm_ver ? `/media/${id}/w?v=${s.wm_ver}` : `/media/${id}`);
  const slots = Math.max(images.length, 1);
  const C = contact(s);
  const waText = `আসসালামু আলাইকুম। এই পণ্যটি সম্পর্কে জানতে চাই:\n${p.name}${p.sku ? ` (SKU: ${p.sku})` : ''}\nদাম: ৳${p.price}`;
  const waBtn = C.waButton ? html`<a class="btn btn-wa btn-lg" href="https://wa.me/${C.waButton}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener"
      data-wa-text="${waText}" data-wa="${C.waButton}" aria-label="WhatsApp এ কথা বলুন">${raw(WA_ICON)} WhatsApp</a>` : '';
  const R = qtyRule(s, cur.price);
  // ⏳ pre-order: the owner switched it on for this product — out of stock, it can still be ordered (sent when it arrives)
  const preorderOk = !!p.preorder && p.product_type !== 'bundle';
  const short = !out && !preorderOk && cur.stock < R.min; // not enough stock for the minimum
  const maxQ = preorderOk ? R.max : Math.max(R.min, Math.min(cur.stock, R.max));
  const preDays = Number(p.preorder_days) || 0;
  const longHtml = md.render(p.description || '', { productCard: true }).replace(/<!--product:([^>]+)-->/g, (_, slug) => (inlineProducts[slug] ? productCard(inlineProducts[slug], s).s : ''));
  return html`<div class="wrap section" data-pdp="${p.id}" ${U.on(s, 'ui_recent') ? raw('data-recent-id="' + p.id + '"') : ''}>
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>${catNode ? catCrumbs(catNode, false) : p.category_slug ? html` / <a href="/products?cat=${p.category_slug}">${p.category_name}</a>` : ''}
    / <span>${p.name}</span></nav>
  <div class="pdp">
    <div class="gallery" data-gallery>
      <div class="g-main">
        ${images.length ? html`<img src="${big(images[0])}" alt="${p.name}" data-g-main draggable="false" fetchpriority="high">
        <button type="button" class="g-zoom" data-g-zoom aria-label="ছবি বড় করে দেখুন">⤢ বড় করে দেখুন</button>` : html`<span class="emoji">${p.emoji || '📦'}</span>`}
        ${yt ? html`<div class="g-video" data-g-video hidden><iframe data-src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0" title="পণ্যের ভিডিও" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : ''}
        ${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}
      </div>
      <div class="g-thumbs" role="list">
        ${images.map((id, i) => html`<button type="button" class="g-thumb ${i === 0 ? 'on' : ''}" data-g-img="${big(id)}" aria-label="ছবি ${bn(i + 1)}"><img src="/media/${id}/t" alt="" loading="lazy" draggable="false"></button>`)}
        ${yt ? html`<button type="button" class="g-thumb g-thumb-video" data-g-yt aria-label="ভিডিও দেখুন"><img src="https://i.ytimg.com/vi/${yt}/mqdefault.jpg" alt="" loading="lazy" draggable="false"><span class="play">▶</span></button>` : ''}
        ${Array.from({ length: Math.max(0, 5 - slots - (yt ? 1 : 0)) }, () => html`<span class="g-thumb g-empty" aria-hidden="true"></span>`)}
      </div>
      ${yt ? html`<button type="button" class="g-video-btn" data-g-yt-btn><span class="yt-ic" aria-hidden="true">▶</span> পণ্যের ভিডিও দেখুন</button>` : ''}
    </div>
    <div class="pdp-info">
      <h1>${p.name}</h1>
      ${reviewStats.count && s.reviews_on !== '0' ? html`<a class="pdp-rating" href="#reviews">${stars(reviewStats.avg)} ${bn(Number(reviewStats.avg).toFixed(1))} · ${bn(reviewStats.count)}টি রিভিউ</a>` : ''}
      ${U.on(s, 'ui_pdp_meta') ? html`<p class="pdp-meta">${cur.sku ? html`SKU: <b data-p-sku>${cur.sku}</b>` : ''}${p.model ? html` · মডেল: <b translate="no">${p.model}</b>` : ''}${p.brand ? html` · ব্র্যান্ড: ${p.brand_slug ? html`<a href="/brand/${p.brand_slug}"><b>${p.brand}</b></a>` : html`<b>${p.brand}</b>`}` : ''}${p.category_name ? html` · <a href="/products?cat=${p.category_slug}">${p.category_name}</a>` : ''}${isNewP(p, s) && U.on(s, 'ui_card_new') ? html` <span class="pill-new">নতুন</span>` : ''}</p>` : ''}
      ${require('../models/catalog').warrantyText(p) ? html`<p class="pdp-warranty">🛡️ ${require('../models/catalog').warrantyText(p)}</p>` : ''}
      <div class="price-row big">
        <span class="price" data-p-price>${money(cur.price)}</span>
        <s class="old-price" data-p-old ${off ? '' : raw('hidden')}>${off ? money(cur.old_price) : ''}</s><span class="save" data-p-save ${off ? '' : raw('hidden')}>${off ? `${money(cur.old_price - cur.price)} সাশ্রয়` : ''}</span>
      </div>
      ${U.on(s, 'ui_pdp_flash') ? html`<div class="flash-box" data-p-flash ${cur.flash_ends ? '' : raw('hidden')}>⚡ <b>ফ্ল্যাশ সেল</b> — এই দাম শেষ হবে <b class="countdown" data-countdown="${cur.flash_ends ? new Date(cur.flash_ends).toISOString() : ''}"></b></div>` : ''}
      ${sel ? variantPicker(p, V, sel, big) : ''}
      ${offers.length && U.on(s, 'ui_pdp_offers') ? html`<ul class="offer-box">${offers.map((o) => html`<li>🎁 <b>${o.label}</b>${o.ends_on ? html` <span class="small muted">(${o.ends_on} পর্যন্ত)</span>` : ''}</li>`)}</ul>` : ''}
      ${U.on(s, 'ui_pdp_tiers') ? tierBox(p, tiers, qtyRule(s, p.price).max) : ''}
      ${R.cheap && minOrder(s) > p.price ? html`<div class="small-rule">🔩 <b>কম দামের পণ্য:</b> প্রতি পিস ${money(p.price)}। ১টা করেও নেওয়া যায় — শুধু পুরো অর্ডারে মোট কমপক্ষে ${money(minOrder(s))} এর পণ্য হতে হবে (যেমন এটা ${bn(Math.ceil(minOrder(s) / p.price - 1e-9))}টি, অথবা অন্য পণ্যের সাথে মিলিয়ে)।</div>` : ''}
      ${out || U.on(s, 'ui_pdp_stock') || sel ? html`<p class="stock ${out ? 'out' : cur.stock <= cur.low_stock ? 'low' : 'ok'}" data-p-stock data-show="${U.on(s, 'ui_pdp_stock') ? '1' : ''}" ${out || U.on(s, 'ui_pdp_stock') ? '' : raw('hidden')}>${out ? (preorderOk ? 'স্টকে নেই — প্রি-অর্ডার চলছে' : 'স্টকে নেই') : cur.stock <= cur.low_stock ? `মাত্র ${bn(cur.stock)}টি বাকি আছে` : '✓ স্টকে আছে'}</p>` : ''}
      ${preorderOk ? html`<div class="preorder-note" data-pre-note ${out ? '' : raw('hidden')}>⏳ <b>প্রি-অর্ডার:</b> এখন স্টকে নেই, কিন্তু অর্ডার নেওয়া হচ্ছে। পণ্য আসতে আনুমানিক <b>${preDays ? `${bn(preDays)} দিন` : 'কিছু দিন'}</b> লাগবে — এলেই সবার আগে আপনাকে পাঠানো হবে।${s.preorder_note ? html` ${s.preorder_note}` : ''}</div>` : ''}
      ${p.short_description && U.on(s, 'ui_pdp_short') ? html`<div class="pdp-short"><p class="pdp-label">📝 সংক্ষেপে</p>${raw(md.render(p.short_description))}
        ${p.description ? html`<a class="pdp-more" href="#details">বিস্তারিত বিবরণ পড়ুন ↓</a>` : ''}</div>` : ''}
      ${p.bundle && p.bundle.length ? html`<div class="bundle-box"><b>এই প্যাকেজে যা যা আছে:</b><ul>${p.bundle.map((b) => html`<li>${b.name} × ${bn(b.qty)}</li>`)}</ul>
        ${(() => { const sum = p.bundle.reduce((t, b) => t + b.price * b.qty, 0); return sum > p.price ? html`<p class="save">আলাদা কিনলে ${money(sum)} — প্যাকেজে ${money(sum - p.price)} কম!</p>` : ''; })()}</div>` : ''}
      ${(out && !preorderOk) || short ? html`${short ? html`<p class="qty-limit">এই পণ্যটি কমপক্ষে ${bn(R.min)}টি নিতে হয়, কিন্তু স্টকে আছে ${bn(cur.stock)}টি। নিতে চাইলে সরাসরি যোগাযোগ করুন।</p>` : ''}<div class="buy-box">${C.phone ? html`<a class="btn btn-ghost btn-lg" href="tel:${C.phone}">📞 স্টক জানতে কল করুন</a>` : ''}${waBtn}</div>${out ? notifyBox(cur.id, s) : ''}${compareBtn(p, s)}` : html`<div class="buy-box" data-buy-box ${preorderOk ? raw('data-preorder="1"') : ''}>
        <div class="qty" data-qty ${U.on(s, 'ui_pdp_qty') ? '' : raw('hidden')}>
          <button type="button" data-step="-1" aria-label="কমান">−</button>
          <input type="number" min="${R.min}" max="${maxQ}" value="${R.min}" aria-label="পরিমাণ" data-stock="${cur.stock}">
          <button type="button" data-step="1" aria-label="বাড়ান">+</button>
        </div>
        <button class="btn btn-add btn-lg" data-add="${cur.id}" data-name="${cur.name}" data-price="${cur.price}" data-with-qty data-label="কার্টে যোগ করুন">${out && preorderOk ? '⏳ প্রি-অর্ডার (কার্টে যোগ)' : 'কার্টে যোগ করুন'}</button>
        ${U.on(s, 'ui_pdp_buy_now') ? html`<button class="btn btn-amber btn-lg" data-add="${cur.id}" data-name="${cur.name}" data-price="${cur.price}" data-with-qty data-buy-now data-label="${U.text(s, 'uit_buy_now')}">${out && preorderOk ? '⏳ এখনই প্রি-অর্ডার করুন' : U.text(s, 'uit_buy_now')}</button>` : ''}
        ${waBtn}${wishBtn(p, s, 'pdp-wish')}
      </div>
      ${sel ? html`<p class="var-out" data-var-out hidden>এই অপশনটা এখন স্টকে নেই — অন্য একটা বাছাই করুন, অথবা নিচে নম্বর দিন, এলেই জানাব।</p>${notifyBox(cur.id, s, true)}` : ''}
      <p class="qty-limit" data-qty-limit hidden></p>${compareBtn(p, s)}`}
      ${U.on(s, 'ui_pdp_facts') ? html`<ul class="pdp-facts">
        <li>🚚 ঢাকা সিটিতে <b>${delText(s.del_days_dhaka, '1-2')}</b>, চার্জ ${money(s.delivery_dhaka)} · ঢাকার বাইরে <b>${delText(s.del_days_outside, '2-4')}</b>, চার্জ ${money(s.delivery_outside)}</li>
        ${out && !preorderOk ? '' : html`<li class="del-eta" data-del-eta data-dhaka="${s.del_days_dhaka || '1-2'}" data-outside="${s.del_days_outside || '2-4'}" data-cutoff="${s.del_cutoff_hour || '17'}" data-extra="${out && preorderOk ? Number(p.preorder_days) || 0 : 0}" hidden></li>`}
        <li>💵 পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)</li>
        ${C.phone ? html`<li>📞 প্রশ্ন থাকলে কল করুন: <a href="tel:${C.phone}">${C.phone}</a></li>` : ''}
        <li>🛒 এই পণ্যটি একসাথে সর্বোচ্চ ${bn(R.max)}টি অর্ডার করা যাবে${C.phone || C.wa ? '। বেশি দরকার হলে সরাসরি যোগাযোগ করুন' : ''}</li>
        ${U.text(s, 'uit_pdp_fact_extra') ? html`<li>${U.text(s, 'uit_pdp_fact_extra')}</li>` : ''}
      </ul>` : ''}
    </div>
  </div>
  <div class="tabs-box" data-tabs id="details">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab on" data-tab="desc">📋 পণ্যের বিস্তারিত বিবরণ</button>
      ${specs.length ? html`<button type="button" role="tab" class="tab" data-tab="specs">⚙️ স্পেসিফিকেশন</button>` : ''}
      ${yt ? html`<button type="button" role="tab" class="tab" data-tab="video">▶ ভিডিও</button>` : ''}
      ${s.reviews_on !== '0' && reviewStats.count ? html`<a role="tab" class="tab" href="#reviews">⭐ রিভিউ (${bn(reviewStats.count)})</a>` : ''}
      ${U.on(s, 'ui_pdp_ship_tab') ? html`<button type="button" role="tab" class="tab" data-tab="ship">🚚 ডেলিভারি ও রিটার্ন</button>` : ''}
    </div>
    <div class="tab-panel rich" data-panel="desc">${p.description ? raw(longHtml) : specs.length ? specTable(specs) : html`<p class="muted">এই পণ্যের বিস্তারিত বিবরণ শীঘ্রই যোগ হবে।</p>`}</div>
    ${specs.length ? html`<div class="tab-panel" data-panel="specs" hidden>${specTable(specs)}</div>` : ''}
    ${yt ? html`<div class="tab-panel" data-panel="video" hidden>${videoBox(yt, p.name)}</div>` : ''}
    <div class="tab-panel rich" data-panel="ship" hidden>
      <ul><li>ঢাকা সিটির ভেতরে: ${money(s.delivery_dhaka)}, সাধারণত ${delText(s.del_days_dhaka, '1-2')}।</li><li>ঢাকার বাইরে: ${money(s.delivery_outside)}, সাধারণত ${delText(s.del_days_outside, '2-4')}।</li>
      ${Number(s.free_delivery_min) > 0 ? html`<li>${money(s.free_delivery_min)} বা বেশি কিনলে ডেলিভারি ফ্রি।</li>` : ''}
      <li>পণ্য হাতে পেয়ে দেখে টাকা দিন। কোনো সমস্যা থাকলে ডেলিভারিম্যানের সামনেই জানান।</li>
      ${U.text(s, 'uit_ship_extra') ? html`<li>${U.text(s, 'uit_ship_extra')}</li>` : ''}</ul>
      <p><a href="/page/return-policy">রিটার্ন নীতি বিস্তারিত →</a></p>
    </div>
  </div>
  ${yt ? html`<section class="pdp-video" id="video"><h2>▶ পণ্যের ভিডিও</h2>${videoBox(yt, p.name)}</section>` : ''}
  ${cross.length && U.on(s, 'ui_pdp_cross') ? html`<div class="section-head"><h2>${U.text(s, 'uit_cross')}</h2></div>${productGrid(cross, s)}` : ''}
  ${upsell.length && U.on(s, 'ui_pdp_upsell') ? html`<div class="section-head"><h2>${U.text(s, 'uit_upsell')}</h2></div>${productGrid(upsell, s)}` : ''}
  ${reviewsBlock(p, s, reviews, reviewStats)}
  ${questionsBlock(p, s, questions)}
  ${related.length && U.on(s, 'ui_pdp_related') ? html`<div class="section-head"><h2>${U.text(s, 'uit_related')}</h2></div>${productGrid(related, s)}` : ''}
  ${U.on(s, 'ui_recent') ? recentBox(s) : ''}
</div>
${images.length ? html`<div class="lightbox" data-lightbox hidden role="dialog" aria-label="ছবি">
  <button type="button" class="lb-x" data-lb-close aria-label="বন্ধ করুন">✕</button>
  ${images.length > 1 ? html`<button type="button" class="lb-nav prev" data-lb-step="-1" aria-label="আগের ছবি">‹</button><button type="button" class="lb-nav next" data-lb-step="1" aria-label="পরের ছবি">›</button>` : ''}
  <img alt="${p.name}" data-lb-img draggable="false">
  <span class="lb-count" data-lb-count></span>
  <span class="lb-hint" data-lb-hint aria-hidden="true"></span>
</div>` : ''}
${out || short || !U.on(s, 'ui_pdp_sticky') ? '' : html`<div class="sticky-buy" data-sticky-buy><div><b data-p-price>${money(cur.price)}</b><span>${p.name}</span></div>
  ${C.waButton ? html`<a class="btn btn-wa btn-wa-ic" href="https://wa.me/${C.waButton}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener" data-wa-text="${waText}" data-wa="${C.waButton}" aria-label="WhatsApp এ কথা বলুন">${raw(WA_ICON)}</a>` : ''}
  <button class="btn btn-amber" data-add="${cur.id}" data-name="${cur.name}" data-price="${cur.price}" data-with-qty data-buy-now>${U.text(s, 'uit_buy_now')}</button></div>`}`;
}
// ⚖️ put this product in the comparison list (kept in the shopper's own browser, up to 4 products)
function compareBtn(p, s) {
  return U.on(s, 'ui_compare') ? html`<p class="pdp-tools"><button type="button" class="link-btn compare-btn" data-compare="${p.id}" aria-pressed="false" title="অন্য পণ্যের সাথে পাশাপাশি তুলনা করুন">⚖️ তুলনা</button></p>` : '';
}
// 🕘 the products this shopper looked at lately (filled in by the browser from its own list)
function recentBox(s) {
  return html`<section class="recent-box" data-recent-box hidden><div class="section-head"><h2>${U.text(s, 'uit_recent')}</h2><button type="button" class="link-btn small" data-recent-clear>মুছে দিন</button></div><div class="grid" data-recent-list></div></section>`;
}

// ---------------------------------------------------------------- cart & checkout
function cartPage({ settings }) {
  return html`<div class="wrap section narrow">
  <h1>আপনার কার্ট</h1>
  <div id="cart-root" data-cart-page data-free-min="${U.on(settings, 'ui_cart_free_msg') ? settings.free_delivery_min : 0}"><p class="muted">লোড হচ্ছে…</p></div>
  ${U.on(settings, 'ui_cart_suggest') ? cartSuggest(settings) : ''}
</div>`;
}

function wishlistPage({ products, settings, asked }) {
  return html`<div class="wrap section" data-wish-page ${asked ? '' : raw('data-wish-load')}>
  <h1>♡ পছন্দের তালিকা ${products.length ? html`<small>${bn(products.length)}টি</small>` : ''}</h1>
  <p class="muted small">এই তালিকা শুধু এই ফোন/কম্পিউটারের ব্রাউজারে রাখা থাকে। পণ্যের ♡ চিহ্নে চাপ দিয়ে যোগ করুন বা সরান।</p>
  ${asked ? productGrid(products, settings, 'পছন্দের তালিকা খালি। পছন্দের পণ্যের ছবির কোণে ♡ চাপ দিন।') : html`<p class="muted">লোড হচ্ছে…</p>`}
</div>`;
}
// ⚖️ products side by side: price, stock, rating, warranty, brand and every specification any of them has
function comparePage({ products: P, settings: s, asked }) {
  if (!asked) return html`<div class="wrap section" data-compare-page data-compare-load><h1>⚖️ পণ্য তুলনা</h1><p class="muted">লোড হচ্ছে…</p></div>`;
  if (P.length < 1) return html`<div class="wrap section" data-compare-page><h1>⚖️ পণ্য তুলনা</h1><div class="empty"><p>তুলনার তালিকা খালি। পণ্যের পেজে "⚖️ তুলনা" বাটনে চাপ দিয়ে ২ থেকে ৪টা পণ্য যোগ করুন।</p><a class="btn" href="/products">পণ্য দেখুন</a></div></div>`;
  const keys = [];
  P.forEach((p) => (Array.isArray(p.specs) ? p.specs : []).forEach((r) => { if (Array.isArray(r) && r[0] && !keys.includes(r[0])) keys.push(r[0]); }));
  const spec = (p, k) => { const r = (Array.isArray(p.specs) ? p.specs : []).find((x) => Array.isArray(x) && x[0] === k); return r ? r[1] : '—'; };
  const W = require('../models/catalog').warrantyText;
  const row = (label, cells) => html`<tr><th scope="row">${label}</th>${cells}</tr>`;
  return html`<div class="wrap section" data-compare-page>
  <div class="title-row"><h1>⚖️ পণ্য তুলনা <small>${bn(P.length)}টি</small></h1><button type="button" class="btn btn-sm btn-ghost" data-compare-clear>সব সরান</button></div>
  ${P.length < 2 ? html`<p class="note">আরেকটা পণ্য যোগ করুন — পণ্যের পেজে "⚖️ তুলনা" বাটনে চাপ দিন।</p>` : ''}
  <div class="table-wrap compare-wrap"><table class="compare-table">
    <thead><tr><th></th>${P.map((p) => html`<th scope="col"><a href="/p/${p.slug}" class="cmp-pic">${img(p)}</a><a href="/p/${p.slug}" class="cmp-name">${p.name}</a>
      <button type="button" class="link-btn small danger" data-compare-remove="${p.id}">✕ সরান</button></th>`)}</tr></thead>
    <tbody>
      ${row('দাম', P.map((p) => html`<td><b class="price">${money(p.price)}</b>${p.variant_count > 0 ? ' থেকে' : ''}${p.old_price > p.price ? html` <s class="old-price">${money(p.old_price)}</s>` : ''}</td>`))}
      ${row('স্টক', P.map((p) => html`<td>${p.stock > 0 ? html`<span class="good">✓ আছে</span>` : html`<span class="warn">স্টকে নেই</span>`}</td>`))}
      ${s.reviews_on !== '0' ? row('রেটিং', P.map((p) => html`<td>${p.review_stats && p.review_stats.count ? html`${stars(p.review_stats.avg)} <span class="small">(${bn(p.review_stats.count)})</span>` : '—'}</td>`)) : ''}
      ${row('ব্র্যান্ড', P.map((p) => html`<td>${p.brand || '—'}</td>`))}
      ${row('মডেল', P.map((p) => html`<td>${p.model || '—'}</td>`))}
      ${row('ক্যাটাগরি', P.map((p) => html`<td>${p.category_name || '—'}</td>`))}
      ${row('ওয়ারেন্টি', P.map((p) => html`<td>${W(p) || '—'}</td>`))}
      ${P.some((p) => p.variant_count > 0) ? row('অপশন', P.map((p) => html`<td class="small">${(p.variants || []).map((v) => v.variant_label).join(', ') || '—'}</td>`)) : ''}
      ${keys.map((k) => row(k, P.map((p) => html`<td>${spec(p, k)}</td>`)))}
      ${row('সংক্ষেপে', P.map((p) => html`<td class="small">${md.plain(p.short_description || p.description || '', 220) || '—'}</td>`))}
      ${row('', P.map((p) => html`<td>${p.stock > 0 ? (p.variant_count > 0 ? html`<a class="btn btn-sm btn-block" href="/p/${p.slug}">অপশন বাছুন</a>` : html`<button class="btn btn-sm btn-block btn-add" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}">কার্টে যোগ করুন</button>`) : ''}</td>`))}
    </tbody></table></div>
</div>`;
}
function cartSuggest(s) {
  return html`<section class="panel cart-suggest" data-cart-suggest hidden><h2>${U.text(s, 'uit_cart_suggest')}</h2><ul class="suggest-list" data-suggest-list></ul></section>`;
}
function checkoutPage({ settings: s, methods, cityAreas, zones = [], account = null, refCode = '', otp = false }) {
  const addrs = account ? account.addresses || [] : [];
  const def = addrs.find((a) => a.is_default) || addrs[0] || null;
  const pre = account ? { name: (def && def.name) || account.name || '', phone: (def && def.phone) || account.phone || '', district: def ? def.district : '', thana: def ? def.thana : '', address: def ? def.address : '' } : null;
  return html`<div class="wrap section">
  <h1>অর্ডার করুন</h1>
  ${s.acct_on === '1' && !account ? html`<p class="acct-hint small">👤 আগে অর্ডার করেছেন? <a href="/account?next=/checkout">মোবাইল নম্বর দিয়ে লগইন করুন</a> — ঠিকানা নিজে থেকে বসে যাবে। (লগইন ছাড়াও অর্ডার করা যায়)</p>` : ''}
  <div class="checkout" data-checkout data-dhaka="${s.delivery_dhaka}" data-outside="${s.delivery_outside}" data-free-min="${s.free_delivery_min}"
       data-city="${JSON.stringify(cityAreas)}" data-zones="${JSON.stringify(zones)}" data-per-kg="${Number(s.delivery_per_kg) || 0}" data-free-kg="${Number(s.delivery_free_kg) || 1}">
    <form class="form panel" id="checkout-form" novalidate ${s.draft_capture_on !== '0' ? raw('data-draft') : ''} ${pre ? raw('data-account') : ''}>
      <h2>ডেলিভারির তথ্য</h2>
      ${addrs.length ? html`<div class="field"><label for="saved-addr">📍 সেভ করা ঠিকানা</label><select id="saved-addr" data-saved-addr>
        ${addrs.map((a) => html`<option value="${a.id}" data-a="${JSON.stringify({ name: a.name || account.name || '', phone: a.phone || account.phone || '', district: a.district, thana: a.thana, address: a.address })}" ${def && a.id === def.id ? raw('selected') : ''}>${a.label || 'ঠিকানা'} — ${String(a.address).slice(0, 40)}</option>`)}
        <option value="">+ নতুন ঠিকানা লিখব</option></select></div>` : ''}
      <div class="field"><label for="name">আপনার নাম</label><input id="name" name="name" required autocomplete="name" maxlength="80" value="${pre ? pre.name : ''}"></div>
      <div class="field"><label for="phone">মোবাইল নম্বর</label>
        <input id="phone" name="phone" required inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength="20" value="${pre ? pre.phone : ''}">
        <small>${otp ? 'এই নম্বরে SMS-এ একটা কোড যাবে — কোডটা নিচের ঘরে বসালেই অর্ডার করা যাবে।' : 'এই নম্বরে কল করে অর্ডার কনফার্ম করা হবে।'}${s.draft_capture_on !== '0' ? ' অর্ডার শেষ করতে কোনো সমস্যা হলে সাহায্যের জন্য আমরা এই নম্বরে যোগাযোগ করতে পারি।' : ''}</small>
        ${otp ? html`<div class="otp-box" data-otp hidden>
          <label for="otp-code" class="otp-label">📩 মোবাইলে আসা কোড</label>
          <div class="otp-row">
            <input id="otp-code" data-otp-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••" aria-label="SMS-এ আসা কোড">
            <button type="button" class="btn btn-sm otp-send" data-otp-send>OTP পাঠান</button>
          </div>
          <p class="otp-msg small" data-otp-msg role="status" aria-live="polite"></p>
          ${contact(s).phone ? html`<p class="otp-help small muted" data-otp-help hidden>SMS আসছে না? <a href="tel:${contact(s).phone}">${contact(s).phone}</a> নম্বরে কল করেও অর্ডার দিতে পারেন।</p>` : ''}
        </div>
        <p class="otp-done small" data-otp-done hidden>✅ নম্বর যাচাই হয়েছে</p>` : ''}</div>
      <div class="field-row">
        <div class="field"><label for="district">জেলা</label><select id="district" name="district" required data-district data-value="${pre && pre.district ? pre.district : 'Dhaka'}"><option value="">লোড হচ্ছে…</option></select></div>
        <div class="field"><label for="thana">থানা / উপজেলা</label><select id="thana" name="thana" required data-thana data-value="${pre ? pre.thana : ''}"><option value="">আগে জেলা বাছুন</option></select></div>
      </div>
      <p class="zone-note" data-zone-note></p>
      <div class="field"><label for="address">পূর্ণ ঠিকানা</label>
        <textarea id="address" name="address" rows="2" required maxlength="400" placeholder="বাসা নং, রোড, এলাকা">${pre ? pre.address : ''}</textarea></div>
      ${U.on(s, 'ui_co_note') ? html`<div class="field"><label for="note">${U.text(s, 'uit_co_note')}</label><input id="note" name="note" maxlength="300"></div>` : html`<input type="hidden" id="note" name="note" value="">`}
      <h2>পেমেন্ট</h2>
      <div class="pay-methods" role="radiogroup">
        ${methods.map((m, i) => html`<label class="pay-opt"><input type="radio" name="payment" value="${m.id}" ${i === 0 ? raw('checked') : ''} data-manual="${m.manual ? '1' : ''}" data-number="${m.number || ''}" data-advance="${m.advance || ''}" data-number-label="${m.numberLabel || ''}">
          <span><b>${m.label}</b><small>${m.note}</small></span></label>`)}
      </div>
      <div class="manual-pay" data-manual-box hidden>
        <p data-manual-text>${s.manual_note} <b data-pay-number></b> (${s.manual_type || 'Personal'})। পরিমাণ: <b data-pay-amount></b></p>
        <p data-adv-text hidden>💵 ${s.cod_advance_note} <span data-adv-label></span> <b data-adv-number></b> (${s.manual_type || 'Personal'})। এখন পাঠাবেন: <b data-adv-amount></b>${s.cod_advance === 'new' ? html`<br><small>শুধু প্রথম অর্ডারে লাগবে — আগে আমাদের থেকে পণ্য নিয়ে থাকলে খালি রাখতে পারেন।</small>` : ''}</p>
        <div class="field-row">
          <div class="field"><label for="pay_from">যে নম্বর থেকে পাঠিয়েছেন</label><input id="pay_from" name="payment_number" inputmode="tel" maxlength="20"></div>
          <div class="field"><label for="trx">Transaction ID (TrxID)</label><input id="trx" name="trx" maxlength="40" autocapitalize="characters"></div>
        </div>
      </div>
      ${s.consent_on !== '0' ? html`<label class="check consent-check"><input type="checkbox" name="consent" value="1" required data-consent>
        <span>আমার নাম, মোবাইল নম্বর ও ঠিকানা শুধু এই অর্ডার ডেলিভারি ও যোগাযোগের জন্য ব্যবহারে সম্মতি দিচ্ছি। <a href="/page/privacy-policy" target="_blank">প্রাইভেসি পলিসি</a></span></label>` : ''}
      <p class="form-error" data-error hidden></p>
      <button class="btn btn-amber btn-lg btn-block" type="submit" data-submit>অর্ডার কনফার্ম করুন</button>
      <p class="muted small center">অর্ডার করার মাধ্যমে আপনি আমাদের <a href="/page/terms">শর্তাবলি</a> মেনে নিচ্ছেন।</p>
    </form>
    <aside class="panel summary" aria-label="অর্ডারের সারাংশ">
      <h2>অর্ডারের সারাংশ</h2>
      <div data-summary><p class="muted">লোড হচ্ছে…</p></div>
      <div class="coupon" data-coupon ${U.on(s, 'ui_co_coupon') ? '' : raw('hidden')}>
        <label for="coupon" class="small">${s.ref_on === '1' ? 'কুপন বা বন্ধুর রেফারেল কোড আছে?' : 'কুপন কোড আছে?'}</label>
        <div class="coupon-row"><input id="coupon" placeholder="কোড লিখুন" maxlength="30" autocapitalize="characters" value="${refCode}" ${refCode ? raw('data-auto-apply') : ''}><button type="button" class="btn btn-sm btn-ghost" data-apply-coupon>প্রয়োগ</button></div>
        <p class="small" data-coupon-msg></p>
      </div>
      ${s.gift_on === '1' ? html`<div class="coupon gift-box" data-gift>
        <label for="giftcode" class="small">💳 গিফট কার্ড আছে?</label>
        <div class="coupon-row"><input id="giftcode" placeholder="GC-XXXX-XXXX" maxlength="30" autocapitalize="characters"><button type="button" class="btn btn-sm btn-ghost" data-apply-gift>প্রয়োগ</button></div>
        <p class="small" data-gift-msg></p>
      </div>` : ''}
      ${s.loyalty_on === '1' ? html`<div class="loyalty-note panel" data-points hidden>
        <p data-points-text></p>
        <label class="check" data-points-use hidden><input type="checkbox" name="use_points" form="checkout-form" value="1"> <span data-points-label></span></label>
        <p class="small muted" data-points-earn></p>
      </div>` : ''}
    </aside>
  </div>
</div>
<script src="/js/bd-geo.js" defer></script>`;
}

const STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
// 01712345678 -> 017•••••678 (shown to anyone who only has the order number)
function maskPhone(p) { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

// After delivery: one review per product, only for the order's owner (placed on this browser or opened with
// order number + mobile number). Everyone else sees how to open it.
function orderReviews(order, items, mine, s = {}) {
  return html`<section class="panel order-reviews" id="review">
    <h2>⭐ পণ্যগুলো কেমন লাগলো?</h2>
    ${!mine ? html`<p class="muted">রিভিউ দিতে আগে <a href="/track?code=${order.code}">অর্ডার ট্র্যাক</a> পেজে অর্ডার নম্বর আর যে মোবাইল নম্বরে অর্ডার করেছিলেন সেটা দিন।</p>`
    : html`<p class="muted small">আপনি পণ্য হাতে পেয়েছেন — আপনার মতামত অন্য কাস্টমারদের সাহায্য করবে। প্রতিটা পণ্যে একবার রিভিউ দেওয়া যায়।</p>
    <ul class="order-review-list">${items.map((it) => html`<li>
      <p><b>${it.name}</b>${it.review_id ? html` <span class="verified">✓ রিভিউ দিয়েছেন${it.status === 'pending' ? ' (যাচাই চলছে)' : ''}</span>` : ''}</p>
      ${it.review_id ? '' : html`<details><summary class="btn btn-sm btn-ghost">✍️ রিভিউ দিন</summary>
      <form class="form review-form" data-review-form data-product="${it.product_id}" data-code="${order.code}">
        <fieldset class="rate-pick" aria-label="রেটিং"><legend class="small">রেটিং দিন</legend>
          ${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" name="rating" id="rt${it.product_id}-${n}" value="${n}" ${n === 5 ? raw('checked') : ''}><label for="rt${it.product_id}-${n}" title="${bn(n)} স্টার">★</label>`)}
        </fieldset>
        <label class="field"><span>আপনার নাম (রিভিউতে দেখাবে)</span><input name="name" maxlength="60" value="${String(order.customer_name || '').trim().split(/\s+/)[0]}" autocomplete="name"></label>
        <label class="field"><span>আপনার মতামত</span><textarea name="body" rows="3" maxlength="1500" required minlength="5"></textarea></label>
        ${s.review_photos_on !== '0' ? html`<div class="field"><span>📸 পণ্যের ছবি (ঐচ্ছিক, সর্বোচ্চ ৩টা)</span><input type="file" accept="image/*" multiple data-photo-pick data-photo-max="3">
          <div class="ret-thumbs" data-photo-thumbs></div></div>` : ''}
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <button class="btn btn-block">রিভিউ পাঠান</button>
        <p class="small" data-review-msg role="status"></p>
      </form></details>`}
    </li>`)}</ul>`}
  </section>`;
}
function orderPage({ order, settings: s, fresh, payFailed, trackUrl, mine = false, reviewItems = [] }) {
  const cancelled = O.RELEASED.has(order.status);
  const at = STEPS.indexOf(order.status === 'hold' ? 'confirmed' : order.status);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const online = ['bkash', 'ssl'].includes(order.payment);
  return html`<div class="wrap section narrow">
  ${fresh && U.on(s, 'ui_order_thanks') ? html`<div class="success-banner">
    <div class="tick" aria-hidden="true">✓</div>
    <h1>ধন্যবাদ, <span translate="no">${order.customer_name}</span>! ${U.text(s, 'uit_order_thanks')}</h1>
    <p>শীঘ্রই আমরা <b translate="no">${mine ? order.phone : maskPhone(order.phone)}</b> নম্বরে কল করে অর্ডার কনফার্ম করব।</p>
  </div>` : html`<h1>অর্ডারের অবস্থা</h1>`}
  ${payFailed ? html`<p class="form-error">পেমেন্ট সম্পন্ন হয়নি। আবার চেষ্টা করুন, অথবা আমাদের কল করুন — অর্ডারটি সেভ করা আছে।</p>` : ''}
  ${online && due > 0 && !cancelled ? html`<div class="panel pay-now"><p>অনলাইন পেমেন্ট বাকি: <b>${money(due)}</b></p><a class="btn btn-amber btn-lg" href="/pay/${order.code}">এখনই পেমেন্ট করুন</a></div>` : ''}
  ${order.payment.startsWith('manual_') && order.payment_status !== 'paid' ? html`<p class="note">আপনার পাঠানো টাকা (TrxID: ${order.transaction_id || '—'}) আমরা যাচাই করে কনফার্ম করব।</p>` : ''}
  <div class="panel">
    <div class="order-meta">
      <div><span class="muted">অর্ডার নম্বর</span><b class="order-code">${order.code}</b></div>
      <div><span class="muted">তারিখ</span><b>${fmtDate(order.created_at)}</b></div>
      <div><span class="muted">মোট</span><b>${money(order.total)}</b></div>
    </div>
    ${cancelled ? html`<p class="status-cancelled">এই অর্ডারটি ${O.STATUSES[order.status]}।</p>`
    : !U.on(s, 'ui_order_steps') ? html`<p><b>${O.STATUSES[order.status] || ''}</b></p>` : html`<ol class="steps steps-5">${STEPS.map((st, i) => html`<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${O.STATUSES[st]}</li>`)}</ol>`}
    ${order.consignment_id && U.on(s, 'ui_order_tracking') ? html`<p>কুরিয়ার: <b>${require('../services/courier').label(order.courier)}</b> · ট্র্যাকিং নম্বর: <b class="mono" translate="no">${order.tracking_code || order.consignment_id}</b>${trackUrl ? html` · <a href="${trackUrl}" target="_blank" rel="noopener">পার্সেল ট্র্যাক করুন ↗</a>` : ''}</p>` : ''}
    ${fresh ? html`<p class="muted small">অর্ডার নম্বরটি লিখে রাখুন। পরে <a href="/track">অর্ডার ট্র্যাক</a> পেজে এটা দিয়ে অবস্থা দেখতে পারবেন।</p>` : ''}
  </div>
  <div class="panel">
    <h2>পণ্যসমূহ</h2>
    <table class="lines"><tbody>
      ${order.items.map((it) => html`<tr><td>${it.name} <span class="muted">× ${bn(it.qty)}</span>${it.note ? html`<br><span class="small good">${it.note}</span>` : ''}${it.preorder_qty > 0 && !['delivered', 'shipped'].includes(order.status) ? html`<br><span class="small preorder-line">⏳ প্রি-অর্ডার: ${bn(it.preorder_qty)}টি স্টকে এলেই পাঠানো হবে</span>` : ''}</td><td class="num">${it.kind === 'gift' && !Number(it.price) ? 'ফ্রি' : money(it.price * it.qty)}</td></tr>`)}
    </tbody><tfoot>
      <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      ${order.discount ? html`<tr><td>ছাড়${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
      ${Number(order.points_discount) ? html`<tr><td>পয়েন্ট ছাড় (${bn(order.points_used)} পয়েন্ট)</td><td class="num">− ${money(order.points_discount)}</td></tr>` : ''}
      <tr><td>ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
      ${roundOff(order) ? html`<tr><td>রাউন্ড ফিগার</td><td class="num">${roundOff(order) > 0 ? '+ ' : '− '}${money(Math.abs(roundOff(order)))}</td></tr>` : ''}
      <tr class="total"><td>মোট</td><td class="num">${money(order.total)}</td></tr>
      ${Number(order.gift_amount) ? html`<tr class="good"><td>💳 গিফট কার্ড থেকে</td><td class="num">${money(order.gift_amount)}</td></tr>` : ''}
      ${order.paid_amount ? html`<tr><td>পরিশোধিত</td><td class="num">${money(order.paid_amount)}</td></tr><tr><td><b>ডেলিভারির সময় দিতে হবে</b></td><td class="num"><b>${money(due)}</b></td></tr>` : ''}
    </tfoot></table>
    ${mine ? html`<p class="muted small">ডেলিভারি ঠিকানা: <span translate="no">${order.address}, ${O.areaLabel(order)}</span></p>`
      : html`<p class="muted small">🔒 নিরাপত্তার জন্য ঠিকানা আর পুরো মোবাইল নম্বর লুকানো আছে। দেখতে <a href="/track?code=${order.code}">অর্ডার ট্র্যাক</a> পেজে মোবাইল নম্বর দিন।</p>`}
  </div>
  ${reviewItems.length ? orderReviews(order, reviewItems, mine, s) : ''}
  ${s.returns_on === '1' && order.status === 'delivered' ? html`<section class="panel ret-cta"><p>পণ্যে কোনো সমস্যা? ভাঙা/ভুল/নষ্ট পণ্য পেলে ${Number(s.returns_days) || 7} দিনের মধ্যে আবেদন করুন।</p><a class="btn btn-ghost" href="/order/${order.code}/return">↩️ রিটার্ন / রিফান্ড আবেদন</a></section>` : ''}
  <p class="center"><a class="btn" href="/products">আরও কেনাকাটা করুন</a>${s.acct_on === '1' ? html` <a class="btn btn-ghost" href="/account">👤 আমার সব অর্ডার</a>` : ''}</p>
  ${s.complaints_on !== '0' && !fresh ? html`<p class="center small muted">এই অর্ডার নিয়ে কোনো সমস্যা? <a href="/complaint?order=${order.code}">📮 অভিযোগ জানান</a> — ${bn(Number(s.complaint_hours) || 72)} ঘণ্টার মধ্যে সমাধান।</p>` : ''}
</div>`;
}

function trackPage({ error, code, phone }) {
  return html`<div class="wrap section narrow">
  <h1>অর্ডার ট্র্যাক করুন</h1>
  <form class="form panel" method="get" action="/track">
    <p class="muted">অর্ডার করার পর যে নম্বর পেয়েছিলেন (যেমন SM7K2P9Q) আর আপনার মোবাইল নম্বর দিন।</p>
    <div class="field"><label for="code">অর্ডার নম্বর</label><input id="code" name="code" required value="${code || ''}" autocapitalize="characters" placeholder="SM…"></div>
    <div class="field"><label for="tphone">মোবাইল নম্বর</label><input id="tphone" name="phone" required inputmode="tel" value="${phone || ''}" placeholder="01XXXXXXXXX"></div>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block" type="submit">অবস্থা দেখুন</button>
  </form>
</div>`;
}

// ---------------------------------------------------------------- blog & pages
function postCard(p) {
  return html`<article class="post-card"><a href="/blog/${p.slug}" class="post-pic">${p.cover_id ? html`<img src="/media/${p.cover_id}/t" alt="" loading="lazy" draggable="false">` : html`<span>📝</span>`}</a>
    <div><span class="small muted">${p.category_name || ''} · ${fmtDate(p.published_at, false)}</span><h3><a href="/blog/${p.slug}">${p.title}</a></h3><p>${p.excerpt}</p></div></article>`;
}
function blogList({ posts, categories, category }) {
  return html`<div class="wrap section">
  <nav class="crumbs"><a href="/">হোম</a> / <a href="/blog">ব্লগ</a>${category ? html` / <span>${category.name}</span>` : ''}</nav>
  <h1>${category ? category.name : 'ব্লগ ও টিপস'}</h1>
  ${categories.length ? html`<div class="chips"><a class="chip ${!category ? 'on' : ''}" href="/blog">সব</a>${categories.map((c) => html`<a class="chip ${category && category.id === c.id ? 'on' : ''}" href="/blog/category/${c.slug}">${c.name}</a>`)}</div>` : ''}
  ${posts.length ? html`<div class="post-grid">${posts.map(postCard)}</div>` : html`<div class="empty"><p>এখনো কোনো লেখা নেই।</p></div>`}
</div>`;
}
function blogPost({ post, contentHtml, related }) {
  return html`<div class="wrap section narrow">
  <nav class="crumbs"><a href="/">হোম</a> / <a href="/blog">ব্লগ</a>${post.category_slug ? html` / <a href="/blog/category/${post.category_slug}">${post.category_name}</a>` : ''}</nav>
  <article class="post rich">
    <h1>${post.title}</h1>
    <p class="muted small">${fmtDate(post.published_at, false)}${post.author_name ? ` · ${post.author_name}` : ''}</p>
    ${post.cover_id ? html`<img class="post-cover" src="/media/${post.cover_id}" alt="" draggable="false">` : ''}
    ${raw(contentHtml)}
  </article>
  ${related.length ? html`<h2>আরও পড়ুন</h2><div class="post-grid">${related.map(postCard)}</div>` : ''}
</div>`;
}
function staticPage({ page }) {
  return html`<div class="wrap section narrow"><nav class="crumbs"><a href="/">হোম</a> / <span>${page.title}</span></nav>
  <article class="post rich"><h1>${page.title}</h1>${raw(md.render(page.content))}</article></div>`;
}

function notFound() {
  return html`<div class="wrap section narrow center">
  <h1>পেজটি পাওয়া যায়নি</h1>
  <p class="muted">লিংকটি ভুল হতে পারে, অথবা পণ্যটি সরিয়ে ফেলা হয়েছে।</p>
  <p><a class="btn" href="/">হোমে ফিরে যান</a> <a class="btn btn-ghost" href="/products">সব পণ্য</a></p>
</div>`;
}

// ---------------------------------------------------------------- live scores
function livePage({ sport, on, data, embed, settings }) {
  const tabs = [['cricket', '🏏 ক্রিকেট'], ['football', '⚽ ফুটবল']].filter(([k]) => on[k]);
  const refresh = Math.min(120, Math.max(10, Number(settings.live_refresh) || 20));
  return html`<div class="wrap section live">
  <div class="live-head">
    <h1>${sport === 'cricket' ? '🏏 লাইভ ক্রিকেট স্কোর' : '⚽ লাইভ ফুটবল স্কোর'}</h1>
    ${tabs.length > 1 ? html`<nav class="live-sports" aria-label="খেলা">${tabs.map(([k, l]) => html`<a href="/live/${k}" class="${k === sport ? 'on' : ''}">${l}</a>`)}</nav>` : ''}
  </div>
  ${embed ? html`<div class="live-embed">${raw(embed)}</div>` : html`
  <div class="live-bar">
    <div class="chips live-filter" role="tablist">
      <button type="button" class="chip on" data-live-filter="all">সব</button>
      <button type="button" class="chip" data-live-filter="in"><span class="dot"></span> লাইভ <b data-live-count></b></button>
      <button type="button" class="chip" data-live-filter="pre">আসন্ন</button>
      <button type="button" class="chip" data-live-filter="post">শেষ</button>
    </div>
    <span class="live-updated small muted" data-live-updated aria-live="polite"></span>
  </div>
  <div class="live-list" data-live="${sport}" data-refresh="${refresh}">
    <p class="live-empty muted">স্কোর লোড হচ্ছে…</p>
  </div>
  <script type="application/json" data-live-initial>${raw(JSON.stringify(data || null).replace(/</g, '\\u003c'))}</script>
  <noscript><p class="muted">লাইভ স্কোর দেখতে ব্রাউজারে JavaScript চালু রাখুন।</p></noscript>`}
</div>`;
}

module.exports = {
  livePage,
  home, listing, productPage, cartPage, checkoutPage, wishlistPage, comparePage, stars, orderPage, trackPage, notFound, productCard, blogList, blogPost, staticPage, discount,
};
void esc;

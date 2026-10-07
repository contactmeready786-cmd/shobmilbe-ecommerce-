'use strict';
const security = require('../security');
const { html, raw, esc, money, bn, fmtDate, youtubeId, contact, roundOff, qtyRule } = require('../util');
const O = require('../models/orders');
const md = require('./md');

function img(p, cls = '', thumb = true) {
  if (p.image_id) return html`<img class="${cls}" src="/media/${p.image_id}${thumb ? '/t' : ''}" alt="${p.name}" loading="lazy" decoding="async" draggable="false">`;
  return html`<span class="emoji ${cls}" aria-hidden="true">${p.emoji || '📦'}</span>`;
}
function discount(p) {
  if (!p.old_price || p.old_price <= p.price) return 0;
  return Math.round(((p.old_price - p.price) / p.old_price) * 100);
}

function productCard(p, settings) {
  const off = discount(p);
  const out = p.stock <= 0;
  return html`<article class="card ${out ? 'is-out' : ''}">
  <a class="card-pic" href="/p/${p.slug}" tabindex="-1" aria-hidden="true">
    ${img(p)}
    ${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}
    ${p.product_type === 'bundle' ? html`<span class="badge-bundle">প্যাকেজ</span>` : ''}
  </a>
  <div class="card-body">
    ${p.category_name ? html`<span class="card-cat">${p.category_name}</span>` : ''}
    <h3 class="card-title"><a href="/p/${p.slug}">${p.name}</a></h3>
    <div class="price-row">
      <span class="price">${money(p.price)}</span>${qtyRule(settings || {}, p.price).small ? html`<span class="per-pc">/পিস</span>` : ''}
      ${off ? html`<s class="old-price">${money(p.old_price)}</s>` : ''}
    </div>
    ${qtyRule(settings || {}, p.price).small ? html`<p class="min-pc">কমপক্ষে ${bn(qtyRule(settings || {}, p.price).min)}টি</p>` : ''}
    ${out
    ? html`<button class="btn btn-block" disabled>স্টকে নেই</button>`
    : html`<div class="card-actions">
        <button class="btn btn-block btn-add" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}">কার্টে যোগ করুন</button>
        ${settings && settings.show_buy_now_on_card === '1' ? html`<button class="btn btn-block btn-amber btn-buy" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}" data-buy-now>এখনই কিনুন</button>` : ''}
      </div>`}
  </div>
</article>`;
}
function productGrid(products, settings, emptyMsg) {
  if (!products.length) return html`<div class="empty"><p>${emptyMsg || 'কোনো পণ্য পাওয়া যায়নি।'}</p><a class="btn" href="/products">সব পণ্য দেখুন</a></div>`;
  return html`<div class="grid">${products.map((p) => productCard(p, settings))}</div>`;
}
function section(title, link, content) {
  return html`<section class="home-sec"><div class="section-head"><h2>${title}</h2>${link ? html`<a href="${link}">সব দেখুন →</a>` : ''}</div>${content}</section>`;
}
function catGrid(categories) {
  return html`<nav class="cat-grid" aria-label="ক্যাটাগরি">${categories.map((c) => html`<a class="cat-box" href="/products?cat=${c.slug}">
    <span class="cat-ic" aria-hidden="true">${c.image_id ? html`<img src="/media/${c.image_id}/t" alt="" draggable="false">` : c.icon}</span>
    <span class="cat-name">${c.name}</span><span class="cat-count">${bn(c.product_count)}টি</span></a>`)}</nav>`;
}

// ---------------------------------------------------------------- home
function home({ settings: s, sections, data }) {
  const parts = sections.map((key) => {
    if (key === 'slider') {
      if (!data.slides.length) {
        return html`<section class="hero"><div class="wrap hero-row"><div class="hero-text">
          <h1>${s.hero_title || 'দরকারি সব পার্টস, এক দোকানে'}</h1><p>${s.tagline}</p>
          <div class="hero-actions"><a class="btn btn-amber" href="/products">কেনাকাটা শুরু করুন</a><a class="btn btn-ghost-light" href="/track">অর্ডার ট্র্যাক করুন</a></div>
          <ul class="hero-facts"><li>পণ্য হাতে পেয়ে টাকা দিন</li><li>ঢাকায় ডেলিভারি ${money(s.delivery_dhaka)}</li><li>সারা দেশে ${money(s.delivery_outside)}</li></ul>
        </div></div></section>`;
      }
      return html`<section class="slider" data-slider aria-roledescription="carousel">
        <div class="slides">${data.slides.map((b, i) => html`<a class="slide ${i === 0 ? 'on' : ''}" href="${security.safeUrl(b.link)}" ${b.link ? '' : raw('tabindex="-1"')}>
          <img src="/media/${b.image_id}" alt="${b.title || s.store_name}" ${i ? raw('loading="lazy"') : raw('fetchpriority="high"')} draggable="false">
          ${b.title || b.subtitle ? html`<span class="slide-text"><b>${b.title}</b>${b.subtitle ? html`<span>${b.subtitle}</span>` : ''}${b.button ? html`<em class="btn btn-amber btn-sm">${b.button}</em>` : ''}</span>` : ''}
        </a>`)}</div>
        ${data.slides.length > 1 ? html`<div class="dots">${data.slides.map((_, i) => html`<button type="button" data-dot="${i}" class="${i === 0 ? 'on' : ''}" aria-label="স্লাইড ${bn(i + 1)}"></button>`)}</div>` : ''}
      </section>`;
    }
    if (key === 'categories' && data.categories.length) return html`<div class="wrap">${section('ক্যাটাগরি', '', catGrid(data.categories))}</div>`;
    if (key === 'featured' && data.featured.length) return html`<div class="wrap">${section('জনপ্রিয় পণ্য', '/products', productGrid(data.featured, s))}</div>`;
    if (key === 'offers' && data.offers.length) return html`<div class="wrap">${section('🔥 অফারে আছে', '/products?sort=offer', productGrid(data.offers, s))}</div>`;
    if (key === 'new' && data.latest.length) return html`<div class="wrap">${section('নতুন এসেছে', '/products?sort=new', productGrid(data.latest, s))}</div>`;
    if (key === 'bestsellers' && data.best.length) return html`<div class="wrap">${section('সবচেয়ে বেশি বিক্রি', '/products?sort=popular', productGrid(data.best, s))}</div>`;
    if (key === 'promo' && data.promos.length) {
      return html`<div class="wrap"><div class="promos">${data.promos.map((b) => html`<a href="${security.safeUrl(b.link)}" class="promo"><img src="/media/${b.image_id}" alt="${b.title || ''}" loading="lazy" draggable="false"></a>`)}</div></div>`;
    }
    if (key === 'blog' && data.posts.length) {
      return html`<div class="wrap">${section('ব্লগ ও টিপস', '/blog', html`<div class="post-grid">${data.posts.map(postCard)}</div>`)}</div>`;
    }
    return '';
  });
  return html`${parts}<div class="wrap trust">
    <div>🚚 <b>সারা দেশে ডেলিভারি</b><span>ঢাকায় ${money(s.delivery_dhaka)}, বাইরে ${money(s.delivery_outside)}</span></div>
    <div>💵 <b>ক্যাশ অন ডেলিভারি</b><span>পণ্য হাতে পেয়ে টাকা</span></div>
    <div>🔁 <b>সহজ রিটার্ন</b><span>সমস্যা থাকলে ফেরত</span></div>
    <div>📞 <b>সাহায্য দরকার?</b><span>${contact(s).phone || 'আমাদের মেসেজ দিন'}</span></div>
  </div>`;
}

// ---------------------------------------------------------------- listing
function listing({ products, categories, category, q, sort, settings, total, page, perPage }) {
  const title = category ? category.name : q ? `"${q}" এর ফলাফল` : sort === 'offer' ? 'অফারের পণ্য' : 'সব পণ্য';
  const base = new URLSearchParams();
  if (category) base.set('cat', category.slug);
  if (q) base.set('q', q);
  if (sort) base.set('sort', sort);
  const pages = Math.ceil(total / perPage);
  const pageLink = (n) => { const p = new URLSearchParams(base); if (n > 1) p.set('page', n); return '/products' + (p.toString() ? '?' + p : ''); };
  return html`<div class="wrap section">
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a> / <span>${title}</span></nav>
  <div class="listing-head">
    <h1>${title} <small>${bn(total)}টি পণ্য</small></h1>
    <form class="sort" method="get" action="/products">
      ${category ? html`<input type="hidden" name="cat" value="${category.slug}">` : ''}
      ${q ? html`<input type="hidden" name="q" value="${q}">` : ''}
      <label for="sort">সাজান</label>
      <select id="sort" name="sort" data-autosubmit>
        ${[['', 'জনপ্রিয়'], ['new', 'নতুন আগে'], ['popular', 'বেশি বিক্রি'], ['offer', 'অফার'], ['price_asc', 'দাম: কম থেকে বেশি'], ['price_desc', 'দাম: বেশি থেকে কম']]
    .map(([v, l]) => html`<option value="${v}" ${sort === v ? raw('selected') : ''}>${l}</option>`)}
      </select>
    </form>
  </div>
  <div class="chips cat-chips" role="list">
    <a role="listitem" class="chip ${!category ? 'on' : ''}" href="${q ? `/products?q=${encodeURIComponent(q)}` : '/products'}">সব</a>
    ${categories.map((c) => html`<a role="listitem" class="chip ${category && category.id === c.id ? 'on' : ''}" href="/products?cat=${c.slug}">${c.icon} ${c.name}</a>`)}
  </div>
  ${productGrid(products, settings, q ? `"${q}" নামে কোনো পণ্য পাওয়া যায়নি। অন্য নামে খুঁজে দেখুন।` : 'এখানে এখনো পণ্য নেই।')}
  ${pages > 1 ? html`<nav class="pager" aria-label="পেজ">${page > 1 ? html`<a href="${pageLink(page - 1)}">← আগের</a>` : ''}
    ${Array.from({ length: pages }, (_, i) => i + 1).filter((n) => Math.abs(n - page) < 3 || n === 1 || n === pages)
    .map((n) => (n === page ? html`<b>${bn(n)}</b>` : html`<a href="${pageLink(n)}">${bn(n)}</a>`))}
    ${page < pages ? html`<a href="${pageLink(page + 1)}">পরের →</a>` : ''}</nav>` : ''}
</div>`;
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

function productPage({ product: p, related, settings: s, inlineProducts = {} }) {
  const off = discount(p);
  const out = p.stock <= 0;
  const yt = youtubeId(p.youtube_url);
  const images = p.images && p.images.length ? p.images : [];
  const slots = Math.max(images.length, 1);
  const C = contact(s);
  const waText = `আসসালামু আলাইকুম। এই পণ্যটি সম্পর্কে জানতে চাই:\n${p.name}${p.sku ? ` (SKU: ${p.sku})` : ''}\nদাম: ৳${p.price}`;
  const waBtn = C.waButton ? html`<a class="btn btn-wa btn-lg" href="https://wa.me/${C.waButton}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener"
      data-wa-text="${waText}" data-wa="${C.waButton}" aria-label="WhatsApp এ কথা বলুন">${raw(WA_ICON)} WhatsApp</a>` : '';
  const R = qtyRule(s, p.price);
  const short = !out && p.stock < R.min; // not enough stock for the minimum
  const maxQ = Math.max(R.min, Math.min(p.stock, R.max));
  const longHtml = md.render(p.description || '', { productCard: true }).replace(/<!--product:([^>]+)-->/g, (_, slug) => (inlineProducts[slug] ? productCard(inlineProducts[slug], s).s : ''));
  return html`<div class="wrap section">
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a> /
    ${p.category_slug ? html`<a href="/products?cat=${p.category_slug}">${p.category_name}</a> /` : ''}
    <span>${p.name}</span></nav>
  <div class="pdp">
    <div class="gallery" data-gallery>
      <div class="g-main">
        ${images.length ? html`<img src="/media/${images[0]}" alt="${p.name}" data-g-main draggable="false" fetchpriority="high">
        <button type="button" class="g-zoom" data-g-zoom aria-label="ছবি বড় করে দেখুন">⤢ বড় করে দেখুন</button>` : html`<span class="emoji">${p.emoji || '📦'}</span>`}
        ${yt ? html`<div class="g-video" data-g-video hidden><iframe data-src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0" title="পণ্যের ভিডিও" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : ''}
        ${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}
      </div>
      <div class="g-thumbs" role="list">
        ${images.map((id, i) => html`<button type="button" class="g-thumb ${i === 0 ? 'on' : ''}" data-g-img="/media/${id}" aria-label="ছবি ${bn(i + 1)}"><img src="/media/${id}/t" alt="" loading="lazy" draggable="false"></button>`)}
        ${yt ? html`<button type="button" class="g-thumb g-thumb-video" data-g-yt aria-label="ভিডিও দেখুন"><img src="https://i.ytimg.com/vi/${yt}/mqdefault.jpg" alt="" loading="lazy" draggable="false"><span class="play">▶</span></button>` : ''}
        ${Array.from({ length: Math.max(0, 5 - slots - (yt ? 1 : 0)) }, () => html`<span class="g-thumb g-empty" aria-hidden="true"></span>`)}
      </div>
      ${yt ? html`<button type="button" class="g-video-btn" data-g-yt-btn><span class="yt-ic" aria-hidden="true">▶</span> পণ্যের ভিডিও দেখুন</button>` : ''}
    </div>
    <div class="pdp-info">
      <h1>${p.name}</h1>
      <p class="pdp-meta">${p.sku ? html`SKU: <b>${p.sku}</b>` : ''}${p.brand ? html` · ব্র্যান্ড: <b>${p.brand}</b>` : ''}${p.category_name ? html` · <a href="/products?cat=${p.category_slug}">${p.category_name}</a>` : ''}</p>
      <div class="price-row big">
        <span class="price">${money(p.price)}</span>
        ${off ? html`<s class="old-price">${money(p.old_price)}</s><span class="save">${money(p.old_price - p.price)} সাশ্রয়</span>` : ''}
      </div>
      ${R.small ? html`<div class="small-rule">🔩 <b>কম দামের পণ্য:</b> প্রতি পিস ${money(p.price)}। কমপক্ষে <b>${bn(R.min)}টি</b> নিতে হবে
        (${money(R.min * p.price)})। একসাথে সর্বোচ্চ ${bn(R.max)}টি।</div>` : ''}
      <p class="stock ${out ? 'out' : p.stock <= p.low_stock ? 'low' : 'ok'}">${out ? 'স্টকে নেই' : p.stock <= p.low_stock ? `মাত্র ${bn(p.stock)}টি বাকি আছে` : '✓ স্টকে আছে'}</p>
      ${p.short_description ? html`<div class="pdp-short"><p class="pdp-label">📝 সংক্ষেপে</p>${raw(md.render(p.short_description))}
        ${p.description ? html`<a class="pdp-more" href="#details">বিস্তারিত বিবরণ পড়ুন ↓</a>` : ''}</div>` : ''}
      ${p.bundle && p.bundle.length ? html`<div class="bundle-box"><b>এই প্যাকেজে যা যা আছে:</b><ul>${p.bundle.map((b) => html`<li>${b.name} × ${bn(b.qty)}</li>`)}</ul>
        ${(() => { const sum = p.bundle.reduce((t, b) => t + b.price * b.qty, 0); return sum > p.price ? html`<p class="save">আলাদা কিনলে ${money(sum)} — প্যাকেজে ${money(sum - p.price)} কম!</p>` : ''; })()}</div>` : ''}
      ${out || short ? html`${short ? html`<p class="qty-limit">এই পণ্যটি কমপক্ষে ${bn(R.min)}টি নিতে হয়, কিন্তু স্টকে আছে ${bn(p.stock)}টি। নিতে চাইলে সরাসরি যোগাযোগ করুন।</p>` : ''}<div class="buy-box">${C.phone ? html`<a class="btn btn-ghost btn-lg" href="tel:${C.phone}">📞 স্টক জানতে কল করুন</a>` : ''}${waBtn}</div>` : html`<div class="buy-box">
        <div class="qty" data-qty>
          <button type="button" data-step="-1" aria-label="কমান">−</button>
          <input type="number" min="${R.min}" max="${maxQ}" value="${R.min}" aria-label="পরিমাণ" data-stock="${p.stock}">
          <button type="button" data-step="1" aria-label="বাড়ান">+</button>
        </div>
        <button class="btn btn-add btn-lg" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}" data-with-qty>কার্টে যোগ করুন</button>
        <button class="btn btn-amber btn-lg" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}" data-with-qty data-buy-now>এখনই কিনুন</button>
        ${waBtn}
      </div>
      <p class="qty-limit" data-qty-limit hidden></p>`}
      <ul class="pdp-facts">
        <li>🚚 ঢাকা সিটিতে ডেলিভারি ${money(s.delivery_dhaka)}, ঢাকার বাইরে ${money(s.delivery_outside)}</li>
        <li>💵 পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)</li>
        ${C.phone ? html`<li>📞 প্রশ্ন থাকলে কল করুন: <a href="tel:${C.phone}">${C.phone}</a></li>` : ''}
        <li>🛒 এই পণ্যটি একসাথে সর্বোচ্চ ${bn(R.max)}টি অর্ডার করা যাবে${C.phone || C.wa ? '। বেশি দরকার হলে সরাসরি যোগাযোগ করুন' : ''}</li>
      </ul>
    </div>
  </div>
  <div class="tabs-box" data-tabs id="details">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab on" data-tab="desc">📋 পণ্যের বিস্তারিত বিবরণ</button>
      ${yt ? html`<button type="button" role="tab" class="tab" data-tab="video">▶ ভিডিও</button>` : ''}
      <button type="button" role="tab" class="tab" data-tab="ship">🚚 ডেলিভারি ও রিটার্ন</button>
    </div>
    <div class="tab-panel rich" data-panel="desc">${p.description ? raw(longHtml) : html`<p class="muted">এই পণ্যের বিস্তারিত বিবরণ শীঘ্রই যোগ হবে।</p>`}</div>
    ${yt ? html`<div class="tab-panel" data-panel="video" hidden>${videoBox(yt, p.name)}</div>` : ''}
    <div class="tab-panel rich" data-panel="ship" hidden>
      <ul><li>ঢাকা সিটির ভেতরে: ${money(s.delivery_dhaka)}, সাধারণত ১-২ দিনে।</li><li>ঢাকার বাইরে: ${money(s.delivery_outside)}, সাধারণত ২-৪ দিনে।</li>
      ${Number(s.free_delivery_min) > 0 ? html`<li>${money(s.free_delivery_min)} বা বেশি কিনলে ডেলিভারি ফ্রি।</li>` : ''}
      <li>পণ্য হাতে পেয়ে দেখে টাকা দিন। কোনো সমস্যা থাকলে ডেলিভারিম্যানের সামনেই জানান।</li></ul>
      <p><a href="/page/return-policy">রিটার্ন নীতি বিস্তারিত →</a></p>
    </div>
  </div>
  ${yt ? html`<section class="pdp-video" id="video"><h2>▶ পণ্যের ভিডিও</h2>${videoBox(yt, p.name)}</section>` : ''}
  ${related.length ? html`<div class="section-head"><h2>একই রকম আরও পণ্য</h2></div>${productGrid(related, s)}` : ''}
</div>
${images.length ? html`<div class="lightbox" data-lightbox hidden role="dialog" aria-label="ছবি">
  <button type="button" class="lb-x" data-lb-close aria-label="বন্ধ করুন">✕</button>
  ${images.length > 1 ? html`<button type="button" class="lb-nav prev" data-lb-step="-1" aria-label="আগের ছবি">‹</button><button type="button" class="lb-nav next" data-lb-step="1" aria-label="পরের ছবি">›</button>` : ''}
  <img alt="${p.name}" data-lb-img draggable="false">
  <span class="lb-count" data-lb-count></span>
</div>` : ''}
${out || short ? '' : html`<div class="sticky-buy" data-sticky-buy><div><b>${money(p.price)}</b><span>${p.name}</span></div>
  ${C.waButton ? html`<a class="btn btn-wa btn-wa-ic" href="https://wa.me/${C.waButton}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener" data-wa-text="${waText}" data-wa="${C.waButton}" aria-label="WhatsApp এ কথা বলুন">${raw(WA_ICON)}</a>` : ''}
  <button class="btn btn-amber" data-add="${p.id}" data-name="${p.name}" data-price="${p.price}" data-with-qty data-buy-now>এখনই কিনুন</button></div>`}`;
}

// ---------------------------------------------------------------- cart & checkout
function cartPage({ settings }) {
  return html`<div class="wrap section narrow">
  <h1>আপনার কার্ট</h1>
  <div id="cart-root" data-cart-page data-free-min="${settings.free_delivery_min}"><p class="muted">লোড হচ্ছে…</p></div>
</div>`;
}

function checkoutPage({ settings: s, methods, cityAreas }) {
  return html`<div class="wrap section">
  <h1>অর্ডার করুন</h1>
  <div class="checkout" data-checkout data-dhaka="${s.delivery_dhaka}" data-outside="${s.delivery_outside}" data-free-min="${s.free_delivery_min}"
       data-city="${JSON.stringify(cityAreas)}">
    <form class="form panel" id="checkout-form" novalidate>
      <h2>ডেলিভারির তথ্য</h2>
      <div class="field"><label for="name">আপনার নাম</label><input id="name" name="name" required autocomplete="name" maxlength="80"></div>
      <div class="field"><label for="phone">মোবাইল নম্বর</label>
        <input id="phone" name="phone" required inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength="20">
        <small>এই নম্বরে কল করে অর্ডার কনফার্ম করা হবে।</small></div>
      <div class="field-row">
        <div class="field"><label for="district">জেলা</label><select id="district" name="district" required data-district data-value="Dhaka"><option value="">লোড হচ্ছে…</option></select></div>
        <div class="field"><label for="thana">থানা / উপজেলা</label><select id="thana" name="thana" required data-thana><option value="">আগে জেলা বাছুন</option></select></div>
      </div>
      <p class="zone-note" data-zone-note></p>
      <div class="field"><label for="address">পূর্ণ ঠিকানা</label>
        <textarea id="address" name="address" rows="2" required maxlength="400" placeholder="বাসা নং, রোড, এলাকা"></textarea></div>
      <div class="field"><label for="note">বিশেষ নির্দেশনা (ঐচ্ছিক)</label><input id="note" name="note" maxlength="300"></div>
      <h2>পেমেন্ট</h2>
      <div class="pay-methods" role="radiogroup">
        ${methods.map((m, i) => html`<label class="pay-opt"><input type="radio" name="payment" value="${m.id}" ${i === 0 ? raw('checked') : ''} data-manual="${m.manual ? '1' : ''}" data-number="${m.number || ''}">
          <span><b>${m.label}</b><small>${m.note}</small></span></label>`)}
      </div>
      <div class="manual-pay" data-manual-box hidden>
        <p>${s.manual_note} <b data-pay-number></b> (${s.manual_type || 'Personal'})। পরিমাণ: <b data-pay-amount></b></p>
        <div class="field-row">
          <div class="field"><label for="pay_from">যে নম্বর থেকে পাঠিয়েছেন</label><input id="pay_from" name="payment_number" inputmode="tel" maxlength="20"></div>
          <div class="field"><label for="trx">Transaction ID (TrxID)</label><input id="trx" name="trx" maxlength="40" autocapitalize="characters"></div>
        </div>
      </div>
      <p class="form-error" data-error hidden></p>
      <button class="btn btn-amber btn-lg btn-block" type="submit" data-submit>অর্ডার কনফার্ম করুন</button>
      <p class="muted small center">অর্ডার করার মাধ্যমে আপনি আমাদের <a href="/page/terms">শর্তাবলি</a> মেনে নিচ্ছেন।</p>
    </form>
    <aside class="panel summary" aria-label="অর্ডারের সারাংশ">
      <h2>অর্ডারের সারাংশ</h2>
      <div data-summary><p class="muted">লোড হচ্ছে…</p></div>
      <div class="coupon" data-coupon>
        <label for="coupon" class="small">কুপন কোড আছে?</label>
        <div class="coupon-row"><input id="coupon" placeholder="কোড লিখুন" maxlength="30" autocapitalize="characters"><button type="button" class="btn btn-sm btn-ghost" data-apply-coupon>প্রয়োগ</button></div>
        <p class="small" data-coupon-msg></p>
      </div>
    </aside>
  </div>
</div>
<script src="/js/bd-geo.js" defer></script>`;
}

const STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
// 01712345678 -> 017•••••678 (shown to anyone who only has the order number)
function maskPhone(p) { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

function orderPage({ order, settings: s, fresh, payFailed, trackUrl, mine = false }) {
  const cancelled = O.RELEASED.has(order.status);
  const at = STEPS.indexOf(order.status === 'hold' ? 'confirmed' : order.status);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const online = ['bkash', 'ssl'].includes(order.payment);
  return html`<div class="wrap section narrow">
  ${fresh ? html`<div class="success-banner">
    <div class="tick" aria-hidden="true">✓</div>
    <h1>ধন্যবাদ, ${order.customer_name}! আপনার অর্ডার পেয়েছি।</h1>
    <p>শীঘ্রই আমরা <b>${mine ? order.phone : maskPhone(order.phone)}</b> নম্বরে কল করে অর্ডার কনফার্ম করব।</p>
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
    : html`<ol class="steps steps-5">${STEPS.map((st, i) => html`<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${O.STATUSES[st]}</li>`)}</ol>`}
    ${order.consignment_id && trackUrl ? html`<p>কুরিয়ার: ${order.courier} · <a href="${trackUrl}" target="_blank" rel="noopener">পার্সেল ট্র্যাক করুন ↗</a></p>` : ''}
    ${fresh ? html`<p class="muted small">অর্ডার নম্বরটি লিখে রাখুন। পরে <a href="/track">অর্ডার ট্র্যাক</a> পেজে এটা দিয়ে অবস্থা দেখতে পারবেন।</p>` : ''}
  </div>
  <div class="panel">
    <h2>পণ্যসমূহ</h2>
    <table class="lines"><tbody>
      ${order.items.map((it) => html`<tr><td>${it.name} <span class="muted">× ${bn(it.qty)}</span></td><td class="num">${money(it.price * it.qty)}</td></tr>`)}
    </tbody><tfoot>
      <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      ${order.discount ? html`<tr><td>ছাড়${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
      <tr><td>ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
      ${roundOff(order) ? html`<tr><td>রাউন্ড ফিগার</td><td class="num">${roundOff(order) > 0 ? '+ ' : '− '}${money(Math.abs(roundOff(order)))}</td></tr>` : ''}
      <tr class="total"><td>মোট</td><td class="num">${money(order.total)}</td></tr>
      ${order.paid_amount ? html`<tr><td>পরিশোধিত</td><td class="num">${money(order.paid_amount)}</td></tr><tr><td><b>ডেলিভারির সময় দিতে হবে</b></td><td class="num"><b>${money(due)}</b></td></tr>` : ''}
    </tfoot></table>
    ${mine ? html`<p class="muted small">ডেলিভারি ঠিকানা: ${order.address}, ${O.areaLabel(order)}</p>`
      : html`<p class="muted small">🔒 নিরাপত্তার জন্য ঠিকানা আর পুরো মোবাইল নম্বর লুকানো আছে। দেখতে <a href="/track?code=${order.code}">অর্ডার ট্র্যাক</a> পেজে মোবাইল নম্বর দিন।</p>`}
  </div>
  <p class="center"><a class="btn" href="/products">আরও কেনাকাটা করুন</a>
  ${contact(s).phone ? html` <a class="btn btn-ghost" href="tel:${contact(s).phone}">📞 কল করুন</a>` : ''}
  ${contact(s).wa ? html` <a class="btn btn-ghost" href="https://wa.me/${contact(s).wa}?text=${encodeURIComponent('আমার অর্ডার নম্বর ' + order.code)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</p>
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
  home, listing, productPage, cartPage, checkoutPage, orderPage, trackPage, notFound, productCard, blogList, blogPost, staticPage, discount,
};
void esc;

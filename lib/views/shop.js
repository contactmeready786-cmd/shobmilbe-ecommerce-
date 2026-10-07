'use strict';
const { html, raw, esc, money, bn, fmtDate } = require('../util');
const { STATUSES } = require('../db');

function productImage(p, cls = '') {
  if (p.has_image) {
    return html`<img class="${cls}" src="/img/p/${p.id}?v=${p.version}" alt="${p.name}" loading="lazy" decoding="async">`;
  }
  return html`<span class="emoji ${cls}" aria-hidden="true">${p.emoji || '📦'}</span>`;
}

function discount(p) {
  if (!p.old_price || p.old_price <= p.price) return '';
  return Math.round(((p.old_price - p.price) / p.old_price) * 100);
}

function productCard(p) {
  const off = discount(p);
  const out = p.stock <= 0;
  return html`<article class="card ${out ? 'is-out' : ''}">
  <a class="card-pic" href="/p/${p.slug}" tabindex="-1" aria-hidden="true">
    ${productImage(p)}
    ${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}
  </a>
  <div class="card-body">
    ${p.category_name ? html`<span class="card-cat">${p.category_name}</span>` : ''}
    <h3 class="card-title"><a href="/p/${p.slug}">${p.name}</a></h3>
    <div class="price-row">
      <span class="price">${money(p.price)}</span>
      ${off ? html`<s class="old-price">${money(p.old_price)}</s>` : ''}
    </div>
    ${out
    ? html`<button class="btn btn-block" disabled>স্টকে নেই</button>`
    : html`<button class="btn btn-block btn-add" data-add="${p.id}" data-name="${p.name}">কার্টে যোগ করুন</button>`}
  </div>
</article>`;
}

function productGrid(products, emptyMsg) {
  if (!products.length) {
    return html`<div class="empty"><p>${emptyMsg || 'কোনো পণ্য পাওয়া যায়নি।'}</p><a class="btn" href="/products">সব পণ্য দেখুন</a></div>`;
  }
  return html`<div class="grid">${products.map(productCard)}</div>`;
}

function home({ settings, categories, featured, latest }) {
  return html`
<section class="hero">
  <div class="wrap hero-row">
    <div class="hero-text">
      <h1>দরকারি সব পার্টস, এক দোকানে</h1>
      <p>${settings.tagline}</p>
      <div class="hero-actions">
        <a class="btn btn-amber" href="/products">কেনাকাটা শুরু করুন</a>
        <a class="btn btn-ghost-light" href="/track">অর্ডার ট্র্যাক করুন</a>
      </div>
      <ul class="hero-facts">
        <li>পণ্য হাতে পেয়ে টাকা দিন</li>
        <li>ঢাকায় ডেলিভারি ${money(settings.delivery_dhaka)}</li>
        <li>সারা দেশে ${money(settings.delivery_outside)}</li>
      </ul>
    </div>
    <nav class="cabinet" aria-label="ক্যাটাগরি">
      ${categories.map((c) => html`<a class="drawer" href="/products?cat=${c.slug}">
        <span class="drawer-icon" aria-hidden="true">${c.icon}</span>
        <span class="drawer-label">${c.name}</span>
        <span class="drawer-count">${bn(c.product_count)}টি পণ্য</span>
        <span class="drawer-handle" aria-hidden="true"></span>
      </a>`)}
    </nav>
  </div>
</section>
<div class="wrap section">
  ${featured.length ? html`
  <div class="section-head"><h2>জনপ্রিয় পণ্য</h2><a href="/products">সব দেখুন</a></div>
  ${productGrid(featured)}` : ''}
  ${latest.length ? html`
  <div class="section-head"><h2>নতুন এসেছে</h2><a href="/products?sort=new">সব দেখুন</a></div>
  ${productGrid(latest)}` : ''}
</div>`;
}

function listing({ products, categories, category, q, sort }) {
  const title = category ? category.name : q ? `"${q}" এর ফলাফল` : 'সব পণ্য';
  const qs = (extra) => {
    const p = new URLSearchParams();
    if (category) p.set('cat', category.slug);
    if (q) p.set('q', q);
    Object.entries(extra).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    const s = p.toString();
    return s ? `/products?${s}` : '/products';
  };
  return html`<div class="wrap section">
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a> / <span>${title}</span></nav>
  <div class="listing-head">
    <h1>${title} <small>${bn(products.length)}টি পণ্য</small></h1>
    <form class="sort" method="get" action="/products">
      ${category ? html`<input type="hidden" name="cat" value="${category.slug}">` : ''}
      ${q ? html`<input type="hidden" name="q" value="${q}">` : ''}
      <label for="sort">সাজান</label>
      <select id="sort" name="sort" data-autosubmit>
        <option value="" ${!sort ? 'selected' : ''}>জনপ্রিয়</option>
        <option value="new" ${sort === 'new' ? 'selected' : ''}>নতুন আগে</option>
        <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>দাম: কম থেকে বেশি</option>
        <option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>দাম: বেশি থেকে কম</option>
      </select>
    </form>
  </div>
  <div class="chips" role="list">
    <a role="listitem" class="chip ${!category ? 'on' : ''}" href="${q ? `/products?q=${encodeURIComponent(q)}` : '/products'}">সব</a>
    ${categories.map((c) => html`<a role="listitem" class="chip ${category && category.id === c.id ? 'on' : ''}" href="/products?cat=${c.slug}">${c.icon} ${c.name}</a>`)}
  </div>
  ${productGrid(products, q ? `"${q}" নামে কোনো পণ্য পাওয়া যায়নি। অন্য নামে খুঁজে দেখুন।` : 'এই ক্যাটাগরিতে এখনো পণ্য নেই।')}
  ${raw(sort && products.length ? `<p class="muted center"><a href="${qs({ sort: '' })}">সাজানো বাতিল করুন</a></p>` : '')}
</div>`;
}

function productPage({ product: p, related, settings }) {
  const off = discount(p);
  const out = p.stock <= 0;
  return html`<div class="wrap section">
  <nav class="crumbs" aria-label="অবস্থান"><a href="/">হোম</a> /
    ${p.category_slug ? html`<a href="/products?cat=${p.category_slug}">${p.category_name}</a> /` : ''}
    <span>${p.name}</span></nav>
  <div class="pdp">
    <div class="pdp-pic">${productImage(p, 'pdp-img')}${off ? html`<span class="badge-off">${bn(off)}% ছাড়</span>` : ''}</div>
    <div class="pdp-info">
      <h1>${p.name}</h1>
      <div class="price-row big">
        <span class="price">${money(p.price)}</span>
        ${off ? html`<s class="old-price">${money(p.old_price)}</s>` : ''}
      </div>
      <p class="stock ${out ? 'out' : p.stock <= 3 ? 'low' : 'ok'}">
        ${out ? 'স্টকে নেই' : p.stock <= 3 ? `মাত্র ${bn(p.stock)}টি বাকি আছে` : 'স্টকে আছে'}
      </p>
      ${out ? '' : html`<div class="buy-box">
        <div class="qty" data-qty>
          <button type="button" data-step="-1" aria-label="কমান">−</button>
          <input type="number" min="1" max="${Math.min(p.stock, 99)}" value="1" aria-label="পরিমাণ">
          <button type="button" data-step="1" aria-label="বাড়ান">+</button>
        </div>
        <button class="btn btn-add btn-lg" data-add="${p.id}" data-name="${p.name}" data-with-qty>কার্টে যোগ করুন</button>
        <button class="btn btn-amber btn-lg" data-add="${p.id}" data-name="${p.name}" data-with-qty data-buy-now>এখনই কিনুন</button>
      </div>`}
      <ul class="pdp-facts">
        <li>🚚 ঢাকায় ডেলিভারি ${money(settings.delivery_dhaka)}, ঢাকার বাইরে ${money(settings.delivery_outside)}</li>
        <li>💵 পণ্য হাতে পেয়ে টাকা দিন</li>
        ${settings.phone ? html`<li>📞 প্রশ্ন থাকলে কল করুন: <a href="tel:${settings.phone}">${settings.phone}</a></li>` : ''}
      </ul>
      ${p.description ? html`<div class="pdp-desc"><h2>পণ্যের বিবরণ</h2>${raw(p.description.split(/\n+/).map((line) => `<p>${esc(line)}</p>`).join(''))}</div>` : ''}
    </div>
  </div>
  ${related.length ? html`<div class="section-head"><h2>একই রকম আরও পণ্য</h2></div>${productGrid(related)}` : ''}
</div>`;
}

function cartPage({ settings }) {
  return html`<div class="wrap section narrow">
  <h1>আপনার কার্ট</h1>
  <div id="cart-root" data-cart-page data-free-min="${settings.free_delivery_min}">
    <p class="muted">লোড হচ্ছে…</p>
  </div>
</div>`;
}

function checkoutPage({ settings }) {
  return html`<div class="wrap section">
  <h1>অর্ডার করুন</h1>
  <div class="checkout" data-checkout
       data-dhaka="${settings.delivery_dhaka}" data-outside="${settings.delivery_outside}" data-free-min="${settings.free_delivery_min}">
    <form class="form panel" id="checkout-form" novalidate>
      <h2>ডেলিভারির তথ্য</h2>
      <div class="field">
        <label for="name">আপনার নাম</label>
        <input id="name" name="name" required autocomplete="name" maxlength="80">
      </div>
      <div class="field">
        <label for="phone">মোবাইল নম্বর</label>
        <input id="phone" name="phone" required inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" maxlength="20">
        <small>এই নম্বরে কল করে অর্ডার কনফার্ম করা হবে।</small>
      </div>
      <fieldset class="field">
        <legend>ডেলিভারি এলাকা</legend>
        <label class="radio"><input type="radio" name="area" value="dhaka" checked> ঢাকা সিটির ভেতরে <b>${money(settings.delivery_dhaka)}</b></label>
        <label class="radio"><input type="radio" name="area" value="outside"> ঢাকার বাইরে <b>${money(settings.delivery_outside)}</b></label>
      </fieldset>
      <div class="field">
        <label for="address">পূর্ণ ঠিকানা</label>
        <textarea id="address" name="address" rows="3" required maxlength="400" placeholder="বাসা/রোড, এলাকা, থানা, জেলা"></textarea>
      </div>
      <div class="field">
        <label for="note">বিশেষ নির্দেশনা (ঐচ্ছিক)</label>
        <input id="note" name="note" maxlength="300">
      </div>
      <p class="form-error" data-error hidden></p>
      <button class="btn btn-amber btn-lg btn-block" type="submit" data-submit>অর্ডার কনফার্ম করুন</button>
      <p class="muted small center">পেমেন্ট: ক্যাশ অন ডেলিভারি। পণ্য হাতে পেয়ে টাকা দেবেন।</p>
    </form>
    <aside class="panel summary" aria-label="অর্ডারের সারাংশ">
      <h2>অর্ডারের সারাংশ</h2>
      <div data-summary><p class="muted">লোড হচ্ছে…</p></div>
    </aside>
  </div>
</div>`;
}

const STEPS = ['pending', 'confirmed', 'shipped', 'delivered'];

function orderPage({ order, settings, fresh }) {
  const cancelled = order.status === 'cancelled';
  const at = STEPS.indexOf(order.status);
  return html`<div class="wrap section narrow">
  ${fresh ? html`<div class="success-banner" data-clear-cart>
    <h1>ধন্যবাদ, ${order.customer_name}! আপনার অর্ডার পেয়েছি।</h1>
    <p>শীঘ্রই আমরা <b>${order.phone}</b> নম্বরে কল করে অর্ডার কনফার্ম করব।</p>
  </div>` : html`<h1>অর্ডারের অবস্থা</h1>`}
  <div class="panel">
    <div class="order-meta">
      <div><span class="muted">অর্ডার নম্বর</span><b class="order-code">${order.code}</b></div>
      <div><span class="muted">তারিখ</span><b>${fmtDate(order.created_at)}</b></div>
      <div><span class="muted">মোট</span><b>${money(order.total)}</b></div>
    </div>
    ${cancelled
    ? html`<p class="status-cancelled">এই অর্ডারটি বাতিল করা হয়েছে।</p>`
    : html`<ol class="steps">${STEPS.map((s, i) => html`<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${STATUSES[s]}</li>`)}</ol>`}
    ${fresh ? html`<p class="muted small">অর্ডার নম্বরটি লিখে রাখুন। পরে <a href="/track">অর্ডার ট্র্যাক</a> পেজে এটা দিয়ে অবস্থা দেখতে পারবেন।</p>` : ''}
  </div>
  <div class="panel">
    <h2>পণ্যসমূহ</h2>
    <table class="lines">
      <tbody>
      ${order.items.map((it) => html`<tr><td>${it.name} <span class="muted">× ${bn(it.qty)}</span></td><td class="num">${money(it.price * it.qty)}</td></tr>`)}
      </tbody>
      <tfoot>
        <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
        <tr><td>ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
        <tr class="total"><td>মোট (ক্যাশ অন ডেলিভারি)</td><td class="num">${money(order.total)}</td></tr>
      </tfoot>
    </table>
    <p class="muted small">ডেলিভারি ঠিকানা: ${order.address}</p>
  </div>
  <p class="center"><a class="btn" href="/products">আরও কেনাকাটা করুন</a>
  ${settings.phone ? html` <a class="btn btn-ghost" href="tel:${settings.phone}">কল করুন</a>` : ''}</p>
</div>`;
}

function trackPage({ error, code, phone }) {
  return html`<div class="wrap section narrow">
  <h1>অর্ডার ট্র্যাক করুন</h1>
  <form class="form panel" method="get" action="/track">
    <p class="muted">অর্ডার করার পর যে নম্বর পেয়েছিলেন (যেমন SM7K2P9Q) আর আপনার মোবাইল নম্বর দিন।</p>
    <div class="field">
      <label for="code">অর্ডার নম্বর</label>
      <input id="code" name="code" required value="${code || ''}" autocapitalize="characters" placeholder="SM…">
    </div>
    <div class="field">
      <label for="tphone">মোবাইল নম্বর</label>
      <input id="tphone" name="phone" required inputmode="tel" value="${phone || ''}" placeholder="01XXXXXXXXX">
    </div>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block" type="submit">অবস্থা দেখুন</button>
  </form>
</div>`;
}

function notFound() {
  return html`<div class="wrap section narrow center">
  <h1>পেজটি পাওয়া যায়নি</h1>
  <p class="muted">লিংকটি ভুল হতে পারে, অথবা পণ্যটি সরিয়ে ফেলা হয়েছে।</p>
  <p><a class="btn" href="/">হোমে ফিরে যান</a></p>
</div>`;
}

module.exports = { home, listing, productPage, cartPage, checkoutPage, orderPage, trackPage, notFound, productCard };

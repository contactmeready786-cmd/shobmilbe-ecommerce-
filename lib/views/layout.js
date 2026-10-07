'use strict';
const { html, raw } = require('../util');

const ASSET_V = '1';

function head(title, description) {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description || ''}">
<meta name="theme-color" content="#0866D6">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=${ASSET_V}">`;
}

function logo(settings) {
  const name = settings.store_name || 'সবমিলবে';
  // The brand mark splits "সবমিলবে" into two colours, like the original logo.
  if (name === 'সবমিলবে') return html`<span class="logo-a">সব</span><span class="logo-b">মিলবে</span>`;
  return html`<span class="logo-a">${name}</span>`;
}

function shopLayout({ settings, title, description, body, q, active }) {
  const full = title ? `${title} | ${settings.store_name}` : `${settings.store_name} | অনলাইন শপ`;
  return '<!doctype html>' + html`<html lang="bn">
<head>${head(full, description || settings.tagline)}</head>
<body class="shop">
<a class="skip" href="#main">মূল অংশে যান</a>
${settings.notice ? html`<div class="notice">${settings.notice}</div>` : ''}
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="/" aria-label="${settings.store_name} হোম">${logo(settings)}</a>
    <form class="search" action="/products" method="get" role="search">
      <label class="sr" for="q">পণ্য খুঁজুন</label>
      <input id="q" name="q" type="search" value="${q || ''}" placeholder="পণ্যের নাম লিখুন, যেমন: capacitor" autocomplete="off">
      <button type="submit" aria-label="খুঁজুন">${raw(icons.search)}</button>
    </form>
    <nav class="header-nav" aria-label="প্রধান মেনু">
      <a href="/products" class="${active === 'products' ? 'on' : ''}">সব পণ্য</a>
      <a href="/track" class="${active === 'track' ? 'on' : ''}">অর্ডার ট্র্যাক</a>
      <a href="/cart" class="cart-link ${active === 'cart' ? 'on' : ''}">${raw(icons.cart)}<span>কার্ট</span><b class="cart-count" data-cart-count hidden>0</b></a>
    </nav>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo logo-sm" href="/">${logo(settings)}</a>
      <p>${settings.tagline}</p>
    </div>
    <div>
      <h2>কেনাকাটা</h2>
      <a href="/products">সব পণ্য</a>
      <a href="/cart">কার্ট</a>
      <a href="/track">অর্ডার ট্র্যাক করুন</a>
    </div>
    <div>
      <h2>যোগাযোগ</h2>
      ${settings.phone ? html`<a href="tel:${settings.phone}">📞 ${settings.phone}</a>` : html`<span class="muted">ফোন নম্বর শীঘ্রই যোগ হবে</span>`}
      ${settings.whatsapp ? html`<a href="https://wa.me/${settings.whatsapp.replace(/\D/g, '').replace(/^0/, '880')}" rel="noopener">💬 WhatsApp</a>` : ''}
      <span class="muted">পেমেন্ট: ক্যাশ অন ডেলিভারি</span>
    </div>
  </div>
  <div class="wrap footer-base">© ${new Date().getFullYear()} ${settings.store_name}</div>
</footer>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script src="/js/shop.js?v=${ASSET_V}" defer></script>
</body></html>`.s;
}

function adminLayout({ settings, title, body, active, bare }) {
  const nav = [
    ['/admin', 'ড্যাশবোর্ড', 'home'],
    ['/admin/orders', 'অর্ডার', 'orders'],
    ['/admin/products', 'পণ্য', 'products'],
    ['/admin/categories', 'ক্যাটাগরি', 'categories'],
    ['/admin/settings', 'সেটিংস', 'settings'],
  ];
  return '<!doctype html>' + html`<html lang="bn">
<head>${head(`${title} | Admin`, '')}<meta name="robots" content="noindex"></head>
<body class="admin">
${bare ? html`<main class="admin-bare">${body}</main>` : html`
<header class="admin-top">
  <a class="logo logo-sm" href="/admin">${logo(settings)}<small>Admin</small></a>
  <nav aria-label="Admin মেনু">
    ${nav.map(([href, label, key]) => html`<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`)}
  </nav>
  <div class="admin-top-end">
    <a href="/" target="_blank" rel="noopener">দোকান দেখুন ↗</a>
    <form method="post" action="/admin/logout"><button class="link-btn">লগআউট</button></form>
  </div>
</header>
<main class="admin-main">${body}</main>`}
<script src="/js/admin.js?v=${ASSET_V}" defer></script>
</body></html>`.s;
}

const icons = {
  search: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m20 20-3.6-3.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 4h2.2l2.2 11h10.4l2-8H6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="9.5" cy="19.5" r="1.6" fill="currentColor"/><circle cx="16.5" cy="19.5" r="1.6" fill="currentColor"/></svg>',
};

module.exports = { shopLayout, adminLayout, icons };

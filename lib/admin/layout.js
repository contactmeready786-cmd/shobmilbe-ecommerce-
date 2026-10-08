'use strict';
const { html, raw } = require('../util');
const { can } = require('../models/staff');

const ASSET_V = '20';

// The admin menu. Each link: [href, label, permission, key]
const MENU = [
  { title: '', items: [['/admin', 'ড্যাশবোর্ড', 'dashboard', 'home', '📊']] },
  { title: 'বিক্রি', icon: '🛍️', items: [
    ['/admin/orders', 'অর্ডার', 'orders', 'orders', '🧾'],
    ['/admin/orders/new', 'নতুন অর্ডার তৈরি', 'orders_edit', 'order-new', '➕'],
  ] },
  { title: 'কাস্টমার', icon: '👥', items: [
    ['/admin/customers', 'সব কাস্টমার', 'customers', 'customers', '👤'],
    ['/admin/blocklist', 'ব্লক লিস্ট (ফ্রড)', 'customers', 'blocklist', '⛔'],
  ] },
  { title: 'পণ্য', icon: '📦', items: [
    ['/admin/products', 'সব পণ্য', 'products', 'products', '📦'],
    ['/admin/products/new', 'নতুন পণ্য আপলোড', 'products', 'product-new', '⬆️'],
    ['/admin/products/import', 'পণ্য আমদানি (কপি করে আনুন)', 'products', 'product-import', '📥'],
    ['/admin/products/more-photos', 'পুরোনো সাইট থেকে আরও ছবি', 'products', 'more-pics', '📸'],
    ['/admin/products?type=bundle', 'বান্ডেল / প্যাকেজ', 'products', 'bundles', '🎁'],
    ['/admin/categories', 'ক্যাটাগরি', 'products', 'categories', '🗂️'],
    ['/admin/products/duplicates', 'ডুপ্লিকেট পণ্য', 'products', 'duplicates', '👯'],
    ['/admin/products/watermark', 'ওয়াটারমার্ক', 'products', 'watermark', '💧'],
  ] },
  { title: 'স্টক ও কেনাকাটা', icon: '🏬', items: [
    ['/admin/inventory', 'ইনভেন্টরি (স্টক)', 'inventory', 'inventory', '🏬'],
    ['/admin/purchases', 'পারচেজ (মাল কেনা)', 'inventory', 'purchases', '🛒'],
    ['/admin/suppliers', 'সাপ্লায়ার', 'inventory', 'suppliers', '🚚'],
  ] },
  { title: 'মার্কেটিং', icon: '📣', items: [
    ['/admin/growth', 'গ্রোথ গাইড (বিক্রি বাড়ান)', 'owner', 'growth', '🚀'],
    ['/admin/research', 'মার্কেট রিসার্চ (উইনিং প্রোডাক্ট)', 'owner', 'research', '🔭'],
    ['/admin/marketing/visitors', 'ভিজিটর অ্যানালিটিক্স', 'marketing', 'visitors', '👀'],
    ['/admin/marketing/tracking', 'পিক্সেল ও ট্র্যাকিং', 'marketing', 'tracking', '📈'],
    ['/admin/marketing/seo', 'SEO', 'marketing', 'seo', '🔎'],
    ['/admin/marketing/coupons', 'কুপন ও অফার', 'marketing', 'coupons', '🏷️'],
    ['/admin/marketing/social', 'সোশ্যাল ও লাইভ চ্যাট', 'marketing', 'social', '💬'],
    ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড (Google/Facebook)', 'marketing', 'feeds', '🔗'],
    ['/admin/blog', 'ব্লগ', 'blog', 'blog', '📝'],
  ] },
  { title: 'স্টোর ডিজাইন', icon: '🎨', items: [
    ['/admin/design', 'লোগো, রং ও হোমপেজ', 'design', 'design', '🎨'],
    ['/admin/design/banners', 'ব্যানার', 'design', 'banners', '🖼️'],
    ['/admin/design/menus', 'হেডার ও ফুটার মেনু', 'design', 'menus', '🧭'],
    ['/admin/design/pages', 'পেজ (About, Policy)', 'design', 'pages', '📄'],
    ['/admin/design/live', 'লাইভ খেলার স্কোর', 'design', 'live', '🏏'],
  ] },
  { title: 'হিসাব', icon: '💰', items: [
    ['/admin/accounts', 'হিসাবের সারাংশ', 'accounting', 'acc-home', '💰'],
    ['/admin/accounts/transactions', 'আয়-ব্যয় এন্ট্রি', 'accounting', 'acc-tx', '✍️'],
    ['/admin/accounts/banks', 'ব্যাংক ও ক্যাশ ব্যালেন্স', 'accounting', 'acc-banks', '🏦'],
    ['/admin/accounts/pnl', 'লাভ-ক্ষতি', 'see_cost', 'acc-pnl', '📉'],
    ['/admin/accounts/vat', 'ভ্যাট ও ট্যাক্স', 'accounting', 'acc-vat', '🧮'],
  ] },
  { title: 'স্টাফ ও রিপোর্ট', icon: '🧑‍💼', items: [
    ['/admin/staff', 'স্টাফ', 'owner', 'staff', '🧑‍💼'],
    ['/admin/reports', 'রিপোর্ট', 'reports', 'reports', '📋'],
  ] },
  { title: 'ইন্টিগ্রেশন ও সেটিংস', icon: '⚙️', items: [
    ['/admin/integrations/courier', 'কুরিয়ার (Pathao, Steadfast…)', 'settings', 'courier', '🛵'],
    ['/admin/integrations/payments', 'পেমেন্ট (বিকাশ, নগদ, কার্ড)', 'settings', 'payments', '💳'],
    ['/admin/integrations/domain', 'ডোমেইন সেটআপ', 'settings', 'domain', '🌐'],
    ['/admin/settings', 'সেটিংস', 'settings', 'settings', '⚙️'],
    ['/admin/security', 'নিরাপত্তা', 'owner', 'security', '🛡️'],
  ] },
  { title: '', items: [['/admin/trash', 'স্থায়ীভাবে মুছে ফেলুন (রিসাইকেল বিন)', 'owner', 'trash', '🗑️']] },
];

function allowed(user, perm) {
  if (perm === 'owner') return user && user.role === 'owner';
  return can(user, perm);
}

function head(title, settings) {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#14213D">
<link rel="icon" href="${settings.favicon_id ? `/media/${settings.favicon_id}/t` : '/favicon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=${ASSET_V}">
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_V}">`;
}

function logoMark(settings) {
  if (settings.logo_id) return html`<img class="logo-img" src="/media/${settings.logo_id}" alt="${settings.store_name}">`;
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return html`<span class="logo-a">সব</span><span class="logo-b">মিলবে</span>`;
  return html`<span class="logo-a">${name}</span>`;
}

function adminLayout({ settings, user, title, body, active, bare }) {
  if (bare) {
    return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}</head>
<body class="admin admin-auth"><main class="admin-bare">${body}</main>
<script src="/js/admin.js?v=${ASSET_V}" defer></script></body></html>`.s;
  }
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((it) => allowed(user, it[2])) })).filter((g) => g.items.length);
  return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}</head>
<body class="admin">
<aside class="side" id="side" aria-label="Admin মেনু">
  <a class="side-logo logo" href="/admin">${logoMark(settings)}<small>Admin</small></a>
  <nav>
    ${groups.map((g) => {
    const link = ([href, label, , key, icon]) => html`<a href="${href}" class="${active === key ? 'on' : ''}"${active === key ? raw(' aria-current="page"') : ''}><span class="side-ic" aria-hidden="true">${icon}</span>${label}</a>`;
    if (!g.title) return html`<div class="side-group">${g.items.map(link)}</div>`;
    const here = g.items.some((it) => it[3] === active);
    return html`<details class="side-group side-drop ${here ? 'has-on' : ''}" data-side-group="${g.title}" ${here ? raw('open') : ''}>
      <summary><span class="side-ic" aria-hidden="true">${g.icon || '•'}</span><span class="side-label">${g.title}</span><span class="side-arrow" aria-hidden="true">${raw('<svg viewBox="0 0 24 24" width="16" height="16"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>')}</span></summary>
      <div class="side-sub">${g.items.map(link)}</div>
    </details>`;
  })}
  </nav>
</aside>
<div class="side-shade" data-side-close></div>
<div class="main-col">
  <header class="topbar">
    <button class="burger" type="button" data-side-open aria-label="মেনু খুলুন" aria-controls="side">${raw('<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>')}</button>
    <form class="top-search" method="get" action="/admin/orders" role="search">
      <input type="search" name="q" placeholder="অর্ডার নম্বর, ফোন বা নাম দিয়ে খুঁজুন" aria-label="অর্ডার খুঁজুন">
    </form>
    <div class="top-end">
      <a href="/" target="_blank" rel="noopener" class="top-link">দোকান দেখুন ↗</a>
      <details class="user-menu">
        <summary><span class="avatar">${(user.name || '?').slice(0, 1)}</span><span class="uname">${user.name}</span></summary>
        <div class="user-pop">
          <p><b>${user.name}</b><br><span class="muted small">${user.role === 'owner' ? 'মালিক (সব অনুমতি)' : 'স্টাফ'} · ${user.username}</span></p>
          <a href="/admin/account">আমার পাসওয়ার্ড বদলান</a>
          <form method="post" action="/admin/logout"><button class="link-btn danger">লগআউট</button></form>
        </div>
      </details>
    </div>
  </header>
  <main class="admin-main" id="main">${body}</main>
</div>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script src="/js/admin.js?v=${ASSET_V}" defer></script>
</body></html>`.s;
}

module.exports = { adminLayout, MENU, allowed, logoMark, ASSET_V };

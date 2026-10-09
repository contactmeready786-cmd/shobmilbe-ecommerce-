'use strict';
const { html, raw } = require('../util');
const { can, canSee } = require('../models/staff');

const ASSET_V = '31';

// The admin menu. Each link: [href, label, permission, key]
const MENU = [
  { title: '', items: [['/admin', 'ড্যাশবোর্ড', 'dashboard', 'home', '📊']] },
  // everyday work first: orders and the people who order
  { title: 'অর্ডার ও কাস্টমার', icon: '🛍️', items: [
    ['/admin/orders', 'অর্ডার', 'orders', 'orders', '🧾'],
    ['/admin/orders/new', 'নতুন অর্ডার তৈরি', 'orders_edit', 'order-new', '➕'],
    ['/admin/orders/incomplete', 'অসম্পূর্ণ অর্ডার (কল করুন)', 'orders', 'drafts', '📝'],
    ['/admin/customers', 'সব কাস্টমার', 'customers', 'customers', '👤'],
    ['/admin/blocklist', 'ব্লক লিস্ট (ফ্রড)', 'customers', 'blocklist', '⛔'],
  ] },
  // products: the lists first, then the tools
  { title: 'পণ্য', icon: '📦', items: [
    ['/admin/products', 'সব পণ্য', 'products', 'products', '📦'],
    ['/admin/products/new', 'নতুন পণ্য আপলোড', 'products', 'product-new', '⬆️'],
    ['/admin/products?type=bundle', 'বান্ডেল / প্যাকেজ', 'products', 'bundles', '🎁'],
    ['/admin/categories', 'ক্যাটাগরি', 'products', 'categories', '🗂️'],
    ['/admin/brands', 'ব্র্যান্ড', 'products', 'brands', '🏷️'],
    ['/admin/products/import', 'পণ্য আমদানি (কপি করে আনুন)', 'products', 'product-import', '📥'],
    ['/admin/products/more-photos', 'পুরোনো সাইট থেকে সব পণ্য ও ছবি', 'products', 'more-pics', '📸'],
    ['/admin/products/duplicates', 'ডুপ্লিকেট পণ্য', 'products', 'duplicates', '👯'],
    ['/admin/products/watermark', 'ওয়াটারমার্ক', 'products', 'watermark', '💧'],
  ] },
  { title: 'স্টক ও কেনাকাটা', icon: '🏬', items: [
    ['/admin/inventory', 'ইনভেন্টরি (স্টক)', 'inventory', 'inventory', '🏬'],
    ['/admin/purchases', 'পারচেজ (মাল কেনা)', 'inventory', 'purchases', '🛒'],
    ['/admin/suppliers', 'সাপ্লায়ার', 'inventory', 'suppliers', '🚚'],
  ] },
  { title: 'হিসাব', icon: '💰', items: [
    ['/admin/accounts', 'হিসাবের সারাংশ', 'accounting', 'acc-home', '💰'],
    ['/admin/accounts/transactions', 'আয়-ব্যয় এন্ট্রি', 'accounting', 'acc-tx', '✍️'],
    ['/admin/accounts/banks', 'ব্যাংক ও ক্যাশ ব্যালেন্স', 'accounting', 'acc-banks', '🏦'],
    ['/admin/accounts/pnl', 'লাভ-ক্ষতি', 'see_cost', 'acc-pnl', '📉'],
    ['/admin/accounts/vat', 'ভ্যাট ও ট্যাক্স', 'accounting', 'acc-vat', '🧮'],
  ] },
  // everything that tells you how the shop is doing and what to do next
  { title: 'রিপোর্ট ও গ্রোথ', icon: '📈', items: [
    ['/admin/reports', 'বিক্রির রিপোর্ট', 'reports', 'reports', '📋'],
    ['/admin/marketing/visitors', 'ভিজিটর অ্যানালিটিক্স', 'marketing', 'visitors', '👀'],
    ['/admin/research', 'মার্কেট রিসার্চ (উইনিং প্রোডাক্ট)', 'owner', 'research', '🔭'],
    ['/admin/reach', 'কাস্টমারের কাছে পৌঁছান (রিটার্গেটিং)', 'owner', 'reach', '🎯'],
    ['/admin/growth', 'গ্রোথ গাইড (বিক্রি বাড়ান)', 'owner', 'growth', '🚀'],
  ] },
  { title: 'মার্কেটিং', icon: '📣', items: [
    ['/admin/marketing/flash', 'ফ্ল্যাশ সেল ও অফার', 'marketing', 'flash', '⚡'],
    ['/admin/marketing/coupons', 'কুপন', 'marketing', 'coupons', '🏷️'],
    ['/admin/reviews', 'রিভিউ ও পছন্দের তালিকা', 'reviews', 'reviews', '⭐'],
    ['/admin/marketing/loyalty', 'লয়ালটি পয়েন্ট', 'marketing', 'loyalty', '🎖️'],
    ['/admin/marketing/sms', 'কাস্টমারকে SMS', 'marketing', 'sms', '📱'],
    ['/admin/marketing/tracking', 'পিক্সেল ও ট্র্যাকিং', 'marketing', 'tracking', '🎯'],
    ['/admin/integrations/status', 'সংযোগের অবস্থা (Google, Facebook, পিক্সেল)', 'settings', 'status', '🔌'],
    ['/admin/marketing/seo', 'SEO', 'marketing', 'seo', '🔎'],
    ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড (Google/Facebook)', 'marketing', 'feeds', '🔗'],
    ['/admin/marketing/social', 'সোশ্যাল ও লাইভ চ্যাট', 'marketing', 'social', '💬'],
    ['/admin/blog', 'ব্লগ', 'blog', 'blog', '📝'],
  ] },
  { title: 'স্টোর ডিজাইন', icon: '🎨', items: [
    ['/admin/design', 'লোগো, রং ও হোমপেজ', 'design', 'design', '🎨'],
    ['/admin/design/rows', 'হোমপেজের সারি (নিজের সারি বানান)', 'design', 'home-rows', '🏠'],
    ['/admin/design/switches', 'দোকানে কী দেখাবে (চালু/বন্ধ)', 'design', 'ui-switches', '👁️'],
    ['/admin/design/banners', 'ব্যানার', 'design', 'banners', '🖼️'],
    ['/admin/design/menus', 'হেডার ও ফুটার মেনু', 'design', 'menus', '🧭'],
    ['/admin/design/pages', 'পেজ (About, Policy)', 'design', 'pages', '📄'],
    ['/admin/design/live', 'লাইভ খেলার স্কোর', 'design', 'live', '🏏'],
    ['/admin/design/language', 'ভাষা (বাংলা / English)', 'design', 'language', '🌐'],
  ] },
  // how the shop connects to the outside: payment, courier, messages, domain
  { title: 'সেটিংস ও সংযোগ', icon: '⚙️', items: [
    ['/admin/settings', 'সাধারণ সেটিংস', 'settings', 'settings', '⚙️'],
    ['/admin/integrations/payments', 'পেমেন্ট (বিকাশ, নগদ, কার্ড)', 'settings', 'payments', '💳'],
    ['/admin/integrations/courier', 'কুরিয়ার (Pathao, Steadfast…)', 'settings', 'courier', '🛵'],
    ['/admin/notify', 'নোটিফিকেশন (ইমেইল ও WhatsApp)', 'owner', 'notify', '🔔'],
    ['/admin/integrations/domain', 'ডোমেইন সেটআপ', 'settings', 'domain', '🌐'],
  ] },
  // who can get in, and what they may do
  { title: 'স্টাফ ও নিরাপত্তা', icon: '🛡️', items: [
    ['/admin/staff', 'স্টাফ ও অনুমতি', 'owner', 'staff', '🧑‍💼'],
    ['/admin/security', 'নিরাপত্তা', 'owner', 'security', '🛡️'],
    ['/admin/security/audit', 'অডিট লগ (কে কী বদলেছে)', 'owner', 'audit', '📜'],
    ['/admin/security/logins', 'লগইন ইতিহাস ও ডিভাইস', 'owner', 'logins', '🔑'],
    ['/admin/security/threats', 'সন্দেহজনক ভিজিটর', 'owner', 'threats', '🚨'],
    ['/admin/security/login', 'লগইন তালা (আঙুল ও মুখ)', 'owner', 'loginlock', '🔐'],
    ['/admin/security/recovery', 'জরুরি রিকভারি কোড', 'owner', 'recovery', '🆘'],
    ['/admin/backup', 'ব্যাকআপ ও রিস্টোর', 'owner', 'backup', '💾'],
  ] },
  { title: '', items: [['/admin/trash', 'স্থায়ীভাবে মুছে ফেলুন (রিসাইকেল বিন)', 'owner', 'trash', '🗑️']] },
];

function allowed(user, perm) {
  if (perm === 'owner') return user && user.role === 'owner';
  return can(user, perm);
}
// menu items: shown when any level (see / add / edit / delete) of the permission is given
function visible(user, perm) { return canSee(user, perm); }

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
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_V}">
<link rel="manifest" href="/admin.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">`;
}

function logoMark(settings) {
  if (settings.logo_id) return html`<img class="logo-img" src="/media/${settings.logo_id}" alt="${settings.store_name}">`;
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return html`<span class="logo-a">সব</span><span class="logo-b">মিলবে</span>`;
  return html`<span class="logo-a">${name}</span>`;
}

// বাংলা ⇄ English for the admin itself (Admin → স্টোর ডিজাইন → ভাষা → "অ্যাডমিন প্যানেলেও বাংলা / English").
// The choice lives on each device; the page is hidden for a moment while it turns English (no Bangla flash).
const adminLangOn = (settings) => settings.admin_i18n_on !== '0';
function langHead(settings) {
  if (!adminLangOn(settings)) return '';
  return raw(`<script>(function(){try{if(localStorage.getItem('sm_admin_lang')==='en'){var d=document.documentElement;d.className+=' admin-i18n-wait';d.setAttribute('data-admin-lang','en');}}catch(e){}})();</script><style>html.admin-i18n-wait body{visibility:hidden}</style>`);
}
function langScript(settings) {
  if (!adminLangOn(settings)) return '';
  return html`<script src="/js/admin-i18n.js?v=${ASSET_V}" defer data-admin-i18n data-v="${ASSET_V}"></script>`;
}
function langSwitch(settings) {
  if (!adminLangOn(settings)) return '';
  return html`<button type="button" class="lang-sw admin-lang-sw" role="switch" aria-checked="false" aria-label="English" title="বাংলা / English" translate="no" data-admin-lang-switch>
    <span class="ls-l ls-bn">বাং</span><span class="ls-track" aria-hidden="true"><span class="ls-knob"></span></span><span class="ls-l ls-en">EN</span>
  </button>`;
}

function adminLayout({ settings, user, title, body, active, bare, readOnly }) {
  if (bare) {
    return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}${langHead(settings)}</head>
<body class="admin admin-auth">${adminLangOn(settings) ? html`<div class="bare-lang">${langSwitch(settings)}</div>` : ''}<main class="admin-bare">${body}</main>
<script src="/js/admin.js?v=${ASSET_V}" defer></script>${langScript(settings)}</body></html>`.s;
  }
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((it) => visible(user, it[2])) })).filter((g) => g.items.length);
  return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}${langHead(settings)}</head>
<body class="admin">
<aside class="side" id="side" aria-label="Admin মেনু">
  <a class="side-logo logo" href="/admin" translate="no">${logoMark(settings)}<small>Admin</small></a>
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
      ${langSwitch(settings)}
      <a href="/" target="_blank" rel="noopener" class="top-link">দোকান দেখুন ↗</a>
      <details class="user-menu">
        <summary>${require('./profile').avatar(user)}<span class="uname" translate="no">${user.name}</span></summary>
        <div class="user-pop">
          <div class="user-pop-head">${require('./profile').avatar(user, 'avatar-lg')}<p><b translate="no">${user.name}</b><br><span class="muted small">${user.designation || (user.role === 'owner' ? 'মালিক (সব অনুমতি)' : 'স্টাফ')} · ${user.username}</span></p></div>
          <a href="/admin/account#profile">👤 আমার প্রোফাইল</a>
          <a href="/admin/account">🔑 পাসওয়ার্ড ও নিরাপত্তা</a>
          <form method="post" action="/admin/logout"><button class="link-btn danger">লগআউট</button></form>
        </div>
      </details>
    </div>
  </header>
  <main class="admin-main" id="main">${readOnly ? html`<p class="flash read-only-note" role="note">👁️ এই পেজে আপনার শুধু <b>দেখার</b> অনুমতি আছে — কিছু সেভ, বদল বা মুছতে পারবেন না।</p>` : ''}${body}</main>
</div>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script src="/js/admin.js?v=${ASSET_V}" defer></script>${langScript(settings)}
</body></html>`.s;
}

module.exports = { adminLayout, MENU, allowed, visible, logoMark, ASSET_V };

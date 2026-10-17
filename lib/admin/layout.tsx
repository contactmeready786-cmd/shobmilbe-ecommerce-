import { toHtml, Val, RawHtml, attrValue, htmlValue, attrProps, jsxList } from '../react/html';
import { cspNonce } from '../security';
import { html, raw } from '../util';
import { can, canSee } from '../models/staff';
import * as $profile from './profile';
import type { Body, Id, Loose, Settings, StaffUser } from '../types';

const ASSET_V = '54';

// 📑 Small jobs that belong together sit on one page as tabs (like browser tabs). Each tab is still its own
// page with its own link (bookmarks and the phone app keep working); the menu shows one entry for the set.
// Each tab: [href, label, permission, key, icon]
const TABS: Record<string, Loose> = {
  returns: [
    ['/admin/returns', 'রিটার্ন ও রিফান্ড', 'orders', 'returns', '↩️'],
    ['/admin/complaints', 'অভিযোগ (৭২ ঘণ্টা)', 'orders', 'complaints', '📮'],
  ],
  fake: [
    ['/admin/checkout-otp', 'চেকআউট OTP', 'settings', 'checkout-otp', '📲'],
    ['/admin/autocall', 'অটো কল', 'owner', 'autocall', '📞'],
    ['/admin/fraud', 'ফ্রড চেক (কুরিয়ার রেকর্ড)', 'orders', 'fraud', '🛡️'],
    ['/admin/blocklist', 'ব্লক লিস্ট', 'customers', 'blocklist', '⛔'],
  ],
  reviews: [
    ['/admin/reviews', 'রিভিউ ও পছন্দের তালিকা', 'reviews', 'reviews', '⭐'],
    ['/admin/questions', 'প্রশ্ন-উত্তর', 'reviews', 'questions', '❓'],
  ],
  products: [
    ['/admin/products', 'সব পণ্য', 'products', 'products', '📦'],
    ['/admin/products?type=bundle', 'বান্ডেল / প্যাকেজ', 'products', 'bundles', '🎁'],
  ],
  catbrand: [
    ['/admin/categories', 'ক্যাটাগরি', 'products', 'categories', '🗂️'],
    ['/admin/brands', 'ব্র্যান্ড', 'products', 'brands', '🏷️'],
  ],
  pictools: [
    ['/admin/products/watermark', 'ওয়াটারমার্ক', 'products', 'watermark', '💧'],
    ['/admin/products/duplicates', 'ডুপ্লিকেট পণ্য', 'products', 'duplicates', '👯'],
    ['/admin/products/source-pics', 'অন্য দোকানের ছবি', 'products', 'source-pics', '🚩'],
  ],
  suppliers: [
    ['/admin/suppliers', 'সাপ্লায়ার', 'inventory', 'suppliers', '🚚'],
    ['/admin/suppliers/dues', 'বাকির খাতা', 'see_cost', 'supplier-dues', '📒'],
  ],
  messages: [
    ['/admin/marketing/sms', 'SMS', 'marketing', 'sms', '📱'],
    ['/admin/marketing/email', 'ইমেইল', 'marketing', 'email', '📧'],
    ['/admin/marketing/push', 'ফোনে নোটিফিকেশন', 'marketing', 'shoppush', '🔔'],
    ['/admin/marketing/restock', 'স্টকে এলে / দাম কমলে জানাও', 'marketing', 'restock', '⏰'],
  ],
  gfb: [
    ['/admin/marketing/seo', 'SEO', 'marketing', 'seo', '🔎'],
    ['/admin/marketing/autoseo', 'অটো SEO', 'marketing', 'autoseo', '🤖'],
    ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড', 'marketing', 'feeds', '🔗'],
    ['/admin/marketing/tracking', 'পিক্সেল ও ট্র্যাকিং', 'marketing', 'tracking', '🎯'],
    ['/admin/integrations/status', 'সংযোগের অবস্থা', 'settings', 'status', '🔌'],
  ],
  system: [
    ['/admin/health', 'সার্ভার ও ডাটাবেস', 'owner', 'health', '🩺'],
    ['/admin/backup', 'ব্যাকআপ ও রিস্টোর', 'owner', 'backup', '💾'],
  ],
  slides: [
    ['/admin/design/slider', 'রানিং স্লাইডার', 'design', 'slider', '🎞️'],
    ['/admin/design/banners', 'ব্যানার', 'design', 'banners', '🖼️'],
  ],
  menupages: [
    ['/admin/design/menus', 'হেডার ও ফুটার মেনু', 'design', 'menus', '🧭'],
    ['/admin/design/pages', 'পেজ (About, Policy)', 'design', 'pages', '📄'],
  ],
  domain: [
    ['/admin/integrations/domain', 'ডোমেইন সেটআপ', 'settings', 'domain', '🌐'],
    ['/admin/integrations/dns', 'DNS ও Cloudflare', 'owner', 'dns', '🛰️'],
  ],
  login: [
    ['/admin/security/login', 'লগইন তালা (আঙুলের ছাপ)', 'owner', 'loginlock', '🔐'],
    ['/admin/security/logins', 'লগইন ইতিহাস ও ডিভাইস', 'owner', 'logins', '🔑'],
    ['/admin/security/recovery', 'জরুরি রিকভারি কোড', 'owner', 'recovery', '🆘'],
  ],
};
const tabSet = (id?: Id, label?: Loose, icon?: Loose) => ({ tabs: id, label, icon });

// The admin menu: everyday work at the top, things set up once at the bottom.
// Each link: [href, label, permission, key, icon], or tabSet(...) for a page with tabs.
const MENU = [
  { title: '', items: [['/admin', 'ড্যাশবোর্ড', 'dashboard', 'home', '📊']] },
  { title: 'অর্ডার', icon: '🧾', items: [
    ['/admin/orders', 'সব অর্ডার', 'orders', 'orders', '🧾'],
    ['/admin/orders/new', 'নতুন অর্ডার', 'orders_edit', 'order-new', '➕'],
    ['/admin/pos', 'দোকানে বিক্রি (POS)', 'pos', 'pos', '🏪'],
    ['/admin/orders/incomplete', 'অসম্পূর্ণ অর্ডার', 'orders', 'drafts', '📝'],
    ['/admin/handover', 'কুরিয়ারে হ্যান্ডওভার', 'orders_edit', 'handover', '📦'],
    tabSet('returns', 'রিটার্ন ও অভিযোগ', '↩️'),
  ] },
  { title: 'কাস্টমার', icon: '👤', items: [
    ['/admin/customers', 'সব কাস্টমার', 'customers', 'customers', '👤'],
    ['/admin/customer-accounts', 'কাস্টমার অ্যাকাউন্ট', 'settings', 'cust-accounts', '🔐'],
    tabSet('reviews', 'রিভিউ ও প্রশ্ন-উত্তর', '⭐'),
    tabSet('fake', 'ফেক অর্ডার ঠেকানো', '🛡️'),
  ] },
  { title: 'পণ্য', icon: '📦', items: [
    tabSet('products', 'সব পণ্য', '📦'),
    ['/admin/products/new', 'নতুন পণ্য', 'products', 'product-new', '⬆️'],
    ['/admin/products/import', 'পণ্য আমদানি', 'products', 'product-import', '📥'],
    tabSet('catbrand', 'ক্যাটাগরি ও ব্র্যান্ড', '🗂️'),
    ['/admin/kits', 'প্রজেক্ট কিট', 'products', 'kits', '🧰'],
    tabSet('pictools', 'ওয়াটারমার্ক ও ডুপ্লিকেট', '💧'),
  ] },
  { title: 'স্টক ও কেনাকাটা', icon: '🏬', items: [
    ['/admin/inventory', 'ইনভেন্টরি (স্টক)', 'inventory', 'inventory', '🏬'],
    ['/admin/stock-scan', 'স্ক্যান করে স্টক', 'inventory', 'stock-scan', '📷'],
    ['/admin/purchases', 'পারচেজ (মাল কেনা)', 'inventory', 'purchases', '🛒'],
    tabSet('suppliers', 'সাপ্লায়ার ও বাকির খাতা', '🚚'),
    ['/admin/warehouses', 'গুদাম ও শাখা', 'inventory', 'warehouses', '🏗️'],
  ] },
  { title: 'হিসাব', icon: '💰', items: [
    ['/admin/accounts', 'হিসাবের সারাংশ', 'accounting', 'acc-home', '💰'],
    ['/admin/accounts/transactions', 'আয়-ব্যয় এন্ট্রি', 'accounting', 'acc-tx', '✍️'],
    ['/admin/accounts/banks', 'ব্যাংক ও ক্যাশ', 'accounting', 'acc-banks', '🏦'],
    ['/admin/accounts/cod', 'কুরিয়ারের COD মিলানো', 'accounting', 'acc-cod', '🚚'],
    ['/admin/accounts/pnl', 'লাভ-ক্ষতি', 'see_cost', 'acc-pnl', '📉'],
    ['/admin/accounts/vat', 'ভ্যাট ও ট্যাক্স', 'accounting', 'acc-vat', '🧮'],
  ] },
  { title: 'রিপোর্ট ও গ্রোথ', icon: '📈', items: [
    ['/admin/reports', 'বিক্রির রিপোর্ট', 'reports', 'reports', '📋'],
    ['/admin/reports/search', 'কাস্টমার কী খুঁজছে', 'reports', 'search-report', '🔎'],
    ['/admin/marketing/visitors', 'ভিজিটর অ্যানালিটিক্স', 'marketing', 'visitors', '👀'],
    ['/admin/research', 'মার্কেট রিসার্চ', 'owner', 'research', '🔭'],
    ['/admin/growth', 'গ্রোথ গাইড', 'owner', 'growth', '🚀'],
  ] },
  { title: 'অফার', icon: '🏷️', items: [
    ['/admin/marketing/flash', 'ফ্ল্যাশ সেল ও অফার', 'marketing', 'flash', '⚡'],
    ['/admin/marketing/coupons', 'কুপন', 'marketing', 'coupons', '🎟️'],
    ['/admin/giftcards', 'গিফট কার্ড ও রেফারেল', 'marketing', 'giftcards', '💳'],
    ['/admin/marketing/loyalty', 'লয়ালটি পয়েন্ট', 'marketing', 'loyalty', '🎖️'],
  ] },
  { title: 'মার্কেটিং', icon: '📣', items: [
    ['/admin/marketing/auto', 'অটো মার্কেটিং (Facebook)', 'marketing', 'automarketing', '🤖'],
    ['/admin/reach', 'রিটার্গেটিং', 'owner', 'reach', '🎯'],
    tabSet('messages', 'কাস্টমারকে মেসেজ', '📱'),
    ['/admin/marketing/social', 'সোশ্যাল ও লাইভ চ্যাট', 'marketing', 'social', '💬'],
    ['/admin/blog', 'ব্লগ', 'blog', 'blog', '📝'],
    tabSet('gfb', 'Google ও Facebook', '🔎'),
  ] },
  { title: 'দোকানের ডিজাইন', icon: '🎨', items: [
    ['/admin/design', 'লোগো, রং ও হোমপেজ', 'design', 'design', '🎨'],
    ['/admin/design/switches', 'দোকানে কী দেখাবে', 'design', 'ui-switches', '👁️'],
    tabSet('slides', 'স্লাইডার ও ব্যানার', '🎞️'),
    tabSet('menupages', 'মেনু ও পেজ', '🧭'),
    ['/admin/design/documents', 'ইনভয়েস ও চেকলিস্ট (প্রিন্ট)', 'design', 'documents', '🖨️'],
    ['/admin/design/language', 'ভাষা (বাংলা / English)', 'design', 'language', '🌐'],
    ['/admin/design/live', 'লাইভ খেলার স্কোর', 'design', 'live', '🏏'],
  ] },
  { title: 'সেটিংস', icon: '⚙️', items: [
    ['/admin/settings', 'সাধারণ সেটিংস', 'settings', 'settings', '⚙️'],
    ['/admin/integrations/payments', 'পেমেন্ট', 'settings', 'payments', '💳'],
    ['/admin/integrations/courier', 'কুরিয়ার', 'settings', 'courier', '🛵'],
    ['/admin/notify', 'আমার নোটিফিকেশন', 'owner', 'notify', '🔔'],
    tabSet('domain', 'ডোমেইন ও DNS', '🌐'),
  ] },
  { title: 'স্টাফ ও নিরাপত্তা', icon: '🛡️', items: [
    ['/admin/staff', 'স্টাফ ও অনুমতি', 'owner', 'staff', '🧑‍💼'],
    ['/admin/security', 'নিরাপত্তার অবস্থা', 'owner', 'security', '🛡️'],
    tabSet('login', 'লগইন ও ডিভাইস', '🔐'),
    ['/admin/security/threats', 'সন্দেহজনক ভিজিটর', 'owner', 'threats', '🚨'],
    ['/admin/security/audit', 'অডিট লগ (কে কী বদলেছে)', 'owner', 'audit', '📜'],
    tabSet('system', 'সার্ভার, ডাটাবেস ও ব্যাকআপ', '🩺'),
  ] },
  { title: '', items: [['/admin/trash', 'রিসাইকেল বিন', 'owner', 'trash', '🗑️']] },
];

function allowed(user: StaffUser, perm?: Loose) {
  if (perm === 'owner') return user && user.role === 'owner';
  return can(user, perm);
}
// menu items: shown when any level (see / add / edit / delete) of the permission is given
function visible(user: StaffUser, perm?: Loose) { return canSee(user, perm); }

// 📊 The dashboard and visitor analytics sit together on one page as two tabs (like browser tabs),
// so the owner does not have to look for visitor analytics in the menu.
const HOME_TABS = [
  ['/admin', 'ড্যাশবোর্ড', 'dashboard', 'home', '📊'],
  ['/admin/marketing/visitors', 'ভিজিটর অ্যানালিটিক্স', 'marketing', 'visitors', '👀'],
];
function homeTabs(user: StaffUser, active?: Loose) {
  const tabs = HOME_TABS.filter((t) => visible(user, t[2]));
  if (tabs.length < 2) return '';
  return toHtml(<nav className="home-tabs" {...({ "aria-label": "ড্যাশবোর্ডের ট্যাব" } as Record<string, string>)}>{jsxList(tabs.map(([href, label, , key, icon]: Loose[]) => <a href={attrValue(href)} className={`home-tab ${attrValue(active === key ? 'on' : '')}`} {...attrProps(active === key ? raw(' aria-current="page"') : '')}><span {...({ "aria-hidden": "true" } as Record<string, string>)}><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>);
}

// A menu entry for the user: a plain link stays as it is; a tab set becomes a link to its first tab the user may
// open, carrying the keys of all its tabs (so the menu lights up on any of them). null = nothing to show.
function resolveItem(user: StaffUser, it?: Loose) {
  if (Array.isArray(it)) return visible(user, it[2]) ? it : null;
  const tabs = (TABS[it.tabs] || []).filter((t?: Loose) => visible(user, t[2]));
  if (!tabs.length) return null;
  return [tabs[0][0], it.label, tabs[0][2], tabs[0][3], it.icon, tabs.map((t?: Loose) => t[3])];
}
// The tab bar on top of a page that is one of a tab set — only on the tab pages themselves
// (a single product, order or supplier opened from the list gets no tab bar).
function pageTabs(user: StaffUser, active?: Loose, path?: Loose) {
  if (!active || !path) return '';
  for (const set of Object.values(TABS)) {
    if (!set.some((t?: Loose) => t[3] === active)) continue;
    if (!set.some((t?: Loose) => t[0].split('?')[0] === path)) continue;
    const tabs = set.filter((t?: Loose) => visible(user, t[2]));
    if (tabs.length < 2) return '';
    return toHtml(<nav className="home-tabs page-tabs" {...({ "aria-label": "এই বিভাগের পেজ" } as Record<string, string>)}>{jsxList(tabs.map(([href, label, , key, icon]: Loose[]) => <a href={attrValue(href)} className={`home-tab ${attrValue(active === key ? 'on' : '')}`} {...attrProps(active === key ? raw(' aria-current="page"') : '')}><span {...({ "aria-hidden": "true" } as Record<string, string>)}><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>);
  }
  return '';
}

function head(title: Loose, settings: Settings) {
  return toHtml(<><RawHtml html={`<meta charset="utf-8">`} /><RawHtml html={`<meta name="viewport" content="width=device-width, initial-scale=1">`} /><RawHtml html={`<title>${htmlValue(title)}</title>`} /><RawHtml html={`<meta name="robots" content="noindex, nofollow">`} /><RawHtml html={`<meta name="theme-color" content="#14213D">`} /><RawHtml html={`<link rel="icon" href="${htmlValue(settings.favicon_id ? `/media/${settings.favicon_id}/t` : '/brand/favicon-32.png')}">`} /><RawHtml html={`<link rel="preconnect" href="https://fonts.googleapis.com">`} /><RawHtml html={`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`} /><RawHtml html={`<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">`} /><RawHtml html={`<link rel="stylesheet" href="/css/style.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="stylesheet" href="/css/admin.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="manifest" href="/admin.webmanifest">`} /><RawHtml html={`<link rel="apple-touch-icon" href="/icon-192.png">`} /><RawHtml html={`<meta name="apple-mobile-web-app-capable" content="yes">`} /></>);
}

function logoMark(settings: Settings) {
  if (settings.logo_id) return toHtml(<img className="logo-img" src={`/media/${attrValue(settings.logo_id)}`} alt={attrValue(settings.store_name)} />);
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return toHtml(<><span className="logo-a">সব</span><span className="logo-b">মিলবে</span></>);
  return toHtml(<span className="logo-a"><Val v={name} /></span>);
}

// বাংলা ⇄ English for the admin itself (Admin → স্টোর ডিজাইন → ভাষা → "অ্যাডমিন প্যানেলেও বাংলা / English").
// The choice lives on each device; the page is hidden for a moment while it turns English (no Bangla flash).
const adminLangOn = (settings: Settings) => settings.admin_i18n_on !== '0';
function langHead(settings: Settings) {
  if (!adminLangOn(settings)) return '';
  return raw(`<script nonce="${cspNonce()}">(function(){try{if(localStorage.getItem('sm_admin_lang')==='en'){var d=document.documentElement;d.className+=' admin-i18n-wait';d.setAttribute('data-admin-lang','en');}}catch(e){}})();</script><style>html.admin-i18n-wait body{visibility:hidden}</style>`);
}
function langScript(settings: Settings) {
  if (!adminLangOn(settings)) return '';
  return toHtml(<script src={`/js/admin-i18n.js?v=${attrValue(ASSET_V)}`} defer data-admin-i18n="" data-v={attrValue(ASSET_V)} />);
}
function langSwitch(settings: Settings) {
  if (!adminLangOn(settings)) return '';
  return toHtml(<button type="button" className="lang-sw admin-lang-sw" role="switch" title="বাংলা / English" data-admin-lang-switch="" {...({ "aria-checked": "false", "aria-label": "English", "translate": "no" } as Record<string, string>)}>{' '}<span className="ls-l ls-bn">বাং</span><span className="ls-track" {...({ "aria-hidden": "true" } as Record<string, string>)}><span className="ls-knob"></span></span><span className="ls-l ls-en">EN</span>{' '}</button>);
}

function adminLayout({ settings, user, title, body, active, bare, readOnly, path = '' }: Body) {
  if (bare) {
    return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}${langHead(settings)}</head>
<body class="admin admin-auth">${adminLangOn(settings) ? toHtml(<div className="bare-lang"><Val v={langSwitch(settings)} /></div>) : ''}<main class="admin-bare">${body}</main>
<script src="/js/admin.js?v=${ASSET_V}" defer></script><script src="/js/page-actions.js?v=${ASSET_V}" defer></script>${langScript(settings)}</body></html>`.s;
  }
  const dashTabs = visible(user, 'dashboard') && visible(user, 'marketing'); // both tabs shown on the dashboard
  const groups = MENU.map((g) => ({ ...g, items: g.items.map((it) => resolveItem(user, it)).filter((it) => it && !(dashTabs && it[3] === 'visitors')) })).filter((g) => g.items.length);
  const onHome = dashTabs && (active === 'home' || active === 'visitors');
  const tabActive = active;
  if (onHome) active = 'home'; // visitor analytics lights up "ড্যাশবোর্ড" in the menu
  return '<!doctype html>' + html`<html lang="bn"><head>${head(`${title} | Admin`, settings)}${langHead(settings)}</head>
<body class="admin">
<script nonce="${cspNonce()}">try{if(localStorage.getItem('sm_side_hidden')==='1')document.body.classList.add('side-hidden')}catch(e){}</script>
<aside class="side" id="side" aria-label="Admin মেনু">
  <button class="side-x" type="button" data-side-toggle aria-label="মেনু বন্ধ করুন" title="মেনু বন্ধ করুন">✕</button>
  <a class="side-logo logo" href="/admin" translate="no">${logoMark(settings)}<small>Admin</small></a>
  <nav>
    ${groups.map((g) => {
    const isOn = (it?: Loose) => it[3] === active || (it[5] || []).includes(active);
    const link = (it?: Loose) => { const [href, label, , , icon] = it; const on = isOn(it); return toHtml(<a href={attrValue(href)} className={attrValue(on ? 'on' : '')} {...attrProps(on ? raw(' aria-current="page"') : '')}><span className="side-ic" {...({ "aria-hidden": "true" } as Record<string, string>)}><Val v={icon} /></span><Val v={label} /></a>); };
    if (!g.title) return toHtml(<div className="side-group"><Val v={g.items.map(link)} /></div>);
    const here = g.items.some(isOn);
    return toHtml(<details className={`side-group side-drop ${attrValue(here ? 'has-on' : '')}`} data-side-group={attrValue(g.title)} {...attrProps(here ? raw('open') : '')}><summary><span className="side-ic" {...({ "aria-hidden": "true" } as Record<string, string>)}><Val v={g.icon || '•'} /></span><span className="side-label"><Val v={g.title} /></span><span className="side-arrow" {...({ "aria-hidden": "true" } as Record<string, string>)}><RawHtml html={'<svg viewBox="0 0 24 24" width="16" height="16"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'} /></span></summary><div className="side-sub"><Val v={g.items.map(link)} /></div></details>);
  })}
  </nav>
</aside>
<div class="side-shade" data-side-close></div>
<div class="main-col">
  <header class="topbar">
    <button class="burger" type="button" data-side-toggle aria-label="মেনু খুলুন / বন্ধ করুন" title="মেনু খুলুন / বন্ধ করুন" aria-controls="side">${raw('<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>')}</button>
    <form class="top-search" method="get" action="/admin/orders" role="search">
      <input type="search" name="q" placeholder="অর্ডার নম্বর, ফোন বা নাম দিয়ে খুঁজুন" aria-label="অর্ডার খুঁজুন">
    </form>
    <div class="top-end">
      ${langSwitch(settings)}
      <a href="/" target="_blank" rel="noopener" class="top-link">দোকান দেখুন ↗</a>
      <details class="user-menu">
        <summary>${$profile.avatar(user)}<span class="uname" translate="no">${user.name}</span></summary>
        <div class="user-pop">
          <div class="user-pop-head">${$profile.avatar(user, 'avatar-lg')}<p><b translate="no">${user.name}</b><br><span class="muted small">${user.designation || (user.role === 'owner' ? 'মালিক (সব অনুমতি)' : 'স্টাফ')} · ${user.username}</span></p></div>
          <a href="/admin/account#profile">👤 আমার প্রোফাইল</a>
          <a href="/admin/account">🔑 পাসওয়ার্ড ও নিরাপত্তা</a>
          <form method="post" action="/admin/logout"><button class="link-btn danger">লগআউট</button></form>
        </div>
      </details>
    </div>
  </header>
  <main class="admin-main" id="main">${readOnly ? toHtml(<p className="flash read-only-note" role="note">👁️ এই পেজে আপনার শুধু{' '}<b>দেখার</b>{' '}অনুমতি আছে — কিছু সেভ, বদল বা মুছতে পারবেন না।</p>) : ''}${onHome ? homeTabs(user, tabActive) : pageTabs(user, active, path)}${body}</main>
</div>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script src="/js/admin.js?v=${ASSET_V}" defer></script><script src="/js/page-actions.js?v=${ASSET_V}" defer></script>${langScript(settings)}
</body></html>`.s;
}

export { adminLayout, MENU, TABS, resolveItem, allowed, visible, logoMark, ASSET_V };

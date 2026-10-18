import { Val, RawHtml, attrValue, htmlValue, jsxList, renderHtml } from '../react/html';
import { adminLangBoot, adminSideBoot } from '../boot-scripts';
import { cspNonce } from '../security';
import type { ReactNode } from 'react';
import { raw } from '../util';
import { can, canSee } from '../models/staff';
import * as $profile from './profile';
import type { Body, Id, Loose, Settings, StaffUser } from '../types';

const ASSET_V = '56';

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
const tabSet = (id?: Id, label?: string, icon?: string) => ({ tabs: id, label, icon });

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
function visible(user: StaffUser, perm: string) { return canSee(user, perm); }

// 📊 The dashboard and visitor analytics sit together on one page as two tabs (like browser tabs),
// so the owner does not have to look for visitor analytics in the menu.
const HOME_TABS = [
  ['/admin', 'ড্যাশবোর্ড', 'dashboard', 'home', '📊'],
  ['/admin/marketing/visitors', 'ভিজিটর অ্যানালিটিক্স', 'marketing', 'visitors', '👀'],
];
function homeTabs(user: StaffUser, active: string | undefined) {
  const tabs = HOME_TABS.filter((t) => visible(user, t[2]));
  if (tabs.length < 2) return '';
  return <nav className="home-tabs" aria-label="ড্যাশবোর্ডের ট্যাব">{jsxList(tabs.map(([href, label, , key, icon]: Loose[]) => <a href={attrValue(href)} className={`home-tab ${active === key ? 'on' : ''}`} aria-current={(active === key) ? "page" : undefined}><span aria-hidden="true"><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>;
}

// A menu entry for the user: a plain link stays as it is; a tab set becomes a link to its first tab the user may
// open, carrying the keys of all its tabs (so the menu lights up on any of them). null = nothing to show.
function resolveItem(user: StaffUser, it?: Loose) {
  if (Array.isArray(it)) return visible(user, it[2]) ? it : null;
  const tabs = (TABS[it.tabs] || []).filter((t: Loose) => visible(user, t[2]));
  if (!tabs.length) return null;
  return [tabs[0][0], it.label, tabs[0][2], tabs[0][3], it.icon, tabs.map((t: Loose) => t[3])];
}
// The tab bar on top of a page that is one of a tab set — only on the tab pages themselves
// (a single product, order or supplier opened from the list gets no tab bar).
function pageTabs(user: StaffUser, active: string | undefined, path: string) {
  if (!active || !path) return '';
  for (const set of Object.values(TABS)) {
    if (!set.some((t: Loose) => t[3] === active)) continue;
    if (!set.some((t: string[]) => t[0].split('?')[0] === path)) continue;
    const tabs = set.filter((t: Loose) => visible(user, t[2]));
    if (tabs.length < 2) return '';
    return <nav className="home-tabs page-tabs" aria-label="এই বিভাগের পেজ">{jsxList(tabs.map(([href, label, , key, icon]: Loose[]) => <a href={attrValue(href)} className={`home-tab ${active === key ? 'on' : ''}`} aria-current={(active === key) ? "page" : undefined}><span aria-hidden="true"><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>;
  }
  return '';
}

function head(title: Loose, settings: Settings) {
  return <><RawHtml html={`<meta charset="utf-8">`} /><RawHtml html={`<meta name="viewport" content="width=device-width, initial-scale=1">`} /><RawHtml html={`<title>${htmlValue(title)}</title>`} /><RawHtml html={`<meta name="robots" content="noindex, nofollow">`} /><RawHtml html={`<meta name="theme-color" content="#14213D">`} /><RawHtml html={`<link rel="icon" href="${htmlValue(settings.favicon_id ? `/media/${settings.favicon_id}/t` : '/brand/favicon-32.png')}">`} /><RawHtml html={`<link rel="preconnect" href="https://fonts.googleapis.com">`} /><RawHtml html={`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`} /><RawHtml html={`<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">`} /><RawHtml html={`<link rel="stylesheet" href="/css/style.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="stylesheet" href="/css/admin.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="manifest" href="/admin.webmanifest">`} /><RawHtml html={`<link rel="apple-touch-icon" href="/icon-192.png">`} /><RawHtml html={`<meta name="apple-mobile-web-app-capable" content="yes">`} /></>;
}

function logoMark(settings: Settings) {
  if (settings.logo_id) return <img className="logo-img" src={`/media/${attrValue(settings.logo_id)}`} alt={attrValue(settings.store_name)} />;
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return <><span className="logo-a">সব</span><span className="logo-b">মিলবে</span></>;
  return <span className="logo-a"><Val v={name} /></span>;
}

// বাংলা ⇄ English for the admin itself (Admin → স্টোর ডিজাইন → ভাষা → "অ্যাডমিন প্যানেলেও বাংলা / English").
// The choice lives on each device; the page is hidden for a moment while it turns English (no Bangla flash).
const adminLangOn = (settings: Settings) => settings.admin_i18n_on !== '0';
function langHead(settings: Settings) {
  if (!adminLangOn(settings)) return '';
  return raw(`<script nonce="${cspNonce()}">${adminLangBoot}</script><style>html.admin-i18n-wait body{visibility:hidden}</style>`);
}
function langSwitch(settings: Settings) {
  if (!adminLangOn(settings)) return '';
  return <button type="button" className="lang-sw admin-lang-sw" role="switch" title="বাংলা / English" data-admin-lang-switch="" aria-checked="false" aria-label="English" translate="no">{' '}<span className="ls-l ls-bn">বাং</span><span className="ls-track" aria-hidden="true"><span className="ls-knob"></span></span><span className="ls-l ls-en">EN</span>{' '}</button>;
}

/** The scripts every admin page loads at the end (admin.js, page-actions.js, the English switch). */
function AdminScripts({ settings }: { settings: Settings }) {
  return (
    <>
      <script type="module" src={`/js/admin/main.js?v=${ASSET_V}`} />
      <script type="module" src={`/js/admin/page-actions.js?v=${ASSET_V}`} />
      {adminLangOn(settings) ? <script type="module" src={`/js/admin/i18n.js?v=${ASSET_V}`} data-admin-i18n="" data-v={ASSET_V} /> : null}
    </>
  );
}

/** The inside of <body class="admin admin-auth"> for login, set-up, reset and the other pages without the menu. */
function AdminBare({ settings, children }: { settings: Settings; children?: ReactNode }) {
  return (
    <>
      {adminLangOn(settings) ? <div className="bare-lang">{langSwitch(settings)}</div> : null}
      <main className="admin-bare">{children}</main>
      <AdminScripts settings={settings} />
    </>
  );
}

type FrameProps = { settings: Settings; user: StaffUser; active?: string; readOnly?: boolean; path?: string; nonce: string; children?: ReactNode };
/** The inside of <body class="admin">: the side menu, the top bar (search, English switch, the user's menu), the page. */
function AdminBody({ settings, user, active, readOnly, path = '', nonce, children }: FrameProps) {
  const dashTabs = visible(user, 'dashboard') && visible(user, 'marketing'); // both tabs shown on the dashboard
  const groups = MENU.map((g) => ({ ...g, items: g.items.map((it) => resolveItem(user, it)).filter((it) => it && !(dashTabs && it[3] === 'visitors')) })).filter((g) => g.items.length);
  const onHome = dashTabs && (active === 'home' || active === 'visitors');
  const tabActive = active;
  if (onHome) active = 'home'; // visitor analytics lights up "ড্যাশবোর্ড" in the menu
  const isOn = (it: Loose) => it[3] === active || (it[5] || []).includes(active);
  const link = (it: Loose, i: number) => {
    const [href, label, , , icon] = it;
    const on = isOn(it);
    return <a key={i} href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}><span className="side-ic" aria-hidden="true">{icon}</span>{label}</a>;
  };
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: adminSideBoot }} />
      <aside className="side" id="side" aria-label="Admin মেনু">
        <button className="side-x" type="button" data-side-toggle="" aria-label="মেনু বন্ধ করুন" title="মেনু বন্ধ করুন">✕</button>{' '}
        <a className="side-logo logo" href="/admin" translate="no">{logoMark(settings)}<small>Admin</small></a>
        <nav>
          {groups.map((g, gi) => {
            if (!g.title) return <div key={gi} className="side-group">{g.items.map(link)}</div>;
            const here = g.items.some(isOn);
            return (
              <details key={gi} className={`side-group side-drop ${here ? 'has-on' : ''}`} data-side-group={g.title} open={here || undefined}>
                <summary><span className="side-ic" aria-hidden="true">{g.icon || '•'}</span><span className="side-label">{g.title}</span><span className="side-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span></summary>
                <div className="side-sub">{g.items.map(link)}</div>
              </details>
            );
          })}
        </nav>
      </aside>
      <div className="side-shade" data-side-close="" />
      <div className="main-col">
        <header className="topbar">
          <button className="burger" type="button" data-side-toggle="" aria-label="মেনু খুলুন / বন্ধ করুন" title="মেনু খুলুন / বন্ধ করুন" aria-controls="side"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
          <form className="top-search" method="get" action="/admin/orders" role="search">
            <input type="search" name="q" placeholder="অর্ডার নম্বর, ফোন বা নাম দিয়ে খুঁজুন" aria-label="অর্ডার খুঁজুন" />
          </form>
          <div className="top-end">
            {langSwitch(settings)}{' '}
            <a href="/" target="_blank" rel="noopener" className="top-link">দোকান দেখুন ↗</a>
            <details className="user-menu">
              <summary>{$profile.avatar(user)}<span className="uname" translate="no">{user.name}</span></summary>
              <div className="user-pop">
                <div className="user-pop-head">{$profile.avatar(user, 'avatar-lg')}<p><b translate="no">{user.name}</b><br /><span className="muted small">{user.designation || (user.role === 'owner' ? 'মালিক (সব অনুমতি)' : 'স্টাফ')} · {user.username}</span></p></div>
                <a href="/admin/account#profile">👤 আমার প্রোফাইল</a>{' '}
                <a href="/admin/account">🔑 পাসওয়ার্ড ও নিরাপত্তা</a>
                <form method="post" action="/admin/logout"><button className="link-btn danger">লগআউট</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="admin-main" id="main">
          {readOnly ? <p className="flash read-only-note" role="note">👁️ এই পেজে আপনার শুধু{' '}<b>দেখার</b>{' '}অনুমতি আছে — কিছু সেভ, বদল বা মুছতে পারবেন না।</p> : null}
          {onHome ? homeTabs(user, tabActive) : pageTabs(user, active, path)}
          {children}
        </main>
      </div>
      <div className="toast" role="status" aria-live="polite" data-toast="" />
      <AdminScripts settings={settings} />
    </>
  );
}

/** The body tag's class: "admin", and "admin-auth" on the pages without the menu. */
const adminBodyClass = (bare?: boolean) => (bare ? 'admin admin-auth' : 'admin');

// The whole admin page as text, for the original router (lib/site.ts). The Next.js admin pages use the same pieces.
function adminLayout({ settings, user, title, body, active, bare, readOnly, path = '' }: Body) {
  const headHtml = `${renderHtml(head(`${title} | Admin`, settings))}${renderHtml(langHead(settings))}`;
  const inner = bare
    ? <AdminBare settings={settings}><Val v={body} /></AdminBare>
    : <AdminBody settings={settings} user={user} active={active} readOnly={readOnly} path={path} nonce={cspNonce()}><Val v={body} /></AdminBody>;
  return `<!doctype html><html lang="bn"><head>${headHtml}</head><body class="${adminBodyClass(bare)}">${renderHtml(inner)}</body></html>`;
}

export { adminLayout, AdminBody, AdminBare, adminBodyClass, langHead, head as adminHeadTags, MENU, TABS, resolveItem, allowed, visible, logoMark, ASSET_V };

import { Val, RawHtml, attrValue, htmlValue, jsxList, renderHtml } from '../react/html';
import { withBuild } from '../asset-version';
import { adminLangBoot, adminSideBoot } from '../boot-scripts';
import { cspNonce } from '../security';
import type { ReactNode } from 'react';
import { raw } from '../util';
import { can, canSee } from '../models/staff';
import * as $profile from './profile';
import type { AdminDrawn, Body, Settings, StaffUser } from '../types';

const ASSET_V = withBuild('88');

// 📑 Small jobs that belong together sit on one page as tabs (like browser tabs). Each tab is still its own
// page with its own link (bookmarks and the phone app keep working); the menu shows one entry for the set.
// Each tab: [href, label, permission, key, icon]
/** [href, label, permission, key, icon] */
type Tab = [string, string, string, string, string];
/** a menu entry that opens a set of tabs */
type TabSet = { tabs: string; label: string; icon: string };
type MenuItem = Tab | TabSet;
/** a menu entry the user may open: a link, plus (for a tab set) the keys of all its tabs */
type Resolved = [string, string, string, string, string, string[]?];
const TABS: Record<string, Tab[]> = {
  // 2026-11-14 (owner: put related pages together): every order list in one place
  orders: [
    ['/admin/orders', 'All orders', 'orders', 'orders', '🧾'],
    ['/admin/orders/incomplete', 'Incomplete orders', 'orders', 'drafts', '📝'],
  ],
  pnl: [
    ['/admin/accounts/pnl', 'Profit & loss', 'see_cost', 'acc-pnl', '📉'],
    ['/admin/accounts/packing', 'Packing costs', 'see_cost', 'packing', '📦'],
  ],
  returns: [
    ['/admin/returns', 'Returns & refunds', 'orders', 'returns', '↩️'],
    ['/admin/complaints', 'Complaints (72 hours)', 'orders', 'complaints', '📮'],
    ['/admin/voice', 'Voice & calls', 'orders', 'voice', '🎤'],
  ],
  fake: [
    ['/admin/checkout-otp', 'Checkout OTP', 'settings', 'checkout-otp', '📲'],
    ['/admin/autocall', 'Auto call', 'owner', 'autocall', '📞'],
    ['/admin/fraud', 'Fraud check (courier record)', 'orders', 'fraud', '🛡️'],
    ['/admin/blocklist', 'Block list', 'customers', 'blocklist', '⛔'],
  ],
  reviews: [
    ['/admin/reviews', 'Reviews & wishlists', 'reviews', 'reviews', '⭐'],
    ['/admin/questions', 'Questions & answers', 'reviews', 'questions', '❓'],
  ],
  products: [
    ['/admin/products', 'All products', 'products', 'products', '📦'],
    ['/admin/products?type=bundle', 'Bundles / packages', 'products', 'bundles', '🎁'],
    ['/admin/products/merge-variants', 'Merge into variants', 'owner', 'merge-variants', '🧩'],
    ['/admin/products/single-piece', 'Packs → single piece', 'owner', 'single-piece', '1️⃣'],
    ['/admin/products/one-pair', 'Pairs → one pair', 'owner', 'one-pair', '👟'],
  ],
  catbrand: [
    ['/admin/categories', 'Categories', 'products', 'categories', '🗂️'],
    ['/admin/brands', 'Brands', 'products', 'brands', '🏷️'],
  ],
  pictools: [
    ['/admin/products/watermark', 'Watermark', 'products', 'watermark', '💧'],
    ['/admin/products/duplicates', 'Duplicate products', 'products', 'duplicates', '👯'],
    ['/admin/products/source-pics', 'Other shops\' pictures', 'products', 'source-pics', '🚩'],
    ['/admin/products/whiten', 'White picture background (AI)', 'products', 'whiten', '⬜'],
    ['/admin/products/whiten/mine', 'Whiten my own pictures', 'products', 'whiten-mine', '📤'],
    ['/admin/products/clean-desc', 'Clean other shops\' text from descriptions', 'products', 'clean-desc', '🧹'],
    ['/admin/products/title-fix', 'Fix names & categories (AI)', 'products', 'title-fix', '🏷️'],
    ['/admin/products/desc-fix', 'Check descriptions (AI)', 'products', 'desc-fix', '📋'],
  ],
  // 2026-11-19: barcode scan and the new photo search side by side (both find a product at home and set its stock)
  stockscan: [
    ['/admin/stock-scan', 'Scan stock', 'inventory', 'stock-scan', '📷'],
    ['/admin/photo-find', 'Find by photo', 'inventory', 'photo-find', '📸'],
  ],
  suppliers: [
    ['/admin/suppliers', 'Suppliers', 'inventory', 'suppliers', '🚚'],
    ['/admin/suppliers/dues', 'Dues ledger', 'see_cost', 'supplier-dues', '📒'],
  ],
  messages: [
    ['/admin/marketing/sms', 'SMS', 'marketing', 'sms', '📱'],
    ['/admin/marketing/email', 'Email', 'marketing', 'email', '📧'],
    ['/admin/marketing/contacts', 'Excel lists', 'marketing', 'contacts', '📥'],
    ['/admin/marketing/push', 'Phone notifications', 'marketing', 'shoppush', '🔔'],
    ['/admin/marketing/app-invite', 'App card', 'marketing', 'appinvite', '📱'],
    ['/admin/marketing/restock', 'Back in stock / price drop alerts', 'marketing', 'restock', '⏰'],
  ],
  // 2026-11-18: the help button's answers sit next to the chat links they lead to
  chat: [
    ['/admin/marketing/social', 'Social links & live chat', 'marketing', 'social', '💬'],
    ['/admin/marketing/helpbot', 'Help bot', 'marketing', 'helpbot', '🙋'],
  ],
  autosocial: [
    ['/admin/marketing/channels', 'All platforms', 'marketing', 'channels', '📣'],
    ['/admin/marketing/auto', 'Facebook, Instagram & Telegram', 'marketing', 'automarketing', '🤖'],
    // 2026-11-21: copy-paste help for what Facebook doesn't let a program do (groups, Marketplace)
    ['/admin/marketing/videos', 'Video posts', 'marketing', 'videos', '🎬'],
    ['/admin/marketing/group-posts', 'Group posts', 'marketing', 'group-posts', '📣'],
    ['/admin/marketing/marketplace', 'Marketplace helper', 'marketing', 'marketplace', '🏷️'],
  ],
  // 2026-11-14: "Google ও Facebook" split in two — being found on Google (SEO, blog) / ads and what the ads need
  // (pixels, product feeds, retargeting, whether each connection works)
  seoblog: [
    ['/admin/marketing/seo', 'SEO', 'marketing', 'seo', '🔎'],
    ['/admin/marketing/autoseo', 'Auto SEO (fills model, details & description)', 'marketing', 'autoseo', '🤖'],
    ['/admin/blog', 'Blog', 'blog', 'blog', '📝'],
  ],
  ads: [
    ['/admin/landing', 'Landing pages', 'marketing', 'landing', '🚀'],
    ['/admin/marketing/tracking', 'Pixels & tracking', 'marketing', 'tracking', '🎯'],
    ['/admin/marketing/feeds', 'Product feeds', 'marketing', 'feeds', '🔗'],
    ['/admin/reach', 'Retargeting', 'owner', 'reach', '🔁'],
    ['/admin/integrations/status', 'Connection status', 'settings', 'status', '🔌'],
  ],
  security: [
    ['/admin/security', 'Security status', 'owner', 'security', '🛡️'],
    ['/admin/security/threats', 'Suspicious visitors', 'owner', 'threats', '🚨'],
    ['/admin/security/audit', 'Audit log (who changed what)', 'owner', 'audit', '📜'],
  ],
  system: [
    ['/admin/health', 'Server & database', 'owner', 'health', '🩺'],
    ['/admin/backup', 'Backup & restore', 'owner', 'backup', '💾'],
  ],
  slides: [
    ['/admin/design/slider', 'Running slider', 'design', 'slider', '🎞️'],
    ['/admin/design/banners', 'Banners', 'design', 'banners', '🖼️'],
  ],
  menupages: [
    ['/admin/design/menus', 'Header & footer menus', 'design', 'menus', '🧭'],
    ['/admin/design/pages', 'Pages (About, Policy)', 'design', 'pages', '📄'],
  ],
  domain: [
    ['/admin/integrations/domain', 'Domain setup', 'settings', 'domain', '🌐'],
    ['/admin/integrations/dns', 'DNS & Cloudflare', 'owner', 'dns', '🛰️'],
  ],
  login: [
    ['/admin/security/login', 'Login lock (fingerprint)', 'owner', 'loginlock', '🔐'],
    ['/admin/security/logins', 'Login history & devices', 'owner', 'logins', '🔑'],
    ['/admin/security/recovery', 'Emergency recovery codes', 'owner', 'recovery', '🆘'],
  ],
};
const tabSet = (id: string, label: string, icon: string): TabSet => ({ tabs: id, label, icon });

// 🧭 The admin menu (owner, 2026-11-17: laid out like the "Veylix" admin template — English only).
// Four sections (Operate · Commerce · Grow & connect · Workspace); each holds a few groups that fold open
// (an outline icon + name + arrow), the pages sit inside. A plain link (Overview, Recycle bin) has no fold.
type Group = { title: string; icon: string; items: MenuItem[] };
type Entry = Tab | Group;
const SECTIONS: { title: string; entries: Entry[] }[] = [
  { title: 'Operate', entries: [
    ['/admin', 'Overview', 'dashboard', 'home', 'home'],
    { title: 'Orders', icon: 'orders', items: [
      tabSet('orders', 'All orders', '🧾'),
      ['/admin/orders/new', 'New order', 'orders_edit', 'order-new', '➕'],
      ['/admin/pos', 'Counter sale (POS)', 'pos', 'pos', '🏪'],
      ['/admin/handover', 'Courier handover', 'orders_edit', 'handover', '📦'],
      tabSet('returns', 'Returns & complaints', '↩️'),
      tabSet('fake', 'Fake order guard', '🛡️'),
    ] },
    { title: 'Products', icon: 'products', items: [
      tabSet('products', 'All products', '📦'),
      ['/admin/products/new', 'Add product', 'products', 'product-new', '⬆️'],
      ['/admin/products/import', 'Import products', 'products', 'product-import', '📥'],
      tabSet('catbrand', 'Categories & brands', '🗂️'),
      ['/admin/kits', 'Project kits', 'products', 'kits', '🧰'],
    ] },
    { title: 'Inventory', icon: 'inventory', items: [
      ['/admin/inventory', 'Stock', 'inventory', 'inventory', '🏬'],
      tabSet('stockscan', 'Scan stock', '📷'),
      ['/admin/purchases', 'Purchases', 'inventory', 'purchases', '🛒'],
      tabSet('suppliers', 'Suppliers & dues', '🚚'),
      ['/admin/warehouses', 'Warehouses & branches', 'inventory', 'warehouses', '🏗️'],
    ] },
    { title: 'Customers', icon: 'customers', items: [
      ['/admin/customers', 'All customers', 'customers', 'customers', '👤'],
      ['/admin/customer-accounts', 'Customer accounts', 'settings', 'cust-accounts', '🔐'],
      tabSet('reviews', 'Reviews & Q&A', '⭐'),
      ['/admin/app-users', 'App users', 'customers', 'appusers', '📱'],
    ] },
  ] },
  { title: 'Commerce', entries: [
    { title: 'Checkout & pricing', icon: 'tag', items: [
      ['/admin/marketing/flash', 'Flash sales & offers', 'marketing', 'flash', '⚡'],
      ['/admin/marketing/coupons', 'Coupons', 'marketing', 'coupons', '🎟️'],
      ['/admin/giftcards', 'Gift cards & referral', 'marketing', 'giftcards', '💳'],
      ['/admin/marketing/loyalty', 'Loyalty points', 'marketing', 'loyalty', '🎖️'],
    ] },
    { title: 'Online store', icon: 'store', items: [
      ['/admin/design', 'Logo, colours & home page', 'design', 'design', '🎨'],
      ['/admin/design/switches', 'What the shop shows', 'design', 'ui-switches', '👁️'],
      tabSet('slides', 'Slider & banners', '🎞️'),
      tabSet('menupages', 'Menus & pages', '🧭'),
      ['/admin/design/documents', 'Invoice & checklist (print)', 'design', 'documents', '🖨️'],
      ['/admin/design/language', 'Shop language (বাংলা / English)', 'design', 'language', '🌐'],
      ['/admin/design/live', 'Live match scores', 'design', 'live', '🏏'],
    ] },
    { title: 'Payments & delivery', icon: 'card', items: [
      ['/admin/integrations/payments', 'Payments', 'settings', 'payments', '💳'],
      ['/admin/integrations/courier', 'Couriers', 'settings', 'courier', '🛵'],
      ['/admin/accounts/cod', 'Courier COD settlement', 'accounting', 'acc-cod', '🚚'],
    ] },
    { title: 'Accounts', icon: 'wallet', items: [
      ['/admin/accounts', 'Accounts summary', 'accounting', 'acc-home', '💰'],
      ['/admin/accounts/transactions', 'Income & expenses', 'accounting', 'acc-tx', '✍️'],
      ['/admin/accounts/banks', 'Bank & cash', 'accounting', 'acc-banks', '🏦'],
      tabSet('pnl', 'Profit & loss', '📉'),
      ['/admin/accounts/vat', 'VAT & tax', 'accounting', 'acc-vat', '🧮'],
    ] },
  ] },
  { title: 'Grow & connect', entries: [
    { title: 'Reports', icon: 'chart', items: [
      ['/admin/reports', 'Sales report', 'reports', 'reports', '📋'],
      ['/admin/reports/search', 'What customers search', 'reports', 'search-report', '🔎'],
      ['/admin/marketing/visitors', 'Visitor analytics', 'marketing', 'visitors', '👀'],
      ['/admin/research', 'Market research (trending products)', 'owner', 'research', '🔭'],
      ['/admin/growth', 'Growth guide', 'owner', 'growth', '🚀'],
    ] },
    { title: 'Communication', icon: 'chat', items: [
      tabSet('messages', 'Customer messages', '📱'),
      tabSet('autosocial', 'Social media auto post', '📣'),
      tabSet('chat', 'Social links & live chat', '💬'),
    ] },
    { title: 'Marketing', icon: 'megaphone', items: [
      tabSet('seoblog', 'SEO & blog (Google)', '🔎'),
      tabSet('ads', 'Landing pages & ads', '🚀'),
    ] },
    { title: 'AI tools', icon: 'sparkle', items: [
      ['/admin/ai-staff', 'AI staff (writes names, descriptions & SEO)', 'owner', 'ai-staff', '🤖'],
    ] },
    { title: 'Media & files', icon: 'media', items: [
      tabSet('pictools', 'Watermark, duplicates & pictures', '💧'),
    ] },
  ] },
  { title: 'Workspace', entries: [
    { title: 'Team & access', icon: 'team', items: [
      ['/admin/staff', 'Staff & permissions', 'owner', 'staff', '🧑‍💼'],
      tabSet('security', 'Security & monitoring', '🛡️'),
      tabSet('login', 'Login & devices', '🔐'),
    ] },
    { title: 'Integrations', icon: 'globe', items: [
      tabSet('domain', 'Domain & DNS', '🌐'),
      ['/admin/notify', 'My notifications', 'owner', 'notify', '🔔'],
    ] },
    { title: 'Settings', icon: 'gear', items: [
      ['/admin/settings', 'General settings', 'settings', 'settings', '⚙️'],
      tabSet('system', 'Server, database & backup', '🩺'),
    ] },
    ['/admin/trash', 'Recycle bin', 'owner', 'trash', 'trash'],
  ] },
];
const isGroup = (e: Entry): e is Group => !Array.isArray(e);
// every menu page in order (the first one a user may open is where they land after login: lib/admin/index.tsx)
const MENU: { title: string; items: MenuItem[] }[] = SECTIONS.flatMap((s) => s.entries.map((e) => (isGroup(e) ? { title: e.title, items: e.items } : { title: '', items: [e] })));

// outline icons (24×24, drawn with a 1.8 stroke) for the menu's sections — like the template's line icons
const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  orders: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  products: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  inventory: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  customers: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM3 21a9 9 0 0 1 18 0',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  store: 'M3 9l2-5h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l12-4v4M16 13h2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  chat: 'M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z',
  megaphone: 'M3 10v4h4l7 5V5L7 10zM18 8a5 5 0 0 1 0 8',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v4M17 5h4',
  media: 'M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M15 9h.01',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 21a8 8 0 0 1 16 0M17 3a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7.4',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  box: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5',
  alert: 'M12 3 2 21h20zM12 10v5M12 18h.01',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg className="ic" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d={ICONS[name] || ICONS.box} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function allowed(user: StaffUser, perm: string) {
  if (perm === 'owner') return user && user.role === 'owner';
  return can(user, perm);
}
// menu items: shown when any level (see / add / edit / delete) of the permission is given
function visible(user: StaffUser, perm: string) { return canSee(user, perm); }

// 📊 The dashboard and visitor analytics sit together on one page as two tabs (like browser tabs),
// so the owner does not have to look for visitor analytics in the menu.
const HOME_TABS: Tab[] = [
  ['/admin', 'Overview', 'dashboard', 'home', '📊'],
  ['/admin/marketing/visitors', 'Visitor analytics', 'marketing', 'visitors', '👀'],
];
function homeTabs(user: StaffUser, active: string | undefined) {
  const tabs = HOME_TABS.filter((t) => visible(user, t[2]));
  if (tabs.length < 2) return '';
  return <nav className="home-tabs" aria-label="Dashboard tabs">{jsxList(tabs.map(([href, label, , key, icon]: unknown[]) => <a href={attrValue(href)} className={`home-tab ${active === key ? 'on' : ''}`} aria-current={(active === key) ? "page" : undefined}><span aria-hidden="true"><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>;
}

// A menu entry for the user: a plain link stays as it is; a tab set becomes a link to its first tab the user may
// open, carrying the keys of all its tabs (so the menu lights up on any of them). null = nothing to show.
function resolveItem(user: StaffUser, it: MenuItem): Resolved | null {
  if (Array.isArray(it)) return visible(user, it[2]) ? it : null;
  const tabs = (TABS[it.tabs] || []).filter((t) => visible(user, t[2]));
  if (!tabs.length) return null;
  return [tabs[0][0], it.label, tabs[0][2], tabs[0][3], it.icon, tabs.map((t) => t[3])];
}
// The tab bar on top of a page that is one of a tab set — only on the tab pages themselves
// (a single product, order or supplier opened from the list gets no tab bar).
function pageTabs(user: StaffUser, active: string | undefined, path: string) {
  if (!active || !path) return '';
  for (const set of Object.values(TABS)) {
    if (!set.some((t) => t[3] === active)) continue;
    if (!set.some((t) => t[0].split('?')[0] === path)) continue;
    const tabs = set.filter((t) => visible(user, t[2]));
    if (tabs.length < 2) return '';
    return <nav className="home-tabs page-tabs" aria-label="Pages in this section">{jsxList(tabs.map(([href, label, , key, icon]: unknown[]) => <a href={attrValue(href)} className={`home-tab ${active === key ? 'on' : ''}`} aria-current={(active === key) ? "page" : undefined}><span aria-hidden="true"><Val v={icon} /></span>{' '}<Val v={label} /></a>))}</nav>;
  }
  return '';
}

function head(title: unknown, settings: Settings) {
  return <><RawHtml html={`<meta charset="utf-8">`} /><RawHtml html={`<meta name="viewport" content="width=device-width, initial-scale=1">`} /><RawHtml html={`<title>${htmlValue(title)}</title>`} /><RawHtml html={`<meta name="robots" content="noindex, nofollow">`} /><RawHtml html={`<meta name="theme-color" content="#14213D">`} /><RawHtml html={`<link rel="icon" href="${htmlValue(settings.favicon_id ? `/media/${settings.favicon_id}/t` : '/brand/favicon-32.png')}">`} /><RawHtml html={`<link rel="preload" href="/fonts/noto-sans-bengali-bn-v5.woff2" as="font" type="font/woff2" crossorigin>`} /><RawHtml html={`<link rel="preload" href="/fonts/manrope-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>`} /><RawHtml html={`<link rel="stylesheet" href="/css/style.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="stylesheet" href="/css/admin.css?v=${htmlValue(ASSET_V)}">`} /><RawHtml html={`<link rel="manifest" href="/admin.webmanifest">`} /><RawHtml html={`<link rel="apple-touch-icon" href="/icon-192.png">`} /><RawHtml html={`<meta name="apple-mobile-web-app-capable" content="yes">`} /></>;
}

function logoMark(settings: Settings) {
  if (settings.logo_id) {
    // the logo's shape (saved with it, lib/admin/design.tsx), so its place is kept before the picture arrives
    const w = Number(settings.logo_w), h = Number(settings.logo_h);
    const size = w > 0 && h > 0 ? { width: w, height: h } : {};
    return <img className="logo-img" src={`/media/${attrValue(settings.logo_id)}`} alt={attrValue(settings.store_name)} {...size} />;
  }
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return <><span className="logo-a">সব</span><span className="logo-b">মিলবে</span></>;
  return <span className="logo-a"><Val v={name} /></span>;
}

// 🇬🇧 The admin is English only (owner, 2026-11-17: "permanently English, remove the বাংলা/English button").
// The pages are made in English on the server (lib/next/admin-en.ts with public/js/admin-en.json), so nothing is
// hidden or swapped in the browser; client/admin/i18n.ts only handles words added later (toasts…). No switch any more.
function langHead(_settings?: Settings) {
  return raw(`<script nonce="${cspNonce()}">${adminLangBoot}</script>`);
}

/** The scripts every admin page loads at the end (admin.js, page-actions.js, the English wording). */
function AdminScripts({ settings: _settings }: { settings: Settings }) {
  return (
    <>
      <script type="module" src={`/js/admin/main.js?v=${ASSET_V}`} />
      <script type="module" src={`/js/admin/page-actions.js?v=${ASSET_V}`} />
      <script type="module" src={`/js/admin/i18n.js?v=${ASSET_V}`} data-admin-i18n="" data-v={ASSET_V} />
    </>
  );
}

/** The inside of <body class="admin admin-auth"> for login, set-up, reset and the other pages without the menu. */
function AdminBare({ settings, children }: { settings: Settings; children?: ReactNode }) {
  return (
    <>
      <main className="admin-bare">{children}</main>
      <AdminScripts settings={settings} />
    </>
  );
}

/** Small numbers in the top bar (orders waiting, low stock, out of stock) — lib/next/admin-counts.ts. */
type TopCounts = { pending: number; low: number; out: number };
type FrameProps = { settings: Settings; user: StaffUser; active?: string; readOnly?: boolean; path?: string; nonce: string; counts?: TopCounts | null; children?: ReactNode };

function TopChips({ user, counts }: { user: StaffUser; counts?: TopCounts | null }) {
  const n = (v: number | undefined) => (counts ? <b>{Number(v || 0).toLocaleString('en-US')}</b> : null);
  const chips: ReactNode[] = [];
  if (visible(user, 'orders')) chips.push(<a key="o" className="top-chip chip-blue" href="/admin/orders?status=pending" title="New orders waiting to be confirmed"><span className="chip-ic"><Icon name="bag" size={18} /></span><span className="chip-tx"><small>New orders</small>{n(counts?.pending)}</span></a>);
  if (visible(user, 'inventory')) chips.push(<a key="l" className="top-chip chip-amber" href="/admin/inventory?low=1" title="Products running low"><span className="chip-ic"><Icon name="box" size={18} /></span><span className="chip-tx"><small>Low stock</small>{n(counts?.low)}</span></a>);
  if (visible(user, 'products')) chips.push(<a key="x" className="top-chip chip-red" href="/admin/products?out=1" title="Active products with no stock"><span className="chip-ic"><Icon name="alert" size={18} /></span><span className="chip-tx"><small>Out of stock</small>{n(counts?.out)}</span></a>);
  return chips.length ? <div className="top-chips">{chips}</div> : null;
}

/** The inside of <body class="admin">: the side menu, the top bar (search, quick numbers, the user's menu), the page. */
function AdminBody({ settings, user, active, readOnly, path = '', nonce, counts, children }: FrameProps) {
  const dashTabs = visible(user, 'dashboard') && visible(user, 'marketing'); // both tabs shown on the dashboard
  const keep = (it: Resolved | null): it is Resolved => !!it && !(dashTabs && it[3] === 'visitors');
  const sections = SECTIONS.map((sec) => ({
    title: sec.title,
    entries: sec.entries.map((e): { group: Group | null; items: Resolved[]; link: Resolved | null } => (isGroup(e)
      ? { group: e, items: e.items.map((it) => resolveItem(user, it)).filter(keep), link: null }
      : { group: null, items: [], link: resolveItem(user, e) })).filter((x) => (x.group ? x.items.length > 0 : keep(x.link))),
  })).filter((sec) => sec.entries.length);
  const onHome = dashTabs && (active === 'home' || active === 'visitors');
  const tabActive = active;
  if (onHome) active = 'home'; // visitor analytics lights up "Overview" in the menu
  const isOn = (it: Resolved) => it[3] === active || (active !== undefined && (it[5] || []).includes(active));
  const sub = (it: Resolved, i: number) => {
    const on = isOn(it);
    return <a key={i} href={it[0]} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{it[1]}</a>;
  };
  const roleName = user.designation || (user.role === 'owner' ? 'Owner' : 'Staff');
  // breadcrumb like the template ("Operate › Products"): the section and group that hold the open page
  let crumb: string[] = [];
  for (const sec of sections) for (const x of sec.entries) {
    if (x.group && x.items.some(isOn)) crumb = [sec.title, x.group.title];
    else if (!x.group && x.link && isOn(x.link)) crumb = [sec.title, x.link[1]];
  }
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: adminSideBoot }} />
      <aside className="side vx-side" id="side" aria-label="Admin menu">
        <div className="vx-brand">
          <a className="side-logo logo" href="/admin" translate="no">{logoMark(settings)}</a>
          <small className="vx-tag">Admin panel</small>
          <button className="vx-collapse" type="button" data-side-toggle="" aria-label="Hide menu" title="Hide menu"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <button className="side-x" type="button" data-side-toggle="" aria-label="Close menu" title="Close menu">✕</button>
        </div>
        <nav className="vx-nav">
          {sections.map((sec, si) => (
            <div key={si} className="vx-section">
              <p className="vx-title">{sec.title}</p>
              {sec.entries.map((x, xi) => {
                if (!x.group) {
                  const it = x.link!;
                  const on = isOn(it);
                  return <a key={xi} href={it[0]} className={`vx-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}><Icon name={it[4]} />{it[1]}</a>;
                }
                const g = x.group;
                const here = x.items.some(isOn);
                return (
                  <details key={xi} className={`side-group side-drop vx-group ${here ? 'has-on' : ''}`} data-side-group={g.title} open={here || undefined}>
                    <summary className="vx-item"><Icon name={g.icon} /><span className="side-label">{g.title}</span><span className="side-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span></summary>
                    <div className="side-sub vx-sub">{x.items.map(sub)}</div>
                  </details>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="side-shade" data-side-close="" />
      <div className="main-col">
        <header className="topbar vx-top">
          <button className="burger" type="button" data-side-toggle="" aria-label="Open / close menu" title="Open / close menu" aria-controls="side"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
          <div className="vx-top-left">
            <form className="top-search" method="get" action="/admin/orders" role="search">
              <Icon name="search" size={18} />
              <input type="search" name="q" placeholder="Search orders by number, phone or name…" aria-label="Search orders" />
            </form>
            <TopChips user={user} counts={counts} />
          </div>
          <div className="top-end vx-top-right">
            <a href="/" target="_blank" rel="noopener" className="top-link"><Icon name="ext" size={16} /> View store</a>
            <details className="user-menu">
              <summary>{$profile.avatar(user)}<span className="uname"><span translate="no">{user.name}</span><small>{roleName}</small></span></summary>
              <div className="user-pop">
                <div className="user-pop-head">{$profile.avatar(user, 'avatar-lg')}<p><b translate="no">{user.name}</b><br /><span className="muted small">{roleName} · {user.username}</span></p></div>
                <a href="/admin/account#profile">👤 My profile</a>{' '}
                <a href="/admin/account">🔑 Password & security</a>
                <form method="post" action="/admin/logout"><button className="link-btn danger">Log out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="admin-main" id="main">
          {crumb.length ? <nav className="vx-crumb" aria-label="Breadcrumb"><span>{crumb[0]}</span><span aria-hidden="true">›</span><span>{crumb[1]}</span></nav> : null}
          {readOnly ? <p className="flash read-only-note" role="note">👁️ You can only <b>view</b> this page — you can't save, change or delete anything.</p> : null}
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
function adminLayout({ settings, user, title, body, active, bare, readOnly, path = '' }: Omit<AdminDrawn, 'status' | 'user'> & { user?: StaffUser | null }) {
  const headHtml = `${renderHtml(head(`${title} | Admin`, settings))}${renderHtml(langHead())}`;
  const inner = bare
    ? <AdminBare settings={settings}><Val v={body} /></AdminBare>
    : <AdminBody settings={settings} user={user!} active={active} readOnly={readOnly} path={path} nonce={cspNonce()}><Val v={body} /></AdminBody>;
  return `<!doctype html><html lang="en"><head>${headHtml}</head><body class="${adminBodyClass(bare)}">${renderHtml(inner)}</body></html>`;
}

export { adminLayout, AdminBody, AdminBare, adminBodyClass, langHead, head as adminHeadTags, MENU, TABS, SECTIONS, resolveItem, allowed, visible, logoMark, ASSET_V };
export type { TopCounts };

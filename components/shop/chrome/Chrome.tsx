// ⚛️ The frame around every shop page: top notice bar, header (logo, search, menu, cart), category menu, phone
// drawer, footer, chat buttons, pop-up offer, and the scripts the page needs. One component for both the Next.js
// pages (app/(shop)/layout.tsx) and the pages still answered by lib/site.ts (lib/views/layout.tsx).
import { tawkLoader } from '../../../lib/boot-scripts';
import type { ReactElement, JSXElementConstructor, ReactNode, ReactPortal } from 'react';
import * as U from '../../../lib/services/uiswitch';
import * as security from '../../../lib/security';
import { contact } from '../../../lib/util';
import { jsonSetting } from '../../../lib/db';
import { categoryTree, type Category, type CategoryNode } from '../../../lib/models/catalog';
import type { BannersRow, PagesRow } from '../../../lib/data/rows';
/** an info page as the footer lists it */
type ShopPage = Pick<PagesRow, 'title' | 'slug' | 'in_footer'>;
type Popup = Pick<BannersRow, 'id' | 'link' | 'image_id' | 'title'>;
import { BodyHtml } from '../../../lib/react/head-html';
import { cx } from '../../../lib/react/html';
import type { CustomScript, MenuLink, Settings } from '../../../lib/types';
import { SearchIcon, CartIcon, UserIcon, MenuIcon, WhatsAppIcon, MessengerIcon, SOCIAL_ICONS } from './icons';

export const ASSET_V = '50';

export function Logo({ settings }: { settings: Settings }) {
  if (settings.logo_id) {
    // width/height (saved with the logo, lib/admin/design.tsx) only tell the browser the logo's shape, so its place is
    // kept before the picture arrives; the size on screen still comes from the CSS (.logo-img)
    const w = Number(settings.logo_w), h = Number(settings.logo_h);
    const size = w > 0 && h > 0 ? { width: w, height: h } : {};
    return <img className="logo-img" src={`/media/${settings.logo_id}`} alt={settings.store_name} {...size} />;
  }
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return <><span className="logo-a">সব</span><span className="logo-b">মিলবে</span></>;
  return <span className="logo-a">{name}</span>;
}

// Admin → পিক্সেল ও ট্র্যাকিং → "যেকোনো স্ক্রিপ্ট বসান": only the owner can save these, each with its own on/off
export function customScripts(s: Settings, place: 'head' | 'body'): string {
  let list: CustomScript[] = [];
  try { list = JSON.parse(s.custom_scripts || '[]'); } catch { list = []; }
  return (Array.isArray(list) ? list : []).filter((x) => x && x.on && x.place === place && x.code).map((x) => `\n<!-- ${String(x.name || '').replace(/--/g, '')} -->\n${x.code}`).join('');
}

// The small on/off switch in the top bar (বাং ◯ EN): tap it and the whole shop changes language, no reload.
function LangSwitch() {
  return (
    <button type="button" className="lang-sw" role="switch" aria-checked="false" aria-label="English" title="বাংলা / English" translate="no" data-lang-switch="">{' '}
      <span className="ls-l ls-bn" data-lang="bn">বাং</span><span className="ls-track" aria-hidden="true"><span className="ls-knob"></span></span><span className="ls-l ls-en" data-lang="en">EN</span>{' '}
    </button>
  );
}

// Category menus. Top bar: main categories with drop-down sub-categories (any depth).
// Phone menu: the same tree, folding open. Empty sub-categories are left out.
const visibleKids = (n: CategoryNode) => n.children.filter((k) => Number(k.total_count) > 0);
function CatMenuItems({ nodes, top }: { nodes: CategoryNode[]; top: boolean }) {
  return nodes.map((n) => {
    const kids = visibleKids(n);
    return (
      <li key={n.id} className={cx('cm-item', kids.length && 'has-sub')}>
        <a href={`/products?cat=${n.slug}`} aria-haspopup={kids.length ? 'true' : undefined}>{top ? <><span className="cm-ic" aria-hidden="true">{n.icon}</span>{' '}</> : null}{n.name}</a>
        {kids.length ? <ul className="cm-sub"><CatMenuItems nodes={kids} top={false} /></ul> : null}
      </li>
    );
  });
}
function DrawerCats({ nodes }: { nodes: CategoryNode[] }) {
  return nodes.map((n) => {
    const kids = visibleKids(n);
    const label = <>{n.depth === 0 ? <>{n.icon}{' '}</> : null}{n.name}</>;
    return kids.length
      ? <details key={n.id} className="dc"><summary>{label}</summary><div className="dc-in"><a href={`/products?cat=${n.slug}`}>সব {n.name} →</a><DrawerCats nodes={kids} /></div></details>
      : <a key={n.id} href={`/products?cat=${n.slug}`}>{label}</a>;
  });
}

export type ChromeProps = {
  settings: Settings; categories: Category[]; pages: ShopPage[]; popup?: Popup | null; q?: string; active?: string; track?: unknown; children: ReactNode;
};

/** Everything inside <body>: the frame, the page (children) and the page's scripts. */
export function ShopBody({ settings: s, categories, pages, popup = null, q = '', active = '', track = null, children }: ChromeProps) {
  const { roots } = categoryTree(categories);
  const menu = jsonSetting<MenuLink[]>(s, 'header_menu', []).filter((m) => m.on !== false); // admin can switch each button off
  const showCart = s.nav_cart !== '0';
  const footerLinks = jsonSetting<MenuLink[]>(s, 'footer_links', []).filter((l) => l.on !== false);
  // footer "কেনাকাটা" column — each link can be switched off from the admin
  const shopLinks = [
    ['/products', 'সব পণ্য', 'foot_products'], ['/products?sort=offer', 'অফার', 'foot_offer'],
    ['/track', 'অর্ডার ট্র্যাক করুন', 'foot_track'], ['/blog', 'ব্লগ', 'foot_blog'], ['/wishlist', '♡ পছন্দের তালিকা', 'wishlist_on'],
    ...(s.acct_on === '1' ? [['/account', '👤 আমার অ্যাকাউন্ট', 'foot_account']] : []),
    ...(s.gift_on === '1' ? [['/gift-card', '🎁 গিফট কার্ড', 'foot_gift']] : []),
    ...(s.ui_compare !== '0' ? [['/compare', '⚖️ পণ্য তুলনা', 'foot_compare']] : []),
    ...(s.shoppush_on === '1' && s.push_vapid_public ? [['#offers-on', '🔔 অফারের খবর পান', 'foot_push']] : []),
  ].filter(([, , k]) => s[k] !== '0').concat(footerLinks.map((l) => [l.url, l.label]));
  const infoPages = pages.filter((p) => p.in_footer);
  const socials = Object.keys(SOCIAL_ICONS).filter((k) => s[k]);
  const liveLinks = [['cricket', '🏏 ক্রিকেট স্কোর'], ['football', '⚽ ফুটবল স্কোর']].filter(([k]) => s[`live_${k}`] === '1');
  const showLiveNav = liveLinks.length > 0 && s.nav_live !== '0';
  const liveLabel = s.live_nav_label || 'লাইভ স্কোর';
  // Running match score in the thin bar at the very top, next to the notice text (no pop-up, no ✕).
  const mini = liveLinks.length > 0 && s.live_mini !== '0' && active !== 'live';
  // বাংলা / English switch: right end of the thin dark bar at the very top (the usual place for a language choice)
  const langOn = s.i18n_on === '1';
  // the top notice bar and other parts the owner can hide (Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে)
  const noticeText = U.on(s, 'ui_notice') ? s.notice : '';
  const C = contact(s);
  const wa = C.wa || (C.phone ? C.phone.replace(/\D/g, '').replace(/^0/, '880') : '');
  const cfg = {
    maxQty: C.maxQty, phone: C.phone, wa: C.wa, rule: { on: s.small_qty_on !== '0', cap: Number(s.small_max_price) || 5, maxVal: Number(s.small_max_value) || 100 },
    minOrder: Math.max(0, Number(s.min_order) || 0), fb: !!s.fb_pixel_id, tt: !!s.tiktok_pixel_id, ga: !!(s.ga4_id || s.gtm_id), g4: !!s.ga4_id,
    protect: s.copy_protect === '1', copyTitle: s.copy_title === '1', track, va: s.visitor_tracking !== '0',
    i18n: s.i18n_on === '1' ? { rev: s.i18n_rev || '1', def: s.i18n_default === 'en' ? 'en' : 'bn' } : null,
    // 🔔 offer notifications (Admin → মার্কেটিং → ফোনে অফারের নোটিফিকেশন)
    push: s.shoppush_on === '1' && s.push_vapid_public ? {
      key: s.push_vapid_public, ask: s.shoppush_prompt !== '0', delay: Math.max(5, Number(s.shoppush_delay) || 25),
      text: s.shoppush_text || 'নতুন অফার আর ফ্ল্যাশ সেলের খবর ফোনে পেতে চান?',
    } : null,
  };
  const chatSecond = s.chat_whatsapp_button === '1' && wa;
  return (
    <>
      {s.gtm_id ? <noscript><iframe src={`https://www.googletagmanager.com/ns.html?id=${s.gtm_id}`} height="0" width="0" style={{ display: 'none', visibility: 'hidden' }}></iframe></noscript> : null}
      <a className="skip" href="#main">মূল অংশে যান</a>
      {noticeText || mini || langOn ? (
        <div className={cx('notice', !noticeText && 'notice-empty', langOn && 'has-lang')} data-notice="">
          <div className="wrap notice-row">
            {noticeText ? <span className="notice-text" data-notice-text=""><span className="nt-in">{noticeText}</span></span> : null}
            {mini ? <a className="live-tick" href={`/live/${liveLinks[0][0]}`} data-live-mini={liveLinks.map(([k]) => k).join(',')} data-refresh={String(Math.min(120, Math.max(10, Number(s.live_refresh) || 20)))} hidden></a> : null}
            {langOn ? <LangSwitch /> : null}
          </div>
        </div>
      ) : null}
      <header className="site-header">
        <div className="wrap header-row">
          <button className="menu-btn" type="button" data-drawer-open="" aria-label="মেনু" aria-controls="drawer"><MenuIcon /></button>{' '}
          <a className="logo" href="/" aria-label={`${s.store_name} হোম`} translate="no"><Logo settings={s} /></a>{' '}
          {U.on(s, 'ui_search') ? (
            <form className="search" action="/products" method="get" role="search">
              <label className="sr" htmlFor="q">পণ্য খুঁজুন</label>{' '}
              <input id="q" name="q" type="search" defaultValue={q} placeholder={U.text(s, 'uit_search_ph')} autoComplete="off" />{' '}
              <button type="submit" aria-label="খুঁজুন"><SearchIcon /></button>{' '}
            </form>
          ) : <span className="search-off" aria-hidden="true"></span>}
          <nav className="header-nav" aria-label="প্রধান মেনু">
            {menu.map((m, i) => <a key={i} href={security.safeUrl(m.url)} className={active && m.url.startsWith('/' + active) ? 'on' : ''}>{m.label}</a>)}{' '}
            {showLiveNav ? <a href="/live" className={cx('live-link', active === 'live' && 'on')}><span className="live-dot" aria-hidden="true"></span>{liveLabel}</a> : null}{' '}
            {s.acct_on === '1' && s.nav_account !== '0' ? <a href="/account" className={cx('acct-link', active === 'account' && 'on')} aria-label="আমার অ্যাকাউন্ট" title="আমার অ্যাকাউন্ট"><UserIcon /><span className="acct-word">অ্যাকাউন্ট</span></a> : null}{' '}
            {showCart ? <a href="/cart" className={cx('cart-link', active === 'cart' && 'on')} aria-label="কার্ট"><CartIcon /><span className="cart-word">কার্ট</span><b className="cart-count" data-cart-count="" hidden>0</b></a> : null}
          </nav>
        </div>
        {categories.length && s.show_cat_strip !== '0' ? <nav className="cat-strip" aria-label="ক্যাটাগরি"><div className="wrap"><ul className="cat-menu" data-cat-menu=""><CatMenuItems nodes={roots} top /></ul></div></nav> : null}
      </header>
      <aside className="drawer" id="drawer" aria-label="মেনু" hidden>
        <div className="drawer-head"><a className="logo logo-sm" href="/" translate="no"><Logo settings={s} /></a><button type="button" className="drawer-x" data-drawer-close="" aria-label="বন্ধ করুন">✕</button></div>
        <nav>
          {menu.map((m, i) => <a key={i} href={security.safeUrl(m.url)}>{m.label}</a>)}
          {s.acct_on === '1' ? <a href="/account">👤 আমার অ্যাকাউন্ট</a> : null}
          {showCart ? <a href="/cart">কার্ট</a> : null}
          {s.wishlist_on !== '0' ? <a href="/wishlist">♡ পছন্দের তালিকা</a> : null}
        </nav>
        {showLiveNav ? <nav><a href="/live"><span className="live-dot" aria-hidden="true"></span> {liveLabel}</a></nav> : null}
        {categories.length ? <><p className="drawer-title">ক্যাটাগরি</p><nav className="drawer-cats"><DrawerCats nodes={roots} /></nav></> : null}
      </aside>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div>
            <a className="logo logo-sm footer-logo" href="/" translate="no"><Logo settings={s} /></a>
            {U.on(s, 'ui_foot_about') ? <p>{s.footer_about || s.tagline}</p> : null}
            {socials.length && U.on(s, 'ui_foot_social') ? (
              <div className="socials">{socials.map((k) => (
                <a key={k} href={security.safeUrl(s[k])} target="_blank" rel="noopener" aria-label={SOCIAL_ICONS[k][0]}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={SOCIAL_ICONS[k][1]} /></svg></a>
              ))}</div>
            ) : null}
          </div>
          {shopLinks.length ? (
            <div>
              <h2>কেনাকাটা</h2>
              {shopLinks.map(([url, label]) => (url === '#offers-on' ? <a key={url} href="#" data-push-ask="">{label}</a> : <a key={url} href={security.safeUrl(url)}>{label}</a>))}{' '}
            </div>
          ) : null}
          {infoPages.length ? (
            <div>
              <h2>তথ্য</h2>
              {infoPages.map((p) => <a key={p.slug} href={`/page/${p.slug}`}>{p.title}</a>)}{' '}
            </div>
          ) : null}
          {s.foot_contact !== '0' && (C.phone || C.wa || s.email || s.address || s.complaints_on !== '0') ? (
            <div>
              <h2>যোগাযোগ</h2>
              {C.phone ? <a href={`tel:${C.phone}`}>📞 {C.phone}</a> : null}{' '}
              {C.wa ? <a href={`https://wa.me/${C.wa}`} rel="noopener" target="_blank">💬 WhatsApp</a> : null}{' '}
              {s.email ? <a href={`mailto:${s.email}`}>✉ {s.email}</a> : null}{' '}
              {s.complaints_on !== '0' ? <a href="/complaint">📮 অভিযোগ / সমস্যা জানান</a> : null}{' '}
              {s.address ? <span className="muted">{s.address}</span> : null}{' '}
            </div>
          ) : null}
        </div>
        {s.email_mkt_on === '1' && s.email_sub_box !== '0' ? (
          <div className="news-box"><div className="wrap">
            <div><h2>🎁 অফার আর নতুন পণ্যের খবর</h2><p>ইমেইল দিন — সপ্তাহে একবারের বেশি নয়, যেকোনো সময় বন্ধ করা যায়।</p></div>
            <form className="news-form" data-news-form="" noValidate>
              <input type="email" name="email" required maxLength={120} autoComplete="email" inputMode="email" placeholder="আপনার ইমেইল" aria-label="আপনার ইমেইল" />{' '}
              <input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />{' '}
              <button className="btn btn-amber" type="submit">যোগ দিন</button>{' '}
              <p className="news-msg" data-news-msg="" role="status"></p>
            </form>
          </div></div>
        ) : null}
        <div className="wrap footer-base">© {new Date().getFullYear()} {s.store_name} · সর্বস্বত্ব সংরক্ষিত{s.trade_license ? <span className="biz-id"> · ট্রেড লাইসেন্স: <span translate="no">{s.trade_license}</span></span> : null}{s.vat_bin ? <span className="biz-id"> · BIN: <span translate="no">{s.vat_bin}</span></span> : null}</div>
      </footer>
      {s.chat_whatsapp_button === '1' && wa ? <a className="float-chat wa" href={`https://wa.me/${wa}`} target="_blank" rel="noopener" aria-label="WhatsApp এ চ্যাট করুন"><WhatsAppIcon /></a> : null}{' '}
      {s.chat_messenger_page ? <a className={cx('float-chat ms', chatSecond && 'second')} href={`https://m.me/${s.chat_messenger_page}`} target="_blank" rel="noopener" aria-label="Messenger এ চ্যাট করুন"><MessengerIcon /></a> : null}{' '}
      {popup ? (
        <div className="popup" data-popup={popup.id} hidden><div className="popup-box"><button type="button" className="popup-x" data-popup-close="" aria-label="বন্ধ করুন">✕</button>{' '}
          <a href={security.safeUrl(popup.link)}><img src={`/media/${popup.image_id}`} alt={popup.title || 'অফার'} /></a></div></div>
      ) : null}
      <div className="toast" role="status" aria-live="polite" data-toast=""></div>
      <script dangerouslySetInnerHTML={{ __html: `window.SM=${JSON.stringify(cfg).replace(/</g, '\\u003c')};` }} />
      {s.i18n_on === '1' ? <script type="module" src={`/js/i18n/main.js?v=${ASSET_V}`}></script> : null}
      <script type="module" src={`/js/shop/main.js?v=${ASSET_V}`}></script>
      {s.chat_tawk_property ? <script dangerouslySetInnerHTML={{ __html: tawkLoader(String(s.chat_tawk_property), String(s.chat_tawk_widget || 'default')) }} /> : null}
      <BodyHtml html={(s.chat_script || '') + (s.custom_body || '') + customScripts(s, 'body')} />
    </>
  );
}

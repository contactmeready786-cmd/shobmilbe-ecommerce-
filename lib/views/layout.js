'use strict';
const U = require('../services/uiswitch');
const security = require('../security');
const { html, raw, esc, contact } = require('../util');
const { jsonSetting } = require('../db');
const { categoryTree } = require('../models/catalog');

const ASSET_V = '35';

const icons = {
  search: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m20 20-3.6-3.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  cart: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 4h2.2l2.2 11h10.4l2-8H6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="9.5" cy="19.5" r="1.6" fill="currentColor"/><circle cx="16.5" cy="19.5" r="1.6" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  wa: '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-1-2.2-1-.3-.1-.5-.2-.7.1l-1 1.3c-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.3c.2.2 2.3 3.5 5.5 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.6-.5Z"/></svg>',
  ms: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M16 3C8.8 3 3 8.4 3 15.1c0 3.8 1.9 7.2 4.8 9.4V29l4.4-2.4c1.2.3 2.5.5 3.8.5 7.2 0 13-5.4 13-12.1S23.2 3 16 3Zm1.3 16.3-3.3-3.5-6.4 3.5 7.1-7.5 3.4 3.5 6.3-3.5-7.1 7.5Z"/></svg>',
};
const SOCIAL_ICONS = {
  social_facebook: ['Facebook', 'M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9h3l.5-4h-3.5V8.8c0-.5.3-.8.5-.8Z'],
  social_instagram: ['Instagram', 'M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3Zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 4c2.2 0 2.5 0 3.3.1 2.2.1 3.2 1.1 3.3 3.3.1.9.1 1.1.1 3.3v2.6c0 2.2 0 2.5-.1 3.3-.1 2.2-1.1 3.2-3.3 3.3-.9.1-1.1.1-3.3.1s-2.5 0-3.3-.1c-2.2-.1-3.2-1.1-3.3-3.3C5.3 15.7 5.3 15.4 5.3 13.2v-2.4c0-2.2 0-2.5.1-3.3.1-2.2 1.1-3.2 3.3-3.3C9.5 4 9.8 4 12 4Z'],
  social_youtube: ['YouTube', 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z'],
  social_tiktok: ['TikTok', 'M16.6 3h-3.2v12.2a2.7 2.7 0 1 1-2.7-2.7c.3 0 .5 0 .8.1V9.3a6 6 0 1 0 5.1 5.9V9a7.7 7.7 0 0 0 4.4 1.4V7.2A4.4 4.4 0 0 1 16.6 3Z'],
  social_linkedin: ['LinkedIn', 'M5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3.3 9h3.4v11H3.3V9Zm5.5 0h3.3v1.5c.5-.9 1.6-1.8 3.3-1.8 3.5 0 4.1 2.3 4.1 5.3v6h-3.4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V20H8.8V9Z'],
  social_x: ['X', 'M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.5l11.2 14.5Z'],
  social_pinterest: ['Pinterest', 'M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.8-2.5.9 0 1.3.7 1.3 1.4 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.9 0-2.6-1.8-4.4-4.5-4.4-3 0-4.8 2.3-4.8 4.6 0 .9.4 1.9.8 2.4l.1.4-.3 1.2c0 .2-.2.3-.4.2-1.4-.6-2.2-2.6-2.2-4.2 0-3.4 2.5-6.6 7.2-6.6 3.8 0 6.7 2.7 6.7 6.3 0 3.8-2.4 6.8-5.7 6.8-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.2 1-1 2.2-1.4 2.9A10 10 0 1 0 12 2Z'],
  social_telegram: ['Telegram', 'M21.5 4.3 2.9 11.5c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.8.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.8-1.3-1.6ZM17.3 8l-8 7.2-.3 3.3-1.5-4.6L17.3 8Z'],
};

function mediaUrl(id, thumb) { return id ? `/media/${id}${thumb ? '/t' : ''}` : ''; }

function logo(settings) {
  if (settings.logo_id) return html`<img class="logo-img" src="/media/${settings.logo_id}" alt="${settings.store_name}">`;
  const name = settings.store_name || 'সবমিলবে';
  if (name === 'সবমিলবে') return html`<span class="logo-a">সব</span><span class="logo-b">মিলবে</span>`;
  return html`<span class="logo-a">${name}</span>`;
}

// Admin → পিক্সেল ও ট্র্যাকিং → "যেকোনো স্ক্রিপ্ট বসান": only the owner can save these, each with its own on/off
function customScripts(s, place) {
  let list = [];
  try { list = JSON.parse(s.custom_scripts || '[]'); } catch (_) { list = []; }
  return (Array.isArray(list) ? list : []).filter((x) => x && x.on && x.place === place && x.code).map((x) => `\n<!-- ${String(x.name || '').replace(/--/g, '')} -->\n${x.code}`).join('');
}

function trackingHead(s) {
  let out = '';
  if (s.gtm_id) {
    out += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(s.gtm_id)});</script>`;
  }
  if (s.ga4_id) {
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(s.ga4_id)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(s.ga4_id)});</script>`;
  }
  if (s.fb_pixel_id) {
    out += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(s.fb_pixel_id)});fbq('track','PageView');</script>`;
  }
  if (s.tiktok_pixel_id) {
    out += `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(${JSON.stringify(s.tiktok_pixel_id)});ttq.page();}(window,document,'ttq');</script>`;
  }
  return out;
}

function head({ settings: s, title, description, keywords, canonical, image, jsonLd, jsonLdExtra, type = 'website', noindex }) {
  const kw = keywords || s.seo_keywords || '';
  const desc = description || s.seo_description || s.tagline || '';
  const base = (s.site_url || '').replace(/\/+$/, '');
  const ogImage = image || (s.og_image_id ? `/media/${s.og_image_id}` : s.logo_id ? `/media/${s.logo_id}` : '');
  const abs = (u) => (u && u.startsWith('/') && base ? base + u : u);
  const primary = /^#[0-9a-f]{6}$/i.test(s.color_primary) ? s.color_primary : '#0866D6';
  const accent = /^#[0-9a-f]{6}$/i.test(s.color_accent) ? s.color_accent : '#F5A524';
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
${kw ? html`<meta name="keywords" content="${kw}">` : ''}
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
${canonical && base ? html`<link rel="canonical" href="${base}${canonical}">` : ''}
<meta name="theme-color" content="${primary}">
<meta property="og:type" content="${type}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta property="og:site_name" content="${s.store_name}">${canonical && base ? html`<meta property="og:url" content="${base}${canonical}">` : ''}
${ogImage ? html`<meta property="og:image" content="${abs(ogImage)}"><meta name="twitter:card" content="summary_large_image">` : ''}
${s.fb_domain_verification ? html`<meta name="facebook-domain-verification" content="${s.fb_domain_verification}">` : ''}
${s.google_site_verification ? html`<meta name="google-site-verification" content="${s.google_site_verification}">` : ''}
${s.bing_site_verification ? html`<meta name="msvalidate.01" content="${s.bing_site_verification}">` : ''}
${s.tiktok_domain_verification ? html`<meta name="tiktok-developers-site-verification" content="${s.tiktok_domain_verification}">` : ''}
${s.favicon_id ? html`<link rel="icon" href="/media/${s.favicon_id}/t">` : raw('<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/brand/favicon-192.png">')}
<link rel="apple-touch-icon" href="${s.favicon_id ? `/media/${s.favicon_id}` : '/brand/apple-touch-icon.png'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=${ASSET_V}">
<style>:root{--blue:${primary};--amber:${accent}}</style>
${s.i18n_on === '1' ? raw(langBoot(s)) : ''}
${[jsonLd, jsonLdExtra].filter(Boolean).map((j) => raw(`<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`))}
${raw(trackingHead(s))}
${raw(s.custom_head || '')}
${raw(customScripts(s, 'head'))}`;
}

// বাংলা / English: before the page is drawn, pick the visitor's language (their last choice, a ?lang= link,
// or the shop's default). An English visitor's page stays invisible for the split second it takes to switch,
// so Bangla never flashes (at most 1.2 s, then it shows anyway).
function langBoot(s) {
  const def = s.i18n_default === 'en' ? 'en' : 'bn';
  return `<script>(function(){var d=document.documentElement,l=${JSON.stringify(def)};try{var q=/[?&]lang=(en|bn)(?:&|$)/.exec(location.search);if(q){l=q[1];localStorage.setItem('sm_lang',l);}else{l=localStorage.getItem('sm_lang')||l;}}catch(e){}d.setAttribute('data-lang',l);if(l==='en'){d.lang='en';d.className+=' i18n-wait';setTimeout(function(){d.className=d.className.replace(' i18n-wait','');},1200);}})();</script><style>html.i18n-wait body{visibility:hidden}</style>`;
}
// The small on/off switch in the top bar (বাং ◯ EN): tap it and the whole shop changes language, no reload.
function langSwitch() {
  return html`<button type="button" class="lang-sw" role="switch" aria-checked="false" aria-label="English" title="বাংলা / English" translate="no" data-lang-switch>
    <span class="ls-l ls-bn" data-lang="bn">বাং</span><span class="ls-track" aria-hidden="true"><span class="ls-knob"></span></span><span class="ls-l ls-en" data-lang="en">EN</span>
  </button>`;
}

// Category menus. Top bar: main categories with drop-down sub-categories (any depth).
// Phone menu: the same tree, folding open. Empty sub-categories are left out.
const visibleKids = (n) => n.children.filter((k) => k.total_count > 0);
function catMenuItems(nodes, top) {
  return nodes.map((n) => {
    const kids = visibleKids(n);
    return html`<li class="cm-item ${kids.length ? 'has-sub' : ''}"><a href="/products?cat=${n.slug}"${kids.length ? raw(' aria-haspopup="true"') : ''}>${top ? html`<span class="cm-ic" aria-hidden="true">${n.icon}</span> ` : ''}${n.name}</a>${kids.length ? html`<ul class="cm-sub">${catMenuItems(kids, false)}</ul>` : ''}</li>`;
  });
}
function drawerCats(nodes) {
  return nodes.map((n) => {
    const kids = visibleKids(n);
    return kids.length
      ? html`<details class="dc"><summary>${n.depth === 0 ? html`${n.icon} ` : ''}${n.name}</summary><div class="dc-in"><a href="/products?cat=${n.slug}">সব ${n.name} →</a>${drawerCats(kids)}</div></details>`
      : html`<a href="/products?cat=${n.slug}">${n.depth === 0 ? html`${n.icon} ` : ''}${n.name}</a>`;
  });
}

function shopLayout({ settings: s, title, description, keywords, body, q, active, canonical, image, jsonLd, jsonLdExtra, type, noindex, categories = [], pages = [], track = null, popup = null }) {
  const full = title ? `${title} | ${s.store_name}` : (s.seo_title || `${s.store_name} | অনলাইন শপ`);
  const { roots } = categoryTree(categories);
  const menu = jsonSetting(s, 'header_menu', []).filter((m) => m.on !== false); // admin can switch each button off
  const showCart = s.nav_cart !== '0';
  const footerLinks = jsonSetting(s, 'footer_links', []).filter((l) => l.on !== false);
  // footer "কেনাকাটা" column — each link can be switched off from the admin
  const shopLinks = [
    ['/products', 'সব পণ্য', 'foot_products'], ['/products?sort=offer', 'অফার', 'foot_offer'],
    ['/track', 'অর্ডার ট্র্যাক করুন', 'foot_track'], ['/blog', 'ব্লগ', 'foot_blog'], ['/wishlist', '♡ পছন্দের তালিকা', 'wishlist_on'],
    ...(s.acct_on === '1' ? [['/account', '👤 আমার অ্যাকাউন্ট', 'foot_account']] : []),
    ...(s.gift_on === '1' ? [['/gift-card', '🎁 গিফট কার্ড', 'foot_gift']] : []),
    ...(s.ui_compare !== '0' ? [['/compare', '⚖️ পণ্য তুলনা', 'foot_compare']] : []),
  ].filter(([, , k]) => s[k] !== '0').concat(footerLinks.map((l) => [l.url, l.label]));
  const infoPages = pages.filter((p) => p.in_footer);
  const socials = Object.keys(SOCIAL_ICONS).filter((k) => s[k]);
  const liveLinks = [['cricket', '🏏 ক্রিকেট স্কোর'], ['football', '⚽ ফুটবল স্কোর']].filter(([k]) => s[`live_${k}`] === '1');
  const showLiveNav = liveLinks.length && s.nav_live !== '0';
  const liveLabel = s.live_nav_label || 'লাইভ স্কোর';
  // Running match score in the thin bar at the very top, next to the notice text (no pop-up, no ✕).
  const mini = liveLinks.length && s.live_mini !== '0' && active !== 'live';
  const miniAttrs = mini ? raw(` data-live-mini="${liveLinks.map(([k]) => k).join(',')}" data-refresh="${Math.min(120, Math.max(10, Number(s.live_refresh) || 20))}"`) : '';
  // বাংলা / English switch: right end of the thin dark bar at the very top (the usual place for a language choice)
  const langOn = s.i18n_on === '1';
  // the top notice bar and other parts the owner can hide (Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে)
  const noticeText = U.on(s, 'ui_notice') ? s.notice : '';
  const C = contact(s);
  const wa = C.wa || (C.phone ? C.phone.replace(/\D/g, '').replace(/^0/, '880') : '');
  const cfg = { maxQty: C.maxQty, phone: C.phone, wa: C.wa, rule: { on: s.small_qty_on !== '0', cap: Number(s.small_max_price) || 5, maxVal: Number(s.small_max_value) || 100 }, minOrder: Math.max(0, Number(s.min_order) || 0), fb: !!s.fb_pixel_id, tt: !!s.tiktok_pixel_id, ga: !!(s.ga4_id || s.gtm_id), g4: !!s.ga4_id, protect: s.copy_protect === '1', track, va: s.visitor_tracking !== '0',
    i18n: s.i18n_on === '1' ? { rev: s.i18n_rev || '1', def: s.i18n_default === 'en' ? 'en' : 'bn' } : null };
  return '<!doctype html>' + html`<html lang="bn">
<head>${head({ settings: s, title: full, description, keywords, canonical, image, jsonLd, jsonLdExtra, type, noindex })}</head>
<body class="shop ${s.copy_protect === '1' ? 'protect' : ''} cols-${s.grid_cols || '4'}">
${s.gtm_id ? raw(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(s.gtm_id)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`) : ''}
<a class="skip" href="#main">মূল অংশে যান</a>
${noticeText || mini || langOn ? html`<div class="notice ${noticeText ? '' : 'notice-empty'} ${langOn ? 'has-lang' : ''}" data-notice><div class="wrap notice-row">${noticeText ? html`<span class="notice-text" data-notice-text><span class="nt-in">${noticeText}</span></span>` : ''}${mini ? html`<a class="live-tick" href="/live/${liveLinks[0][0]}"${miniAttrs} hidden></a>` : ''}${langOn ? langSwitch() : ''}</div></div>` : ''}
<header class="site-header">
  <div class="wrap header-row">
    <button class="menu-btn" type="button" data-drawer-open aria-label="মেনু" aria-controls="drawer">${raw(icons.menu)}</button>
    <a class="logo" href="/" aria-label="${s.store_name} হোম" translate="no">${logo(s)}</a>
    ${U.on(s, 'ui_search') ? html`<form class="search" action="/products" method="get" role="search">
      <label class="sr" for="q">পণ্য খুঁজুন</label>
      <input id="q" name="q" type="search" value="${q || ''}" placeholder="${U.text(s, 'uit_search_ph')}" autocomplete="off">
      <button type="submit" aria-label="খুঁজুন">${raw(icons.search)}</button>
    </form>` : html`<span class="search-off" aria-hidden="true"></span>`}
    <nav class="header-nav" aria-label="প্রধান মেনু">
      ${menu.map((m) => html`<a href="${security.safeUrl(m.url)}" class="${active && m.url.startsWith('/' + active) ? 'on' : ''}">${m.label}</a>`)}
      ${showLiveNav ? html`<a href="/live" class="live-link ${active === 'live' ? 'on' : ''}"><span class="live-dot" aria-hidden="true"></span>${liveLabel}</a>` : ''}
      ${s.acct_on === '1' && s.nav_account !== '0' ? html`<a href="/account" class="acct-link ${active === 'account' ? 'on' : ''}" aria-label="আমার অ্যাকাউন্ট" title="আমার অ্যাকাউন্ট">${raw(icons.user)}<span class="acct-word">অ্যাকাউন্ট</span></a>` : ''}
      ${showCart ? html`<a href="/cart" class="cart-link ${active === 'cart' ? 'on' : ''}" aria-label="কার্ট">${raw(icons.cart)}<span class="cart-word">কার্ট</span><b class="cart-count" data-cart-count hidden>0</b></a>` : ''}
    </nav>
  </div>
  ${categories.length && s.show_cat_strip !== '0' ? html`<nav class="cat-strip" aria-label="ক্যাটাগরি"><div class="wrap"><ul class="cat-menu" data-cat-menu>${catMenuItems(roots, true)}</ul></div></nav>` : ''}
</header>
<aside class="drawer" id="drawer" aria-label="মেনু" hidden>
  <div class="drawer-head"><a class="logo logo-sm" href="/" translate="no">${logo(s)}</a><button type="button" class="drawer-x" data-drawer-close aria-label="বন্ধ করুন">✕</button></div>
  <nav>${menu.map((m) => html`<a href="${security.safeUrl(m.url)}">${m.label}</a>`)}${s.acct_on === '1' ? html`<a href="/account">👤 আমার অ্যাকাউন্ট</a>` : ''}${showCart ? html`<a href="/cart">কার্ট</a>` : ''}${s.wishlist_on !== '0' ? html`<a href="/wishlist">♡ পছন্দের তালিকা</a>` : ''}</nav>
  ${showLiveNav ? html`<nav><a href="/live"><span class="live-dot" aria-hidden="true"></span> ${liveLabel}</a></nav>` : ''}
  ${categories.length ? html`<p class="drawer-title">ক্যাটাগরি</p><nav class="drawer-cats">${drawerCats(roots)}</nav>` : ''}
</aside>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="logo logo-sm footer-logo" href="/" translate="no">${logo(s)}</a>
      ${U.on(s, 'ui_foot_about') ? html`<p>${s.footer_about || s.tagline}</p>` : ''}
      ${socials.length && U.on(s, 'ui_foot_social') ? html`<div class="socials">${socials.map((k) => html`<a href="${security.safeUrl(s[k])}" target="_blank" rel="noopener" aria-label="${SOCIAL_ICONS[k][0]}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="${SOCIAL_ICONS[k][1]}"/></svg></a>`)}</div>` : ''}
    </div>
    ${shopLinks.length ? html`<div>
      <h2>কেনাকাটা</h2>
      ${shopLinks.map(([url, label]) => html`<a href="${security.safeUrl(url)}">${label}</a>`)}
    </div>` : ''}
    ${infoPages.length ? html`<div>
      <h2>তথ্য</h2>
      ${infoPages.map((p) => html`<a href="/page/${p.slug}">${p.title}</a>`)}
    </div>` : ''}
    ${s.foot_contact !== '0' && (C.phone || C.wa || s.email || s.address) ? html`<div>
      <h2>যোগাযোগ</h2>
      ${C.phone ? html`<a href="tel:${C.phone}">📞 ${C.phone}</a>` : ''}
      ${C.wa ? html`<a href="https://wa.me/${C.wa}" rel="noopener" target="_blank">💬 WhatsApp</a>` : ''}
      ${s.email ? html`<a href="mailto:${s.email}">✉ ${s.email}</a>` : ''}
      ${s.address ? html`<span class="muted">${s.address}</span>` : ''}
    </div>` : ''}
  </div>
  <div class="wrap footer-base">© ${new Date().getFullYear()} ${s.store_name} · সর্বস্বত্ব সংরক্ষিত</div>
</footer>
${s.chat_whatsapp_button === '1' && wa ? html`<a class="float-chat wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" aria-label="WhatsApp এ চ্যাট করুন">${raw(icons.wa)}</a>` : ''}
${s.chat_messenger_page ? html`<a class="float-chat ms ${s.chat_whatsapp_button === '1' && wa ? 'second' : ''}" href="https://m.me/${s.chat_messenger_page}" target="_blank" rel="noopener" aria-label="Messenger এ চ্যাট করুন">${raw(icons.ms)}</a>` : ''}
${popup ? html`<div class="popup" data-popup="${popup.id}" hidden><div class="popup-box"><button type="button" class="popup-x" data-popup-close aria-label="বন্ধ করুন">✕</button>
  <a href="${security.safeUrl(popup.link)}"><img src="/media/${popup.image_id}" alt="${popup.title || 'অফার'}"></a></div></div>` : ''}
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script>window.SM=${raw(JSON.stringify(cfg).replace(/</g, '\\u003c'))};</script>
${s.i18n_on === '1' ? html`<script src="/js/i18n.js?v=${ASSET_V}" defer></script>` : ''}
<script src="/js/shop.js?v=${ASSET_V}" defer></script>
${s.chat_tawk_property ? raw(`<script>var Tawk_API=Tawk_API||{};(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src='https://embed.tawk.to/${esc(s.chat_tawk_property)}/${esc(s.chat_tawk_widget || 'default')}';s1.charset='UTF-8';s1.setAttribute('crossorigin','*');s0.parentNode.insertBefore(s1,s0);})();</script>`) : ''}
${raw(s.chat_script || '')}
${raw(s.custom_body || '')}
${raw(customScripts(s, 'body'))}
</body></html>`.s;
}

module.exports = { shopLayout, icons, logo, mediaUrl, ASSET_V };

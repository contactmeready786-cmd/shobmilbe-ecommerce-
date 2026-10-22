// 📱 A small card telling visitors the সবমিলবে Android app exists (/app) — and, inside an older copy of the app, that a
// new version is out. Fixed at the bottom (the page never jumps). Android phones (also Chrome's "desktop site" mode)
// get "ডাউনলোড"; computers get "দেখুন" (how to get it on the phone); iPhones get nothing (no app for them yet).
// Waits while something else sits at the bottom (a product page's buy bar, the notification question, the offer
// pop-up, the compare bar) instead of covering it; never on the cart / checkout / order / the app page itself.
// The owner sets the rules on Admin → মার্কেটিং → মেসেজ → 📱 অ্যাপের কার্ড (window.SM.invite; lib/app-invite.ts): on/off,
// who gets it, after how many seconds, the texts, and what "✕" does — by default it only closes it on this page and it
// comes back on the next page or a refresh (owner, 2026-10-20); the owner may make it stay away for some days.
import { h } from '../jsx.js';
import { store } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';
import { appVersionOf, inviteKind, inviteAllowed, INVITE_DEFAULTS, type InviteConfig, type InviteKind as Kind } from '../app-release.js';

const HIDE_KEY = 'sm_app_invite_hidden';

export function startAppInvite(): void {
  const SM: Partial<ShopConfig> = window.SM || {};
  const rules: InviteConfig = SM.invite || INVITE_DEFAULTS;
  const kind = inviteKind(navigator.userAgent, navigator.maxTouchPoints || 0);
  if (!inviteAllowed(rules, kind, location.pathname, Date.now(), Number(store(HIDE_KEY)) || 0)) return;
  let tries = 0;
  const attempt = () => {
    if (busyBottom()) { if (++tries < 15) setTimeout(attempt, 4000); return; }
    show(kind!, rules);
  };
  setTimeout(attempt, Math.max(0, rules.delay) * 1000);
}

/** Something else is showing at the bottom of the screen (or the offer pop-up is open). */
function busyBottom(): boolean {
  const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && !(el as HTMLElement).hidden;
  return shown(document.querySelector('.sticky-buy.show')) || shown(document.querySelector('.push-ask'))
    || shown(document.querySelector('.compare-bar')) || shown(document.querySelector('[data-popup]'));
}

function show(kind: Kind, rules: InviteConfig): void {
  if (document.querySelector('.app-invite')) return;
  const inApp = appVersionOf(navigator.userAgent);
  const close = () => {
    card.remove();
    // the owner's "hide for N days" (0 = only this page)
    if (rules.hideDays > 0) store(HIDE_KEY, String(Date.now() + rules.hideDays * 86400000));
  };
  const t = (x: { title: string; sub: string; btn: string }) => [x.title, x.sub, x.btn];
  const text = {
    update: ['🎉 অ্যাপের নতুন সংস্করণ এসেছে', `আপনার আছে ${inApp} — নতুনটা নিলে আরও ভালো চলবে।`, 'আপডেট'],
    android: t(rules.texts.android),
    computer: t(rules.texts.computer),
  }[kind];
  const card = h('div', { className: 'app-invite', role: 'dialog', 'aria-label': 'সবমিলবে অ্যাপ' },
    h('img', { src: '/icon-192.png', alt: '', width: '44', height: '44' }),
    h('div', { className: 'app-invite-text' }, h('b', null, text[0]), h('span', null, text[1])),
    h('a', { className: 'btn btn-amber btn-sm', href: '/app', onClick: close }, text[2]),
    h('button', { type: 'button', className: 'app-invite-x', 'aria-label': 'পরে', onClick: close }, '✕'));
  document.body.appendChild(card);
}

// 📱 A small card telling visitors the সবমিলবে Android app exists (/app) — and, inside an older copy of the app, that a
// new version is out. Fixed at the bottom (the page never jumps). Android phones (also Chrome's "desktop site" mode)
// get "ডাউনলোড"; computers get "দেখুন" (how to get it on the phone); iPhones get nothing (no app for them yet).
// Waits while something else sits at the bottom (a product page's buy bar, the notification question, the offer
// pop-up, the compare bar) instead of covering it; never on the cart / checkout / order / the app page itself.
// "✕" (or "ডাউনলোড") only closes it on this page: it comes back on the next page or a refresh (owner, 2026-10-20 —
// never hide it for days).
import { h } from '../jsx.js';
import { appVersionOf, inviteKind, type InviteKind as Kind } from '../app-release.js';

export function startAppInvite(): void {
  const kind = inviteKind(navigator.userAgent, navigator.maxTouchPoints || 0);
  if (!kind) return;
  if (/^\/(app|checkout|cart|order|admin)(\/|$)/.test(location.pathname)) return;
  let tries = 0;
  const attempt = () => {
    if (busyBottom()) { if (++tries < 15) setTimeout(attempt, 4000); return; }
    show(kind);
  };
  setTimeout(attempt, 3000);
}

/** Something else is showing at the bottom of the screen (or the offer pop-up is open). */
function busyBottom(): boolean {
  const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && !(el as HTMLElement).hidden;
  return shown(document.querySelector('.sticky-buy.show')) || shown(document.querySelector('.push-ask'))
    || shown(document.querySelector('.compare-bar')) || shown(document.querySelector('[data-popup]'));
}

function show(kind: Kind): void {
  if (document.querySelector('.app-invite')) return;
  const inApp = appVersionOf(navigator.userAgent);
  const close = () => card.remove();
  const text = {
    update: ['🎉 অ্যাপের নতুন সংস্করণ এসেছে', `আপনার আছে ${inApp} — নতুনটা নিলে আরও ভালো চলবে।`, 'আপডেট'],
    android: ['📱 সবমিলবে অ্যাপ', 'অর্ডার, অফার আর ট্র্যাক — এক চাপে।', 'ডাউনলোড'],
    computer: ['📱 আমাদের Android অ্যাপ আছে', 'ফোনে অর্ডার, অফার আর ট্র্যাক — এক চাপে।', 'দেখুন'],
  }[kind];
  const card = h('div', { className: 'app-invite', role: 'dialog', 'aria-label': 'সবমিলবে অ্যাপ' },
    h('img', { src: '/icon-192.png', alt: '', width: '44', height: '44' }),
    h('div', { className: 'app-invite-text' }, h('b', null, text[0]), h('span', null, text[1])),
    h('a', { className: 'btn btn-amber btn-sm', href: '/app', onClick: close }, text[2]),
    h('button', { type: 'button', className: 'app-invite-x', 'aria-label': 'পরে', onClick: close }, '✕'));
  document.body.appendChild(card);
}

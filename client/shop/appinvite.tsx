// 📱 A small card inviting Android phone visitors to download the সবমিলবে app (/app), and — inside an older copy of
// the app — telling them a new version is out. Fixed at the bottom (the page never jumps), shown a few seconds after
// the page opens, never on the cart / checkout / the app page itself, never over a product page's buy bar or the
// notification question, and "পরে" keeps it away for a while (this browser only).
import { h } from '../jsx.js';
import { store } from '../dom.js';
import { APP_VERSION, appVersionOf, olderVersion } from '../app-release.js';

const HIDE_KEY = 'sm_app_invite_hide';
const DAY = 24 * 60 * 60 * 1000;

export function startAppInvite(): void {
  const ua = navigator.userAgent;
  const inApp = appVersionOf(ua);
  const update = !!inApp && olderVersion(inApp, APP_VERSION);
  if (inApp && !update) return; // already on the newest app
  if (!inApp && !(/Android/i.test(ua) && /Mobile/i.test(ua))) return; // only Android phones (no app for iPhone yet)
  const path = location.pathname;
  if (path === '/app' || path.startsWith('/checkout') || path.startsWith('/cart') || path.startsWith('/admin')) return;
  const until = Number(store(HIDE_KEY) || 0);
  if (until > Date.now()) return;
  setTimeout(() => show(update, inApp), 6000);
}

function show(update: boolean, inApp: string): void {
  // something else already sits at the bottom: try another page
  const buyBar = document.querySelector<HTMLElement>('.sticky-buy');
  if ((buyBar && getComputedStyle(buyBar).display !== 'none') || document.querySelector('.push-ask, .compare-bar')) return;
  const close = (days: number) => {
    store(HIDE_KEY, String(Date.now() + days * DAY));
    card.remove();
  };
  const card = h('div', { className: 'app-invite', role: 'dialog', 'aria-label': 'সবমিলবে অ্যাপ' },
    h('img', { src: '/icon-192.png', alt: '', width: '44', height: '44' }),
    h('div', { className: 'app-invite-text' },
      h('b', null, update ? '🎉 অ্যাপের নতুন সংস্করণ এসেছে' : '📱 সবমিলবে অ্যাপ'),
      h('span', null, update ? `আপনার আছে ${inApp} — নতুনটা নিলে আরও ভালো চলবে।` : 'অর্ডার, অফার আর ট্র্যাক — এক চাপে।')),
    h('a', { className: 'btn btn-amber btn-sm', href: '/app', onClick: () => close(update ? 3 : 30) }, update ? 'আপডেট' : 'ডাউনলোড'),
    h('button', { type: 'button', className: 'app-invite-x', 'aria-label': 'পরে', onClick: () => close(update ? 3 : 21) }, '✕'));
  document.body.appendChild(card);
}

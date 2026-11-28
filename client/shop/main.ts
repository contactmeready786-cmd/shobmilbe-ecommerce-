// সবমিলবে — the storefront's browser code (cart, checkout, gallery, live scores, tracking, small forms).
// Starts once React has taken over the page (see whenReady), so React never finds something already changed.
//
// ⚡ Speed (owner, 2026-11-28: "never feel slow, even on slow internet"): the parts every page needs load at once;
// the parts only one kind of page needs (product gallery, cart page, checkout, lessons, calculators) are fetched only
// on a page that has them — a visitor on the home page no longer downloads the checkout or the calculators.
import { whenReady } from '../dom.js';
import { startAppInvite } from './appinvite.js';
import { startCartButtons, startFbt, updateCount } from './cart.js';
import { startCartRemind } from './cartremind.js';
import { startForms } from './forms.js';
import { startHelp } from './help.js';
import { startLanding } from './landing.js';
import { startLists } from './lists.js';
import { startLive } from './live.js';
import { startTracking } from './track.js';
import { startUi } from './ui.js';
import { startPics } from './pics.js';

/** page-only parts: [name, the marks that show the page has it, how to load it] */
const ON_DEMAND: [string, string, () => Promise<() => void>][] = [
  ['product', '[data-gallery],[data-variants]', async () => (await import('./product.js')).startProduct],
  ['cart page', '[data-cart-page],[data-cart-suggest]', async () => (await import('./cartpage.js')).startCartPage],
  ['checkout', '[data-checkout]', async () => (await import('./checkout.js')).startCheckout],
  ['learn', '[data-learn-list],[data-lesson-page],[data-quiz],[data-tutor],[data-cert],[data-cert-link]', async () => (await import('./learn.js')).startLearn],
  ['tools', '[data-calc]', async () => (await import('./tools.js')).startTools],
];

whenReady(() => {
  const parts: [string, () => void][] = [
    ['pictures', startPics], ['tracking', startTracking], ['ui', startUi], ['cart', startCartButtons], ['bought together', startFbt],
    ['landing', startLanding], ['live', startLive], ['lists', startLists], ['forms', startForms], ['app invite', startAppInvite], ['help', startHelp], ['cart reminder', startCartRemind],
  ];
  // one broken part must never stop the rest of the page (the cart keeps working even if, say, live scores fail)
  for (const [name, start] of parts) {
    try { start(); } catch (e) { console.error(`সবমিলবে: ${name} could not start`, e); }
  }
  for (const [name, marks, load] of ON_DEMAND) {
    if (!document.querySelector(marks)) continue;
    load().then((start) => start()).catch((e) => console.error(`সবমিলবে: ${name} could not start`, e));
  }
  updateCount();
});

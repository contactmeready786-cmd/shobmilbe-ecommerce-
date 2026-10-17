// সবমিলবে — the storefront's browser code (cart, checkout, gallery, live scores, tracking, small forms).
// Starts once React has taken over the page (see whenReady), so React never finds something already changed.
import { whenReady } from '../dom.js';
import { startCartButtons, updateCount } from './cart.js';
import { startCartPage } from './cartpage.js';
import { startCheckout } from './checkout.js';
import { startForms } from './forms.js';
import { startLists } from './lists.js';
import { startLive } from './live.js';
import { startProduct } from './product.js';
import { startTracking } from './track.js';
import { startUi } from './ui.js';

whenReady(() => {
  const parts: [string, () => void][] = [
    ['tracking', startTracking], ['ui', startUi], ['cart', startCartButtons], ['product', startProduct],
    ['cart page', startCartPage], ['checkout', startCheckout], ['live', startLive], ['lists', startLists], ['forms', startForms],
  ];
  // one broken part must never stop the rest of the page (the cart keeps working even if, say, live scores fail)
  for (const [name, start] of parts) {
    try { start(); } catch (e) { console.error(`সবমিলবে: ${name} could not start`, e); }
  }
  updateCount();
});

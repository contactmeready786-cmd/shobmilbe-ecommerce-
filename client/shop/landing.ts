// 🚀 A landing page (/lp/<slug>): one product and the order form on the same page. The cart becomes just this product
// (the amount box changes it), so the order form's summary shows exactly what the ad offered. Runs before the order
// form starts (client/shop/main.ts); a change of amount tells the form with the "sm:cart" event.
import { $, $all, hit } from '../dom.js';
import { readCart, rememberPacks, rule, toPacks, writeCart, type Cart } from './cart.js';

export function startLanding(): void {
  const lp = $('[data-lp]');
  if (!lp) { bringBack(); return; }
  const id = lp.getAttribute('data-lp-product') || '';
  if (!id) return;
  rememberPacks(id, lp.getAttribute('data-lp-packs') || '');
  const r = rule(lp.getAttribute('data-lp-price'), id);
  const min = Math.max(1, Number(lp.getAttribute('data-lp-min')) || r.min);
  const max = Math.max(min, Number(lp.getAttribute('data-lp-max')) || r.max);
  const box = $<HTMLInputElement>('[data-lp-n]', lp);
  const fit = (n: number) => (r.step > 1 ? toPacks(n, { ...r, min, max }) : Math.min(max, Math.max(min, Math.round(n) || min)));

  // the products already in the cart wait aside (the order form here is for this one product); they come back on
  // the next other page of the shop (after ordering too), so nothing the shopper chose is lost
  const before = readCart();
  const others: Cart = {};
  for (const [k, n] of Object.entries(before)) if (k !== id) others[k] = n;
  const qty = fit(before[id] || min);
  if (Object.keys(others).length) {
    try { sessionStorage.setItem('sm_cart_aside', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('sm_cart_aside') || '{}') as Cart, ...others })); } catch { /* private mode */ }
  }
  writeCart({ [id]: qty });
  if (box) box.value = String(qty);
  const set = (n: number) => {
    const q = fit(n);
    if (box) box.value = String(q);
    writeCart({ [id]: q });
    window.dispatchEvent(new CustomEvent('sm:cart'));
  };
  lp.addEventListener('click', (e) => {
    const b = hit(e, '[data-lp-step]');
    if (b) { set(Number(box?.value || min) + Number(b.getAttribute('data-lp-step')) * (r.step || 1)); return; }
    const t = hit(e, '[data-lp-img]');
    if (t) {
      const main = $<HTMLImageElement>('[data-lp-main]', lp);
      if (main) main.src = t.getAttribute('data-lp-img') || main.src;
      for (const x of $all('[data-lp-img]', lp)) x.classList.toggle('on', x === t);
      return;
    }
    const go = hit<HTMLAnchorElement>(e, '[data-lp-go]');
    if (go) {
      e.preventDefault();
      $('#order')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $<HTMLInputElement>('#checkout-form input[name="name"]')?.focus({ preventScroll: true }), 600);
    }
  });
  box?.addEventListener('change', () => set(Number(box.value)));

  // the bottom bar hides while the order form is on the screen
  const bar = $('[data-lp-bar]', lp);
  const form = $('#order');
  if (bar && form && 'IntersectionObserver' in window) {
    const seen = new Set<Element>();
    const io = new IntersectionObserver((list) => {
      for (const en of list) { if (en.isIntersecting) seen.add(en.target); else seen.delete(en.target); }
      bar.classList.toggle('hide', seen.size > 0);
    });
    io.observe(form);
    const co = $('[data-checkout]');
    if (co) io.observe(co);
  }
}

/** Any other page: the cart that waited aside while a landing page was open comes back (added to what is there now). */
function bringBack(): void {
  let aside: string | null = null;
  try { aside = sessionStorage.getItem('sm_cart_aside'); } catch { return; }
  if (!aside) return;
  sessionStorage.removeItem('sm_cart_aside');
  try { writeCart({ ...JSON.parse(aside) as Cart, ...readCart() }); } catch { /* nothing to bring back */ }
}

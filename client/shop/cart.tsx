// The cart kept in this browser, the per-product piece limits, the toast message and the "add to cart" buttons.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, hit, money, readJson, store } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';
import { track } from './track.js';

void Fragment;
const SM: Partial<ShopConfig> = window.SM || {};
const KEY = 'sm_cart';
export type Cart = Record<string, number>;

export function readCart(): Cart {
  const c = readJson<Cart>(KEY, {});
  return c && typeof c === 'object' ? c : {};
}
export function writeCart(cart: Cart): void { store(KEY, JSON.stringify(cart)); updateCount(); }
/** Puts a cart back without touching the counter (the page is about to move on). */
export function saveCartQuietly(cart: Cart): void { store(KEY, JSON.stringify(cart)); }
const count = (cart: Cart): number => Object.values(cart).reduce((s, n) => s + n, 0);

// How many pieces of one product a customer may order (same formula as the server, Admin → সেটিংস):
// every product from 1 piece; cheap parts (price up to rule.cap, e.g. ৳5) up to rule.maxVal worth.
// The shop's minimum is on the whole order instead (SM.minOrder, e.g. ৳10 of goods in total).
const MAXQ = Math.max(1, Number(SM.maxQty) || 10);
const RULE: { on: boolean; cap: number; maxVal: number } = SM.rule || { on: true, cap: 5, maxVal: 100 };
const MIN_ORDER = Math.max(0, Number(SM.minOrder) || 0);
export type Rule = { min: number; max: number; small: boolean };

export function rule(price: unknown): Rule {
  const p = Number(price) || 0;
  if (!RULE.on || p <= 0 || p > RULE.cap + 1e-9) return { min: 1, max: MAXQ, small: false };
  return { min: 1, max: Math.max(MAXQ, Math.floor(RULE.maxVal / p + 1e-9)), small: false };
}
/** "add ৳3 more" — the whole order must reach the shop's minimum (goods only, without delivery) */
export const minShort = (subtotal: number): number =>
  MIN_ORDER > 0 && subtotal + 1e-9 < MIN_ORDER ? Math.round((MIN_ORDER - subtotal) * 100) / 100 : 0;
export function minNote(subtotal: number): string {
  const need = minShort(subtotal);
  return need ? `অর্ডার করতে মোট কমপক্ষে ${money(MIN_ORDER)} এর পণ্য নিতে হবে (ডেলিভারি চার্জ বাদে)। এখন আছে ${money(subtotal)} — আরও ${money(need)} এর পণ্য যোগ করুন।` : '';
}

/** product id → price, so the cart knows each product's rule */
export const PRICES: Record<string, number> = {};

function contactLinks(): Node {
  const how: Node[] = [];
  if (SM.phone) how.push(<a href={`tel:${SM.phone}`}>📞 কল করুন</a>);
  if (SM.wa) how.push(<a href={`https://wa.me/${SM.wa}`} target="_blank" rel="noopener">💬 WhatsApp</a>);
  if (!how.length) return document.createTextNode('।');
  return <>{' — '}{how.flatMap((a, i) => (i ? [' · ', a] : [a]))}</>;
}
export const limitText = (max: number): Node =>
  <>এই পণ্যটি একসাথে সর্বোচ্চ {bn(max)}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন{contactLinks()}</>;
export const minText = (r: Rule, price: number): string =>
  `এটি কম দামের পণ্য — কমপক্ষে ${bn(r.min)}টি নিতে হবে (${money(r.min * price)})। না চাইলে "সরান" চাপুন।`;

let toastTimer = 0;
/** The small message at the bottom of the screen. */
export function toast(content: Node | string, ms = 3200): void {
  const t = $('[data-toast]');
  if (!t) return;
  paint(t, content);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
}
/** A toast with a text part and an optional link (the usual "✅ added — কার্ট দেখুন"). */
export const toastLink = (text: Node | string, link?: [string, string], ms?: number): void =>
  toast(<>{<span>{text}</span>}{link ? <a href={link[0]}>{link[1]}</a> : null}</>, ms);

/** Warning about piece limits: under the buttons on a product page, otherwise as a toast. */
export function say(text: Node | string): void {
  const box = $('[data-qty-limit]');
  if (box) { paint(box, '⚠️ ', text); box.hidden = false; return; }
  toast(<span>⚠️ {text}</span>, 6500);
}

/** Adds pieces, keeping the product between its minimum and maximum. Returns what happened. */
export function addToCart(id: string, qty: number, price: number) {
  const cart = readCart();
  const r = rule(price);
  const want = (cart[id] || 0) + qty;
  const got = Math.min(Math.max(want, r.min), r.max);
  cart[id] = got;
  writeCart(cart);
  return { raised: want < r.min, capped: want > r.max, qty: got, rule: r };
}

export function updateCount(bump = false): void {
  const n = count(readCart());
  for (const el of $all('[data-cart-count]')) {
    el.textContent = bn(n);
    el.hidden = n === 0;
    if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  }
}

export function startCartButtons(): void {
  document.addEventListener('click', (e) => {
    const btn = hit(e, '[data-add]');
    if (!btn) return;
    let qty = 1;
    if (btn.hasAttribute('data-with-qty')) {
      const input = $<HTMLInputElement>('[data-qty] input');
      qty = Math.max(1, parseInt(input?.value || '', 10) || 1);
    }
    const id = btn.getAttribute('data-add') || '';
    const name = btn.getAttribute('data-name') || '';
    const price = Number(btn.getAttribute('data-price')) || 0;
    const inCart = readCart()[id] || 0;
    const r0 = rule(price);
    const buyNow = btn.hasAttribute('data-buy-now');
    if (inCart >= r0.max && !buyNow) { say(limitText(r0.max)); return; }
    const res = addToCart(id, qty, price);
    track('add_to_cart', { items: [{ id, name, price, qty: Math.max(1, res.qty - inCart) }] });
    if (buyNow) { location.href = '/checkout'; return; }
    updateCount(true);
    if (res.capped) { say(limitText(res.rule.max)); return; }
    if (res.raised) {
      toastLink(`✅ "${name}" — কম দামের পণ্য, তাই কমপক্ষে ${bn(res.rule.min)}টি (${money(res.rule.min * price)}) কার্টে যোগ হয়েছে`, ['/cart', 'কার্ট দেখুন'], 5000);
      return;
    }
    toastLink(`✅ "${name}" কার্টে যোগ হয়েছে`, ['/cart', 'কার্ট দেখুন']);
  });

  for (const box of $all('[data-qty]')) {
    const input = $<HTMLInputElement>('input', box);
    if (!input) continue;
    const addBtn = $('[data-add][data-with-qty]');
    const price = addBtn ? Number(addBtn.getAttribute('data-price')) || 0 : 0;
    const r = rule(price);
    const fix = (v: number) => {
      const max = parseInt(input.max, 10) || r.max;
      const min = parseInt(input.min, 10) || 1;
      if (v > max && max >= r.max) say(limitText(r.max));
      else if (v < min && r.small) say(`কম দামের পণ্য — কমপক্ষে ${bn(min)}টি নিতে হবে (${money(min * price)})।`);
      input.value = String(Math.min(max, Math.max(min, v)));
    };
    box.addEventListener('click', (e) => {
      const b = hit(e, '[data-step]');
      if (b) fix((parseInt(input.value, 10) || 1) + parseInt(b.getAttribute('data-step') || '0', 10));
    });
    input.addEventListener('change', () => fix(parseInt(input.value, 10) || 1));
  }

  // WhatsApp button on the product page: message carries the product name, price and this page's link
  document.addEventListener('click', (e) => {
    const w = hit<HTMLAnchorElement>(e, '[data-wa-text]');
    if (!w) return;
    w.href = `https://wa.me/${w.getAttribute('data-wa')}?text=${encodeURIComponent(`${w.getAttribute('data-wa-text')}\n${location.href.split('#')[0]}`)}`;
    track('contact', { method: 'whatsapp' });
  });
  for (const el of $all<HTMLInputElement | HTMLSelectElement>('[data-autosubmit]')) el.addEventListener('change', () => el.form?.submit());

  // "order again" on the account page: the same products back into the cart
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-reorder]');
    if (!b) return;
    let items: { id: unknown; qty: unknown }[] = [];
    try { items = JSON.parse(b.getAttribute('data-reorder') || '[]'); } catch { items = []; }
    for (const it of items) addToCart(String(it.id), Math.max(1, Number(it.qty) || 1), 0);
    location.href = '/cart';
  });
}

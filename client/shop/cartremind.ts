// 🛒 Cart reminders (lib/services/cartremind.ts): tells the shop what is in this browser's cart, so a reminder can go
// 1 h / 24 h / 72 h later if nobody orders. Only sent when the shop follows this browser — it takes the shop's
// notifications, or a customer is signed in (the server says which; otherwise it asks again only a day later).
// The link in a reminder (/cart?cr=…) puts the same products back in the cart, on any device.
import { getJson, postJson, store } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';
import { readCart, saveCartQuietly } from './cart.js';

const SM: Partial<ShopConfig> = window.SM || {};
const NOT_FOLLOWED = 'sm_cr_no';

async function pushEndpoint(): Promise<string> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return '';
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? sub.endpoint : '';
  } catch { return ''; }
}

const items = () => Object.entries(readCart()).map(([id, qty]) => ({ id: Number(id), qty: Number(qty) })).filter((i) => i.id > 0 && i.qty > 0).slice(0, 30);

async function send(order = ''): Promise<void> {
  if (!SM.cartRemind) return;
  const endpoint = await pushEndpoint();
  const skipUntil = Number(store(NOT_FOLLOWED) || 0);
  if (!endpoint && !order && skipUntil > Date.now()) return;
  try {
    const { j } = await postJson<{ track?: boolean }>('/api/cart-reminder', { endpoint, items: order ? [] : items(), order });
    store(NOT_FOLLOWED, j && j.track ? '0' : String(Date.now() + 24 * 3600e3));
  } catch { /* offline: the next change tries again */ }
}

let timer = 0;
export function startCartRemind(): void {
  if (!SM.cartRemind) return;
  // the order page right after ordering (/order/CODE?new=1): this cart is done — no reminder for it
  const done = location.pathname.match(/^\/order\/([A-Za-z0-9]+)$/);
  if (done && /[?&]new=1(?:&|$)/.test(location.search)) void send(done[1]);
  window.addEventListener('sm:cart', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { void send(); }, 2500);
  });
}

/** /cart?cr=…: the reminder's products back in the cart (added to what is already there), then a clean address. */
export async function restoreFromReminder(): Promise<void> {
  const t = (location.search.match(/[?&]cr=([a-f0-9]{24})(?:&|$)/) || [])[1];
  if (!t) return;
  try {
    const j = await getJson<{ ok: boolean; items?: { id: number; qty: number }[] }>(`/api/cart-reminder?t=${t}`);
    if (j && j.ok && j.items && j.items.length) {
      const c = readCart();
      for (const i of j.items) if (!c[i.id]) c[i.id] = i.qty;
      saveCartQuietly(c);
    }
  } catch { /* the cart page opens anyway */ }
  try { history.replaceState(null, '', location.pathname); } catch { /* old browser */ }
}

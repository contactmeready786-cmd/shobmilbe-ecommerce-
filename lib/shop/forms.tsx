// 📮 The customer pages that hold forms, as data (only showing them — the forms are answered by lib/shopx.tsx):
// 👤 আমার অ্যাকাউন্ট (login, or orders / addresses / profile / referral / gift cards), the complaint form and complaint
// status form, the return request on a delivered order and buying a gift card.
// Used by the Next.js pages (app/(shop)) and by the forms' own routes (lib/shopx.tsx), so both always show the same page.
import * as A from '../models/accounts';
import * as O from '../models/orders';
import * as $models_giftcards from '../models/giftcards';
import * as V from '../views/account';
import * as $views_complaint from '../views/complaint';
import * as $models_complaints from '../models/complaints';
import * as $models_returns from '../models/returns';
import * as $services_payments from '../services/payments';
import { myOrders } from '../gate';
import { str, int, parseCookies, sign, unsign } from '../util';
import type { PageOpts, Resolved } from './router';
import type { Loose, Settings, ShopRequest } from '../types';

export type FormsCtx = { path: string; query: URLSearchParams; settings: Settings; req: Pick<ShopRequest, 'headers'> };

/** A return request's page. */
export const RETURN_PAGE = /^\/order\/([A-Za-z0-9]+)\/return$/;

/** Where to go after logging in: only an address on this site, never back into the account pages. */
export const safeNext = (n?: Loose) => (/^\/(?!\/)[A-Za-z0-9/_?=&.%-]{0,200}$/.test(String(n || '')) && !String(n).startsWith('/account') ? String(n) : '');

// The browser's "my orders" list (order page shows the full address / reviews / returns for these).
export function ordersCookie(req: Pick<ShopRequest, 'headers'>, settings: Settings, codes?: Loose) {
  const old = (() => { const v = unsign(parseCookies(req.headers.cookie as string).sm_orders, settings.session_secret); return v ? v.split('.').filter(Boolean) : []; })();
  const all = [...new Set([...codes, ...old])].slice(0, 15);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_orders=${encodeURIComponent(sign(all.join('.'), settings.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${120 * 86400}${secure}`;
}

/** Opening the account dashboard adds the customer's latest orders to this browser's list (null: nothing to add). */
export async function accountOrdersCookie(req: Pick<ShopRequest, 'headers'>, settings: Settings, cu?: A.Customer | null): Promise<string | null> {
  const who = cu === undefined ? await A.current(req, settings) : cu;
  if (!who) return null;
  const codes = (await A.ordersOf(who, 15)).slice(0, 15).map((o) => String(o.code));
  return codes.length ? ordersCookie(req, settings, codes) : null;
}

const NOT_FOUND: Resolved = { kind: 'notFound' };
const page = (title: string, body: Loose, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });

/** The page shown when one of these addresses is opened (GET), or null when it is not one of them. */
export async function resolveForms({ path, query, settings, req }: FormsCtx): Promise<Resolved | null> {
  if (path === '/complaint' || path === '/complaint/status') {
    if (settings.complaints_on === '0') return NOT_FOUND;
    const CV = $views_complaint;
    const CM = $models_complaints;
    // (a status check with a number and a phone is answered by lib/shopx.tsx — it counts tries)
    if (path === '/complaint/status') return page('অভিযোগের অবস্থা', CV.statusPage({ code: str(query.get('code'), 12).toUpperCase().trim() }), { noindex: true });
    const oc = str(query.get('order'), 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const values = { order_code: oc };
    // 🛡️ "ওয়ারেন্টি দাবি করুন" from an order's page: the product is named on the form
    if (query.get('topic') === 'warranty' && oc) {
      const order = await O.getOrder({ code: oc });
      const items = CM.warrantyItems(order);
      const it = items.find((x?: Loose) => x.product_id === int(query.get('item'))) || (items.length === 1 ? items[0] : null);
      Object.assign(values, { topic: 'warranty', item: it ? it.product_id : '', item_name: it ? it.name : '', item_end: it && it.end instanceof Date ? it.end : null, items });
    }
    return page('অভিযোগ জানান', CV.complaintPage({ settings, values }), { canonical: '/complaint', description: 'অর্ডার, পণ্য, ডেলিভারি বা টাকা নিয়ে সমস্যা জানান — ৭২ ঘণ্টার মধ্যে সমাধান।' });
  }

  if (path === '/account' || path.startsWith('/account/')) {
    if (!A.on(settings)) return NOT_FOUND;
    const cu = await A.current(req as ShopRequest, settings);
    const next = safeNext(query.get('next'));
    const ways = { phoneOn: A.phoneReady(settings), emailOn: A.emailReady(settings) };
    if (!cu) return page('আমার অ্যাকাউন্ট', V.loginPage({ ...ways, next, via: query.get('via'), mode: query.get('mode') || 'login', email: str(query.get('email'), 120) }), { noindex: true, canonical: '/account' });
    // a new account: name (and mobile) first — every other tab waits
    const welcome = A.needsProfile(cu);
    const tab = welcome ? 'profile' : ['orders', 'addresses', 'profile', 'refer', 'gift'].includes(query.get('tab') || '') ? query.get('tab') : 'orders';
    const G = $models_giftcards;
    const RC = G.refCfg(settings);
    const [orders, addresses, cards] = await Promise.all([A.ordersOf(cu), A.addresses(cu.id), settings.gift_on === '1' && A.deliveryPhone(cu) ? G.forPhone(A.deliveryPhone(cu)) : []]);
    let referral = null;
    if (RC.on && RC.friendGets) {
      const code = await G.refCodeFor(cu.id);
      const st = await G.referralStats(cu.id);
      referral = { code, friendGets: RC.friendGets, friendMin: RC.friendMin, youGet: RC.youGet, joined: st!.joined, rewarded: st!.rewarded };
    }
    return page('আমার অ্যাকাউন্ট', V.dashboard({ cu, orders, addresses, settings, tab, referral, cards, welcome, next,
      flash: query.get('ok') ? 'সেভ হয়েছে।' : '', error: str(query.get('err'), 200) }), { noindex: true, canonical: '/account' });
  }

  const m = path.match(RETURN_PAGE);
  if (m) {
    if (settings.returns_on !== '1') return NOT_FOUND;
    // (the caller has already counted this visit against the limit for trying many order numbers)
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return NOT_FOUND;
    const mine = myOrders(req, settings).includes(order.code);
    const existing = mine ? await $models_returns.forOrder(order.id) : [];
    return page('রিটার্ন / রিফান্ড', V.returnForm({ order, existing, settings, mine }), { noindex: true });
  }

  if (path === '/gift-card') {
    if (settings.gift_on !== '1') return NOT_FOUND;
    return page('গিফট কার্ড', V.giftPage({ settings, methods: giftMethods(settings) }), { canonical: '/gift-card', description: `${settings.store_name} এর গিফট কার্ড — প্রিয়জনকে উপহার দিন।` });
  }
  return null;
}

/** The ways to pay for a gift card on the site (manual bKash / Nagad … with a number). */
export function giftMethods(settings: Settings): Loose[] {
  return $services_payments.methods(settings).filter((x) => x.manual && x.number && settings.gift_sell_online !== '0');
}

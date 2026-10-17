// 📮 The customer pages that hold forms, as data (only showing them — the forms are still sent to lib/shopx.ts):
// the complaint form and complaint status form, the return request on a delivered order and buying a gift card.
// Used by the Next.js pages (app/(shop)) and by the original router (lib/shopx.ts), so both always show the same page.
import * as O from '../models/orders';
import * as V from '../views/account';
import * as $views_complaint from '../views/complaint';
import * as $models_complaints from '../models/complaints';
import * as $models_returns from '../models/returns';
import * as $services_payments from '../services/payments';
import { myOrders } from '../gate';
import { str, int } from '../util';
import type { PageOpts, Resolved } from './router';
import type { Loose, Settings, ShopRequest } from '../types';

export type FormsCtx = { path: string; query: URLSearchParams; settings: Settings; req: Pick<ShopRequest, 'headers'> };

/** A return request's page. */
export const RETURN_PAGE = /^\/order\/([A-Za-z0-9]+)\/return$/;

const NOT_FOUND: Resolved = { kind: 'notFound' };
const page = (title: string, body: Loose, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });

/** The page shown when one of these addresses is opened (GET), or null when it is not one of them. */
export async function resolveForms({ path, query, settings, req }: FormsCtx): Promise<Resolved | null> {
  if (path === '/complaint' || path === '/complaint/status') {
    if (settings.complaints_on === '0') return NOT_FOUND;
    const CV = $views_complaint;
    const CM = $models_complaints;
    // (a status check with a number and a phone is answered by lib/shopx.ts — it counts tries)
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
  return $services_payments.methods(settings).filter((x: Loose) => x.manual && x.number && settings.gift_sell_online !== '0');
}

// 🛒 More shop pages as data — live scores, cart, wishlist, compare, checkout, project kits — each with its title, React
// body and page settings. Used by the Next.js pages (app/(shop)) and by the original router (lib/app.ts), so both always
// show the same page. The code is the original router's, moved here unchanged.
import * as catalog from '../models/catalog';
import * as O from '../models/orders';
import * as payments from '../services/payments';
import * as livescore from '../services/livescore';
import * as md from '../views/md';
import * as seo from '../services/seo';
import * as shop from '../views/shop';
import * as $models_accounts from '../models/accounts';
import * as $models_reviews from '../models/reviews';
import * as $models_checkoutotp from '../models/checkoutotp';
import * as $models_kits from '../models/kits';
import { refFromCookie } from '../gate';
import { int, bn } from '../util';
import type { PageOpts, Resolved } from './router';
import type { Loose, Settings, ShopRequest } from '../types';

export type MoreCtx = { path: string; query: URLSearchParams; settings: Settings; base: string; req: Pick<ShopRequest, 'headers'> };

const NOT_FOUND: Resolved = { kind: 'notFound' };
const page = (title: string, body: Loose, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });
// the original router's redirect: 303, never cached
const see = (location: string): Resolved => ({ kind: 'redirect', status: 303, location, headers: { 'Cache-Control': 'no-store' } });

/** The page at this address, or null when it is not one of these pages. */
export async function resolveMore({ path, query, settings, base: siteBase, req }: MoreCtx): Promise<Resolved | null> {
  let m: RegExpMatchArray | null = null;
  if (path === '/live' || (m = path.match(/^\/live\/(cricket|football)$/))) {
    const on = livescore.enabled(settings);
    const sport = m ? m[1] : (on.cricket ? 'cricket' : 'football');
    if (!on[sport]) return NOT_FOUND;
    if (!m) return see(`/live/${sport}`);
    const embed = settings[`live_${sport}_source`] === 'embed' && String(settings[`live_${sport}_embed`] || '').trim();
    let data = null;
    if (!embed) data = await Promise.race([livescore.scores(sport, settings), new Promise((r) => setTimeout(() => r(null), 3500))]).catch(() => null);
    const title = sport === 'cricket' ? 'লাইভ ক্রিকেট স্কোর' : 'লাইভ ফুটবল স্কোর';
    return page(title, shop.livePage({ sport, on, data, embed, settings }), {
      active: 'live', canonical: `/live/${sport}`,
      description: sport === 'cricket' ? 'বাংলাদেশসহ সব আন্তর্জাতিক ও লিগ ক্রিকেটের লাইভ স্কোর, প্রতি কয়েক সেকেন্ডে আপডেট।' : 'বিশ্বকাপ, প্রিমিয়ার লিগ, লা লিগা সহ সব বড় ফুটবল ম্যাচের লাইভ স্কোর।',
    });
  }
  if (path === '/cart') return page('কার্ট', shop.cartPage({ settings }), { active: 'cart', noindex: true });
  if (path === '/wishlist') {
    // the list lives in the shopper's own browser; the page asks for /wishlist?ids=… and shows those products
    const ids = (query.get('ids') || '').split(',').map((x?: Loose) => int(x)).filter((x?: Loose) => x > 0).slice(0, 60);
    const prods = ids.length ? await catalog.getProductsByIds(ids, { public: true }) : [];
    const pos = new Map(ids.map((id?: Loose, i?: Loose) => [id, i]));
    return page('পছন্দের তালিকা', shop.wishlistPage({ products: prods.sort((a, b) => (pos.get(a.id) as number) - (pos.get(b.id) as number)), settings, asked: query.has('ids') }), { noindex: true, canonical: '/wishlist' });
  }
  if (path === '/compare') {
    if (settings.ui_compare === '0') return NOT_FOUND;
    // ⚖️ the shopper's own comparison list (kept in the browser): /compare?ids=1,2,3
    const ids = (query.get('ids') || '').split(',').map((x?: Loose) => int(x)).filter((x?: Loose) => x > 0).slice(0, 4);
    const prods = ids.length ? (await Promise.all(ids.map((id?: Loose) => catalog.getProduct({ id, public: true })))).filter((p): p is Loose => !!(p && p.active && !p.parent_id)) : [];
    const rv = await Promise.all(prods.map((p) => (settings.reviews_on === '0' ? { stats: { count: 0 } } : $models_reviews.forProduct(p.id))));
    prods.forEach((p, i) => { p.review_stats = rv[i].stats; });
    return page('পণ্য তুলনা', shop.comparePage({ products: prods, settings, asked: query.has('ids') }), { noindex: true, canonical: '/compare' });
  }
  if (path === '/checkout') {
    const A = $models_accounts;
    const cu = await A.current(req as ShopRequest, settings);
    // a brand-new account gives its name (and an e-mail account its mobile number) first, then orders
    if (cu && A.needsProfile(cu)) return see('/account?tab=profile&welcome=1&next=/checkout');
    const account = cu ? { name: cu.name, phone: A.deliveryPhone(cu), addresses: await A.addresses(cu.id) } : null;
    const refCode = settings.ref_on === '1' ? (refFromCookie(req) || (query.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)) : '';
    return page('অর্ডার করুন', shop.checkoutPage({ settings, methods: payments.methods(settings), cityAreas: O.dhakaCityAreas(settings), zones: O.customZones(settings), account, refCode,
      otp: $models_checkoutotp.active(settings) }),
      { active: 'cart', noindex: true, track: { event: 'begin_checkout' } });
  }
  // 🧰 project kits
  if (path === '/kits' && settings.kits_on !== '0') {
    const kits = await $models_kits.list({ activeOnly: true });
    return page('প্রজেক্ট কিট', shop.kitsPage({ kits, settings }), { canonical: '/kits', description: 'প্রজেক্ট বানাতে যা যা পার্টস লাগে — এক জায়গায়, এক চাপে কার্টে।' });
  }
  let km = path.match(/^\/kit\/([^/]+)$/);
  if (km && settings.kits_on !== '0') {
    const kit = await $models_kits.forShop(decodeURIComponent(km[1]));
    if (!kit) return NOT_FOUND;
    // 🛠️ a kit with steps is a "how to build it" page for Google (HowTo): the parts are its supplies, with today's total
    const K = $models_kits;
    const steps = K.stepList(kit);
    const base = siteBase.replace(/\/+$/, '');
    const need = kit.items.filter((i?: Loose) => !i.optional);
    const howTo = steps.length ? { '@context': 'https://schema.org', '@type': 'HowTo', name: kit.title, url: `${base}/kit/${kit.slug}`,
      description: md.plain(kit.description, 300) || kit.title, image: kit.image_id ? `${base}/media/${kit.image_id}` : undefined,
      estimatedCost: { '@type': 'MonetaryAmount', currency: 'BDT', value: Math.round(need.reduce((t?: Loose, i?: Loose) => t + Number(i.product.price) * i.qty, 0)) },
      supply: kit.items.map((i?: Loose) => ({ '@type': 'HowToSupply', name: seo.cleanName(i.product.name), requiredQuantity: i.qty })),
      step: steps.map((t, i) => ({ '@type': 'HowToStep', position: i + 1, name: seo.cut(t, 80), text: t, url: `${base}/kit/${kit.slug}#step-${i + 1}` })) } : null;
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: settings.store_name, item: base + '/' },
      { '@type': 'ListItem', position: 2, name: 'প্রজেক্ট কিট', item: base + '/kits' },
      { '@type': 'ListItem', position: 3, name: kit.title, item: `${base}/kit/${kit.slug}` }] };
    const title = !steps.length ? `${kit.title} — পার্টস লিস্ট ও দাম`
      : /বানান|বানানো|বানাবেন|বানানোর/.test(kit.title) ? `${kit.title} — ধাপে ধাপে নিয়ম ও পার্টস লিস্ট` : `${kit.title} — বানানোর নিয়ম ও পার্টস লিস্ট`;
    return page(title, shop.kitPage({ kit, settings }), { canonical: `/kit/${kit.slug}`,
      description: seo.cut(`${md.plain(kit.description, 300) || kit.title} ${steps.length ? `${bn(steps.length)}টি ধাপে বানানোর নিয়ম, ` : ''}সব পার্টস এক চাপে কার্টে।`, 160),
      image: kit.image_id ? `/media/${kit.image_id}` : '', jsonLd: howTo || undefined, jsonLdExtra: crumbs });
  }
  return null;
}

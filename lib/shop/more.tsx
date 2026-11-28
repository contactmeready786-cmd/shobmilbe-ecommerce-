// 🛒 More shop pages as data — live scores, cart, wishlist, compare, checkout, project kits, order pages — each with its title, React
// body and page settings. Used by the Next.js pages (app/(shop)) and by the original router (lib/site.ts), so both always
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
import * as $models_landing from '../models/landing';
import { landingPage } from '../views/landing';
import { learnListPage, lessonPage } from '../views/learn';
import { toolsListPage, toolPage } from '../views/tools';
import * as $tools from '../data/tools';
import * as $seoLearn from '../data/seo-learn';
import * as $seoLive from '../data/seo-live';
import * as $lessons from '../data/lessons';
import * as db from '../db';
import * as courier from '../services/courier';
import * as $track from '../models/courier-track';
import * as U from '../services/uiswitch';
import { refFromCookie, myOrders } from '../gate';
import { appPage } from '../views/apppage';
import { appVersionOf } from '../app-release';
import { int, str, bn } from '../util';
import type { PageOpts, Resolved } from './router';
import type { Settings, ShopRequest } from '../types';
import type { JSX } from 'react/jsx-runtime';

export type MoreCtx = { path: string; query: URLSearchParams; settings: Settings; base: string; req: Pick<ShopRequest, 'headers'> };

/** An order's page (and the old invoice address, which now opens the order). */
export const ORDER_PAGE = /^\/order\/([A-Za-z0-9]+)(\/invoice)?$/;

const NOT_FOUND: Resolved = { kind: 'notFound' };
const page = (title: string, body: JSX.Element, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });
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
    const seo = $seoLive.LIVE_SEO[sport as 'cricket' | 'football'];
    const matches = ((data as livescore.Scores | null)?.matches || []).slice(0, 30);
    const url = `${siteBase}/live/${sport}`;
    // what is on the page, for Google & co.: the page itself, where it sits, and today's matches (real start times only)
    const events = matches.filter((x) => x.date && x.teams.length >= 2).map((x) => ({
      '@type': 'SportsEvent', name: `${x.teams[0].name} vs ${x.teams[1].name}`, sport: sport === 'cricket' ? 'Cricket' : 'Football',
      startDate: x.date, description: x.league, url,
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: x.venue ? { '@type': 'Place', name: x.venue } : { '@type': 'VirtualLocation', url },
      competitor: x.teams.slice(0, 2).map((t) => ({ '@type': 'SportsTeam', name: t.name })),
    }));
    return page($seoLearn.seoTitle(seo.title, seo.en), shop.livePage({ sport, on, data, embed, settings, seo }), {
      active: 'live', canonical: `/live/${sport}`, description: seo.description, keywords: seo.keywords,
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: `${seo.title} — ${seo.en}`, description: seo.description, url, inLanguage: 'bn',
        ...(events.length ? { mainEntity: { '@type': 'ItemList', itemListElement: events.map((e, i) => ({ '@type': 'ListItem', position: i + 1, item: e })) } } : {}) },
      jsonLdExtra: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'হোম', item: `${siteBase}/` },
        { '@type': 'ListItem', position: 2, name: seo.title, item: url },
      ] }, $seoLearn.faqLd(seo.faq)],
    });
  }
  if (path === '/cart') return page('কার্ট', shop.cartPage({ settings }), { active: 'cart', noindex: true });
  if (path === '/wishlist') {
    // the list lives in the shopper's own browser; the page asks for /wishlist?ids=… and shows those products
    const ids = (query.get('ids') || '').split(',').map((x) => int(x)).filter((x) => x > 0).slice(0, 60);
    const prods = ids.length ? await catalog.getProductsByIds(ids, { public: true }) : [];
    const pos = new Map(ids.map((id, i) => [id, i]));
    return page('পছন্দের তালিকা', shop.wishlistPage({ products: prods.sort((a, b) => (pos.get(a.id) as number) - (pos.get(b.id) as number)), settings, asked: query.has('ids') }), { noindex: true, canonical: '/wishlist' });
  }
  if (path === '/compare') {
    if (settings.ui_compare === '0') return NOT_FOUND;
    // ⚖️ the shopper's own comparison list (kept in the browser): /compare?ids=1,2,3
    const ids = (query.get('ids') || '').split(',').map((x) => int(x)).filter((x) => x > 0).slice(0, 4);
    const prods = ids.length ? (await Promise.all(ids.map((id) => catalog.getProduct({ id, public: true })))).filter((p): p is catalog.FullProduct => !!(p && p.active && !p.parent_id)) : [];
    const rv = await Promise.all(prods.map((p) => (settings.reviews_on === '0' ? { stats: { count: 0 } } : $models_reviews.forProduct(p.id))));
    const compared = prods.map((p, i) => Object.assign(p, { review_stats: rv[i].stats }));
    return page('পণ্য তুলনা', shop.comparePage({ products: compared, settings, asked: query.has('ids') }), { noindex: true, canonical: '/compare' });
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
  // 🚀 a landing page for ads: one product, its selling points and the order form on the same page
  const lpm = path.match(/^\/lp\/([^/]+)$/);
  if (lpm) {
    const found = await $models_landing.forShop(decodeURIComponent(lpm[1]));
    if (!found) return NOT_FOUND;
    const { page: lp, product } = found;
    const A = $models_accounts;
    const cu = await A.current(req as ShopRequest, settings);
    const [account, rv] = await Promise.all([
      cu && !A.needsProfile(cu) ? A.addresses(cu.id).then((addresses) => ({ name: cu.name, phone: A.deliveryPhone(cu), addresses })) : null,
      settings.reviews_on === '0' ? { reviews: [], stats: { count: 0 } } : $models_reviews.forProduct(product.id, 12),
    ]);
    const methods = payments.methods(settings);
    const refCode = settings.ref_on === '1' ? (refFromCookie(req) || '') : '';
    const checkout = shop.checkoutPage({ settings, methods, cityAreas: O.dhakaCityAreas(settings), zones: O.customZones(settings), account, refCode,
      otp: $models_checkoutotp.active(settings), heading: '📝 অর্ডার করতে নিচের ফর্মটি পূরণ করুন' });
    const img = product.images && product.images[0];
    return page(lp.headline || product.name, landingPage({ page: lp, product, settings, reviews: rv.reviews, reviewStats: rv.stats, checkout, hasCod: methods.some((m) => m.id === 'cod') }), {
      canonical: `/p/${product.slug}`, description: lp.subhead || md.plain(product.short_description || product.description || '', 160),
      image: img ? `/media/${img}` : undefined, type: 'product',
      track: { event: 'view_item', id: product.id, name: product.name, price: product.price, category: product.category_name || '' },
    });
  }
  // 📱 the Android app to download (inside the app: is this the newest version?)
  if (path === '/app') {
    const ua = String(req.headers['user-agent'] || '');
    return page('সবমিলবে অ্যাপ ডাউনলোড', appPage({ inAppVersion: appVersionOf(ua), android: /Android/i.test(ua) }), {
      canonical: '/app', description: 'সবমিলবের Android অ্যাপ নামান — অর্ডার, অফার আর অর্ডার ট্র্যাক এক চাপে, নতুন অফারের নোটিফিকেশন।' });
  }
  // 🎓 free electronics classes (owner, 2026-11-27): lessons with a quiz and the AI teacher (lib/api/learn.ts)
  if ((path === '/learn' || path.startsWith('/learn/')) && settings.learn_on !== '0') {
    const tutor = $lessons.tutorOn(settings);
    if (path === '/learn') {
      const list = $lessons.lessons();
      return page($seoLearn.seoTitle('ইলেকট্রনিক্স পাঠশালা', $seoLearn.LIST_SEO.learn.en), learnListPage({ list, tutor }), { canonical: '/learn', keywords: $seoLearn.LIST_SEO.learn.keywords,
        description: 'ভোল্টেজ-কারেন্ট, LED, ব্রেডবোর্ড, মাল্টিমিটার, সোল্ডারিং আর আরডুইনো (Arduino) — হাতে-কলমে ছোট বাংলা লেসন, কুইজ, AI শিক্ষক আর সার্টিফিকেট। কোনো খরচ বা অ্যাকাউন্ট লাগে না।',
        jsonLd: { '@context': 'https://schema.org', '@type': 'ItemList', name: 'ইলেকট্রনিক্স পাঠশালা', itemListElement: list.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: `${siteBase}/learn/${l.slug}`, name: l.title })) },
        jsonLdExtra: $seoLearn.faqLd($seoLearn.LIST_SEO.learn.faq) });
    }
    const lm = path.match(/^\/learn\/([^/]+)$/);
    const l = lm ? $lessons.lesson(lm[1]) : null;
    if (!l) return NOT_FOUND;
    const { prev, next } = $lessons.around(l.slug);
    const kit = l.kitGuide && settings.kits_on !== '0'
      ? await db.one<{ slug: string; title: string }>('SELECT slug, title FROM kits WHERE active AND guide_key=$1 ORDER BY id LIMIT 1', [l.kitGuide]).catch(() => null)
      : null;
    const ls = $seoLearn.LESSON_SEO[l.slug];
    return page(ls ? `${l.title.split(' — ')[0]} — ${ls.en}` : l.title, lessonPage({ l, prev, next, kit: kit || null, tutor, total: $lessons.lessons().length, seo: ls || null }), { canonical: `/learn/${l.slug}`, description: l.summary, type: 'article', keywords: ls?.keywords,
      jsonLd: { '@context': 'https://schema.org', '@type': 'LearningResource', name: l.title, description: l.summary, inLanguage: 'bn', isAccessibleForFree: true,
        educationalLevel: l.level, url: `${siteBase}/learn/${l.slug}`, learningResourceType: 'Lesson', provider: { '@type': 'Organization', name: 'সবমিলবে', url: siteBase } },
      jsonLdExtra: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'হোম', item: siteBase + '/' },
        { '@type': 'ListItem', position: 2, name: 'ইলেকট্রনিক্স পাঠশালা', item: siteBase + '/learn' },
        { '@type': 'ListItem', position: 3, name: l.title, item: `${siteBase}/learn/${l.slug}` }] }, ...(ls ? [$seoLearn.faqLd(ls.faq)] : [])] });
  }
  // 🧮 electronics tools (owner, 2026-11-27): calculators that run in the visitor's browser (client/shop/tools.tsx)
  if (path === '/tools' || path.startsWith('/tools/')) {
    const list = $tools.toolsOn(settings);
    if (!list.length) return NOT_FOUND;
    if (path === '/tools') {
      return page($seoLearn.seoTitle($seoLearn.LIST_SEO.tools.en, 'ইলেকট্রনিক্স টুলস ও ক্যালকুলেটর'), toolsListPage({ list }), { canonical: '/tools', keywords: $seoLearn.LIST_SEO.tools.keywords,
        description: 'রেজিস্টর কালার কোড, SMD কোড, ক্যাপাসিটর কোড, ওহমের সূত্র, LED রেজিস্টর, ট্রানজিস্টর পিন চার্ট, 555 টাইমার — বাংলায় ফ্রি ক্যালকুলেটর।',
        jsonLd: { '@context': 'https://schema.org', '@type': 'ItemList', name: 'ইলেকট্রনিক্স টুলস', itemListElement: list.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: `${siteBase}/tools/${t.key}`, name: t.title })) } });
    }
    const tm = path.match(/^\/tools\/([^/]+)$/);
    const t = tm ? list.find((x) => x.key === tm[1]) : null;
    if (!t) return NOT_FOUND;
    const ts = $seoLearn.TOOL_SEO[t.key];
    return page(ts ? $seoLearn.seoTitle(ts.en, t.title.split(' (')[0]) : t.title, toolPage({ t, others: list.filter((x) => x.key !== t.key), seo: ts || null }), { canonical: `/tools/${t.key}`, description: t.summary, keywords: ts?.keywords,
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebApplication', name: t.title, alternateName: ts?.en, description: t.summary, url: `${siteBase}/tools/${t.key}`, inLanguage: 'bn',
        applicationCategory: 'EducationalApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'BDT' } },
      jsonLdExtra: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'হোম', item: siteBase + '/' },
        { '@type': 'ListItem', position: 2, name: 'ইলেকট্রনিক্স টুলস', item: siteBase + '/tools' },
        { '@type': 'ListItem', position: 3, name: t.title, item: `${siteBase}/tools/${t.key}` }] }, ...(ts ? [$seoLearn.faqLd(ts.faq)] : [])] });
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
    const need = kit.items.filter((i) => !i.optional);
    const howTo = steps.length ? { '@context': 'https://schema.org', '@type': 'HowTo', name: kit.title, url: `${base}/kit/${kit.slug}`,
      description: md.plain(kit.description, 300) || kit.title, image: kit.image_id ? `${base}/media/${kit.image_id}` : undefined,
      estimatedCost: { '@type': 'MonetaryAmount', currency: 'BDT', value: Math.round(need.reduce((t: number, i) => t + Number(i.product.price) * i.qty, 0)) },
      supply: kit.items.map((i) => ({ '@type': 'HowToSupply', name: seo.cleanName(i.product.name), requiredQuantity: i.qty })),
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
  m = path.match(ORDER_PAGE);
  if (m) {
    // (the caller has already counted this visit against the limit for trying many order numbers)
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return NOT_FOUND;
    const mine = myOrders(req, settings).includes(order.code);
    // Invoices are only for the shop's own staff (Admin → অর্ডার → ইনভয়েস), not for customers.
    if (m[2]) return see(`/order/${order.code}`);
    const fresh = query.get('new') === '1';
    const trackUrl = order.courier && courier.PROVIDERS[order.courier] ? courier.PROVIDERS[order.courier].track(order) : '';
    const track = fresh && query.get('pay') !== 'failed'
      ? { event: 'purchase', code: order.code, value: order.total, items: order.items.map((i) => ({ id: i.product_id, name: i.name, price: i.price, qty: i.qty })) }
      : null;
    // delivered → each product can be reviewed once (only by the order's owner on this browser)
    const reviewItems = order.status === 'delivered' && settings.reviews_on !== '0' ? await $models_reviews.forOrder(order.id) : [];
    const selfMsg = { ok: str(query.get('done'), 300), err: str(query.get('err'), 300) };
    // 🛵 the parcel's journey (phone numbers in it hidden unless it is the customer's own order on this browser)
    const journey = order.consignment_id && U.on(settings, 'ui_order_tracking') ? await $track.list(order.id, { limit: 12, maskPhones: !mine }) : [];
    return page(`অর্ডার ${order.code}`, shop.orderPage({ order, settings, fresh, payFailed: query.get('pay') === 'failed', trackUrl, mine, reviewItems, selfMsg, journey,
      otpActive: $models_checkoutotp.active(settings) }), { noindex: true, track });
  }
  return null;
}

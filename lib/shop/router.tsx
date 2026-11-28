// 🧭 The shop's main pages — home, product lists (all products, a category, a brand, search, offers) and product
// pages — as data: the page's title, its React body and its settings (canonical link, data for Google, tracking …).
// Used by the Next.js pages (app/(shop)) and by the original router (lib/site.ts), so both always show the same page.
import type { HomeRowsRow, PageViewsRow, FlashSalesRow, FlashItemsRow, ProductsRow } from '../data/rows';
import type { ReactNode } from 'react';
import * as db from '../db';
import * as cache from '../cache';
import * as catalog from '../models/catalog';
import * as content from '../models/content';
import * as seo from '../services/seo';
import * as dupcanon from '../services/dupcanon';
import * as U from '../services/uiswitch';
import * as md from '../views/md';
import * as shop from '../views/shop';
import { str, int, bn, contact, catHref } from '../util';
import * as $services_search from '../services/search';
import * as $services_pricing from '../services/pricing';
import * as $services_autoseo from '../services/autoseo';
import * as $models_reviews from '../models/reviews';
import * as $models_extras from '../models/extras';
import * as $models_kits from '../models/kits';
import * as $models_homerows from '../models/homerows';
import { mix, rotateOn, listSeed } from '../services/rotate';
import type { Settings } from '../types';

export const HOME_DEFAULT = ['slider', 'trust', 'categories', 'new', 'offers', 'bestsellers', 'popular', 'promo', 'cat_rows', 'budget', 'featured'];

/** How a page is shown around its body (the same options the shop's page frame always took). */
export type PageOpts = {
  status?: number; q?: string; active?: string; canonical?: string; noindex?: boolean; description?: string; keywords?: string;
  image?: string; type?: 'website' | 'article' | 'product'; jsonLd?: unknown; jsonLdExtra?: unknown; track?: unknown;
};
export type Resolved =
  | { kind: 'page'; title: string; body: ReactNode; opts: PageOpts }
  | { kind: 'redirect'; status: 301 | 302 | 303; location: string; headers: Record<string, string> }
  | { kind: 'notFound' };
export type ShopCtx = { path: string; query: URLSearchParams; settings: Settings; categories: catalog.Category[]; base: string };

const NOT_FOUND: Resolved = { kind: 'notFound' };
const done = (title: string, body: ReactNode, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });

/** The page for one of these addresses: '/', '/products', '/brand/<slug>', '/p/<slug>'. Anything else: not found. */
export async function resolveShop(ctx: ShopCtx): Promise<Resolved> {
  const { path, query, settings, categories } = ctx;
  // Admin → দোকানে কী দেখাবে → "স্টক শেষ পণ্য তালিকায় দেখাও" off: lists, home rows and search skip them
  const hideOut = settings.ui_show_out_of_stock === '0';
  if (path === '/') {
    let sections = db.jsonSetting<string[]>(settings, 'home_sections', HOME_DEFAULT);
    // 🎞️ running slider switched on (Admin → স্টোর ডিজাইন → রানিং স্লাইডার) → always at the top
    if (settings.slider_on === '1' && Array.isArray(sections) && !sections.includes('slider')) sections = ['slider', ...sections];
    const want = (k: string) => sections.includes(k);
    // ⚡ Speed (2026-11-19): 10 cards per sliding row (was 16). The home page had 167 cards and weighed 834 KB, half of
    // it React's copy of the same cards; customers see 2–6 cards of a row at a time and "সব দেখুন" opens the full list.
    const ROW = 10;
    const inStockFirst = <P extends { stock: number }>(a: P[]) => [...a.filter((p) => p.stock > 0), ...a.filter((p) => p.stock <= 0)];
    // 🔀 rows take a bigger pool and show a fresh mix every half hour (lib/services/rotate.ts); off = the old fixed rows
    const rotating = rotateOn(settings);
    const POOL = rotating ? 6 : 2;
    // ⚡ the home page's rows are the same for every visitor: worked out once a minute, not on every visit
    // (a saved product clears this memory at once — lib/cache.ts)
    const data: shop.HomeData = await cache.memo<shop.HomeData>(`home:${hideOut ? 1 : 0}:${sections.join(',')}`, async () => {
    // most looked-at products of the last 30 days (real visitors)
    const viewedIds = want('popular') ? (await db.q<Pick<PageViewsRow, 'product_id'>>(`SELECT product_id FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days'
      GROUP BY product_id ORDER BY count(DISTINCT visitor_id) DESC LIMIT $1`, [ROW * 2])).map((r) => r.product_id) : [];
    const [slides, promos, featured, latest, best, offers, posts, viewed, budget] = await Promise.all([
      want('slider') ? content.listBanners({ active: true, placement: 'slider' }) : [],
      want('promo') ? content.listBanners({ active: true, placement: 'promo' }) : [],
      want('featured') || want('popular') ? catalog.listProducts({ public: true, hideOut, featured: true, limit: ROW * (rotating ? 4 : 1) }) : [],
      want('new') ? catalog.listProducts({ public: true, hideOut, sort: 'new', limit: ROW * POOL }) : [],
      want('bestsellers') ? catalog.listProducts({ public: true, hideOut, sold: true, sort: 'popular', limit: ROW * POOL }) : [],
      want('offers') ? catalog.listProducts({ public: true, hideOut, offer: true, sort: 'offer', limit: ROW * POOL }) : [],
      want('blog') ? content.listPosts({ published: true, limit: 3 }) : [],
      viewedIds.length ? catalog.getProductsByIds(viewedIds, { public: true }).then((r) => (hideOut ? r.filter((p) => p.stock > 0) : r)) : [],
      want('budget') ? catalog.listProducts({ public: true, hideOut, sort: 'popular', maxPrice: 100, limit: ROW * POOL }) : [],
    ]);
    const order = new Map(viewedIds.map((id, i) => [id, i]));
    const popularList = viewed.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
    // category rows: each main category with its best products
    const pick = <P extends catalog.Product>(a: P[], row: string): P[] => (rotating ? mix(a, ROW, row) : inStockFirst(a).slice(0, ROW));
    let catRows: shop.HomeData['catRows'] = [];
    if (want('cat_rows')) {
      const { roots } = catalog.categoryTree(categories);
      const mains = roots.filter((c) => c.total_count! >= 4).slice(0, 8);
      catRows = await Promise.all(mains.map(async (c) => ({
        cat: c, chips: c.children.filter((k) => k.total_count! > 0).slice(0, 8),
        products: pick(await catalog.listProducts({ public: true, hideOut, category: c.slug, sort: 'popular', limit: ROW * POOL }), `cat${c.id}`),
      })));
    }
    // the flash sale that ends first among the running ones, with its products (sale price already in them)
    let flash = null;
    if (want('flash')) {
      const sale = await db.one<FlashSalesRow>(`SELECT fs.* FROM flash_sales fs WHERE fs.active AND fs.show_home AND now() >= fs.starts_at AND now() < fs.ends_at
        AND EXISTS (SELECT 1 FROM flash_items fi WHERE fi.sale_id=fs.id) ORDER BY fs.ends_at LIMIT 1`);
      if (sale) {
        const ids = (await db.q<Pick<FlashItemsRow, 'product_id'>>('SELECT product_id FROM flash_items WHERE sale_id=$1 AND (max_qty = 0 OR sold < max_qty) ORDER BY id', [sale.id])).map((r) => r.product_id);
        const prods = (await catalog.getProductsByIds(ids, { public: true })).filter((p) => p.flash_ends && (!hideOut || p.stock > 0));
        const pos = new Map(ids.map((id, i) => [id, i]));
        flash = { sale, products: inStockFirst(prods.sort((a, b) => (pos.get(a.id) as number) - (pos.get(b.id) as number))).slice(0, ROW * 2) };
      }
    }
    // the owner's own rows
    const custom: shop.HomeData['custom'] = {};
    const customKeys = sections.filter((k) => /^x\d+$/.test(k));
    if (customKeys.length) {
      const H = $models_homerows;
      const rows = await db.q<HomeRowsRow>('SELECT * FROM home_rows WHERE id = ANY($1::int[])', [customKeys.map((k) => H.idOf(k))]).catch(() => []);
      await Promise.all(rows.map(async (r) => {
        custom[H.keyOf(r.id)] = { row: r, link: H.linkFor(r), products: await H.productsFor(r, { hideOut }).catch(() => []) };
      }));
    }
    return {
      slides, promos, categories, posts, catRows, flash, custom,
      latest: rotating ? mix(latest, ROW, 'new') : latest.slice(0, ROW),
      offers: pick(offers, 'offers'),
      best: pick(best.filter((p) => p.sold_count > 0), 'best'),
      popular: pick(popularList.length >= 4 ? popularList : featured, 'popular'),
      featured: pick(featured, 'featured'),
      budget: pick(budget.filter((p) => p.stock > 0), 'budget'),
    };
    }, 60_000);
    // who the shop is, for Google: both spellings of the name, so "সবমিলবে" and "shobmilbe" both find it
    const site = ctx.base.replace(/\/+$/, '');
    const host = site.replace(/^https?:\/\//, '');
    const names = [...new Set([settings.store_name, 'সবমিলবে', 'Shobmilbe', host].filter(Boolean))];
    const jsonLd = { '@context': 'https://schema.org', '@type': 'Store', '@id': site + '/#store', name: settings.store_name,
      alternateName: names.filter((n) => n !== settings.store_name), description: seo.homeDescription(settings),
      url: site + '/', telephone: contact(settings).phone || undefined, address: settings.address || undefined,
      logo: settings.logo_id ? `${site}/media/${settings.logo_id}` : `${site}/icon-512.png`,
      image: settings.logo_id ? `${site}/media/${settings.logo_id}` : `${site}/icon-512.png`,
      priceRange: '৳', currenciesAccepted: 'BDT', areaServed: { '@type': 'Country', name: 'Bangladesh' },
      sameAs: ['social_facebook', 'social_instagram', 'social_threads', 'social_youtube', 'social_tiktok', 'social_linkedin', 'social_x', 'social_pinterest', 'social_telegram'].map((k) => settings[k]).filter((u) => /^https?:\/\//.test(u || '')) };
    // the site's name in Google results + a search box for the shop
    const websiteLd = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': site + '/#website', name: settings.store_name,
      alternateName: names.filter((n) => n !== settings.store_name), url: site + '/', inLanguage: 'bn-BD',
      publisher: { '@id': site + '/#store' },
      potentialAction: { '@type': 'SearchAction', target: `${site}/products?q={search_term_string}`, 'query-input': 'required name=search_term_string' } };
    return done('', shop.home({ settings, sections, data }), { canonical: '/', jsonLd, jsonLdExtra: websiteLd, description: seo.homeDescription(settings) });
  }
  if (path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/c\/[^/]+$/.test(path)) {
    // 🗂️ the old category address /products?cat=<slug> → /c/<slug> (owner, 2026-11-27), keeping sort / filters / page
    if (path === '/products' && query.get('cat')) {
      const rest = new URLSearchParams(query);
      const cat = String(rest.get('cat'));
      rest.delete('cat');
      const qs = rest.toString();
      return { kind: 'redirect', status: 301, location: `${catHref(cat)}${qs ? '?' + qs : ''}`, headers: { 'Cache-Control': 'public, max-age=3600' } };
    }
    const q = str(query.get('q'), 80);
    const sortAsked = query.get('sort') || '';
    const sort = ['new', 'popular', 'offer', 'price_asc', 'price_desc'].includes(sortAsked) ? sortAsked : '';
    // a brand's own page: /brand/philips
    let brand = null;
    if (path.startsWith('/brand/')) {
      brand = await catalog.getBrand({ slug: path.slice(7) });
      if (!brand || !brand.active) return NOT_FOUND;
    }
    // a category's own page: /c/ac-remote (owner, 2026-11-27); the old /products?cat=… is sent there by proxy.ts
    const catSlug = path.startsWith('/c/') ? path.slice(3) : (!brand ? query.get('cat') : null);
    const category = catSlug ? categories.find((c) => c.slug === catSlug) || null : null;
    if (path.startsWith('/c/') && !category) return NOT_FOUND;
    const perPage = (Number(settings.grid_cols) || 4) * 6;
    const pageNo = Math.max(1, int(query.get('page'), 1));
    // 🔎 filters: price from–to, brands (several), only in stock
    const num = (v: string | null) => { const n = Number(String(v || '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e7) : 0; };
    const filters = {
      pmin: num(query.get('pmin')), pmax: num(query.get('pmax')),
      brands: brand ? [] : query.getAll('b').map((x) => int(x)).filter((x) => x > 0).slice(0, 20),
      stock: query.get('stock') === '1',
      // 🔧 spec filters: ?sp=voltage~12v&sp=voltage~5v
      specs: {} as Record<string, string[]>, specList: [] as string[],
    };
    for (const raw of query.getAll('sp').slice(0, 30)) {
      const i = String(raw).indexOf('~');
      if (i < 1) continue;
      const k = str(raw.slice(0, i), 40).toLowerCase().trim(); const v = str(raw.slice(i + 1), 30).toLowerCase().trim();
      if (!k || !v) continue;
      (filters.specs[k] = filters.specs[k] || []).push(v);
      filters.specList.push(`${k}~${v}`);
    }
    if (filters.pmin && filters.pmax && filters.pmin > filters.pmax) [filters.pmin, filters.pmax] = [filters.pmax, filters.pmin];
    // smart search: spelling mistakes and Bangla words find the product too
    let ids;
    if (q) {
      ids = await $services_search.find(q).catch(() => undefined);
    }
    const opts = { category: category && category.slug, brandId: brand && brand.id, q: ids ? '' : q, ids, sort, offer: sort === 'offer', hideOut,
      mixSeed: !sort && !q && rotateOn(settings) ? listSeed() : undefined };
    const fopts = { ...opts, minPrice: filters.pmin || undefined, maxPrice: filters.pmax || undefined, brandIds: filters.brands, inStock: filters.stock,
      specs: filters.specList.length ? filters.specs : null };
    const [products, total, brandList, specFacets] = await Promise.all([
      catalog.listProducts({ public: true, ...fopts, limit: perPage, offset: (pageNo - 1) * perPage }), catalog.countProducts(fopts),
      brand || settings.ui_filters === '0' ? [] : catalog.brandsIn(opts).catch(() => []),
      settings.ui_filters === '0' || settings.ui_spec_filters === '0' ? [] : catalog.specFacets(opts).catch(() => []),
    ]);
    const intro = brand || (category ? seo.listSeo(category, categories) : null);
    // 🔎 a proper Google title & description for every category / brand (the owner's own text wins when written)
    const title = q ? `খুঁজুন: ${q}` : intro ? seo.listTitle(brand ? { ...brand, seo_title: brand.seo_title || `${brand.name} পণ্য — দাম ও অর্ডার বাংলাদেশে` } : intro, pageNo)
      : sort === 'offer' ? 'অফার — ছাড়ে কেনাকাটা' : pageNo > 1 ? `সব পণ্য (পেজ ${bn(pageNo)})` : 'সব পণ্য — দাম ও অনলাইন অর্ডার';
    const description = intro ? seo.listDescription(intro, total, settings) : !q ? seo.homeDescription(settings) : undefined;
    const lbase = ctx.base.replace(/\/+$/, '');
    const listLd = !q ? seo.itemListLd(lbase, products, (pageNo - 1) * perPage) : null;
    // breadcrumb: Home › main category › sub-category
    const catPath = category ? ((catalog.categoryTree(categories).byId.get(category.id) || {}).path || [category]) : [];
    const listCrumbs = category ? { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: settings.store_name, item: lbase + '/' },
      ...catPath.map((c) => ({ name: c.name, item: `${lbase}${catHref(c.slug)}` }))].map((c, i) => ({ '@type': 'ListItem', position: i + 1, ...c })) } : null;
    // filtered / sorted copies of a list are the same page for Google; page 2, 3 … are their own pages
    const filtered = !!(sort || filters.pmin || filters.pmax || filters.brands.length || filters.stock || filters.specList.length);
    const listPath = brand ? `/brand/${brand.slug}` : category ? catHref(category.slug) : '/products';
    const listCanonical = pageNo > 1 && !filtered ? `${listPath}${listPath.includes('?') ? '&' : '?'}page=${pageNo}` : listPath;
    // nothing found: show the best sellers instead of an empty page
    const fallback = q && !total ? await catalog.listProducts({ public: true, hideOut: true, sort: 'popular', limit: 8 }).catch(() => []) : [];
    return done(title, shop.listing({ products, categories, category, brand, q, sort, settings, total, page: pageNo, perPage, filters, brandList, specFacets, fallback }),
      { q, active: 'products', canonical: listCanonical, noindex: !!q || !!(intro && intro.noindex), jsonLd: listLd, jsonLdExtra: listCrumbs,
        description, image: brand && brand.logo_id ? `/media/${brand.logo_id}` : category && category.banner_id ? `/media/${category.banner_id}` : '',
        track: q ? { event: 'search', q } : null });
  }
  let m = path.match(/^\/p\/([^/]+)$/);
  if (m) {
    const product = await catalog.getProduct({ slug: m[1], public: true });
    if (!product) {
      // the product's link was changed: send people (and Google) to the new one for good
      const to = await catalog.findRedirect('/p/' + m[1]);
      if (to) return { kind: 'redirect', status: 301, location: encodeURI(to), headers: { 'Cache-Control': 'public, max-age=3600' } };
      // 🔎 a product that was deleted (still in the recycle bin): its old link goes to its category, not a dead end
      // (Search Console listed ~300 such 404s, 2026-11-28). Restored → the product itself answers again (checked first).
      const gone = await db.one<{ slug: string }>(`SELECT c.slug FROM trash t JOIN categories c ON c.id = (t.data->'row'->>'category_id')::int
        WHERE t.kind='product' AND t.data->'row'->>'slug'=$1 AND coalesce(c.active, true) ORDER BY t.id DESC LIMIT 1`, [m[1]]).catch(() => null);
      if (gone) return { kind: 'redirect', status: 301, location: encodeURI(catHref(gone.slug)), headers: { 'Cache-Control': 'public, max-age=3600' } };
      // gone for good: a search for its words (like an old-shop link, lib/site.ts oldProductLink) — the visitor still
      // finds the part; search pages are noindex, so Google simply drops the old address
      const words = (() => { try { return decodeURIComponent(m![1]); } catch { return m![1]; } })().split('-').filter((w) => w.length > 1 && !/^\d+$/.test(w)).slice(0, 5).join(' ');
      if (words.split(' ').length >= 2) return { kind: 'redirect', status: 302, location: `/products?q=${encodeURIComponent(words)}`, headers: { 'Cache-Control': 'public, max-age=3600' } };
    }
    if (!product || !product.active) return NOT_FOUND;
    // a variant's own link opens its main product with that variant chosen
    if (product.parent_id) {
      const parent = await db.one<Pick<ProductsRow, 'slug'>>('SELECT slug FROM products WHERE id=$1 AND active', [product.parent_id]);
      if (!parent) return NOT_FOUND;
      return { kind: 'redirect', status: 301, location: `/p/${encodeURIComponent(parent.slug)}?v=${product.id}`, headers: { 'Cache-Control': 'public, max-age=3600' } };
    }
    const cols = Number(settings.grid_cols) || 4;
    const pricing = $services_pricing;
    const [chosen, cross, upsell, tiersMap, offerRows, rv] = await Promise.all([
      catalog.linkedProducts(product.id, 'related', cols * 2), catalog.linkedProducts(product.id, 'cross', cols), catalog.linkedProducts(product.id, 'upsell', cols),
      pricing.tiersFor([product.id]), pricing.offersFor([product.id]),
      settings.reviews_on === '0' ? { reviews: [], stats: { count: 0 } } : $models_reviews.forProduct(product.id),
    ]);
    // ⚡ (owner, 2026-11-14 — faster pages) everything below is read at the same time instead of one after another;
    // the page that comes out is exactly the same
    const slugs = [...String(product.description || '').matchAll(/^\s*\/p\/([A-Za-z0-9ঀ-৿-]+)\s*$/gm)].map((x) => x[1]).slice(0, 6);
    const first = (product.images || [])[0];
    const [questions, related, inlineList, mainSrc, kits, canonical, fbt] = await Promise.all([
      U.on(settings, 'ui_qa') ? $models_extras.publishedQuestions(product.id) : Promise.resolve([]),
      // related: the owner's own choice, otherwise the same category
      chosen.length ? Promise.resolve(chosen.slice(0, cols)) : product.category_slug
        ? catalog.listProducts({ public: true, hideOut, category: product.category_slug, limit: 9 }).then((list) => list.filter((p) => p.id !== product.id).slice(0, cols))
        : Promise.resolve([]),
      Promise.all(slugs.map((sl) => catalog.getProduct({ slug: sl, public: true }))),
      // ⚡ the big picture straight from ImageKit (no stop at /media/…/w on the way — one round trip less on a slow line)
      first ? catalog.directPictureUrl(first, settings).catch(() => null) : Promise.resolve(null),
      settings.kits_on !== '0' ? $models_kits.kitsWith(product.id).catch(() => []) : Promise.resolve([]),
      dupcanon.canonicalFor(product.slug),
      // 🛒 "একসাথে কেনা হয়" — from real orders, else the owner's cross picks (catalog.boughtTogether)
      U.on(settings, 'ui_pdp_fbt') ? catalog.boughtTogether(product.id, 2).catch(() => []) : Promise.resolve([]),
    ]);
    const offers = offerRows.map((o) => ({ label: pricing.offerTitle(o, bn), ends_on: o.ends_on ? String(o.ends_on).slice(0, 10) : '' }));
    const inlineProducts: Record<string, catalog.FullProduct> = {};
    slugs.forEach((sl, i) => { const ip = inlineList[i]; if (ip && ip.active) inlineProducts[sl] = ip; });
    // full https:// links, so Google can read pictures and prices even when "site_url" is not set
    const base = ctx.base.replace(/\/+$/, '');
    const shipFee = Math.max(0, Number(settings.delivery_outside) || 0);
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Product', name: seo.cleanName(product.name), sku: product.sku || undefined, url: `${base}/p/${product.slug}`,
      category: product.category_name || undefined,
      description: md.plain(product.short_description || product.description, 300) || $services_autoseo.summary(product).slice(0, 300), brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      mpn: product.model || undefined,
      additionalProperty: Array.isArray(product.specs) && product.specs.length
        ? product.specs.filter((x) => Array.isArray(x) && x[0] && x[1]).map(([k, v]) => ({ '@type': 'PropertyValue', name: k, value: v })) : undefined,
      image: product.images.map((id) => `${base}/media/${id}`),
      offers: { '@type': 'Offer', priceCurrency: 'BDT', price: product.price, availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: `${base}/p/${product.slug}`,
        priceValidUntil: product.flash_ends ? new Date(product.flash_ends).toISOString().slice(0, 10) : undefined,
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: settings.store_name || undefined },
        // Google merchant listings: delivery cost/time and the return rule (same as the shop's own rules)
        shippingDetails: { '@type': 'OfferShippingDetails',
          shippingRate: { '@type': 'MonetaryAmount', value: shipFee, currency: 'BDT' },
          shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'BD' },
          deliveryTime: { '@type': 'ShippingDeliveryTime',
            handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
            transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' } } },
        hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'BD',
          returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
          merchantReturnDays: Number(settings.returns_days) || 7,
          returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility' } },
      // star rating in Google results (only real, approved reviews)
      aggregateRating: rv.stats.count ? { '@type': 'AggregateRating', ratingValue: 'avg' in rv.stats ? rv.stats.avg : undefined, reviewCount: rv.stats.count, bestRating: 5, worstRating: 1 } : undefined,
      review: rv.reviews.length ? rv.reviews.slice(0, 5).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name || 'Customer' },
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 }, reviewBody: String(r.body).slice(0, 500), datePublished: new Date(r.created_at).toISOString().slice(0, 10) })) : undefined,
    };
    // breadcrumb for Google: Home › main category › … › product
    const crumbs: { name: string; url: string }[] = [];
    if (product.category_id) {
      const node = catalog.categoryTree(categories).byId.get(product.category_id);
      (node ? node.path : [])!.forEach((c) => crumbs.push({ name: c.name, url: `${base}${catHref(c.slug)}` }));
    }
    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: settings.store_name, url: base + '/' }, ...crumbs, { name: seo.cleanName(product.name), url: `${base}/p/${product.slug}` }]
      .map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url || undefined })) };
    product.name = seo.cleanName(product.name); // "Product details of …" copied from other shops never shows
    return done(seo.productTitle(product), shop.productPage({ product, related, settings, inlineProducts, categories, mainSrc,
      tiers: tiersMap.get(product.id) || [], offers, reviews: rv.reviews, reviewStats: rv.stats, cross, upsell, questions, selectedVariant: int(query.get('v')),
      kits, fbt }), {
      noindex: !!product.noindex || await catalog.copiedOut(product.id).catch(() => false), jsonLdExtra: breadcrumb,
      description: seo.productDescription(product, settings),
      keywords: seo.productKeywords(product),
      canonical, image: product.image_id ? `/media/${product.image_id}` : '', jsonLd, type: 'product',
      track: { event: 'view_item', id: product.id, name: product.name, price: product.price, category: product.category_name || '' },
    });
  }
  return NOT_FOUND;
}

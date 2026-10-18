// 🧭 The shop's main pages — home, product lists (all products, a category, a brand, search, offers) and product
// pages — as data: the page's title, its React body and its settings (canonical link, data for Google, tracking …).
// Used by the Next.js pages (app/(shop)) and by the original router (lib/site.ts), so both always show the same page.
import type { HomeRowsRow, PageViewsRow, FlashSalesRow, FlashItemsRow, ProductsRow } from '../data/rows';
import type { ReactNode } from 'react';
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as content from '../models/content';
import * as seo from '../services/seo';
import * as dupcanon from '../services/dupcanon';
import * as U from '../services/uiswitch';
import * as md from '../views/md';
import * as shop from '../views/shop';
import { str, int, bn, contact } from '../util';
import * as $services_search from '../services/search';
import * as $services_pricing from '../services/pricing';
import * as $services_autoseo from '../services/autoseo';
import * as $models_reviews from '../models/reviews';
import * as $models_extras from '../models/extras';
import * as $models_kits from '../models/kits';
import * as $models_homerows from '../models/homerows';
import type { Loose, Settings } from '../types';

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
export type ShopCtx = { path: string; query: URLSearchParams; settings: Settings; categories: Loose[]; base: string };

const NOT_FOUND: Resolved = { kind: 'notFound' };
const done = (title: string, body: ReactNode, opts: PageOpts = {}): Resolved => ({ kind: 'page', title, body, opts });

/** The page for one of these addresses: '/', '/products', '/brand/<slug>', '/p/<slug>'. Anything else: not found. */
export async function resolveShop(ctx: ShopCtx): Promise<Resolved> {
  const { path, query, settings, categories } = ctx;
  // Admin → দোকানে কী দেখাবে → "স্টক শেষ পণ্য তালিকায় দেখাও" off: lists, home rows and search skip them
  const hideOut = settings.ui_show_out_of_stock === '0';
  if (path === '/') {
    let sections = db.jsonSetting(settings, 'home_sections', HOME_DEFAULT);
    // 🎞️ running slider switched on (Admin → স্টোর ডিজাইন → রানিং স্লাইডার) → always at the top
    if (settings.slider_on === '1' && Array.isArray(sections) && !sections.includes('slider')) sections = ['slider', ...sections];
    const want = (k: string) => sections.includes(k);
    const ROW = 16;
    const inStockFirst = (a?: Loose) => [...a.filter((p: { stock: number; }) => p.stock > 0), ...a.filter((p: { stock: number; }) => p.stock <= 0)];
    // most looked-at products of the last 30 days (real visitors)
    const viewedIds = want('popular') ? (await db.q<Pick<PageViewsRow, 'product_id'>>(`SELECT product_id FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days'
      GROUP BY product_id ORDER BY count(DISTINCT visitor_id) DESC LIMIT $1`, [ROW * 2])).map((r) => r.product_id) : [];
    const [slides, promos, featured, latest, best, offers, posts, viewed, budget] = await Promise.all([
      want('slider') ? content.listBanners({ active: true, placement: 'slider' }) : [],
      want('promo') ? content.listBanners({ active: true, placement: 'promo' }) : [],
      want('featured') || want('popular') ? catalog.listProducts({ public: true, hideOut, featured: true, limit: ROW }) : [],
      want('new') ? catalog.listProducts({ public: true, hideOut, sort: 'new', limit: ROW * 2 }) : [],
      want('bestsellers') ? catalog.listProducts({ public: true, hideOut, sort: 'popular', limit: ROW * 2 }) : [],
      want('offers') ? catalog.listProducts({ public: true, hideOut, offer: true, sort: 'offer', limit: ROW * 2 }) : [],
      want('blog') ? content.listPosts({ published: true, limit: 3 }) : [],
      viewedIds.length ? catalog.getProductsByIds(viewedIds, { public: true }).then((r) => (hideOut ? r.filter((p) => p.stock > 0) : r)) : [],
      want('budget') ? catalog.listProducts({ public: true, hideOut, sort: 'popular', maxPrice: 100, limit: ROW * 2 }) : [],
    ]);
    const order = new Map(viewedIds.map((id, i) => [id, i]));
    const popularList = viewed.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
    // category rows: each main category with its best products
    let catRows: unknown[] = [];
    if (want('cat_rows')) {
      const { roots } = catalog.categoryTree(categories);
      const mains = roots.filter((c) => c.total_count! >= 4).slice(0, 8);
      catRows = await Promise.all(mains.map(async (c) => ({
        cat: c, chips: c.children.filter((k) => k.total_count! > 0).slice(0, 8),
        products: inStockFirst(await catalog.listProducts({ public: true, hideOut, category: c.slug, sort: 'popular', limit: ROW * 2 })).slice(0, ROW),
      })));
    }
    const take = (a: catalog.Product[]) => inStockFirst(a).slice(0, ROW);
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
    const custom: Record<string, unknown> = {};
    const customKeys = sections.filter((k: string) => /^x\d+$/.test(k));
    if (customKeys.length) {
      const H = $models_homerows;
      const rows = await db.q<HomeRowsRow>('SELECT * FROM home_rows WHERE id = ANY($1::int[])', [customKeys.map((k: unknown) => H.idOf(k))]).catch(() => []);
      await Promise.all(rows.map(async (r) => {
        custom[H.keyOf(r.id)] = { row: r, link: H.linkFor(r), products: await H.productsFor(r, { hideOut }).catch(() => []) };
      }));
    }
    const data = {
      slides, promos, categories, posts, catRows, flash, custom,
      latest: latest.slice(0, ROW),
      offers: take(offers),
      best: take(best.filter((p) => p.sold_count > 0)),
      popular: take(popularList.length >= 4 ? popularList : featured),
      featured: take(featured),
      budget: take(budget.filter((p) => p.stock > 0)),
    };
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
      sameAs: ['social_facebook', 'social_instagram', 'social_youtube', 'social_tiktok', 'social_linkedin', 'social_x'].map((k) => settings[k]).filter((u) => /^https?:\/\//.test(u || '')) };
    // the site's name in Google results + a search box for the shop
    const websiteLd = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': site + '/#website', name: settings.store_name,
      alternateName: names.filter((n) => n !== settings.store_name), url: site + '/', inLanguage: 'bn-BD',
      publisher: { '@id': site + '/#store' },
      potentialAction: { '@type': 'SearchAction', target: `${site}/products?q={search_term_string}`, 'query-input': 'required name=search_term_string' } };
    return done('', shop.home({ settings, sections, data }), { canonical: '/', jsonLd, jsonLdExtra: websiteLd, description: seo.homeDescription(settings) });
  }
  if (path === '/products' || /^\/brand\/[^/]+$/.test(path)) {
    const q = str(query.get('q'), 80);
    const sortAsked = query.get('sort') || '';
    const sort = ['new', 'popular', 'offer', 'price_asc', 'price_desc'].includes(sortAsked) ? sortAsked : '';
    // a brand's own page: /brand/philips
    let brand = null;
    if (path.startsWith('/brand/')) {
      brand = await catalog.getBrand({ slug: path.slice(7) });
      if (!brand || !brand.active) return NOT_FOUND;
    }
    const category = !brand && query.get('cat') ? categories.find((c) => c.slug === query.get('cat')) || null : null;
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
      if (ids && pageNo === 1 && !query.get('pmin') && !query.get('b')) $services_search.log(q, ids.length).catch(() => {});
    }
    const opts = { category: category && category.slug, brandId: brand && brand.id, q: ids ? '' : q, ids, sort, offer: sort === 'offer', hideOut };
    const fopts = { ...opts, minPrice: filters.pmin || undefined, maxPrice: filters.pmax || undefined, brandIds: filters.brands, inStock: filters.stock,
      specs: filters.specList.length ? filters.specs : null };
    const [products, total, brandList, specFacets] = await Promise.all([
      catalog.listProducts({ public: true, ...fopts, limit: perPage, offset: (pageNo - 1) * perPage }), catalog.countProducts(fopts),
      brand || settings.ui_filters === '0' ? [] : catalog.brandsIn(opts).catch(() => []),
      settings.ui_filters === '0' || settings.ui_spec_filters === '0' ? [] : catalog.specFacets(opts).catch(() => []),
    ]);
    const intro = brand || category;
    // 🔎 a proper Google title & description for every category / brand (the owner's own text wins when written)
    const title = q ? `খুঁজুন: ${q}` : intro ? seo.listTitle(brand ? { ...brand, seo_title: brand.seo_title || `${brand.name} পণ্য — দাম ও অর্ডার বাংলাদেশে` } : intro, pageNo)
      : sort === 'offer' ? 'অফার — ছাড়ে কেনাকাটা' : pageNo > 1 ? `সব পণ্য (পেজ ${bn(pageNo)})` : 'সব পণ্য — দাম ও অনলাইন অর্ডার';
    const description = intro ? seo.listDescription(intro, total, settings) : !q ? seo.homeDescription(settings) : undefined;
    const lbase = ctx.base.replace(/\/+$/, '');
    const listLd = !q ? seo.itemListLd(lbase, products, (pageNo - 1) * perPage) : null;
    // breadcrumb: Home › main category › sub-category
    const catPath = category ? ((catalog.categoryTree(categories).byId.get(category.id) || {}).path || [category]) : [];
    const listCrumbs = category ? { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: settings.store_name, item: lbase + '/' },
      ...catPath.map((c) => ({ name: c.name, item: `${lbase}/products?cat=${c.slug}` }))].map((c, i) => ({ '@type': 'ListItem', position: i + 1, ...c })) } : null;
    // filtered / sorted copies of a list are the same page for Google; page 2, 3 … are their own pages
    const filtered = !!(sort || filters.pmin || filters.pmax || filters.brands.length || filters.stock || filters.specList.length);
    const listPath = brand ? `/brand/${brand.slug}` : category ? `/products?cat=${category.slug}` : '/products';
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
    const questions = U.on(settings, 'ui_qa') ? await $models_extras.publishedQuestions(product.id) : [];
    // related: the owner's own choice, otherwise the same category
    const related = chosen.length ? chosen.slice(0, cols) : product.category_slug
      ? (await catalog.listProducts({ public: true, hideOut, category: product.category_slug, limit: 9 })).filter((p) => p.id !== product.id).slice(0, cols)
      : [];
    const offers = offerRows.map((o) => ({ label: pricing.offerTitle(o, bn), ends_on: o.ends_on ? String(o.ends_on).slice(0, 10) : '' }));
    const slugs = [...String(product.description || '').matchAll(/^\s*\/p\/([A-Za-z0-9ঀ-৿-]+)\s*$/gm)].map((x) => x[1]).slice(0, 6);
    const inlineProducts: Record<string, unknown> = {};
    for (const s of slugs) { const ip = await catalog.getProduct({ slug: s, public: true }); if (ip && ip.active) inlineProducts[s] = ip; }
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
      aggregateRating: rv.stats.count ? { '@type': 'AggregateRating', ratingValue: (rv.stats as Loose).avg, reviewCount: rv.stats.count, bestRating: 5, worstRating: 1 } : undefined,
      review: rv.reviews.length ? rv.reviews.slice(0, 5).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name || 'Customer' },
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 }, reviewBody: String(r.body).slice(0, 500), datePublished: new Date(r.created_at).toISOString().slice(0, 10) })) : undefined,
    };
    // breadcrumb for Google: Home › main category › … › product
    const crumbs: Loose[] = [];
    if (product.category_id) {
      const node = catalog.categoryTree(categories).byId.get(product.category_id);
      (node ? node.path : [])!.forEach((c) => crumbs.push({ name: c.name, url: `${base}/products?cat=${c.slug}` }));
    }
    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: settings.store_name, url: base + '/' }, ...crumbs, { name: seo.cleanName(product.name), url: `${base}/p/${product.slug}` }]
      .map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url || undefined })) };
    product.name = seo.cleanName(product.name); // "Product details of …" copied from other shops never shows
    return done(seo.productTitle(product), shop.productPage({ product, related, settings, inlineProducts, categories,
      tiers: tiersMap.get(product.id) || [], offers, reviews: rv.reviews, reviewStats: rv.stats, cross, upsell, questions, selectedVariant: int(query.get('v')),
      kits: settings.kits_on !== '0' ? await $models_kits.kitsWith(product.id).catch(() => []) : [] }), {
      noindex: !!product.noindex, jsonLdExtra: breadcrumb,
      description: seo.productDescription(product, settings),
      keywords: seo.productKeywords(product),
      canonical: await dupcanon.canonicalFor(product.slug), image: product.image_id ? `/media/${product.image_id}` : '', jsonLd, type: 'product',
      track: { event: 'view_item', id: product.id, name: product.name, price: product.price, category: product.category_name || '' },
    });
  }
  return NOT_FOUND;
}

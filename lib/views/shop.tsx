import * as security from '../security';
import { createElement } from 'react';
import { Fragment } from 'react';
import { Val, RawHtml, attrValue, htmlValue, styleOf, jsxList } from '../react/html';
import * as R from '../../components/shop/Pages';
import { raw, esc, money, bn, fmtDate, youtubeId, contact, roundOff, roundOffLabel, qtyRule, minOrder } from '../util';
import * as O from '../models/orders';
import * as md from './md';
import { categoryTree } from '../models/catalog';
import * as U from '../services/uiswitch';
import * as $services_seo from '../services/seo';
import * as $services_imagekit from '../services/imagekit';
import * as $services_autoseo from '../services/autoseo';
import * as $models_catalog from '../models/catalog';
import * as $models_kits from '../models/kits';
import * as $services_courier from '../services/courier';
import * as $models_selfservice from '../models/selfservice';
import * as $models_complaints from '../models/complaints';
import type { Body, Id, Loose, Settings } from '../types';
import type { DbRow } from '../pg';
import type { BannersRow, FlashSalesRow, HomeRowsRow } from '../data/rows';
import type { BrandCount, Category, CategoryNode, FullProduct, Product, SpecFacet } from '../models/catalog';
import type { OrderReviewItem, ReviewStats, ShownReview } from '../models/reviews';
import type { PayMethod } from '../services/payments';
import type { BrandsRow, CustomerAddressesRow, KitsRow, ProductQuestionsRow } from '../data/rows';
type Question = Pick<ProductQuestionsRow, 'id' | 'name' | 'question' | 'answer' | 'created_at'>;
import type { PostSummary } from '../models/content';
import type { ReactNode } from 'react';

/** A product as the shop's cards and pages read it. Any product query's row fits (the columns named here are typed). */
// (read: id, name, slug, price, old_price, stock, image_id / image_ik, emoji, is_new, created_at …)
type ShopProduct = Product;

// A product picture. Small card pictures link straight to ImageKit when the picture lives there (one step less than
// /media/<id>/t, which only forwards to the same address). pri: 'high' = the first pictures a customer sees (load at
// once, before anything else), 'eager' = load at once; otherwise the picture loads when it scrolls into view.
type Pri = '' | 'eager' | 'high';
function img(p: ShopProduct, cls = '', thumb = true, pri: Pri = '') {
  if (p.image_id) {
    const src = thumb && p.image_ik ? String($services_imagekit.thumbUrl(p.image_ik)) : `/media/${p.image_id}${thumb ? '/t' : ''}`;
    return (<img className={String(cls)} src={src} alt={p.name} loading={pri ? 'eager' : 'lazy'} fetchPriority={pri === 'high' ? 'high' : undefined} decoding="async" draggable="false" />);
  }
  return (<span className={`emoji ${attrValue(cls)}`} aria-hidden="true"><Val v={p.emoji || '📦'} /></span>);
}
function discount(p: ShopProduct): number {
  const old = Number(p.old_price) || 0; const price = Number(p.price) || 0;
  if (!old || old <= price) return 0;
  return Math.round(((old - price) / old) * 100);
}

// ★★★★☆ for a rating (rounded to the nearest whole star)
function stars(r: unknown) {
  const n = Math.max(0, Math.min(5, Math.round(Number(r) || 0)));
  return (<span className="stars" aria-label={`${bn(Number(r || 0).toFixed(1))} / ৫`}>{'★'.repeat(n)}<span className="stars-off">{'★'.repeat(5 - n)}</span></span>);
}
const wishOn = (s?: Settings | null) => !s || s.wishlist_on !== '0';
function wishBtn(p: ShopProduct, s: Settings | null | undefined, cls = '') {
  return wishOn(s) ? (<button type="button" className={`wish-btn ${attrValue(cls)}`} data-wish={attrValue(p.id)} title="পছন্দের তালিকায় রাখুন" {...({ "aria-label": `${attrValue(p.name)} পছন্দের তালিকায় রাখুন`, "aria-pressed": "false" } as Record<string, string>)}>♡</button>) : '';
}

// "নতুন": ticked by hand, or added within the last N days (Admin → সেটিংস)
function isNewP(p: ShopProduct, s: Settings | null | undefined): boolean {
  if (p.is_new) return true;
  const days = Number(s && s.new_badge_days !== undefined ? s.new_badge_days : 14);
  return days > 0 && !!p.created_at && Date.now() - new Date(p.created_at).getTime() < days * 864e5;
}
function productCard(p: ShopProduct, settings: Settings, badge = '', pri: Pri = '') {
  const S = settings || {};
  // "Product details of …" copied from other shops never shows on a card
  if (p && /^\s*product\s+details?\s+of\s/i.test(p.name || '')) p = { ...p, name: $services_seo.cleanName(p.name) };
  if (!badge && isNewP(p, settings) && U.on(S, 'ui_card_new')) badge = 'নতুন';
  if (badge === 'নতুন' && !U.on(S, 'ui_card_new')) badge = '';
  const off = U.on(S, 'ui_card_discount') ? discount(p) : 0;
  const out = p.stock <= 0;
  return (<article className={`card ${out ? 'is-out' : ''}`}><a className="card-pic" href={`/p/${attrValue(p.slug)}`} tabIndex={-1} aria-hidden="true">{' '}{img(p, '', true, pri)}{' '}{(off ? <span className="badge-off">{bn(off)}% ছাড়</span> : null)}{' '}{(p.product_type === 'bundle' ? <span className="badge-bundle">প্যাকেজ</span> : null)}{' '}{(p.flash_ends ? <span className="badge-flash">⚡ ফ্ল্যাশ সেল</span> : (badge ? <span className="badge-tag"><Val v={badge} /></span> : null))}{' '}</a>{' '}{wishBtn(p, settings, 'card-wish')}<div className="card-body">{(p.category_name && U.on(S, 'ui_card_category') ? <span className="card-cat"><Val v={p.category_name} /></span> : null)}<h3 className="card-title"><a href={`/p/${attrValue(p.slug)}`}><Val v={p.name} /></a></h3>{(p.rating_count > 0 && U.on(S, 'ui_card_rating') && U.on(S, 'reviews_on') ? <p className="card-rating">{stars(p.rating_avg)}{' '}<span>({bn(p.rating_count)})</span></p> : null)}<div className="price-row"><span className="price">{money(p.price)}</span>{(p.variant_count > 0 ? <span className="per-pc">থেকে</span> : (qtyRule(settings || {}, p.price).cheap ? <span className="per-pc">/পিস</span> : null))}{' '}{(Number(p.old_price) > p.price ? <s className="old-price">{money(p.old_price)}</s> : null)}</div>{(p.flash_ends && U.on(S, 'ui_card_flash_timer') ? <p className="card-flash">⚡ শেষ হবে{' '}<b className="countdown" data-countdown={attrValue(new Date(p.flash_ends).toISOString())}></b></p> : null)}{' '}{(out ? (p.preorder && p.product_type !== 'bundle' ? <a className="btn btn-block btn-ghost" href={`/p/${attrValue(p.slug)}`}>⏳ প্রি-অর্ডার করুন</a> : <button className="btn btn-block" disabled>স্টকে নেই</button>) : (p.variant_count > 0 ? <div className="card-actions"><a className="btn btn-block btn-add" href={`/p/${attrValue(p.slug)}`}>অপশন বাছুন ({bn(p.variant_count)})</a></div> : <div className="card-actions"><button className="btn btn-block btn-add" data-add={attrValue(p.id)} data-name={attrValue(p.name)} data-price={attrValue(p.price)}>কার্টে যোগ করুন</button>{' '}{(S.show_buy_now_on_card === '1' ? <button className="btn btn-block btn-amber btn-buy" data-add={attrValue(p.id)} data-name={attrValue(p.name)} data-price={attrValue(p.price)} data-buy-now=""><Val v={U.text(S, 'uit_buy_now')} /></button> : null)}</div>))}</div></article>);
}
// lead = how many of the first cards are on screen at once (they load immediately; the first two before anything else)
const leadPri = (i: number, lead: number): Pri => (i < Math.min(lead, 2) ? 'high' : i < lead ? 'eager' : '');
function productGrid(products: ShopProduct[], settings: Settings, emptyMsg?: ReactNode, lead = 0) {
  if (!products.length) return (<div className="empty"><p><Val v={emptyMsg || 'কোনো পণ্য পাওয়া যায়নি।'} /></p><a className="btn" href="/products">সব পণ্য দেখুন</a></div>);
  return (<div className="grid"><Val v={products.map((p, i) => productCard(p, settings, '', leadPri(i, lead)))} /></div>);
}
// The shop's four promises — small and in one row (inside the blue banner, or a thin strip under the pictures).
function trustItems(s: Settings, cls = '') {
  const phone = contact(s).phone;
  return (<ul className={`trust-row ${attrValue(cls)}`}><li><span className="tr-ic" aria-hidden="true">🚚</span><span><b>সারা দেশে ডেলিভারি</b><small>ঢাকায়{' '}{money(s.delivery_dhaka)}, বাইরে{' '}{money(s.delivery_outside)}</small></span></li><li><span className="tr-ic" aria-hidden="true">💵</span><span><b>ক্যাশ অন ডেলিভারি</b><small>পণ্য হাতে পেয়ে টাকা</small></span></li><li><span className="tr-ic" aria-hidden="true">🔁</span><span><b>সহজ রিটার্ন</b><small>সমস্যা থাকলে ফেরত</small></span></li><li>{(phone ? <a href={`tel:${attrValue(phone)}`} className="tr-link"><span className="tr-ic" aria-hidden="true">📞</span><span><b>সাহায্য দরকার?</b><small><Val v={phone} /></small></span></a> : <><span className="tr-ic" aria-hidden="true">📞</span><span><b>সাহায্য দরকার?</b><small>আমাদের মেসেজ দিন</small></span></>)}</li></ul>);
}
function section(title: ReactNode, link: string, content: ReactNode) {
  return (<section className="home-sec"><div className="section-head"><h2><Val v={title} /></h2>{(link ? <a href={attrValue(link)}>সব দেখুন →</a> : null)}</div><Val v={content} /></section>);
}
// Home page boxes: only the main categories (no drop-downs); the count includes their sub-categories.
function catGrid(categories: $models_catalog.Category[]) {
  const { roots } = categoryTree(categories);
  return (<nav className="cat-grid" aria-label="ক্যাটাগরি">{jsxList(roots.map((c) => <a className="cat-box" href={`/products?cat=${attrValue(c.slug)}`}>{' '}<span className="cat-ic" aria-hidden="true">{(c.image_id ? <img src={`/media/${attrValue(c.image_id)}/t`} alt="" draggable="false" /> : <Val v={c.icon} />)}</span>{' '}<span className="cat-name"><Val v={c.name} /></span><span className="cat-count">{bn(c.total_count)}টি</span></a>))}</nav>);
}
// "হোম / ইলেকট্রনিক্স / সার্কিট ও মডিউল" — every step is a link except the last
function catCrumbs(node: CategoryNode, last = true) {
  if (!node) return '';
  return (<>{jsxList(node.path!.map((x, i) => (last && i === node.path!.length - 1 ? <>{' '}/{' '}<span><Val v={x.name} /></span></> : <>{' '}/{' '}<a href={`/products?cat=${attrValue(x.slug)}`}><Val v={x.name} /></a></>)))}</>);
}

// A row of products that slides sideways (arrows on computers, swipe on phones).
// auto = moves on by itself, one card at a time, and stops while someone is looking at it.
function rail(title: ReactNode, link: string, products: ShopProduct[] | null | undefined, s: Settings, { badge = '', auto = false, sub = '', chips = null, lead = 0 }: { badge?: string | ((p: ShopProduct) => string); auto?: boolean; sub?: ReactNode; chips?: DbRow[] | null; lead?: number } = {}) {
  if (!products || !products.length) return '';
  return (<section className="home-sec rail-sec"><div className="section-head"><div><h2><Val v={title} /></h2>{(sub ? <p className="sec-sub"><Val v={sub} /></p> : null)}</div><div className="rail-head-r">{(link ? <a href={attrValue(link)}>সব দেখুন →</a> : null)}{' '}<button type="button" className="rail-btn" data-rail-prev="" aria-label="আগের পণ্য">‹</button><button type="button" className="rail-btn" data-rail-next="" aria-label="পরের পণ্য">›</button></div></div>{(chips && chips.length ? <div className="chips rail-chips">{jsxList(chips.map((c) => <a className="chip" href={`/products?cat=${attrValue(c.slug)}`}><Val v={c.name} /></a>))}</div> : null)}<div className="rail" data-rail="" data-rail-auto={(auto) ? "" : undefined}><Val v={products.map((p, i) => productCard(p, s, typeof badge === 'function' ? badge(p) : badge, i < lead ? 'eager' : ''))} /></div></section>);
}

// ---------------------------------------------------------------- home
/** what the home page shows (made in lib/shop/router.tsx; a box the owner switched off gets an empty list) */
export type HomeData = {
  slides: BannersRow[]; promos: BannersRow[]; categories: $models_catalog.Category[]; posts: PostSummary[];
  catRows: { cat: CategoryNode; chips: CategoryNode[]; products: Product[] }[];
  flash: { sale: FlashSalesRow; products: Product[] } | null;
  /** the owner's own rows, by their key (x12) */
  custom: Record<string, { row: HomeRowsRow; link: string; products: Product[] }>;
  latest: Product[]; offers: Product[]; best: Product[]; popular: Product[]; featured: Product[]; budget: Product[];
};
type HomeProps = {
  settings: Settings;
  /** the home page's boxes, in the owner's order */
  sections: string[];
  data: HomeData;
};
function home({ settings: s, sections, data }: HomeProps) {
  // the first row of products on the page loads its first cards at once (the rest load as they scroll into view)
  let firstRow = true;
  const lead = (list?: unknown[] | null) => (firstRow && list && list.length ? ((firstRow = false), 4) : 0);
  const parts = sections.map((key: string) => {
    if (key === 'slider') {
      if (!data.slides.length || s.slider_on === '0') {
        // no banner pictures yet: the blue welcome banner, with the shop's promises inside it
        return (<section className="hero"><div className="wrap hero-row"><div className="hero-text"><h1><Val v={s.hero_title || 'দরকারি সব পার্টস, এক দোকানে'} /></h1><p><Val v={s.tagline} /></p><div className="hero-actions"><a className="btn btn-amber" href="/products">কেনাকাটা শুরু করুন</a><a className="btn btn-ghost-light" href="/track">অর্ডার ট্র্যাক করুন</a></div>{(sections.includes('trust') ? trustItems(s, 'hero-trust') : null)}</div></div></section>);
      }
      return (<section className={`slider ${s.slider_effect === 'fade' ? 'fx-fade' : 'fx-slide'}`} data-slider="" data-interval={attrValue(Math.min(15, Math.max(1, Number(s.slider_interval) || 4)))} aria-roledescription="carousel"><div className="slides">{jsxList(data.slides.slice(0, 5).map((b, i: number) => <a className={`slide ${i === 0 ? 'on' : ''}`} href={attrValue(security.safeUrl(b.link))} tabIndex={(b.link) ? undefined : -1}>{' '}<img src={`/media/${attrValue(b.image_id)}`} alt={attrValue(b.title || s.store_name)} loading={i ? 'lazy' : undefined} fetchpriority={i ? undefined : 'high'} draggable="false" />{' '}{(b.title || b.subtitle ? <span className="slide-text"><b><Val v={b.title} /></b>{(b.subtitle ? <span><Val v={b.subtitle} /></span> : null)}{(b.button ? <em className="btn btn-amber btn-sm"><Val v={b.button} /></em> : null)}</span> : null)}{' '}</a>))}</div>{(data.slides.length > 1 ? <div className="dots">{jsxList(data.slides.slice(0, 5).map((_: unknown, i) => <button type="button" data-dot={attrValue(i)} className={i === 0 ? 'on' : ''} aria-label={`স্লাইড ${bn(i + 1)}`}></button>))}</div> : null)}</section>);
    }
    if (key === 'categories' && data.categories.length) return (<div className="wrap">{section(U.text(s, 'uit_home_categories'), '', catGrid(data.categories))}</div>);
    if (key === 'trust') return sections.includes('slider') && !data.slides.length ? '' : (<div className="wrap">{trustItems(s, 'trust-strip')}</div>);
    if (key === 'flash') {
      if (!data.flash || !data.flash.products.length) return '';
      return (<div className="wrap flash-sec">{rail(`⚡ ${data.flash.sale.title}`, '/products?sort=offer', data.flash.products, s,
        { lead: lead(data.flash.products), sub: (<>অফার শেষ হবে{' '}<b className="countdown" data-countdown={attrValue(new Date(data.flash.sale.ends_at).toISOString())}></b></>) })}</div>);
    }
    if (key === 'new') return (<div className="wrap">{rail(U.text(s, 'uit_home_new'), '/products?sort=new', data.latest, s, { lead: lead(data.latest), auto: true, badge: (p) => (isNewP(p, s) ? 'নতুন' : ''), sub: U.text(s, 'uit_home_new_sub') })}</div>);
    if (key === 'offers') return (<div className="wrap">{rail(U.text(s, 'uit_home_offers'), '/products?sort=offer', data.offers, s, { lead: lead(data.offers), sub: U.text(s, 'uit_home_offers_sub') })}</div>);
    if (key === 'bestsellers') return (<div className="wrap">{rail(U.text(s, 'uit_home_bestsellers'), '/products?sort=popular', data.best, s, { lead: lead(data.best), badge: 'বেস্ট সেলার', sub: U.text(s, 'uit_home_bestsellers_sub') })}</div>);
    if (key === 'popular') return (<div className="wrap">{rail(U.text(s, 'uit_home_popular'), '/products', data.popular, s, { lead: lead(data.popular), badge: 'জনপ্রিয়', sub: U.text(s, 'uit_home_popular_sub') })}</div>);
    if (key === 'featured') return (<div className="wrap">{rail(U.text(s, 'uit_home_featured'), '/products', data.featured, s, { lead: lead(data.featured), sub: U.text(s, 'uit_home_featured_sub') })}</div>);
    if (key === 'budget') return (<div className="wrap">{rail(U.text(s, 'uit_home_budget'), '/products?sort=price_asc', data.budget, s, { lead: lead(data.budget), sub: U.text(s, 'uit_home_budget_sub') })}</div>);
    if (key === 'cat_rows') {
      return (<div className="wrap"><Val v={(data.catRows || []).map((r) => rail(`${r.cat.icon} ${r.cat.name}`, `/products?cat=${r.cat.slug}`, r.products, s, { chips: r.chips, lead: lead(r.products) }))} /></div>);
    }
    if (key === 'promo' && data.promos.length) {
      return (<div className="wrap"><div className="promos">{jsxList(data.promos.map((b: Body) => <a href={attrValue(security.safeUrl(b.link))} className="promo"><img src={`/media/${attrValue(b.image_id)}`} alt={attrValue(b.title || '')} loading="lazy" draggable="false" /></a>))}</div></div>);
    }
    // the owner's own rows (Admin → হোমপেজের সারি)
    if (/^x\d+$/.test(key)) {
      const c = data.custom && data.custom[key];
      if (!c || !c.products.length) return '';
      const sub = c.row.sub;
      const rowLead = lead(c.products);
      if (c.row.style === 'grid') {
        return (<div className="wrap"><section className="home-sec"><div className="section-head"><div><h2><Val v={c.row.title} /></h2>{(sub ? <p className="sec-sub"><Val v={sub} /></p> : null)}</div><a href={attrValue(c.link)}>সব দেখুন →</a></div><div className="grid"><Val v={c.products.map((p: ShopProduct, i: number) => productCard(p, s, c.row.badge, i < rowLead ? 'eager' : ''))} /></div></section></div>);
      }
      return (<div className="wrap">{rail(c.row.title, c.link, c.products, s, { badge: c.row.badge, sub, lead: rowLead })}</div>);
    }
    if (key === 'blog' && data.posts.length) {
      return (<div className="wrap">{section(U.text(s, 'uit_home_blog'), '/blog', (<div className="post-grid"><Val v={data.posts.map(postCard)} /></div>))}</div>);
    }
    return '';
  });
  return (<><Val v={parts} />{(s.for_you_on !== '0' ? <div className="wrap">{forYouBox()}</div> : null)}{(U.on(s, 'ui_recent') ? <div className="wrap">{recentBox(s)}</div> : null)}</>);
}

// ---------------------------------------------------------------- listing
type ListFilters = { pmin?: number; pmax?: number; brands?: number[]; stock?: boolean; specs?: Record<string, string[]>; specList?: string[] };
type ListingProps = {
  products: Product[]; categories: Category[]; category?: Category | null; brand?: BrandsRow | null; q?: string; sort?: string; settings: Settings;
  total: number; page: number; perPage: number; filters?: ListFilters; brandList?: BrandCount[]; specFacets?: SpecFacet[]; fallback?: Product[];
};
function listing({ products, categories, category, brand = null, q, sort, settings, total, page, perPage, filters = {}, brandList = [], specFacets = [], fallback = [] }: ListingProps) {
  const title = brand ? brand.name : category ? category.name : q ? `"${q}" এর ফলাফল` : sort === 'offer' ? 'অফারের পণ্য' : 'সব পণ্য';
  const base = new URLSearchParams();
  if (category) base.set('cat', category.slug);
  if (q) base.set('q', q);
  if (sort) base.set('sort', sort);
  if (filters.pmin) base.set('pmin', String(filters.pmin));
  if (filters.pmax) base.set('pmax', String(filters.pmax));
  (filters.brands || []).forEach((b) => base.append('b', String(b)));
  if (filters.stock) base.set('stock', '1');
  (filters.specList || []).forEach((x: string) => base.append('sp', x));
  const nFilters = (filters.pmin || filters.pmax ? 1 : 0) + (filters.brands || []).length + (filters.stock ? 1 : 0) + (filters.specList || []).length;
  const pages = Math.ceil(total / perPage);
  const listPath = brand ? `/brand/${brand.slug}` : '/products';
  const pageLink = (n: number) => { const p = new URLSearchParams(base); if (n > 1) p.set('page', String(n)); return listPath + (p.toString() ? '?' + p : ''); };
  const intro = brand || category;
  const { roots, byId } = categoryTree(categories);
  const here = category ? byId.get(category.id) : null;
  // chips: inside a category → its sub-categories (or, at the bottom level, its neighbours); otherwise the main categories
  const holder = here ? (here.children.some((k) => k.total_count! > 0) ? here : (here.parent_id ? byId.get(here.parent_id) : null)) : null;
  const chips = (holder ? holder.children : roots).filter((k) => k.total_count! > 0 || !holder);
  const allHref = holder ? `/products?cat=${holder.slug}` : (q ? `/products?q=${encodeURIComponent(q)}` : '/products');
  return (<div className="wrap section"><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{(brand ? <>{' '}/{' '}<a href="/products">সব পণ্য</a>{' '}/{' '}<span><Val v={brand.name} /></span></> : (here ? catCrumbs(here) : <>{' '}/{' '}<span><Val v={title} /></span></>))}</nav>{(!brand && category && category.banner_id && page === 1 ? <div className="cat-banner"><img src={`/media/${attrValue(category.banner_id)}`} alt={attrValue(category.name)} fetchpriority="high" draggable="false" /></div> : null)}<div className="listing-head"><h1>{(brand && brand.logo_id ? <img className="brand-logo" src={`/media/${attrValue(brand.logo_id)}/t`} alt="" draggable="false" /> : null)}<Val v={title} />{' '}<small>{bn(total)}টি পণ্য</small></h1><form className="sort" method="get" action={attrValue(listPath)}>{(category && !brand ? <input type="hidden" name="cat" defaultValue={attrValue(category.slug)} /> : null)}{' '}{(q ? <input type="hidden" name="q" defaultValue={attrValue(q)} /> : null)}{' '}<label htmlFor="sort">সাজান</label>{' '}<select id="sort" name="sort" data-autosubmit="">{' '}{jsxList([['', 'জনপ্রিয়'], ['new', 'নতুন আগে'], ['popular', 'বেশি বিক্রি'], ['offer', 'অফার'], ['price_asc', 'দাম: কম থেকে বেশি'], ['price_desc', 'দাম: বেশি থেকে কম']].map(([v, l]) => <option value={attrValue(v)} selected={!!(sort === v)}><Val v={l} /></option>))}{' '}</select>{' '}{(filters.pmin ? <input type="hidden" name="pmin" defaultValue={attrValue(filters.pmin)} /> : null)}{(filters.pmax ? <input type="hidden" name="pmax" defaultValue={attrValue(filters.pmax)} /> : null)}{' '}{jsxList((filters.brands || []).map((b) => <input type="hidden" name="b" defaultValue={attrValue(b)} />))}{(filters.stock ? <input type="hidden" name="stock" defaultValue="1" /> : null)}{' '}{jsxList((filters.specList || []).map((x) => <input type="hidden" name="sp" defaultValue={attrValue(x)} />))}</form></div>{(settings.ui_filters === '0' ? null : filterBox({ listPath, category, brand, q, sort, filters, brandList, specFacets, nFilters }))}{' '}{(intro && intro.description && page === 1 ? <div className="listing-intro rich"><RawHtml html={md.render(intro.description)} /></div> : null)}{' '}{(brand ? null : <div className="chips cat-chips" role="list"><a role="listitem" className={`chip ${(!category || (holder && holder.id === category.id)) ? 'on' : ''}`} href={attrValue(allHref)}>{(holder ? `সব ${holder.name}` : "সব")}</a>{' '}{jsxList(chips.map((c) => <a role="listitem" className={`chip ${category && category.id === c.id ? 'on' : ''}`} href={`/products?cat=${attrValue(c.slug)}`}>{(c.depth === 0 ? <><Val v={c.icon} />{' '}</> : null)}<Val v={c.name} /></a>))}</div>)}{' '}{productGrid(products, settings, nFilters ? 'এই ফিল্টারে কোনো পণ্য নেই — ফিল্টার কমিয়ে দেখুন।' : q ? `"${q}" নামে কোনো পণ্য পাওয়া যায়নি। অন্য নামে খুঁজে দেখুন, অথবা আমাদের WhatsApp/ফোনে জিজ্ঞেস করুন — আনিয়ে দেওয়ার চেষ্টা করব।` : 'এখানে এখনো পণ্য নেই।', 4)}{' '}{(fallback.length ? <section className="no-results-more"><h2>🔥 বেশি বিক্রি হওয়া পণ্য</h2>{productGrid(fallback, settings, '')}</section> : null)}{' '}{(pages > 1 ? <nav className="pager" aria-label="পেজ">{(page > 1 ? <a href={attrValue(pageLink(page - 1))}>← আগের</a> : null)}{' '}{jsxList(Array.from({ length: pages }, (_, i) => i + 1).filter((n) => Math.abs(n - page) < 3 || n === 1 || n === pages).map((n) => (n === page ? <b>{bn(n)}</b> : <a href={attrValue(pageLink(n))}>{bn(n)}</a>)))}{' '}{(page < pages ? <a href={attrValue(pageLink(page + 1))}>পরের →</a> : null)}</nav> : null)}</div>);
}

// "1-2" → "১-২ দিনে"
function delText(v: unknown, def: string): string {
  const m = String(v || def).match(/^(\d{1,2})(?:-(\d{1,2}))?$/) || String(def).match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  return `${bn(m![1])}${m![2] && m![2] !== m![1] ? '-' + bn(m![2]) : ''} দিনে`;
}

// 🔎 Filter box on shop lists: price from–to, brands, only in stock. A plain form (works without JavaScript too).
type FilterBoxProps = {
  listPath: string;
  category?: Category | null;
  brand?: BrandsRow | null;
  q?: string;
  sort?: string;
  filters: ListFilters;
  brandList: BrandCount[];
  specFacets?: SpecFacet[];
  nFilters: number;
};
function filterBox({ listPath, category, brand, q, sort, filters, brandList, specFacets = [], nFilters }: FilterBoxProps) {
  const clear = new URLSearchParams();
  if (category && !brand) clear.set('cat', category.slug);
  if (q) clear.set('q', q);
  if (sort) clear.set('sort', sort);
  const clearHref = listPath + (clear.toString() ? '?' + clear : '');
  const showBrands = brandList.length > 1 || (filters.brands || []).length;
  return (<details className="filters" open={!!(nFilters)}><summary className="btn btn-sm btn-ghost">⚙️ ফিল্টার{(nFilters ? <>{' '}<b className="filter-n">{bn(nFilters)}</b></> : null)}</summary><form className="filter-form" method="get" action={attrValue(listPath)}>{(category && !brand ? <input type="hidden" name="cat" defaultValue={attrValue(category.slug)} /> : null)}{(q ? <input type="hidden" name="q" defaultValue={attrValue(q)} /> : null)}{(sort ? <input type="hidden" name="sort" defaultValue={attrValue(sort)} /> : null)}<fieldset className="f-price"><legend>দাম (৳)</legend><input name="pmin" inputMode="decimal" placeholder="সর্বনিম্ন" defaultValue={attrValue(filters.pmin || '')} maxLength={8} aria-label="সর্বনিম্ন দাম" />{' '}<span aria-hidden="true">–</span>{' '}<input name="pmax" inputMode="decimal" placeholder="সর্বোচ্চ" defaultValue={attrValue(filters.pmax || '')} maxLength={8} aria-label="সর্বোচ্চ দাম" /></fieldset>{(showBrands ? <fieldset className="f-brands"><legend>ব্র্যান্ড</legend><div className="f-brand-list">{jsxList(brandList.map((b) => <label className="check"><input type="checkbox" name="b" defaultValue={attrValue(b.id)} defaultChecked={!!((filters.brands || []).includes(b.id))} />{' '}<span translate="no"><Val v={b.name} /></span>{' '}<small className="muted">({bn(b.n)})</small></label>))}</div></fieldset> : null)}{' '}{jsxList(specFacets.map((f) => <fieldset className="f-brands f-spec"><legend translate="no"><Val v={f.label} /></legend><div className="f-brand-list">{jsxList(f.values.map((v) => <label className="check"><input type="checkbox" name="sp" defaultValue={`${attrValue(f.key)}~${attrValue(v.value)}`} defaultChecked={!!((filters.specList || []).includes(`${f.key}~${v.value}`))} />{' '}<span translate="no"><Val v={v.label} /></span>{' '}<small className="muted">({bn(v.n)})</small></label>))}</div></fieldset>))}{' '}<label className="check f-stock"><input type="checkbox" name="stock" defaultValue="1" defaultChecked={!!(filters.stock)} />{' '}<span>শুধু স্টকে আছে এমন পণ্য</span></label><div className="f-actions"><button className="btn btn-sm">ফিল্টার করুন</button>{(nFilters ? <a className="btn btn-sm btn-ghost" href={attrValue(clearHref)}>✕ সব মুছুন</a> : null)}</div></form></details>);
}

// ---------------------------------------------------------------- product page
// YouTube video that loads only when tapped (keeps the page fast), with a link in case the owner blocked embedding.
function videoBox(yt: string, title: string) {
  return (<><div className="video yt-lite" data-yt-lite={attrValue(yt)}><button type="button" className="yt-play" aria-label="ভিডিও চালান">{' '}<img src={`https://i.ytimg.com/vi/${attrValue(yt)}/hqdefault.jpg`} alt={`${attrValue(title)} — ভিডিও`} loading="lazy" draggable="false" />{' '}<span className="yt-big" aria-hidden="true">▶</span>{' '}</button></div><p className="small muted yt-alt">ভিডিও না চললে{' '}<a href={`https://www.youtube.com/watch?v=${attrValue(yt)}`} target="_blank" rel="noopener">সরাসরি YouTube-এ দেখুন ↗</a></p></>);
}

const WA_ICON = '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-1-2.2-1-.3-.1-.5-.2-.7.1l-1 1.3c-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.3c.2.2 2.3 3.5 5.5 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.6-.5Z"/></svg>';

function specTable(specs: unknown[][]) {
  return (<table className="spec-table"><tbody>{jsxList(specs.map(([k, v]) => <tr><th scope="row"><Val v={k} /></th><td><Val v={v} /></td></tr>))}</tbody></table>);
}
function tierBox(p: ShopProduct, tiers: { min_qty: number; price: number }[], maxQty = Infinity) {
  if (!tiers || !tiers.length) return '';
  // only steps a customer can actually order online (the per-product maximum still applies)
  const rows = tiers.slice().sort((a, b) => a.min_qty - b.min_qty).filter((t) => t.price < Number(p.price) && t.min_qty <= maxQty);
  if (!rows.length) return '';
  return (<div className="tier-box"><p className="pdp-label">📦 বেশি কিনলে কম দাম</p><table className="tier-table"><tbody><tr><td>{bn(1)}–{bn(rows[0].min_qty - 1)}টি</td><td><b>{money(p.price)}</b>{' '}করে</td></tr>{jsxList(rows.map((t, i) => <tr><td>{bn(t.min_qty)}{(rows[i + 1] ? `–${bn(rows[i + 1].min_qty - 1)}` : "+")}টি</td><td><b>{money(t.price)}</b>{' '}করে{' '}<span className="good small">({bn(Math.round((1 - t.price / p.price) * 100))}% কম)</span></td></tr>))}</tbody></table><p className="small muted">কার্টে পরিমাণ বাড়ালে কম দাম নিজে থেকেই বসে যাবে।</p></div>);
}
function reviewsBlock(p: unknown, s: Settings, reviews: ShownReview[], stats: Partial<ReviewStats> & { count: number }) {
  if (s.reviews_on === '0' || !stats.count) return '';
  const dist = [5, 4, 3, 2, 1].map((n) => [n, (stats.dist || {})[n] || 0]);
  return (<section className="reviews" id="reviews"><div className="section-head"><h2>⭐ কাস্টমারদের রিভিউ{' '}{(stats.count ? <small>{bn(stats.count)}টি</small> : null)}</h2></div><div className="reviews-grid"><div className="review-summary panel">{(stats.count ? <><p className="big-rating">{bn(Number(stats.avg).toFixed(1))}<small>/৫</small></p>{stars(stats.avg)}<ul className="rating-bars">{jsxList(dist.map(([n, c]) => <li><span>{bn(n)}★</span><span className="bar"><i style={styleOf(`width:${attrValue(stats.count ? Math.round((c / stats.count) * 100) : 0)}%`)}></i></span><span>{bn(c)}</span></li>))}</ul></> : <p className="muted">এখনো কোনো রিভিউ নেই।</p>)}</div><div className="review-list">{(reviews.length ? <ul>{jsxList(reviews.map((r) => <li className="review"><p>{stars(r.rating)}{' '}<b><Val v={r.name || 'কাস্টমার'} /></b>{(r.verified ? <>{' '}<span className="verified">✓ যাচাই করা ক্রেতা</span></> : null)}{' '}<span className="small muted"><Val v={fmtDate(r.created_at).split(',')[0]} /></span></p><p className="review-body"><Val v={r.body} /></p>{(r.photos && r.photos.length ? <div className="review-photos">{jsxList(r.photos.map((pid: unknown) => <a href={`/media/${attrValue(pid)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(pid)}/t`} alt="ক্রেতার তোলা ছবি" loading="lazy" draggable="false" /></a>))}</div> : null)}{' '}{(r.reply ? <p className="review-reply"><b><Val v={s.store_name} />:</b>{' '}<Val v={r.reply} /></p> : null)}</li>))}</ul> : null)}</div></div></section>);
}
// 🔔 "দাম কমলে জানাও": a small fold-out with a mobile number box
function priceAlertBox(productId: Id, price: unknown) {
  return (<details className="price-alert"><summary>🔔 দাম কমলে SMS-এ জানাও</summary><form className="notify-box" data-price-alert="" data-product={attrValue(productId)} noValidate><p className="small muted">এখন দাম{' '}{money(price)}। এর চেয়ে কমলেই (নতুন দাম বা ফ্ল্যাশ সেল) একবার SMS পাবেন।</p><div className="coupon-row"><input name="phone" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={20} required aria-label="মোবাইল নম্বর" /><button className="btn btn-sm">জানাবেন</button></div><input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" /><p className="small" data-notify-msg="" role="status"></p></form></details>);
}
// 📤 share the product: phone's own share sheet, Facebook, Messenger, WhatsApp, copy the link
function shareRow(p: { slug: string | number | boolean; name: unknown; price: unknown; }, s: Settings) {
  if (s.ui_share === '0') return '';
  const base = String(s.site_url || '').replace(/\/+$/, '');
  const url = base ? `${base}/p/${encodeURIComponent(p.slug)}` : '';
  const text = `${p.name} — ${money(p.price)}`;
  const u = encodeURIComponent(url);
  return (<div className="share-row" data-share="" data-title={attrValue(p.name)} data-text={attrValue(text)} data-url={attrValue(url)}><span className="share-label">শেয়ার করুন:</span>{' '}<button type="button" className="share-btn share-native" data-share-native="" hidden aria-label="শেয়ার করুন">📤</button>{' '}<a className="share-btn share-fb" data-share-to="fb" href={`https://www.facebook.com/sharer/sharer.php?u=${attrValue(u)}`} target="_blank" rel="noopener" aria-label="Facebook-এ শেয়ার">f</a>{' '}<a className="share-btn share-ms" data-share-to="ms" href={`fb-messenger://share/?link=${attrValue(u)}`} aria-label="Messenger-এ পাঠান">💬</a>{' '}<a className="share-btn share-wa" data-share-to="wa" href={`https://wa.me/?text=${attrValue(encodeURIComponent(text + ' ' + url))}`} target="_blank" rel="noopener" aria-label="WhatsApp-এ পাঠান">🟢</a>{' '}<button type="button" className="share-btn" data-share-copy="" aria-label="লিংক কপি করুন">🔗</button>{' '}<span className="small good" data-share-msg="" role="status"></span></div>);
}
// 🔔 "স্টকে এলে জানাও": the customer leaves a mobile number; an SMS goes out when the product is back.
function notifyBox(productId: Id, s: Settings, hidden = false) {
  if (!U.on(s, 'ui_restock_notify')) return '';
  return (<form className="notify-box" data-notify="" data-product={attrValue(productId)} hidden={!!(hidden)} noValidate><p><b>🔔{' '}<Val v={U.text(s, 'uit_restock_title')} /></b><br /><span className="small muted">মোবাইল নম্বর দিন — পণ্যটা আবার এলেই আপনাকে SMS করে জানাব।</span></p><div className="coupon-row"><input name="phone" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={20} required aria-label="মোবাইল নম্বর" /><button className="btn btn-sm">জানাবেন</button></div><input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" /><p className="small" data-notify-msg="" role="status"></p></form>);
}
// The size / colour / model picker. Each variant carries what the page needs to switch to it without reloading.
function variantPicker(p: FullProduct, V: Product[], sel: Product, big: (id?: Id) => string) {
  return (<div className="var-pick" data-variants=""><p className="var-head"><Val v={p.variant_title || 'অপশন'} />:{' '}<b data-var-name=""><Val v={sel.variant_label} /></b></p><div className="var-list" role="radiogroup" aria-label={`${attrValue(p.variant_title || 'অপশন')} বাছাই করুন`}>{jsxList(V.map((v) => <button type="button" role="radio" className={`var-opt ${v.id === sel.id ? 'on' : ''} ${v.stock <= 0 ? 'is-out' : ''}`} data-var={attrValue(v.id)} data-label={attrValue(v.variant_label)} data-name={attrValue(v.name)} data-price={attrValue(v.price)} data-old={attrValue(v.old_price || '')} data-stock={attrValue(v.stock)} data-low={attrValue(v.low_stock)} data-sku={attrValue(v.sku || '')} data-img={attrValue(v.image_id ? big(v.image_id) : '')} data-flash={attrValue(v.flash_ends ? new Date(v.flash_ends).toISOString() : '')} aria-checked={v.id === sel.id ? 'true' : 'false'}>{' '}{(v.image_id ? <img src={`/media/${attrValue(v.image_id)}/t`} alt="" loading="lazy" draggable="false" /> : null)}<span><Val v={v.variant_label} /></span>{(v.stock <= 0 ? <small>স্টকে নেই</small> : null)}</button>))}</div></div>);
}
// Questions & answers on a product: what others asked and the shop's answers, plus a small form to ask.
function questionsBlock(p: { id: unknown; }, s: Settings, questions: Question[]) {
  if (!U.on(s, 'ui_qa')) return '';
  return (<section className="qa" id="qa"><div className="section-head"><h2>❓{' '}<Val v={U.text(s, 'uit_qa_title')} />{' '}{(questions.length ? <small>{bn(questions.length)}টি</small> : null)}</h2></div><div className="qa-grid"><div>{(questions.length ? <ul className="qa-list">{jsxList(questions.map((x) => <li><p className="qa-q"><b>প্রশ্ন:</b>{' '}<Val v={x.question} />{' '}<span className="small muted">—{' '}<Val v={x.name || 'একজন কাস্টমার'} />,{' '}<Val v={fmtDate(x.created_at).split(',')[0]} /></span></p><p className="qa-a"><b><Val v={s.store_name} />:</b>{' '}<Val v={x.answer} /></p></li>))}</ul> : <p className="muted">এখনো কেউ প্রশ্ন করেননি। এই পণ্য নিয়ে কিছু জানার থাকলে প্রথম প্রশ্নটা আপনিই করুন।</p>)}</div><form className="form panel qa-form" data-qa-form="" data-product={attrValue(p.id)} noValidate><h3>প্রশ্ন করুন</h3><label className="field"><span>আপনার প্রশ্ন</span><textarea name="question" rows={3} maxLength={500} required minLength={5} placeholder="যেমন: এটা কি ১২ ভোল্টে চলবে?" /></label><div className="field-row"><label className="field"><span>আপনার নাম</span><input name="name" maxLength={60} autoComplete="name" /></label>{' '}<label className="field"><span>মোবাইল (ঐচ্ছিক — উত্তর দিলে SMS পাবেন)</span><input name="phone" inputMode="tel" maxLength={20} autoComplete="tel" /></label></div><input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />{' '}<button className="btn btn-block">প্রশ্ন পাঠান</button><p className="small" data-qa-msg="" role="status"></p><p className="small muted">উত্তর দেওয়ার পর প্রশ্ন-উত্তর এখানে সবাই দেখতে পাবে।</p></form></div></section>);
}
type ProductPageProps = {
  product: FullProduct; related: Product[]; settings: Settings; inlineProducts?: Record<string, FullProduct>; categories?: Category[];
  tiers?: { min_qty: number; price: number }[]; offers?: { label: string; ends_on: string }[]; reviews?: ShownReview[]; reviewStats?: Partial<ReviewStats> & { count: number };
  cross?: Product[]; upsell?: Product[]; questions?: Question[]; selectedVariant?: number; kits?: Pick<KitsRow, 'id' | 'slug' | 'title'>[];
};
function productPage({ product: p, related, settings: s, inlineProducts = {}, categories = [], tiers = [], offers = [], reviews = [], reviewStats = { count: 0 }, cross = [], upsell = [], questions = [], selectedVariant = 0, kits = [] }: ProductPageProps) {
  const specs = U.on(s, 'ui_pdp_specs') ? (Array.isArray(p.specs) ? p.specs : []).filter((r: unknown) => Array.isArray(r) && r[0] && r[1]) : [];
  const catNode = p.category_id ? categoryTree(categories).byId.get(p.category_id) : null;
  // 📏 size chart: the product's own category, or the nearest parent category that has one
  const sizeChart = catNode ? ([...(catNode.path || [catNode])].reverse().map((c) => String(c.size_chart || '').trim()).find(Boolean) || '') : '';
  // a product with variants shows the chosen one's price, stock and SKU (first in-stock one unless ?v= says otherwise)
  const V = Array.isArray(p.variants) ? p.variants : [];
  const sel = V.length ? (V.find((v) => v.id === selectedVariant && v.stock > 0) || V.find((v) => v.stock > 0) || V.find((v) => v.id === selectedVariant) || V[0]) : null;
  const cur = sel || p;
  const off = discount(cur);
  const out = cur.stock <= 0;
  const yt = U.on(s, 'ui_pdp_video') ? youtubeId(p.youtube_url) : null;
  const images = p.images && p.images.length ? p.images : [];
  // big picture: the watermarked copy when the watermark is on (thumbnails and cards stay as they are)
  const big = (id?: Id) => (s.wm_on === '1' && s.wm_ver ? `/media/${id}/w?v=${s.wm_ver}.r2` : `/media/${id}`);
  const slots = Math.max(images.length, 1);
  const C = contact(s);
  const waText = `আসসালামু আলাইকুম। এই পণ্যটি সম্পর্কে জানতে চাই:\n${p.name}${p.sku ? ` (SKU: ${p.sku})` : ''}\nদাম: ৳${p.price}`;
  const waBtn = C.waButton ? (<a className="btn btn-wa btn-lg" href={`https://wa.me/${attrValue(C.waButton)}?text=${attrValue(encodeURIComponent(waText))}`} target="_blank" rel="noopener" data-wa-text={attrValue(waText)} data-wa={attrValue(C.waButton)} aria-label="WhatsApp এ কথা বলুন"><RawHtml html={WA_ICON} />{' '}WhatsApp</a>) : '';
  const R = qtyRule(s, cur.price);
  // ⏳ pre-order: the owner switched it on for this product — out of stock, it can still be ordered (sent when it arrives)
  const preorderOk = !!p.preorder && p.product_type !== 'bundle';
  const short = !out && !preorderOk && cur.stock < R.min; // not enough stock for the minimum
  const maxQ = preorderOk ? R.max : Math.max(R.min, Math.min(cur.stock, R.max));
  const preDays = Number(p.preorder_days) || 0;
  // 🤖 no (or very little) own text → the auto description (services/autoseo.js), made fresh with today's price
  const AS = $services_autoseo;
  const autoText = AS.needsAuto(p, s) ? AS.describe(p, s) : '';
  // the description, with a product card wherever the owner wrote a product's link (/p/…) on its own line
  const longParts = md.render(p.description || '', { productCard: true }).split(/<!--product:([^>]+)-->/);
  const longHtml = <>{longParts.map((x, i) => (i % 2 ? (inlineProducts[x] ? <Fragment key={i}>{productCard(inlineProducts[x], s)}</Fragment> : null) : <RawHtml key={i} html={x} />))}</>;
  return (<><div className="wrap section" data-pdp={attrValue(p.id)} data-recent-id={U.on(s, 'ui_recent') ? String(p.id) : undefined}><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{(catNode ? catCrumbs(catNode, false) : (p.category_slug ? <>{' '}/{' '}<a href={`/products?cat=${attrValue(p.category_slug)}`}><Val v={p.category_name} /></a></> : null))}{' '}/{' '}<span><Val v={p.name} /></span></nav><div className="pdp"><div className="gallery" data-gallery=""><div className="g-main">{(images.length ? <><img src={attrValue(big(images[0]))} alt={attrValue(p.name)} data-g-main="" draggable="false" fetchpriority="high" />{' '}<button type="button" className="g-zoom" data-g-zoom="" aria-label="ছবি বড় করে দেখুন">⤢ বড় করে দেখুন</button></> : <span className="emoji"><Val v={p.emoji || '📦'} /></span>)}{' '}{(yt ? <div className="g-video" data-g-video="" hidden><iframe data-src={`https://www.youtube-nocookie.com/embed/${attrValue(yt)}?autoplay=1&rel=0`} title="পণ্যের ভিডিও" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen></iframe></div> : null)}{' '}{(off ? <span className="badge-off">{bn(off)}% ছাড়</span> : null)}</div><div className="g-thumbs" role="list">{jsxList(images.map((id, i: number) => <button type="button" className={`g-thumb ${i === 0 ? 'on' : ''}`} data-g-img={attrValue(big(id))} data-g-orig={`/media/${attrValue(id)}`} aria-label={`ছবি ${bn(i + 1)}`}><img src={`/media/${attrValue(id)}/t`} alt={`${attrValue(p.name)} — ছবি ${bn(i + 1)}`} loading="lazy" draggable="false" /></button>))}{' '}{(yt ? <button type="button" className="g-thumb g-thumb-video" data-g-yt="" aria-label="ভিডিও দেখুন"><img src={`https://i.ytimg.com/vi/${attrValue(yt)}/mqdefault.jpg`} alt="" loading="lazy" draggable="false" /><span className="play">▶</span></button> : null)}{' '}<Val v={Array.from({ length: Math.max(0, 5 - slots - (yt ? 1 : 0)) }, () => (<span className="g-thumb g-empty" aria-hidden="true"></span>))} /></div>{(yt ? <button type="button" className="g-video-btn" data-g-yt-btn=""><span className="yt-ic" aria-hidden="true">▶</span>{' '}পণ্যের ভিডিও দেখুন</button> : null)}</div><div className="pdp-info"><h1 className="p-title"><Val v={p.name} /></h1>{(s.copy_title === '1' ? <button type="button" className="btn btn-sm btn-ghost copy-title-btn" data-copy-title={attrValue(p.name)}>📋 নাম কপি</button> : null)}{' '}{(reviewStats.count && s.reviews_on !== '0' ? <a className="pdp-rating" href="#reviews">{stars(reviewStats.avg)}{' '}{bn(Number(reviewStats.avg).toFixed(1))}{' '}·{' '}{bn(reviewStats.count)}টি রিভিউ</a> : null)}{' '}{(U.on(s, 'ui_pdp_meta') ? <p className="pdp-meta">{(cur.sku ? <>SKU:{' '}<b data-p-sku=""><Val v={cur.sku} /></b></> : null)}{(p.model ? <>{' '}· মডেল:{' '}<b translate="no"><Val v={p.model} /></b></> : null)}{(p.brand ? <>{' '}· ব্র্যান্ড:{' '}{(p.brand_slug ? <a href={`/brand/${attrValue(p.brand_slug)}`}><b><Val v={p.brand} /></b></a> : <b><Val v={p.brand} /></b>)}</> : null)}{(p.category_name ? <>{' '}·{' '}<a href={`/products?cat=${attrValue(p.category_slug)}`}><Val v={p.category_name} /></a></> : null)}{(isNewP(p, s) && U.on(s, 'ui_card_new') ? <>{' '}<span className="pill-new">নতুন</span></> : null)}</p> : null)}{' '}{($models_catalog.warrantyText(p) ? <p className="pdp-warranty">🛡️{' '}<Val v={$models_catalog.warrantyText(p)} /></p> : null)}<div className="price-row big"><span className="price" data-p-price="">{money(cur.price)}</span>{' '}<s className="old-price" data-p-old="" hidden={!(off)}>{(off ? money(cur.old_price) : null)}</s><span className="save" data-p-save="" hidden={!(off)}>{(off ? `${money(cur.old_price! - cur.price)} সাশ্রয়` : null)}</span></div>{(U.on(s, 'ui_pdp_flash') ? <div className="flash-box" data-p-flash="" hidden={!(cur.flash_ends)}>⚡{' '}<b>ফ্ল্যাশ সেল</b>{' '}— এই দাম শেষ হবে{' '}<b className="countdown" data-countdown={attrValue(cur.flash_ends ? new Date(cur.flash_ends).toISOString() : '')}></b></div> : null)}{' '}{(sel ? variantPicker(p, V, sel, big) : null)}{' '}{(offers.length && U.on(s, 'ui_pdp_offers') ? <ul className="offer-box">{jsxList(offers.map((o) => <li>🎁{' '}<b><Val v={o.label} /></b>{(o.ends_on ? <>{' '}<span className="small muted">(<Val v={o.ends_on} />{' '}পর্যন্ত)</span></> : null)}</li>))}</ul> : null)}{' '}{(U.on(s, 'ui_pdp_tiers') ? tierBox(p, tiers, qtyRule(s, p.price).max) : null)}{' '}{(R.cheap && minOrder(s) > p.price ? <div className="small-rule">🔩{' '}<b>কম দামের পণ্য:</b>{' '}প্রতি পিস{' '}{money(p.price)}। ১টা করেও নেওয়া যায় — শুধু পুরো অর্ডারে মোট কমপক্ষে{' '}{money(minOrder(s))}{' '}এর পণ্য হতে হবে (যেমন এটা{' '}{bn(Math.ceil(minOrder(s) / p.price - 1e-9))}টি, অথবা অন্য পণ্যের সাথে মিলিয়ে)।</div> : null)}{' '}{(out || U.on(s, 'ui_pdp_stock') || sel ? <p className={`stock ${out ? 'out' : cur.stock <= cur.low_stock ? 'low' : 'ok'}`} data-p-stock="" data-show={U.on(s, 'ui_pdp_stock') ? '1' : ''} hidden={!(out || U.on(s, 'ui_pdp_stock'))}>{(out ? (preorderOk ? "স্টকে নেই — প্রি-অর্ডার চলছে" : "স্টকে নেই") : (cur.stock <= cur.low_stock ? `মাত্র ${bn(cur.stock)}টি বাকি আছে` : "✓ স্টকে আছে"))}</p> : null)}{' '}{(preorderOk ? <div className="preorder-note" data-pre-note="" hidden={!(out)}>⏳{' '}<b>প্রি-অর্ডার:</b>{' '}এখন স্টকে নেই, কিন্তু অর্ডার নেওয়া হচ্ছে। পণ্য আসতে আনুমানিক{' '}<b>{(preDays ? `${bn(preDays)} দিন` : "কিছু দিন")}</b>{' '}লাগবে — এলেই সবার আগে আপনাকে পাঠানো হবে।{(s.preorder_note ? <>{' '}<Val v={s.preorder_note} /></> : null)}</div> : null)}{' '}{(p.short_description && U.on(s, 'ui_pdp_short') ? <div className="pdp-short"><p className="pdp-label">📝 সংক্ষেপে</p><RawHtml html={md.render(p.short_description)} />{' '}{(p.description ? <a className="pdp-more" href="#details">বিস্তারিত বিবরণ পড়ুন ↓</a> : null)}</div> : null)}{' '}{(p.bundle && p.bundle.length ? <div className="bundle-box"><b>এই প্যাকেজে যা যা আছে:</b><ul>{jsxList(p.bundle.map((b) => <li><Val v={b.name} />{' '}×{' '}{bn(b.qty)}</li>))}</ul>{(() => { const sum = p.bundle.reduce((t: number, b) => t + b.price * b.qty, 0); return sum > p.price ? (<p className="save">আলাদা কিনলে{' '}{money(sum)}{' '}— প্যাকেজে{' '}{money(sum - p.price)}{' '}কম!</p>) : ''; })()}</div> : null)}{' '}{((out && !preorderOk) || short ? <>{(short ? <p className="qty-limit">এই পণ্যটি কমপক্ষে{' '}{bn(R.min)}টি নিতে হয়, কিন্তু স্টকে আছে{' '}{bn(cur.stock)}টি। নিতে চাইলে সরাসরি যোগাযোগ করুন।</p> : null)}<div className="buy-box">{(C.phone ? <a className="btn btn-ghost btn-lg" href={`tel:${attrValue(C.phone)}`}>📞 স্টক জানতে কল করুন</a> : null)}{waBtn}</div>{(out ? notifyBox(cur.id, s) : null)}{compareBtn(p, s)}</> : <><div className="buy-box" data-buy-box="" data-preorder={(preorderOk) ? "1" : undefined}><div className="qty" data-qty="" hidden={!(U.on(s, 'ui_pdp_qty'))}><button type="button" data-step="-1" aria-label="কমান">−</button>{' '}<input type="number" min={attrValue(R.min)} max={attrValue(maxQ)} defaultValue={attrValue(R.min)} data-stock={attrValue(cur.stock)} aria-label="পরিমাণ" />{' '}<button type="button" data-step="1" aria-label="বাড়ান">+</button></div><button className="btn btn-add btn-lg" data-add={attrValue(cur.id)} data-name={attrValue(cur.name)} data-price={attrValue(cur.price)} data-with-qty="" data-label="কার্টে যোগ করুন">{(out && preorderOk ? "⏳ প্রি-অর্ডার (কার্টে যোগ)" : "কার্টে যোগ করুন")}</button>{' '}{(U.on(s, 'ui_pdp_buy_now') ? <button className="btn btn-amber btn-lg" data-add={attrValue(cur.id)} data-name={attrValue(cur.name)} data-price={attrValue(cur.price)} data-with-qty="" data-buy-now="" data-label={attrValue(U.text(s, 'uit_buy_now'))}>{(out && preorderOk ? "⏳ এখনই প্রি-অর্ডার করুন" : <Val v={U.text(s, 'uit_buy_now')} />)}</button> : null)}{' '}{waBtn}{wishBtn(p, s, 'pdp-wish')}</div>{(sel ? <><p className="var-out" data-var-out="" hidden>এই অপশনটা এখন স্টকে নেই — অন্য একটা বাছাই করুন, অথবা নিচে নম্বর দিন, এলেই জানাব।</p>{notifyBox(cur.id, s, true)}</> : null)}<p className="qty-limit" data-qty-limit="" hidden></p>{compareBtn(p, s)}</>)}{' '}{(sizeChart ? <details className="size-guide"><summary>📏 সাইজ গাইড দেখুন</summary><div className="rich"><RawHtml html={md.render(sizeChart)} /></div></details> : null)}{' '}{(s.price_alert_on !== '0' && !out ? priceAlertBox(cur.id, cur.price) : null)}{' '}{shareRow(p, s)}{' '}{(kits.length ? <p className="kit-links">🧰 এই পণ্যটি এই প্রজেক্ট কিটে আছে:{' '}{jsxList(kits.map((k, i: unknown) => <>{(i ? ", " : null)}<a href={`/kit/${attrValue(k.slug)}`}><Val v={k.title} /></a></>))}</p> : null)}{' '}{(U.on(s, 'ui_pdp_facts') ? <ul className="pdp-facts"><li>🚚 ঢাকা সিটিতে{' '}<b><Val v={delText(s.del_days_dhaka, '1-2')} /></b>, চার্জ{' '}{money(s.delivery_dhaka)}{' '}· ঢাকার বাইরে{' '}<b><Val v={delText(s.del_days_outside, '2-4')} /></b>, চার্জ{' '}{money(s.delivery_outside)}</li>{(out && !preorderOk ? null : <li className="del-eta" data-del-eta="" data-dhaka={attrValue(s.del_days_dhaka || '1-2')} data-outside={attrValue(s.del_days_outside || '2-4')} data-cutoff={attrValue(s.del_cutoff_hour || '17')} data-extra={attrValue(out && preorderOk ? Number(p.preorder_days) || 0 : 0)} hidden></li>)}<li>💵 পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)</li>{(C.phone ? <li>📞 প্রশ্ন থাকলে কল করুন:{' '}<a href={`tel:${attrValue(C.phone)}`}><Val v={C.phone} /></a></li> : null)}<li>🛒 এই পণ্যটি একসাথে সর্বোচ্চ{' '}{bn(R.max)}টি অর্ডার করা যাবে{(C.phone || C.wa ? "। বেশি দরকার হলে সরাসরি যোগাযোগ করুন" : null)}</li>{(U.text(s, 'uit_pdp_fact_extra') ? <li><Val v={U.text(s, 'uit_pdp_fact_extra')} /></li> : null)}</ul> : null)}</div></div><div className="tabs-box" data-tabs="" id="details"><div className="tabs" role="tablist"><button type="button" role="tab" className="tab on" data-tab="desc">📋 পণ্যের বিস্তারিত বিবরণ</button>{' '}{(specs.length ? <button type="button" role="tab" className="tab" data-tab="specs">⚙️ স্পেসিফিকেশন</button> : null)}{' '}{(yt ? <button type="button" role="tab" className="tab" data-tab="video">▶ ভিডিও</button> : null)}{' '}{(s.reviews_on !== '0' && reviewStats.count ? <a role="tab" className="tab" href="#reviews">⭐ রিভিউ ({bn(reviewStats.count)})</a> : null)}{' '}{(U.on(s, 'ui_pdp_ship_tab') ? <button type="button" role="tab" className="tab" data-tab="ship">🚚 ডেলিভারি ও রিটার্ন</button> : null)}</div><div className="tab-panel rich" data-panel="desc">{(p.description ? longHtml : null)}{(autoText ? <RawHtml html={md.render(autoText)} /> : (p.description ? null : (specs.length ? specTable(specs) : <p className="muted">এই পণ্যের বিস্তারিত বিবরণ শীঘ্রই যোগ হবে।</p>)))}</div>{(specs.length ? <div className="tab-panel" data-panel="specs" hidden>{specTable(specs)}</div> : null)}{' '}{(yt ? <div className="tab-panel" data-panel="video" hidden>{videoBox(yt, p.name)}</div> : null)}<div className="tab-panel rich" data-panel="ship" hidden><ul><li>ঢাকা সিটির ভেতরে:{' '}{money(s.delivery_dhaka)}, সাধারণত{' '}<Val v={delText(s.del_days_dhaka, '1-2')} />।</li><li>ঢাকার বাইরে:{' '}{money(s.delivery_outside)}, সাধারণত{' '}<Val v={delText(s.del_days_outside, '2-4')} />।</li>{(Number(s.free_delivery_min) > 0 ? <li>{money(s.free_delivery_min)}{' '}বা বেশি কিনলে ডেলিভারি ফ্রি।</li> : null)}<li>পণ্য হাতে পেয়ে দেখে টাকা দিন। কোনো সমস্যা থাকলে ডেলিভারিম্যানের সামনেই জানান।</li>{(U.text(s, 'uit_ship_extra') ? <li><Val v={U.text(s, 'uit_ship_extra')} /></li> : null)}</ul><p><a href="/page/return-policy">রিটার্ন নীতি বিস্তারিত →</a></p></div></div>{(yt ? <section className="pdp-video" id="video"><h2>▶ পণ্যের ভিডিও</h2>{videoBox(yt, p.name)}</section> : null)}{' '}{(cross.length && U.on(s, 'ui_pdp_cross') ? <><div className="section-head"><h2><Val v={U.text(s, 'uit_cross')} /></h2></div>{productGrid(cross, s)}</> : null)}{' '}{(upsell.length && U.on(s, 'ui_pdp_upsell') ? <><div className="section-head"><h2><Val v={U.text(s, 'uit_upsell')} /></h2></div>{productGrid(upsell, s)}</> : null)}{' '}{reviewsBlock(p, s, reviews, reviewStats)}{' '}{questionsBlock(p, s, questions)}{' '}{(related.length && U.on(s, 'ui_pdp_related') ? <><div className="section-head"><h2><Val v={U.text(s, 'uit_related')} /></h2></div>{productGrid(related, s)}</> : null)}{' '}{(U.on(s, 'ui_recent') ? recentBox(s) : null)}</div>{(images.length ? <div className="lightbox" data-lightbox="" hidden role="dialog" aria-label="ছবি"><button type="button" className="lb-x" data-lb-close="" aria-label="বন্ধ করুন">✕</button>{' '}{(s.photo_download === '1' ? <button type="button" className="lb-dl" data-lb-dl="" data-name={attrValue(p.slug || 'product')}>⬇️ JPG ডাউনলোড</button> : null)}{' '}{(images.length > 1 ? <><button type="button" className="lb-nav prev" data-lb-step="-1" aria-label="আগের ছবি">‹</button><button type="button" className="lb-nav next" data-lb-step="1" aria-label="পরের ছবি">›</button></> : null)}{' '}<img alt={attrValue(p.name)} data-lb-img="" draggable="false" />{' '}<span className="lb-count" data-lb-count=""></span>{' '}<span className="lb-hint" data-lb-hint="" aria-hidden="true"></span></div> : null)}{' '}{(out || short || !U.on(s, 'ui_pdp_sticky') ? null : <div className="sticky-buy" data-sticky-buy=""><div><b data-p-price="">{money(cur.price)}</b><span><Val v={p.name} /></span></div>{(C.waButton ? <a className="btn btn-wa btn-wa-ic" href={`https://wa.me/${attrValue(C.waButton)}?text=${attrValue(encodeURIComponent(waText))}`} target="_blank" rel="noopener" data-wa-text={attrValue(waText)} data-wa={attrValue(C.waButton)} aria-label="WhatsApp এ কথা বলুন"><RawHtml html={WA_ICON} /></a> : null)}{' '}<button className="btn btn-amber" data-add={attrValue(cur.id)} data-name={attrValue(cur.name)} data-price={attrValue(cur.price)} data-with-qty="" data-buy-now=""><Val v={U.text(s, 'uit_buy_now')} /></button></div>)}</>);
}
// ⚖️ put this product in the comparison list (kept in the shopper's own browser, up to 4 products)
function compareBtn(p: { id: unknown; }, s: Settings) {
  return U.on(s, 'ui_compare') ? (<p className="pdp-tools"><button type="button" className="link-btn compare-btn" data-compare={attrValue(p.id)} title="অন্য পণ্যের সাথে পাশাপাশি তুলনা করুন" aria-pressed="false">⚖️ তুলনা</button></p>) : '';
}
// 🕘 the products this shopper looked at lately (filled in by the browser from its own list)
function recentBox(s: Settings) {
  return (<section className="recent-box" data-recent-box="" hidden><div className="section-head"><h2><Val v={U.text(s, 'uit_recent')} /></h2><button type="button" className="link-btn small" data-recent-clear="">মুছে দিন</button></div><div className="grid" data-recent-list=""></div></section>);
}

// ---------------------------------------------------------------- cart & checkout
type CartPageProps = {
  settings: Settings;
};
function cartPage({ settings }: CartPageProps) {
  return (<><div className="wrap section narrow"><h1>আপনার কার্ট</h1><div id="cart-root" data-cart-page="" data-free-min={attrValue(U.on(settings, 'ui_cart_free_msg') ? settings.free_delivery_min : 0)}><p className="muted">লোড হচ্ছে…</p></div>{(U.on(settings, 'ui_cart_suggest') ? cartSuggest(settings) : null)}</div>{(settings.for_you_on !== '0' ? <div className="wrap">{forYouBox()}</div> : null)}</>);
}
// 🧰 project kits: the list, and one kit with its parts (tick what you need → all into the cart)
function kitsPage({ kits }: { kits: Awaited<ReturnType<typeof $models_kits.list>>; settings?: Settings }) {
  return (<div className="wrap section"><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{' '}/{' '}<span>প্রজেক্ট কিট</span></nav><h1>🧰 প্রজেক্ট কিট</h1><p className="muted">একটা প্রজেক্ট বানাতে যা যা লাগে, সব এক জায়গায়। যেটা আপনার কাছে আছে সেটা বাদ দিয়ে বাকি সব এক চাপে কার্টে নিন।</p>{(kits.length ? <div className="kit-grid">{jsxList(kits.map((k) => <a className="kit-card panel" href={`/kit/${attrValue(k.slug)}`}>{' '}<span className="kit-pic">{(k.image_id ? <img src={`/media/${attrValue(k.image_id)}/t`} alt="" loading="lazy" draggable="false" /> : <span><Val v={k.emoji} /></span>)}</span>{' '}<span className="kit-body"><b><Val v={k.title} /></b><span className="small muted">{bn(k.parts)}টি পার্টস · মোট প্রায়{' '}{money(k.base_total)}{(k.level ? ` · ${k.level}` : null)}</span></span></a>))}</div> : <p className="muted">শীঘ্রই আসছে।</p>)}</div>);
}
type KitPageProps = {
  kit: $models_kits.ShopKit;
  settings: Settings;
};
function kitPage({ kit: k, settings: s }: KitPageProps) {
  const rule = (price?: unknown) => qtyRule(s, price);
  const steps = $models_kits.stepList(k);
  return (<div className="wrap section" data-kit-page=""><nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{' '}/{' '}<a href="/kits">প্রজেক্ট কিট</a>{' '}/{' '}<span><Val v={k.title} /></span></nav><div className="kit-head">{(k.image_id ? <img className="kit-hero" src={`/media/${attrValue(k.image_id)}`} alt={attrValue(k.title)} draggable="false" /> : <span className="kit-emoji"><Val v={k.emoji} /></span>)}<div><h1><Val v={k.title} /></h1>{(k.level || k.duration || steps.length ? <p className="kit-meta small">{(k.level ? <span>📶{' '}<Val v={k.level} /></span> : null)}{(k.duration ? <span>⏱️{' '}<Val v={k.duration} /></span> : null)}<span>🔩{' '}{bn(k.items.length)}টি পার্টস</span>{(steps.length ? <span>📋{' '}{bn(steps.length)}টি ধাপ</span> : null)}</p> : null)}{' '}{(k.description ? <div className="rich"><RawHtml html={md.render(k.description)} /></div> : null)}</div></div><section className="panel"><h2>যা যা লাগবে</h2><p className="small muted">আপনার কাছে আগে থেকে যেটা আছে সেটার টিক তুলে দিন। পরিমাণ বদলাতে পারবেন।</p><ul className="kit-parts">{jsxList(k.items.map((i) => {
    const p = i.product; const out = p.stock <= 0 && !p.preorder;
    return <li className={`kit-part ${out ? 'is-out' : ''}`} data-kit-item="" data-id={attrValue(p.id)} data-price={attrValue(p.price)}><label className="kit-tick"><input type="checkbox" data-kit-on="" defaultChecked={!!(!i.optional && !out)} disabled={!!(out)} aria-label={`${attrValue(p.name)} নেব`} /></label>{' '}<a className="kit-thumb" href={`/p/${attrValue(p.slug)}`}>{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" loading="lazy" draggable="false" /> : <span><Val v={p.emoji || '📦'} /></span>)}</a>{' '}<span className="kit-info"><a href={`/p/${attrValue(p.slug)}`}><b><Val v={p.name} /></b></a>{(i.optional ? <>{' '}<span className="pill-new">ঐচ্ছিক</span></> : null)}{' '}{(i.note ? <><br /><span className="small muted"><Val v={i.note} /></span></> : null)}<br /><span className="small">{money(p.price)}{' '}করে{(out ? <>{' '}·{' '}<span className="warn">স্টকে নেই</span></> : (p.stock <= 0 ? <>{' '}·{' '}<span className="preorder-line">প্রি-অর্ডার</span></> : null))}</span></span>{' '}<span className="qty sm"><button type="button" data-kd="-1" aria-label="কমান">−</button><input type="number" min={attrValue(rule(p.price).min)} max={attrValue(rule(p.price).max)} defaultValue={attrValue(Math.max(i.qty, rule(p.price).min))} data-kit-qty="" aria-label="পরিমাণ" /><button type="button" data-kd="1" aria-label="বাড়ান">+</button></span>{' '}<b className="kit-line" data-kit-line=""></b></li>;
  }))}</ul><div className="kit-total"><span>বাছাই করা পার্টসের মোট দাম</span><b data-kit-total="">—</b></div><button className="btn btn-amber btn-lg btn-block" type="button" data-kit-add="">🛒 বাছাই করা সব কার্টে যোগ করুন</button><p className="small muted center" data-kit-msg="" role="status"></p></section>{(steps.length ? <section className="panel kit-steps" id="steps"><h2>🛠️ কীভাবে বানাবেন — ধাপে ধাপে</h2><ol className="kit-step-list">{jsxList(steps.map((t, i) => <li id={`step-${i + 1}`}><Val v={t} /></li>))}</ol><p className="small muted">কোনো ধাপে আটকে গেলে নিচের চ্যাট বা WhatsApp-এ জিজ্ঞেস করুন — আমরা সাহায্য করব।</p></section> : null)}</div>);
}

// ✨ "আপনার জন্য": picked from what this shopper looked at, has in the cart and bought before (filled in by the browser)
function forYouBox() {
  return (<section className="recent-box for-you" data-for-you="" hidden><div className="section-head"><h2>✨ আপনার জন্য</h2></div><div className="grid" data-for-you-list=""></div></section>);
}

type WishlistPageProps = {
  products: $models_catalog.Product[];
  settings: Settings;
  asked: boolean;
};
function wishlistPage({ products, settings, asked }: WishlistPageProps) {
  return (<div className="wrap section" data-wish-page="" data-wish-load={(asked) ? undefined : ""}><h1>♡ পছন্দের তালিকা{' '}{(products.length ? <small>{bn(products.length)}টি</small> : null)}</h1><p className="muted small">এই তালিকা শুধু এই ফোন/কম্পিউটারের ব্রাউজারে রাখা থাকে। পণ্যের ♡ চিহ্নে চাপ দিয়ে যোগ করুন বা সরান।</p>{(asked ? productGrid(products, settings, 'পছন্দের তালিকা খালি। পছন্দের পণ্যের ছবির কোণে ♡ চাপ দিন।') : <p className="muted">লোড হচ্ছে…</p>)}</div>);
}
// ⚖️ products side by side: price, stock, rating, warranty, brand and every specification any of them has
type CompareProduct = FullProduct & { review_stats?: Partial<ReviewStats> & { count: number } };
function comparePage({ products: P, settings: s, asked }: { products: CompareProduct[]; settings: Settings; asked: boolean }) {
  if (!asked) return (<div className="wrap section" data-compare-page="" data-compare-load=""><h1>⚖️ পণ্য তুলনা</h1><p className="muted">লোড হচ্ছে…</p></div>);
  if (P.length < 1) return (<div className="wrap section" data-compare-page=""><h1>⚖️ পণ্য তুলনা</h1><div className="empty"><p>তুলনার তালিকা খালি। পণ্যের পেজে "⚖️ তুলনা" বাটনে চাপ দিয়ে ২ থেকে ৪টা পণ্য যোগ করুন।</p><a className="btn" href="/products">পণ্য দেখুন</a></div></div>);
  const keys: unknown[] = [];
  P.forEach((p) => (Array.isArray(p.specs) ? p.specs : []).forEach((r: unknown) => { if (Array.isArray(r) && r[0] && !keys.includes(r[0])) keys.push(r[0]); }));
  const spec = (p: CompareProduct, k?: unknown) => { const r = (Array.isArray(p.specs) ? p.specs : []).find((x: unknown) => Array.isArray(x) && x[0] === k); return r ? r[1] : '—'; };
  const W = $models_catalog.warrantyText;
  const row = (label?: unknown, cells?: unknown) => (<tr><th scope="row"><Val v={label} /></th><Val v={cells} /></tr>);
  return (<div className="wrap section" data-compare-page=""><div className="title-row"><h1>⚖️ পণ্য তুলনা{' '}<small>{bn(P.length)}টি</small></h1><button type="button" className="btn btn-sm btn-ghost" data-compare-clear="">সব সরান</button></div>{(P.length < 2 ? <p className="note">আরেকটা পণ্য যোগ করুন — পণ্যের পেজে "⚖️ তুলনা" বাটনে চাপ দিন।</p> : null)}<div className="table-wrap compare-wrap"><table className="compare-table"><thead><tr><th></th>{jsxList(P.map((p) => <th scope="col"><a href={`/p/${attrValue(p.slug)}`} className="cmp-pic">{img(p)}</a><a href={`/p/${attrValue(p.slug)}`} className="cmp-name"><Val v={p.name} /></a>{' '}<button type="button" className="link-btn small danger" data-compare-remove={attrValue(p.id)}>✕ সরান</button></th>))}</tr></thead><tbody>{row('দাম', P.map((p) => (<td><b className="price">{money(p.price)}</b>{(p.variant_count > 0 ? " থেকে" : null)}{(Number(p.old_price) > p.price ? <>{' '}<s className="old-price">{money(p.old_price)}</s></> : null)}</td>)))}{' '}{row('স্টক', P.map((p) => (<td>{(p.stock > 0 ? <span className="good">✓ আছে</span> : <span className="warn">স্টকে নেই</span>)}</td>)))}{' '}{(s.reviews_on !== '0' ? row('রেটিং', P.map((p) => (<td>{(p.review_stats && p.review_stats.count ? <>{stars(p.review_stats.avg)}{' '}<span className="small">({bn(p.review_stats.count)})</span></> : "—")}</td>))) : null)}{' '}{row('ব্র্যান্ড', P.map((p) => (<td><Val v={p.brand || '—'} /></td>)))}{' '}{row('মডেল', P.map((p) => (<td><Val v={p.model || '—'} /></td>)))}{' '}{row('ক্যাটাগরি', P.map((p) => (<td><Val v={p.category_name || '—'} /></td>)))}{' '}{row('ওয়ারেন্টি', P.map((p: { warranty?: string; warranty_type?: string; } | null | undefined) => (<td><Val v={W(p) || '—'} /></td>)))}{' '}{(P.some((p) => p.variant_count > 0) ? row('অপশন', P.map((p) => (<td className="small"><Val v={(p.variants || []).map((v) => v.variant_label).join(', ') || '—'} /></td>))) : null)}{' '}<Val v={keys.map((k) => row(k, P.map((p) => (<td><Val v={spec(p, k)} /></td>))))} />{' '}{row('সংক্ষেপে', P.map((p) => (<td className="small"><Val v={md.plain(p.short_description || p.description || '', 220) || '—'} /></td>)))}{' '}{row('', P.map((p) => (<td>{(p.stock > 0 ? (p.variant_count > 0 ? <a className="btn btn-sm btn-block" href={`/p/${attrValue(p.slug)}`}>অপশন বাছুন</a> : <button className="btn btn-sm btn-block btn-add" data-add={attrValue(p.id)} data-name={attrValue(p.name)} data-price={attrValue(p.price)}>কার্টে যোগ করুন</button>) : null)}</td>)))}</tbody></table></div></div>);
}
function cartSuggest(s: Settings) {
  return (<section className="panel cart-suggest" data-cart-suggest="" hidden><h2><Val v={U.text(s, 'uit_cart_suggest')} /></h2><ul className="suggest-list" data-suggest-list=""></ul></section>);
}
type CheckoutPageProps = {
  settings: Settings; methods: PayMethod[]; cityAreas: string[]; zones?: { name: string; fee: number; districts: string[] }[];
  account?: { name: string; phone: string; addresses: CustomerAddressesRow[]; email?: string; email_verified?: boolean } | null; refCode?: string; otp?: boolean;
};
function checkoutPage({ settings: s, methods, cityAreas, zones = [], account = null, refCode = '', otp = false }: CheckoutPageProps) {
  const addrs = account ? account.addresses || [] : [];
  const def = addrs.find((a) => a.is_default) || addrs[0] || null;
  const pre = account ? { name: (def && def.name) || account.name || '', phone: (def && def.phone) || account.phone || '', district: def ? def.district : '', thana: def ? def.thana : '', address: def ? def.address : '' } : null;
  return (<><div className="wrap section"><h1>অর্ডার করুন</h1>{(s.acct_on === '1' && !account ? <p className="acct-hint small">👤{' '}<a href="/account?next=/checkout">অ্যাকাউন্ট খুলুন / লগইন করুন</a>{' '}(ইমেইল বা মোবাইল দিয়ে) — একবার কোড দিলেই পরের অর্ডারগুলোতে আর কোড লাগবে না, ঠিকানাও নিজে থেকে বসে যাবে। (লগইন ছাড়াও অর্ডার করা যায়)</p> : null)}<div className="checkout" data-checkout="" data-dhaka={attrValue(s.delivery_dhaka)} data-outside={attrValue(s.delivery_outside)} data-free-min={attrValue(s.free_delivery_min)} data-city={attrValue(JSON.stringify(cityAreas))} data-zones={attrValue(JSON.stringify(zones))} data-per-kg={attrValue(Number(s.delivery_per_kg) || 0)} data-free-kg={attrValue(Number(s.delivery_free_kg) || 1)}><form className="form panel" id="checkout-form" noValidate data-draft={(s.draft_capture_on !== '0') ? "" : undefined} data-account={(pre) ? "" : undefined}><h2>ডেলিভারির তথ্য</h2>{(addrs.length ? <div className="field"><label htmlFor="saved-addr">📍 সেভ করা ঠিকানা</label><select id="saved-addr" data-saved-addr="">{' '}{jsxList(addrs.map((a) => <option value={attrValue(a.id)} data-a={attrValue(JSON.stringify({ name: a.name || account!.name || '', phone: a.phone || account!.phone || '', district: a.district, thana: a.thana, address: a.address }))} selected={!!(def && a.id === def.id)}><Val v={a.label || 'ঠিকানা'} />{' '}—{' '}{String(a.address).slice(0, 40)}</option>))}<option value="">+ নতুন ঠিকানা লিখব</option></select></div> : null)}<div className="field"><label htmlFor="name">আপনার নাম</label><input id="name" name="name" required autoComplete="name" maxLength={80} defaultValue={attrValue(pre ? pre.name : '')} /></div><div className="field"><label htmlFor="phone">মোবাইল নম্বর</label>{' '}<input id="phone" name="phone" required inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" maxLength={20} defaultValue={attrValue(pre ? pre.phone : '')} />{' '}<small>{(otp && !account ? "এই নম্বরে SMS-এ একটা কোড যাবে — কোডটা নিচের ঘরে বসালেই অর্ডার করা যাবে।" : "এই নম্বরে কল করে অর্ডার কনফার্ম করা হবে।")}{(s.draft_capture_on !== '0' ? " অর্ডার শেষ করতে কোনো সমস্যা হলে সাহায্যের জন্য আমরা এই নম্বরে যোগাযোগ করতে পারি।" : null)}</small>{' '}{(otp ? <><div className="otp-box" data-otp="" hidden><label htmlFor="otp-code" className="otp-label">📩 মোবাইলে আসা কোড</label><div className="otp-row"><input id="otp-code" data-otp-code="" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••" aria-label="SMS-এ আসা কোড" />{' '}<button type="button" className="btn btn-sm otp-send" data-otp-send="">OTP পাঠান</button></div><p className="otp-msg small" data-otp-msg="" role="status" aria-live="polite"></p>{(contact(s).phone ? <p className="otp-help small muted" data-otp-help="" hidden>SMS আসছে না?{' '}<a href={`tel:${attrValue(contact(s).phone)}`}><Val v={contact(s).phone} /></a>{' '}নম্বরে কল করেও অর্ডার দিতে পারেন।</p> : null)}</div><p className="otp-done small" data-otp-done="" hidden>✅ নম্বর যাচাই হয়েছে</p></> : null)}</div><div className="field-row"><div className="field"><label htmlFor="district">জেলা</label><select id="district" name="district" required data-district="" data-value={attrValue(pre && pre.district ? pre.district : 'Dhaka')}><option value="">লোড হচ্ছে…</option></select></div><div className="field"><label htmlFor="thana">থানা / উপজেলা</label><select id="thana" name="thana" required data-thana="" data-value={attrValue(pre ? pre.thana : '')}><option value="">আগে জেলা বাছুন</option></select></div></div><p className="zone-note" data-zone-note=""></p><div className="field"><label htmlFor="address">পূর্ণ ঠিকানা</label>{' '}<textarea id="address" name="address" rows={2} required maxLength={400} placeholder="বাসা নং, রোড, এলাকা" defaultValue={attrValue(pre ? pre.address : '')} /></div>{(U.on(s, 'ui_co_note') ? <div className="field"><label htmlFor="note"><Val v={U.text(s, 'uit_co_note')} /></label><input id="note" name="note" maxLength={300} /></div> : <input type="hidden" id="note" name="note" defaultValue="" />)}<h2>পেমেন্ট</h2><div className="pay-methods" role="radiogroup">{jsxList(methods.map((m, i: number) => <label className="pay-opt"><input type="radio" name="payment" defaultValue={attrValue(m.id)} defaultChecked={!!(i === 0)} data-manual={m.manual ? '1' : ''} data-number={attrValue(m.number || '')} data-advance={attrValue(m.advance || '')} data-number-label={attrValue(m.numberLabel || '')} />{' '}<span><b><Val v={m.label} /></b><small><Val v={m.note} /></small></span></label>))}</div><div className="manual-pay" data-manual-box="" hidden><p data-manual-text=""><Val v={s.manual_note} />{' '}<b data-pay-number=""></b>{' '}(<Val v={s.manual_type || 'Personal'} />)। পরিমাণ:{' '}<b data-pay-amount=""></b></p><p data-adv-text="" hidden>💵{' '}<Val v={s.cod_advance_note} />{' '}<span data-adv-label=""></span>{' '}<b data-adv-number=""></b>{' '}(<Val v={s.manual_type || 'Personal'} />)। এখন পাঠাবেন:{' '}<b data-adv-amount=""></b>{(s.cod_advance === 'new' ? <><br /><small>শুধু প্রথম অর্ডারে লাগবে — আগে আমাদের থেকে পণ্য নিয়ে থাকলে খালি রাখতে পারেন।</small></> : null)}</p><div className="field-row"><div className="field"><label htmlFor="pay_from">যে নম্বর থেকে পাঠিয়েছেন</label><input id="pay_from" name="payment_number" inputMode="tel" maxLength={20} /></div><div className="field"><label htmlFor="trx">Transaction ID (TrxID)</label><input id="trx" name="trx" maxLength={40} autoCapitalize="characters" /></div></div></div>{(s.email_mkt_on === '1' && s.email_co_box !== '0' ? <div className="field"><label htmlFor="co_email">ইমেইল{' '}<span className="muted small">(ঐচ্ছিক)</span></label>{' '}<input id="co_email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={120} defaultValue={attrValue(account && account.email_verified ? account.email : '')} placeholder="you@gmail.com" /></div> : null)}{' '}{(s.email_mkt_on === '1' && s.email_co_box !== '0' || s.sms_on === '1' ? <label className="check promo-check"><input type="checkbox" name="promo" defaultValue="1" defaultChecked data-promo="" />{' '}<span>🎁 নতুন পণ্য আর অফারের খবর{' '}{(s.email_mkt_on === '1' && s.email_co_box !== '0' ? "ইমেইলে/SMS-এ" : "SMS-এ")}{' '}পেতে চাই{' '}<span className="muted small">(যেকোনো সময় বন্ধ করা যায়)</span></span></label> : null)}{' '}{(s.consent_on !== '0' ? <label className="check consent-check"><input type="checkbox" name="consent" defaultValue="1" required data-consent="" />{' '}<span>আমার নাম, মোবাইল নম্বর ও ঠিকানা শুধু এই অর্ডার ডেলিভারি ও যোগাযোগের জন্য ব্যবহারে সম্মতি দিচ্ছি।{' '}<a href="/page/privacy-policy" target="_blank">প্রাইভেসি পলিসি</a></span></label> : null)}<p className="form-error" data-error="" hidden></p><button className="btn btn-amber btn-lg btn-block" type="submit" data-submit="">অর্ডার কনফার্ম করুন</button><p className="muted small center">অর্ডার করার মাধ্যমে আপনি আমাদের{' '}<a href="/page/terms">শর্তাবলি</a>{' '}মেনে নিচ্ছেন।</p></form><aside className="panel summary" aria-label="অর্ডারের সারাংশ"><h2>অর্ডারের সারাংশ</h2><div data-summary=""><p className="muted">লোড হচ্ছে…</p></div><div className="coupon" data-coupon="" hidden={!(U.on(s, 'ui_co_coupon'))}><label htmlFor="coupon" className="small">{(s.ref_on === '1' ? "কুপন বা বন্ধুর রেফারেল কোড আছে?" : "কুপন কোড আছে?")}</label><div className="coupon-row"><input id="coupon" placeholder="কোড লিখুন" maxLength={30} autoCapitalize="characters" defaultValue={attrValue(refCode)} data-auto-apply={(refCode) ? "" : undefined} /><button type="button" className="btn btn-sm btn-ghost" data-apply-coupon="">প্রয়োগ</button></div><p className="small" data-coupon-msg=""></p></div>{(s.gift_on === '1' ? <div className="coupon gift-box" data-gift=""><label htmlFor="giftcode" className="small">💳 গিফট কার্ড আছে?</label><div className="coupon-row"><input id="giftcode" placeholder="GC-XXXX-XXXX" maxLength={30} autoCapitalize="characters" /><button type="button" className="btn btn-sm btn-ghost" data-apply-gift="">প্রয়োগ</button></div><p className="small" data-gift-msg=""></p></div> : null)}{' '}{(s.loyalty_on === '1' ? <div className="loyalty-note panel" data-points="" hidden><p data-points-text=""></p><label className="check" data-points-use="" hidden><input type="checkbox" name="use_points" form="checkout-form" defaultValue="1" />{' '}<span data-points-label=""></span></label><p className="small muted" data-points-earn=""></p></div> : null)}</aside></div></div></>);
}

const STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
// 01712345678 -> 017•••••678 (shown to anyone who only has the order number)
function maskPhone(p: unknown): string { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

// After delivery: one review per product, only for the order's owner (placed on this browser or opened with
// order number + mobile number). Everyone else sees how to open it.
function orderReviews(order: O.Order, items: OrderReviewItem[], mine?: unknown, s: Settings = {} as Settings) {
  return (<section className="panel order-reviews" id="review"><h2>⭐ পণ্যগুলো কেমন লাগলো?</h2>{(!mine ? <p className="muted">রিভিউ দিতে আগে{' '}<a href={`/track?code=${attrValue(order.code)}`}>অর্ডার ট্র্যাক</a>{' '}পেজে অর্ডার নম্বর আর যে মোবাইল নম্বরে অর্ডার করেছিলেন সেটা দিন।</p> : <><p className="muted small">আপনি পণ্য হাতে পেয়েছেন — আপনার মতামত অন্য কাস্টমারদের সাহায্য করবে। প্রতিটা পণ্যে একবার রিভিউ দেওয়া যায়।</p><ul className="order-review-list">{jsxList(items.map((it) => <li><p><b><Val v={it.name} /></b>{(it.review_id ? <>{' '}<span className="verified">✓ রিভিউ দিয়েছেন{(it.status === 'pending' ? " (যাচাই চলছে)" : null)}</span></> : null)}</p>{(it.review_id ? null : <details><summary className="btn btn-sm btn-ghost">✍️ রিভিউ দিন</summary><form className="form review-form" data-review-form="" data-product={attrValue(it.product_id)} data-code={attrValue(order.code)}><fieldset className="rate-pick" aria-label="রেটিং"><legend className="small">রেটিং দিন</legend>{jsxList([5, 4, 3, 2, 1].map((n) => <><input type="radio" name="rating" id={`rt${attrValue(it.product_id)}-${attrValue(n)}`} defaultValue={attrValue(n)} defaultChecked={!!(n === 5)} /><label htmlFor={`rt${attrValue(it.product_id)}-${attrValue(n)}`} title={`${bn(n)} স্টার`}>★</label></>))}</fieldset><label className="field"><span>আপনার নাম (রিভিউতে দেখাবে)</span><input name="name" maxLength={60} defaultValue={attrValue(String(order.customer_name || '').trim().split(/\s+/)[0])} autoComplete="name" /></label>{' '}<label className="field"><span>আপনার মতামত</span><textarea name="body" rows={3} maxLength={1500} required minLength={5} /></label>{' '}{(s.review_photos_on !== '0' ? <div className="field"><span>📸 পণ্যের ছবি (ঐচ্ছিক, সর্বোচ্চ ৩টা)</span><input type="file" accept="image/*" multiple data-photo-pick="" data-photo-max="3" /><div className="ret-thumbs" data-photo-thumbs=""></div></div> : null)}{' '}<input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />{' '}<button className="btn btn-block">রিভিউ পাঠান</button><p className="small" data-review-msg="" role="status"></p></form></details>)}</li>))}</ul></>)}</section>);
}
type OrderPageProps = {
  order: O.Order; settings: Settings; fresh?: boolean; payFailed?: boolean; trackUrl?: string; mine?: boolean; reviewItems?: OrderReviewItem[];
  selfMsg?: { ok?: string; err?: string }; otpActive?: boolean;
};
function orderPage({ order, settings: s, fresh, payFailed, trackUrl, mine = false, reviewItems = [], selfMsg = {}, otpActive = false }: OrderPageProps) {
  const cancelled = O.RELEASED.has(order.status);
  const at = STEPS.indexOf(order.status === 'hold' ? 'confirmed' : order.status);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const online = ['bkash', 'ssl'].includes(order.payment);
  return (<div className="wrap section narrow">{(fresh && U.on(s, 'ui_order_thanks') ? <div className="success-banner"><div className="tick" aria-hidden="true">✓</div><h1>ধন্যবাদ,{' '}<span translate="no"><Val v={order.customer_name} /></span>!{' '}<Val v={U.text(s, 'uit_order_thanks')} /></h1><p>শীঘ্রই আমরা{' '}<b translate="no">{(mine ? <Val v={order.phone} /> : <Val v={maskPhone(order.phone)} />)}</b>{' '}নম্বরে কল করে অর্ডার কনফার্ম করব।</p></div> : <h1>অর্ডারের অবস্থা</h1>)}{' '}{(fresh ? followBox(s) : null)}{' '}{(payFailed ? <p className="form-error">পেমেন্ট সম্পন্ন হয়নি। আবার চেষ্টা করুন, অথবা আমাদের কল করুন — অর্ডারটি সেভ করা আছে।</p> : null)}{' '}{(online && due > 0 && !cancelled ? <div className="panel pay-now"><p>অনলাইন পেমেন্ট বাকি:{' '}<b>{money(due)}</b></p><a className="btn btn-amber btn-lg" href={`/pay/${attrValue(order.code)}`}>এখনই পেমেন্ট করুন</a></div> : null)}{' '}{(order.payment.startsWith('manual_') && order.payment_status !== 'paid' ? <p className="note">আপনার পাঠানো টাকা (TrxID:{' '}<Val v={order.transaction_id || '—'} />) আমরা যাচাই করে কনফার্ম করব।</p> : null)}<div className="panel"><div className="order-meta"><div><span className="muted">অর্ডার নম্বর</span><b className="order-code"><Val v={order.code} /></b></div><div><span className="muted">তারিখ</span><b>{fmtDate(order.created_at)}</b></div><div><span className="muted">মোট</span><b>{money(order.total)}</b></div></div>{(cancelled ? <p className="status-cancelled">এই অর্ডারটি{' '}<Val v={O.STATUSES[order.status]} />।</p> : (!U.on(s, 'ui_order_steps') ? <p><b><Val v={O.STATUSES[order.status] || ''} /></b></p> : <ol className="steps steps-5">{jsxList(STEPS.map((st, i) => <li className={`${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}`}><Val v={O.STATUSES[st]} /></li>))}</ol>))}{' '}{(order.consignment_id && U.on(s, 'ui_order_tracking') ? <p>কুরিয়ার:{' '}<b><Val v={$services_courier.label(order.courier)} /></b>{' '}· ট্র্যাকিং নম্বর:{' '}<b className="mono" translate="no"><Val v={order.tracking_code || order.consignment_id} /></b>{(trackUrl ? <>{' '}·{' '}<a href={attrValue(trackUrl)} target="_blank" rel="noopener">পার্সেল ট্র্যাক করুন ↗</a></> : null)}</p> : null)}{' '}{(fresh ? <p className="muted small">অর্ডার নম্বরটি লিখে রাখুন। পরে{' '}<a href="/track">অর্ডার ট্র্যাক</a>{' '}পেজে এটা দিয়ে অবস্থা দেখতে পারবেন।</p> : null)}</div><div className="panel"><h2>পণ্যসমূহ</h2><table className="lines"><tbody>{jsxList(order.items.map((it) => <tr><td><Val v={it.name} />{' '}<span className="muted">×{' '}{bn(it.qty)}</span>{(it.note ? <><br /><span className="small good"><Val v={it.note} /></span></> : null)}{(it.preorder_qty > 0 && !['delivered', 'shipped'].includes(order.status) ? <><br /><span className="small preorder-line">⏳ প্রি-অর্ডার:{' '}{bn(it.preorder_qty)}টি স্টকে এলেই পাঠানো হবে</span></> : null)}</td><td className="num">{(it.kind === 'gift' && !Number(it.price) ? "ফ্রি" : money(it.price * it.qty))}</td></tr>))}</tbody><tfoot><tr><td>পণ্যের দাম</td><td className="num">{money(order.subtotal)}</td></tr>{(order.discount ? <tr><td>ছাড়{(order.coupon_code ? ` (${order.coupon_code})` : null)}</td><td className="num">−{' '}{money(order.discount)}</td></tr> : null)}{' '}{(Number(order.points_discount) ? <tr><td>পয়েন্ট ছাড় ({bn(order.points_used)}{' '}পয়েন্ট)</td><td className="num">−{' '}{money(order.points_discount)}</td></tr> : null)}<tr><td>ডেলিভারি চার্জ</td><td className="num">{(order.delivery ? money(order.delivery) : "ফ্রি")}</td></tr>{(roundOff(order) ? <tr><td>{roundOffLabel(roundOff(order))}</td><td className="num">{(roundOff(order) > 0 ? "+ " : "− ")}{money(Math.abs(roundOff(order)))}</td></tr> : null)}<tr className="total"><td>মোট</td><td className="num">{money(order.total)}</td></tr>{(Number(order.gift_amount) ? <tr className="good"><td>💳 গিফট কার্ড থেকে</td><td className="num">{money(order.gift_amount)}</td></tr> : null)}{' '}{(order.paid_amount ? <><tr><td>পরিশোধিত</td><td className="num">{money(order.paid_amount)}</td></tr><tr><td><b>ডেলিভারির সময় দিতে হবে</b></td><td className="num"><b>{money(due)}</b></td></tr></> : null)}</tfoot></table>{(mine ? <p className="muted small">ডেলিভারি ঠিকানা:{' '}<span translate="no"><Val v={order.address} />,{' '}<Val v={O.areaLabel(order)} /></span></p> : <p className="muted small">🔒 নিরাপত্তার জন্য ঠিকানা আর পুরো মোবাইল নম্বর লুকানো আছে। দেখতে{' '}<a href={`/track?code=${attrValue(order.code)}`}>অর্ডার ট্র্যাক</a>{' '}পেজে মোবাইল নম্বর দিন।</p>)}</div>{(selfMsg.ok || selfMsg.err ? <p className={selfMsg.err ? 'form-error' : 'self-ok'} id="self" role="status"><Val v={selfMsg.err || '✅ ' + selfMsg.ok} /></p> : null)}{' '}{(mine && s.self_service_on !== '0' && $models_selfservice.canChange(order).ok ? selfPanel(order, s, otpActive) : null)}{' '}{(reviewItems.length ? orderReviews(order, reviewItems, mine, s) : null)}{' '}{(mine && s.warranty_claims_on !== '0' && s.complaints_on !== '0' ? warrantyBox(order) : null)}{' '}{(s.returns_on === '1' && order.status === 'delivered' ? <section className="panel ret-cta"><p>পণ্যে কোনো সমস্যা? ভাঙা/ভুল/নষ্ট পণ্য পেলে{' '}<Val v={Number(s.returns_days) || 7} />{' '}দিনের মধ্যে আবেদন করুন।</p><a className="btn btn-ghost" href={`/order/${attrValue(order.code)}/return`}>↩️ রিটার্ন / রিফান্ড আবেদন</a></section> : null)}<p className="center"><a className="btn" href="/products">আরও কেনাকাটা করুন</a>{(s.acct_on === '1' ? <>{' '}<a className="btn btn-ghost" href="/account">👤 আমার সব অর্ডার</a></> : null)}</p>{(s.complaints_on !== '0' && !fresh ? <p className="center small muted">এই অর্ডার নিয়ে কোনো সমস্যা?{' '}<a href={`/complaint?order=${attrValue(order.code)}`}>📮 অভিযোগ জানান</a>{' '}—{' '}{bn(Number(s.complaint_hours) || 72)}{' '}ঘণ্টার মধ্যে সমাধান।</p> : null)}</div>);
}

// 👍 right after ordering, the happiest moment: ask to follow the Facebook page (owner wants page followers)
function fbPageUrl(s: Settings) {
  const u = String(s.social_facebook || '').trim();
  if (/^https?:\/\/(www\.|m\.)?(facebook|fb)\.com\//i.test(u)) return u;
  return s.autopost_page_id ? `https://www.facebook.com/${encodeURIComponent(s.autopost_page_id)}` : '';
}
function followBox(s: Settings) {
  const url = fbPageUrl(s);
  if (!url || s.follow_box_on === '0') return '';
  return (<section className="panel follow-box" style={styleOf("display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-left:4px solid #1877f2")}><div style={styleOf("font-size:34px")} aria-hidden="true">👍</div><div style={styleOf("flex:1;min-width:200px")}><b>আমাদের Facebook পেজ ফলো করুন</b><br /><span className="small muted">নতুন পার্টস, অফার, ইলেকট্রনিক্সের টিপস আর কুইজ — সবার আগে পাবেন।</span></div><a className="btn" style={styleOf("background:#1877f2;border-color:#1877f2;color:#fff")} href={attrValue(url)} target="_blank" rel="noopener">Facebook-এ ফলো করুন</a></section>);
}
// 🛡️ delivered products with a warranty: until when, and a button to claim it online
function warrantyBox(order: O.Order) {
  const items = $models_complaints.warrantyItems(order);
  if (!items.length) return '';
  return (<section className="panel warranty-box"><h2>🛡️ ওয়ারেন্টি</h2><ul className="warranty-list">{jsxList(items.map((x: Loose) => <li><span><b translate="no"><Val v={x.name} /></b><br /><span className={`small ${x.valid ? 'good' : 'muted'}`}>{(x.end instanceof Date ? (x.valid ? `ওয়ারেন্টি আছে ${fmtDate(x.end, false)} পর্যন্ত` : `ওয়ারেন্টি শেষ হয়েছে ${fmtDate(x.end, false)}`) : "ওয়ারেন্টি আছে")}</span></span>{' '}{(x.valid ? <a className="btn btn-sm btn-ghost" href={`/complaint?order=${attrValue(order.code)}&topic=warranty&item=${attrValue(x.product_id)}`}>ওয়ারেন্টি দাবি করুন</a> : null)}</li>))}</ul></section>);
}
// 🙋 the customer's own changes (until the parcel goes to the courier): change name / number / address, or cancel
function selfPanel(order: O.Order, s?: Settings, otpActive?: unknown) {
  const SS = $models_selfservice;
  return (<><section className="panel self-panel" id="self"><h2>অর্ডারে কিছু বদলাতে চান?</h2><p className="muted small">কুরিয়ারে দেওয়ার আগ পর্যন্ত নিজেই ঠিকানা/নম্বর বদলাতে বা অর্ডার বাতিল করতে পারবেন।</p><details className="self-box"><summary className="btn btn-ghost">✏️ নাম, নম্বর বা ঠিকানা বদলান</summary><form className="form" method="post" action={`/order/${attrValue(order.code)}/edit`} data-geo-form="" data-self-edit="" data-phone={attrValue(order.phone)} data-otp-need={(otpActive) ? "" : undefined}><div className="field-row"><div className="field"><label>নাম</label><input name="name" required maxLength={80} defaultValue={attrValue(order.customer_name)} translate="no" /></div><div className="field"><label>মোবাইল নম্বর</label><input name="phone" required inputMode="tel" maxLength={20} defaultValue={attrValue(order.phone)} data-self-phone="" translate="no" /></div></div>{(otpActive ? <div className="otp-box" data-self-otp="" hidden><label className="otp-label">📩 নতুন নম্বরে আসা কোড</label><div className="otp-row"><input data-self-code="" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••" aria-label="SMS-এ আসা কোড" /><button type="button" className="btn btn-sm otp-send" data-self-send="">OTP পাঠান</button></div><p className="otp-msg small" data-self-msg="" role="status"></p><input type="hidden" name="otp_token" defaultValue="" data-self-token="" /></div> : null)}<div className="field-row"><div className="field"><label>জেলা</label><select name="district" required data-district="" data-value={attrValue(order.district || '')}><option value="">লোড হচ্ছে…</option></select></div><div className="field"><label>থানা / উপজেলা</label><select name="thana" required data-thana="" data-value={attrValue(order.thana || '')}><option value="">আগে জেলা বাছুন</option></select></div></div><div className="field"><label>পূর্ণ ঠিকানা</label><textarea name="address" rows={2} required maxLength={400} translate="no" defaultValue={attrValue(order.address)} /></div><p className="small muted">এলাকা বদলালে ডেলিভারি চার্জ নতুন এলাকা অনুযায়ী হিসাব হবে।</p><button className="btn">সেভ করুন</button></form></details><details className="self-box"><summary className="btn btn-ghost danger-text">❌ অর্ডার বাতিল করুন</summary><form className="form" method="post" action={`/order/${attrValue(order.code)}/cancel`} data-confirm-shop="অর্ডারটি সত্যিই বাতিল করবেন? এটা আর ফেরানো যাবে না।"><div className="field"><label>কেন বাতিল করছেন?</label><select name="reason" required><option value="">— বাছাই করুন —</option>{jsxList(Object.entries(SS.REASONS).map(([k, v]) => <option value={attrValue(k)}><Val v={v} /></option>))}</select></div><div className="field"><label>আরও কিছু বলতে চাইলে (ঐচ্ছিক)</label><input name="details" maxLength={200} /></div>{(Number(order.paid_amount) > 0 ? <p className="small">আগে দেওয়া{' '}{money(order.paid_amount)}{' '}১০ দিনের মধ্যে ফেরত দেওয়া হবে।</p> : null)}{' '}<button className="btn btn-danger">হ্যাঁ, অর্ডার বাতিল করুন</button></form></details></section></>);
}

// ⚛️ moved to React (components/shop/Pages.tsx) — same HTML, same callers
type TrackPageProps = {
  error?: string;
  code: string;
  phone?: string;
};
function trackPage({ error, code, phone }: TrackPageProps) { return (createElement(R.TrackPage, { error, code, phone })); }
type BlogListProps = {
  posts: DbRow[];
  categories: DbRow[];
  category?: DbRow | null;
};
function blogList({ posts, categories, category }: BlogListProps) { return (createElement(R.BlogList, { posts, categories, category })); }
function blogPost({ post, contentHtml, related }: Body) { return (createElement(R.BlogPost, { post, contentHtml, related })); }
type StaticPageProps = {
  page: DbRow;
};
function staticPage({ page }: StaticPageProps) { return (createElement(R.StaticPage, { page })); }
function notFound() { return (createElement(R.NotFound)); }
function postCard(p?: unknown) { return (createElement(R.PostCard, { p })); }

// ---------------------------------------------------------------- live scores
type LivePageProps = {
  sport: string;
  on: Record<string, boolean>;
  data: Loose;
  embed: string | false;
  settings: Settings;
};
function livePage({ sport, on, data, embed, settings }: LivePageProps) {
  const tabs = [['cricket', '🏏 ক্রিকেট'], ['football', '⚽ ফুটবল']].filter(([k]) => on[k]);
  const refresh = Math.min(120, Math.max(10, Number(settings.live_refresh) || 20));
  return (<div className="wrap section live"><div className="live-head"><h1>{(sport === 'cricket' ? "🏏 লাইভ ক্রিকেট স্কোর" : "⚽ লাইভ ফুটবল স্কোর")}</h1>{(tabs.length > 1 ? <nav className="live-sports" aria-label="খেলা">{jsxList(tabs.map(([k, l]) => <a href={`/live/${attrValue(k)}`} className={k === sport ? 'on' : ''}><Val v={l} /></a>))}</nav> : null)}</div>{(embed ? <div className="live-embed"><RawHtml html={embed} /></div> : <><div className="live-bar"><div className="chips live-filter" role="tablist"><button type="button" className="chip on" data-live-filter="all">সব</button>{' '}<button type="button" className="chip" data-live-filter="in"><span className="dot"></span>{' '}লাইভ{' '}<b data-live-count=""></b></button>{' '}<button type="button" className="chip" data-live-filter="pre">আসন্ন</button>{' '}<button type="button" className="chip" data-live-filter="post">শেষ</button></div><span className="live-updated small muted" data-live-updated="" aria-live="polite"></span></div><div className="live-list" data-live={attrValue(sport)} data-refresh={attrValue(refresh)}><p className="live-empty muted">স্কোর লোড হচ্ছে…</p></div><script type="application/json" data-live-initial="" dangerouslySetInnerHTML={{ __html: htmlValue(raw(JSON.stringify(data || null).replace(/</g, '\\u003c'))) }} /><noscript><p className="muted">লাইভ স্কোর দেখতে ব্রাউজারে JavaScript চালু রাখুন।</p></noscript></>)}</div>);
}

export { livePage, home, listing, productPage, cartPage, kitsPage, kitPage, checkoutPage, wishlistPage, comparePage, stars, orderPage, trackPage, notFound, productCard, blogList, blogPost, staticPage, discount };
void esc;

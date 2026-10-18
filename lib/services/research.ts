// Market research (মার্কেট রিসার্চ) — owner only, never shown on the shop.
//
// What it does, around the clock (every hour from GitHub, once a day from Vercel, and whenever the
// owner has the research page open):
//   1. Reads the public product lists of other Bangladeshi shops — WooCommerce / Shopify through their
//      product lists, and any other shop (Star Tech, TechLand, Othoba …) page by page: its sitemap and
//      category pages lead to product pages, and each product page's own price data (the JSON-LD /
//      Open Graph data shops publish for Google) is read. Only what those shops allow robots to read
//      (robots.txt is respected), a few pages at a time.
//      It keeps each product's price, old price, stock and — for WooCommerce — its place in the
//      shop's "most popular" list, so it can see what is selling and what is climbing.
//   2. Reads this shop's own signals: what customers search for (and don't find), what they look at.
//   3. Scores every product: popular in other shops + sold by several shops + climbing + new +
//      people search for it here → "উইনিং প্রোডাক্ট". For each: market price range, a sensible
//      selling price, the buying price that still leaves a good profit, and where to look for stock.
import type { ResearchItemsRow, ResearchQueueRow, ResearchSourcesRow } from '../data/rows';
import { q, one } from '../db';
import { safeFetch, type Fetched, type SafeFetchOpts } from './safefetch';
import * as dupes from '../models/duplicates';
import { bn } from '../util';
import * as importer from './importer';
import type { Id, Caught } from '../types';

/** A product name made ready for comparing (words, letter pairs, model codes). */
type Prep = ReturnType<typeof dupes.prepName> & { codes?: Set<string> };
type FullPrep = Prep & { codes: Set<string> };
// What other shops' product lists give (every field can be missing: someone else's data)
type WooItem = {
  id?: unknown; name?: string; permalink?: string; is_in_stock?: boolean; average_rating?: unknown; review_count?: unknown;
  images?: { thumbnail?: string; src?: string }[]; categories?: { name?: string }[];
  prices?: { currency_minor_unit?: number | string; price?: string; regular_price?: string };
};
type ShopifyItem = { id?: unknown; title?: string; handle?: string; product_type?: string; images?: { src?: string }[]; variants?: { price?: unknown; compare_at_price?: unknown; available?: boolean }[] };
type ShopifySuggest = { resources?: { results?: { products?: {
  id?: unknown; handle?: string; url?: string; title?: string; price?: unknown; compare_at_price?: unknown; compare_at_price_max?: unknown;
  image?: string; featured_image?: { url?: string }; type?: string; product_type?: string; available?: boolean;
}[] } } };
/** One product seen in another shop, as saved (research_items). */
type SeenItem = {
  ext_id: unknown; title: string; url?: string; image?: string; category?: string; price: number | null; regular_price: number | null;
  in_stock: boolean | null; rank?: number | null; rating: number | null; reviews: number;
};
/** A link put on a shop's reading list (research_queue). */
type QueueLink = { url: string; kind?: string; depth?: number; lastmod?: string | null; pos?: number };
/** A link on a list page: where it goes, and whether it looks like a product card. */
type PageLink = { url: string; path: string; text: string; img: boolean; near: boolean };
/** One of our own products, ready for comparing. */
type OurProduct = { id: number; name: string; price: number; cost_price: number | null; active: boolean; sku: string | null; import_ref: string | null; prep: FullPrep };
type OurList = OurProduct[] & { byRef?: Map<string, OurProduct>; byHost?: Map<string, { p: OurProduct; slug: string }[]> };
/** "we already sell this": which of our products, how sure, and why */
type Match = { id: number; name: string; price: number; cost_price: number | null; active: boolean; match: number; via: string };
type RobotsRule = { allow: boolean; path: string };





const SEGMENTS: Record<string, string> = { electronics: 'ইলেকট্রনিক্স', electrical: 'ইলেকট্রিক্যাল', fashion: 'ফ্যাশন', other: 'অন্যান্য' };
const UA_NAME = '*'; // follow the rules every robot must follow
const RANK_PAGES = 3; // WooCommerce: top 300 most popular per shop
const SHOPIFY_PAGES = 4;
const REFRESH_MIN = 50; // each shop is read again after this many minutes
const SITE_REFRESH_MIN = 12; // page-by-page shops come back sooner (each visit reads ~25 pages)
const SITE_PAGES = 26; // pages read per visit to a page-by-page shop
const SITE_QUEUE_MAX = 8000; // pages remembered per shop
// research items count as "live" for this long (page-by-page shops re-read each product every few days)
const FRESH = `(i.last_seen > now() - interval '3 days' OR (s.kind = 'site' AND i.last_seen > now() - interval '12 days'))`;

// ---------------------------------------------------------------- robots.txt
function robotsRules(text?: unknown) {
  // groups for "*" (and our own name); Allow / Disallow with * and $
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur!.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a: string) => a !== '*' && UA_NAME.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (mine.length ? mine : star).flatMap((g) => g.rules);
}
function robotsAllow(rules: RobotsRule[], pathAndQuery: string) {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!r.path) { if (!r.allow) continue; }
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$').replace(/\$$/, '$'));
    if (re.test(pathAndQuery)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return !best || best.allow;
}
async function allowed(url: string | URL) {
  const u = new URL(url);
  const host = u.origin;
  let row: { robots: string } | null = await one<{ robots: string; fetched_at: Date }>(`SELECT robots, fetched_at FROM research_hosts WHERE host=$1 AND fetched_at > now() - interval '1 day'`, [host]);
  if (!row) {
    let text = '';
    try {
      const r = await fetchImpl(host + '/robots.txt', { maxBytes: 300 * 1024, timeoutMs: 6000, accept: 'text/plain,*/*' });
      if (r.ok) text = r.body.toString('utf8');
      else if (r.status === 401 || r.status === 403) text = 'User-agent: *\nDisallow: /';
    } catch (_) { text = ''; }
    await q(`INSERT INTO research_hosts(host, robots, fetched_at) VALUES($1,$2,now()) ON CONFLICT (host) DO UPDATE SET robots=EXCLUDED.robots, fetched_at=now()`, [host, text]);
    row = { robots: text };
  }
  return robotsAllow(robotsRules(row.robots), u.pathname + u.search);
}

async function robotsSitemaps(origin: string) {
  const row = await one<{ robots: string }>('SELECT robots FROM research_hosts WHERE host=$1', [origin]);
  return [...String(row ? row.robots : '').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]).filter((u) => /^https?:\/\//i.test(u));
}
// pluggable for tests
type FetchFn = (url: string, opts: SafeFetchOpts) => Promise<Fetched>;
let fetchImpl: FetchFn = (url, opts) => safeFetch(url, opts);
function setFetch(fn?: FetchFn | null) { fetchImpl = fn || ((url, opts) => safeFetch(url, opts)); }

/** a shop's JSON (its shape is the shop's business: the callers say what they expect) */
async function getJson(url: string): Promise<unknown> {
  if (!(await allowed(url))) { const e: Caught = new Error('এই দোকান রোবটকে এই তথ্য পড়তে দেয় না (robots.txt)।'); e.code = 'ROBOTS'; throw e; }
  const r = await fetchImpl(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 9000, accept: 'application/json' });
  if (!r.ok) { const e: Caught = new Error(`দোকান উত্তর দিয়েছে ${r.status}`); e.code = 'HTTP'; throw e; }
  try { return JSON.parse(r.body.toString('utf8')); } catch (_) { const e: Caught = new Error('দোকানের তথ্য পড়া যায়নি'); e.code = 'JSON'; throw e; }
}

// ---------------------------------------------------------------- sources
async function listSources() {
  return q(`SELECT s.*, (SELECT count(*)::int FROM research_items i WHERE i.source_id=s.id AND ${FRESH}) AS live_items,
      (SELECT count(*)::int FROM research_queue rq WHERE rq.source_id=s.id) AS queued,
      (SELECT count(*)::int FROM research_queue rq WHERE rq.source_id=s.id AND rq.checked_at IS NULL AND rq.fails < 3) AS waiting
    FROM research_sources s ORDER BY s.segment, s.name`);
}
// What kind of shop is this? → { kind, origin, name }
async function detect(input: string) {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input); } catch (_) { throw new Error('লিংকটি ঠিক নেই।'); }
  const origin = u.origin;
  try {
    const d = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=1`);
    if (Array.isArray(d)) return { kind: 'woo', origin, name: u.hostname.replace(/^www\./, '') };
  } catch (caught) { const e = caught as Caught; if (e.code === 'ROBOTS') throw e; }
  try {
    const d = (await getJson(`${origin}/products.json?limit=1`)) as { products?: unknown } | null;
    if (d && Array.isArray(d.products)) return { kind: 'shopify', origin, name: u.hostname.replace(/^www\./, '') };
  } catch (caught) { const e = caught as Caught; if (e.code === 'ROBOTS') throw e; }
  // any other shop: read page by page (sitemap → category pages → product pages)
  if (!(await allowed(origin + '/'))) { const e: Caught = new Error('এই দোকান রোবটকে তাদের পেজ পড়তে দেয় না (robots.txt)।'); e.code = 'ROBOTS'; throw e; }
  let home: Fetched;
  try { home = await fetchImpl(origin + '/', { maxBytes: 4 * 1024 * 1024, timeoutMs: 9000, accept: 'text/html,*/*' }); } catch (caught) { const e = caught as Caught; throw new Error('দোকানের ওয়েবসাইট খোলা যায়নি: ' + e.message); }
  if (!home.ok) throw new Error(`দোকানের ওয়েবসাইট উত্তর দিয়েছে ${home.status} — হয়তো রোবট আটকে রাখে।`);
  return { kind: 'site', origin, name: u.hostname.replace(/^www\./, '') };
}
async function addSource(url: string, segment: string, name: string, searchOnly = false) {
  const d = await detect(url);
  const seg = SEGMENTS[segment] ? segment : 'other';
  await q(`INSERT INTO research_sources(url, name, kind, segment, search_only) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (url) DO UPDATE SET kind=EXCLUDED.kind, segment=EXCLUDED.segment, active=true, search_only=EXCLUDED.search_only`, [d.origin, String(name || d.name).slice(0, 60), d.kind, seg, !!searchOnly]);
  return d;
}

// ---------------------------------------------------------------- reading one shop
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
function cleanText(s: unknown) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '–').replace(/\s+/g, ' ').trim(); }

async function upsert(sourceId: Id, it: SeenItem) {
  await q(`INSERT INTO research_items(source_id, ext_id, title, url, image, category, price, regular_price, in_stock, rank, rank_ref, rank_ref_at, best_rank, rating, reviews)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,CASE WHEN $10::int IS NULL THEN NULL ELSE now() END,$10,$11,$12)
    ON CONFLICT (source_id, ext_id) DO UPDATE SET
      title=EXCLUDED.title, url=EXCLUDED.url, image=CASE WHEN EXCLUDED.image <> '' THEN EXCLUDED.image ELSE research_items.image END,
      category=CASE WHEN EXCLUDED.category <> '' THEN EXCLUDED.category ELSE research_items.category END,
      prev_price=CASE WHEN research_items.price IS DISTINCT FROM EXCLUDED.price AND EXCLUDED.price IS NOT NULL THEN research_items.price ELSE research_items.prev_price END,
      price_changed_at=CASE WHEN research_items.price IS DISTINCT FROM EXCLUDED.price AND EXCLUDED.price IS NOT NULL THEN now() ELSE research_items.price_changed_at END,
      price=coalesce(EXCLUDED.price, research_items.price), regular_price=coalesce(EXCLUDED.regular_price, research_items.regular_price),
      sold_out_count=research_items.sold_out_count + CASE WHEN research_items.in_stock AND EXCLUDED.in_stock = false THEN 1 ELSE 0 END,
      in_stock=coalesce(EXCLUDED.in_stock, research_items.in_stock),
      rank=CASE WHEN $10::int IS NOT NULL THEN $10 ELSE research_items.rank END,
      rank_ref=CASE WHEN $10::int IS NOT NULL AND (research_items.rank_ref_at IS NULL OR research_items.rank_ref_at < now() - interval '7 days') THEN coalesce(research_items.rank, $10) ELSE research_items.rank_ref END,
      rank_ref_at=CASE WHEN $10::int IS NOT NULL AND (research_items.rank_ref_at IS NULL OR research_items.rank_ref_at < now() - interval '7 days') THEN now() ELSE research_items.rank_ref_at END,
      best_rank=CASE WHEN $10::int IS NOT NULL THEN least(coalesce(research_items.best_rank, $10), $10) ELSE research_items.best_rank END,
      rating=coalesce(EXCLUDED.rating, research_items.rating), reviews=greatest(EXCLUDED.reviews, research_items.reviews), last_seen=now()`,
  [sourceId, String(it.ext_id).slice(0, 120), it.title.slice(0, 300), String(it.url || '').slice(0, 600), String(it.image || '').slice(0, 600),
    String(it.category || '').slice(0, 120), it.price, it.regular_price, it.in_stock, it.rank ?? null, it.rating, it.reviews || 0]);
}

async function readWoo(src: ResearchSourcesRow, started: number) {
  let n = 0;
  for (let page = 1; page <= RANK_PAGES; page++) {
    const list = (await getJson(`${src.url}/wp-json/wc/store/v1/products?orderby=popularity&order=desc&per_page=100&page=${page}`)) as WooItem[];
    if (!Array.isArray(list) || !list.length) break;
    for (const [i, p] of list.entries()) {
      const pr = p.prices || {};
      const unit = Math.pow(10, Number(pr.currency_minor_unit ?? 0));
      const price = pr.price !== undefined && pr.price !== '' ? num(Number(pr.price) / unit) : null;
      const reg = pr.regular_price ? num(Number(pr.regular_price) / unit) : null;
      await upsert(src.id, {
        ext_id: p.id, title: cleanText(p.name), url: p.permalink, image: (p.images && p.images[0] && (p.images[0].thumbnail || p.images[0].src)) || '',
        category: ((p.categories || [])[0] || {}).name || '', price, regular_price: reg && price && reg > price ? reg : null,
        in_stock: p.is_in_stock !== false, rank: (page - 1) * 100 + i + 1, rating: num(p.average_rating), reviews: Number(p.review_count) || 0,
      });
      n++;
    }
    if (list.length < 100 || Date.now() - started > 10000) break;
  }
  // products that dropped out of the popular list lose their place
  await q(`UPDATE research_items SET rank=NULL WHERE source_id=$1 AND rank IS NOT NULL AND last_seen < now() - interval '30 seconds'`, [src.id]);
  // newest arrivals (not ranked)
  if (Date.now() - started < 9000) {
    try {
      const fresh = (await getJson(`${src.url}/wp-json/wc/store/v1/products?orderby=date&order=desc&per_page=50`)) as WooItem[];
      for (const p of Array.isArray(fresh) ? fresh : []) {
        const pr = p.prices || {};
        const unit = Math.pow(10, Number(pr.currency_minor_unit ?? 0));
        const price = pr.price ? num(Number(pr.price) / unit) : null;
        const reg = pr.regular_price ? num(Number(pr.regular_price) / unit) : null;
        await upsert(src.id, { ext_id: p.id, title: cleanText(p.name), url: p.permalink, image: (p.images && p.images[0] && (p.images[0].thumbnail || p.images[0].src)) || '',
          category: ((p.categories || [])[0] || {}).name || '', price, regular_price: reg && price && reg > price ? reg : null, in_stock: p.is_in_stock !== false, rank: null,
          rating: num(p.average_rating), reviews: Number(p.review_count) || 0 });
        n++;
      }
    } catch (_) { /* popular list is what matters */ }
  }
  return n;
}
async function readShopify(src: ResearchSourcesRow, started: number) {
  let n = 0;
  for (let page = 1; page <= SHOPIFY_PAGES; page++) {
    const d = (await getJson(`${src.url}/products.json?limit=250&page=${page}`)) as { products?: ShopifyItem[] } | null;
    const list = (d && d.products) || [];
    if (!list.length) break;
    for (const p of list) {
      const vs = p.variants || [];
      const prices = vs.map((v) => num(v.price)).filter((x): x is number => x !== null);
      const price = prices.length ? Math.min(...prices) : null;
      const cmp = vs.map((v) => num(v.compare_at_price)).filter((x): x is number => x !== null && x > 0);
      await upsert(src.id, {
        ext_id: p.id, title: cleanText(p.title), url: `${src.url}/products/${p.handle}`, image: (p.images && p.images[0] && p.images[0].src) || '',
        category: p.product_type || '', price, regular_price: cmp.length && price && Math.max(...cmp) > price ? Math.max(...cmp) : null,
        in_stock: vs.some((v) => v.available !== false), rank: null, rating: null, reviews: 0,
      });
      n++;
    }
    if (list.length < 250 || Date.now() - started > 10000) break;
  }
  return n;
}

// ---------------------------------------------------------------- any other shop, page by page
// Every shop keeps a list of its pages to read (research_queue):
//   sitemap  – the shop's sitemap(s): lead to category and product pages (read again every day)
//   rank     – a "best selling / popular / trending" list on the shop: its order is the popularity rank
//   page     – any other page: if it holds product data it is a product (price, stock, picture saved),
//              otherwise it is a category page and its product links are added to the list
// Each visit reads ~25 pages: new pages first (new arrivals show up within a day), then popular
// products every day, then every other product every few days (price / stock changes).
const NOT_PRODUCT = /\/(cart|checkout|account|my-account|login|signin|sign-in|register|signup|wishlist|compare|search|blog|blogs|news|article|articles|tag|tags|page|pages|contact|contact-us|about|about-us|privacy|policy|terms|faq|help|support|career|careers|store-locator|stores|track|tracking|order|orders|offers?|campaign|brands?|vendor|seller|shop-by|feed|wp-admin|wp-login|cdn-cgi|static|assets|media|images?|files?)(\/|$)/i;
const FILE_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js|xml|json|txt|ico|mp4|mp3)(\?|$)/i;
const RANK_WORDS = /best[\s_-]*sell|top[\s_-]*sell|most[\s_-]*popular|popular|trending|hot[\s_-]*(deals?|items?|products?)|bestseller|জনপ্রিয়|বেশি বিক্রি|সর্বাধিক বিক্রি/i;
const hostKey = (u?: string | URL) => { try { return new URL(u as string).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };
function cleanLink(u: string | URL, base: string | URL | undefined) {
  let x: URL;
  try { x = new URL(u, base); } catch (_) { return ''; }
  if (!/^https?:$/.test(x.protocol) || hostKey(x.href) !== hostKey(base)) return '';
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|sort|order|view|limit|per_?page)/i.test(k)) x.searchParams.delete(k);
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
  return x.toString().slice(0, 600);
}
// Does this path look like one product (long name, numbers) rather than a category?
function productish(path: string) {
  if (importer.PRODUCT_PATH.test(path)) return true;
  const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  return last.length >= 18 && (last.match(/-/g) || []).length >= 3;
}
// Links on a list page, in page order: [{ url, img, near }]
function pageLinks(html: string, base: string | URL | undefined) {
  const out: PageLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,1500}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 1500) {
    const url = cleanLink(m[1].replace(/&amp;/g, '&'), base);
    if (!url || seen.has(url)) continue;
    let path: string;
    try { path = new URL(url).pathname; } catch (_) { continue; }
    if (path === '/' || NOT_PRODUCT.test(path) || FILE_EXT.test(path)) continue;
    seen.add(url);
    // the price printed right after the link, before the next link (a product card)
    let after = html.slice(re.lastIndex, re.lastIndex + 400);
    const nextA = after.search(/<a\b/i);
    if (nextA >= 0) after = after.slice(0, nextA);
    out.push({ url, path, text: cleanText(m[2]).slice(0, 80), img: /<img\b/i.test(m[2]), near: /(৳|tk\.?\s*\d|bdt|taka|\d\s*টাকা)/i.test(m[2] + after) });
  }
  return out;
}
// <url><loc>…</loc><lastmod>…</lastmod></url> → [{ url, lastmod }]; index → child sitemaps
function readSitemap(xml: string, base: unknown) {
  const isIndex = /<sitemapindex\b/i.test(xml.slice(0, 3000));
  const out: { url: string; lastmod: string | null }[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)) {
    const loc = (m[1].match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lm = (m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i) || [])[1];
    const d = lm ? new Date(lm) : null;
    out.push({ url: loc.replace(/&amp;/g, '&').trim(), lastmod: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return { isIndex, entries: out };
}

async function enqueue(srcId: Id, list: QueueLink[]) {
  // one row per link (the same link can't be written twice in one go); a list/sitemap role wins over "page"
  const byUrl = new Map<string, QueueLink>();
  for (const r of list) {
    const had = byUrl.get(r.url);
    if (!had || (had.kind === 'page' && r.kind !== 'page') || (had.kind === r.kind && (r.depth ?? 1) < (had.depth ?? 1))) byUrl.set(r.url, r);
  }
  const rows = [...byUrl.values()];
  if (!rows.length) return 0;
  const room = await one<{ n: number }>('SELECT count(*)::int AS n FROM research_queue WHERE source_id=$1', [srcId]);
  const take = rows.slice(0, Math.max(0, SITE_QUEUE_MAX - room!.n) + rows.filter((r) => r.kind !== 'page').length);
  let n = 0;
  for (let i = 0; i < take.length; i += 200) {
    const part = take.slice(i, i + 200);
    const r = await q(`INSERT INTO research_queue(source_id, url, kind, depth, lastmod, pos)
      SELECT $1, x.url, x.kind, x.depth, x.lastmod::timestamptz, x.pos FROM jsonb_to_recordset($2::jsonb) AS x(url text, kind text, depth int, lastmod text, pos int)
      ON CONFLICT (source_id, url) DO UPDATE SET
        lastmod = coalesce(EXCLUDED.lastmod, research_queue.lastmod),
        checked_at = CASE WHEN EXCLUDED.lastmod IS NOT NULL AND research_queue.lastmod IS DISTINCT FROM EXCLUDED.lastmod AND research_queue.checked_at IS NOT NULL
          AND EXCLUDED.lastmod > research_queue.checked_at THEN NULL ELSE research_queue.checked_at END,
        kind = CASE WHEN research_queue.kind = 'page' THEN EXCLUDED.kind ELSE research_queue.kind END,
        depth = least(research_queue.depth, EXCLUDED.depth)
      RETURNING 1`, [srcId, JSON.stringify(part.map((x) => ({ url: x.url, kind: x.kind || 'page', depth: x.depth ?? 1, lastmod: x.lastmod || null, pos: x.pos ?? null })))]);
    n += r.length;
  }
  return n;
}

// Start (or restart, once a day) a shop's reading list: its sitemaps, home page and popular lists.
async function seedSite(src: ResearchSourcesRow) {
  await allowed(src.url + '/'); // loads robots.txt (and its Sitemap: lines)
  const maps = await robotsSitemaps(src.url);
  if (!maps.length) maps.push(src.url + '/sitemap.xml', src.url + '/sitemap_index.xml');
  await enqueue(src.id, [...maps.slice(0, 10).map((url) => ({ url, kind: 'sitemap', depth: 0 })), { url: src.url + '/', kind: 'page', depth: 0 }]);
  // every day: sitemaps, the home page, category pages and popular lists are read again → new arrivals, new ranks
  await q(`UPDATE research_queue SET checked_at=NULL, fails=0 WHERE source_id=$1 AND (kind IN ('sitemap','rank') OR (depth=0 AND is_product IS NOT TRUE))`, [src.id]);
  await q('UPDATE research_sources SET seeded_at=now() WHERE id=$1', [src.id]);
}

async function currentRank(srcId: Id, url: string) {
  const r = await one<{ rank_hint: number | null }>('SELECT rank_hint FROM research_queue WHERE source_id=$1 AND url=$2', [srcId, url]);
  return r ? r.rank_hint : null;
}
async function readSite(src: ResearchSourcesRow, started: number) {
  const until = started + 10500;
  if (!src.seeded_at || Date.now() - new Date(src.seeded_at).getTime() > 20 * 3600 * 1000) await seedSite(src);
  const batch = await q<ResearchQueueRow>(`SELECT * FROM research_queue WHERE source_id=$1 AND fails < 3 AND (
        checked_at IS NULL
        OR (is_product AND rank_hint IS NOT NULL AND checked_at < now() - interval '20 hours')
        OR (is_product AND checked_at < now() - interval '4 days'))
    ORDER BY CASE
        WHEN checked_at IS NULL AND kind='sitemap' THEN 0
        WHEN checked_at IS NULL AND kind='rank' THEN 1
        WHEN checked_at IS NULL AND depth=0 THEN 2
        WHEN checked_at IS NULL THEN 3
        WHEN rank_hint IS NOT NULL THEN 4 ELSE 5 END,
      rank_hint NULLS LAST, lastmod DESC NULLS LAST, pos NULLS LAST, added_at
    LIMIT $2`, [src.id, SITE_PAGES]);
  if (!batch.length) return { n: 0, pages: 0, failed: 0 };
  let n = 0, pages = 0, failed = 0, blocked = 0;
  const lastErr: string[] = [];
  const work = async (row: ResearchQueueRow) => {
    if (Date.now() > until - 1500) return;
    try {
      if (!(await allowed(row.url))) {
        await q('UPDATE research_queue SET fails=9, checked_at=now() WHERE source_id=$1 AND url=$2', [src.id, row.url]);
        return;
      }
      const r = await fetchImpl(row.url, { maxBytes: 6 * 1024 * 1024, timeoutMs: Math.max(2500, Math.min(7000, until - Date.now() - 500)), accept: row.kind === 'sitemap' ? 'application/xml,text/xml,*/*' : 'text/html,*/*' });
      pages++;
      if (!r.ok) {
        failed++;
        if (r.status === 403 || r.status === 429 || r.status === 503) blocked++;
        lastErr.push(`${r.status}`);
        await q('UPDATE research_queue SET fails=fails+1, checked_at=CASE WHEN fails >= 2 THEN now() ELSE checked_at END WHERE source_id=$1 AND url=$2', [src.id, row.url]);
        return;
      }
      const text = r.body.toString('utf8');
      if (row.kind === 'sitemap' || /^\s*<\?xml|<(urlset|sitemapindex)\b/i.test(text.slice(0, 600))) {
        const sm = readSitemap(text, row.url);
        if (sm.isIndex) {
          const kids = sm.entries.filter((e) => !/blog|post|news|article|tag|author|image|video|page-sitemap|static/i.test(e.url));
          kids.sort((a, b) => (/product/i.test(b.url) ? 1 : 0) - (/product/i.test(a.url) ? 1 : 0));
          await enqueue(src.id, kids.slice(0, 60).map((e) => ({ url: e.url, kind: 'sitemap', depth: 0, lastmod: e.lastmod })));
        } else {
          const rows: (QueueLink & { depth: number })[] = [];
          const productMap = /product/i.test(row.url);
          for (const e of sm.entries) {
            const url = cleanLink(e.url, src.url);
            if (!url) continue;
            const path = new URL(url).pathname;
            if (path === '/' || NOT_PRODUCT.test(path) || FILE_EXT.test(path)) continue;
            rows.push({ url, kind: 'page', depth: productMap || productish(path) ? 1 : 0, lastmod: e.lastmod });
          }
          rows.sort((a, b) => a.depth - b.depth || String(b.lastmod || '').localeCompare(String(a.lastmod || '')));
          await enqueue(src.id, rows.slice(0, 5000));
        }
        await q('UPDATE research_queue SET checked_at=now(), fails=0, is_product=false WHERE source_id=$1 AND url=$2', [src.id, row.url]);
        return;
      }
      const parsed = importer.parseContent(r.body, { contentType: r.contentType || 'text/html', baseUrl: r.finalUrl || row.url });
      const items = (parsed.items || []).filter((it) => it.title && it.price !== null && it.price > 0);
      if (items.length) {
        for (const it of items.slice(0, 60)) {
          const link = cleanLink(it.link || row.url, src.url) || row.url;
          await upsert(src.id, {
            ext_id: (() => { try { const x = new URL(link); return (x.pathname + x.search).slice(0, 120); } catch (_) { return link.slice(0, 120); } })(),
            title: cleanText(it.title), url: link, image: (it.images || [])[0] || '', category: it.category || '',
            price: num(it.price), regular_price: it.old_price && it.old_price > Number(it.price) ? num(it.old_price) : null,
            in_stock: it.in_stock === null || it.in_stock === undefined ? (it.stock === 0 ? false : null) : it.in_stock,
            rank: items.length === 1 ? await currentRank(src.id, row.url) : null, rating: null, reviews: 0,
          });
          n++;
        }
        await q('UPDATE research_queue SET checked_at=now(), fails=0, is_product=$3 WHERE source_id=$1 AND url=$2', [src.id, row.url, items.length === 1]);
        if (items.length === 1) return;
      } else {
        await q('UPDATE research_queue SET checked_at=now(), fails=0, is_product=false WHERE source_id=$1 AND url=$2', [src.id, row.url]);
      }
      // a list page: follow its product links (category pages lead to products; one level deeper at most)
      if (row.depth > 1 && row.kind !== 'rank') return;
      const links = pageLinks(text, r.finalUrl || row.url);
      const cards = links.filter((l) => l.img || l.near);
      const prod = (cards.length >= 4 ? cards : links).filter((l) => (productish(l.path) || l.near) && !(RANK_WORDS.test(l.text + ' ' + l.path) && !productish(l.path)));
      const add: QueueLink[] = prod.slice(0, 300).map((l, i) => ({ url: l.url, kind: 'page', depth: row.depth + 1, pos: i + 1 }));
      if (row.depth === 0) {
        // popular / best-selling lists on the home page or a category page
        for (const l of links) if (RANK_WORDS.test(l.text + ' ' + l.path) && !productish(l.path)) add.unshift({ url: l.url, kind: 'rank', depth: 0 });
        // category pages linked from the home page (when the sitemap has none)
        for (const l of links.filter((x) => !productish(x.path) && !x.near).slice(0, 80)) add.push({ url: l.url, kind: 'page', depth: 0 });
      }
      await enqueue(src.id, add);
      if (row.kind === 'rank') {
        // this list's order = popularity: #1, #2, …
        const urls = prod.slice(0, 300).map((l) => l.url);
        await q(`UPDATE research_queue SET rank_hint=NULL WHERE source_id=$1 AND rank_hint IS NOT NULL AND NOT (url = ANY($2::text[]))`, [src.id, urls]);
        for (const [i, url] of urls.entries()) await q('UPDATE research_queue SET rank_hint=$3 WHERE source_id=$1 AND url=$2', [src.id, url, i + 1]);
        // products already read get their place straight away
        const paths = urls.map((u) => { try { const x = new URL(u); return (x.pathname + x.search).slice(0, 120); } catch (_) { return ''; } });
        await q(`UPDATE research_items AS i SET rank=x.r,
            rank_ref=CASE WHEN i.rank_ref_at IS NULL OR i.rank_ref_at < now() - interval '7 days' THEN coalesce(i.rank, x.r) ELSE i.rank_ref END,
            rank_ref_at=CASE WHEN i.rank_ref_at IS NULL OR i.rank_ref_at < now() - interval '7 days' THEN now() ELSE i.rank_ref_at END,
            best_rank=least(coalesce(i.best_rank, x.r), x.r)
          FROM unnest($2::text[]) WITH ORDINALITY AS x(p, r) WHERE i.source_id=$1 AND i.ext_id=x.p`, [src.id, paths]);
        await q('UPDATE research_items SET rank=NULL WHERE source_id=$1 AND rank IS NOT NULL AND NOT (ext_id = ANY($2::text[]))', [src.id, paths]);
      }
    } catch (caught) { const e = caught as Caught;
      failed++;
      lastErr.push(String(e.message || e).slice(0, 80));
      await q('UPDATE research_queue SET fails=fails+1, checked_at=CASE WHEN fails >= 2 THEN now() ELSE checked_at END WHERE source_id=$1 AND url=$2', [src.id, row.url]);
    }
  };
  // sitemaps and popular lists first (they decide what to read and the ranks), then 4 pages at a time, gently
  for (const row of batch.filter((r) => r.kind !== 'page')) await work(row);
  const rest = batch.filter((r) => r.kind === 'page');
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < rest.length && Date.now() < until - 1500) await work(rest[next++]); }));
  if (pages >= 3 && failed === pages) { // a single locked page is normal; every page refused means the shop blocks robots
    const e = new Error(blocked ? `দোকানটি রোবটকে পড়তে দিচ্ছে না (${lastErr[0]}) — পরে আবার চেষ্টা হবে।` : `পেজ পড়া যায়নি: ${lastErr[0] || ''}`);
    throw e;
  }
  return { n, pages, failed };
}

// One step of the round-the-clock work: read the shop that was read longest ago.
type TickOpts = {
  force?: boolean;
};
async function tick({ force = false }: TickOpts = {}) {
  const started = Date.now();
  if (!force) {
    const last = await one<{ value: string }>(`SELECT value FROM settings WHERE key='research_tick_at'`);
    if (last && Date.now() - Number(last.value) < 50 * 1000) return { skipped: true };
  }
  await q(`INSERT INTO settings(key, value) VALUES('research_tick_at', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(Date.now())]);
  const src = await one<ResearchSourcesRow>(`SELECT * FROM research_sources WHERE active AND NOT coalesce(search_only, false) AND (last_run IS NULL
      OR last_run < now() - make_interval(mins => CASE WHEN kind='site' THEN $2::int ELSE $1::int END))
    ORDER BY last_run NULLS FIRST LIMIT 1`, [force ? 0 : REFRESH_MIN, force ? 0 : SITE_REFRESH_MIN]);
  if (!src) return { idle: true };
  await q('UPDATE research_sources SET last_run=now() WHERE id=$1', [src.id]);
  try {
    if (src.kind === 'site') {
      const r = await readSite(src, started);
      const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM research_items WHERE source_id=$1 AND last_seen > now() - interval '12 days'`, [src.id]);
      await q(`UPDATE research_sources SET last_ok=CASE WHEN $3 > 0 THEN now() ELSE last_ok END, last_error='', items=$2 WHERE id=$1`, [src.id, total!.n, r.pages - r.failed]);
      return { source: src.name, items: r.n, pages: r.pages };
    }
    const n = src.kind === 'woo' ? await readWoo(src, started) : await readShopify(src, started);
    await q(`UPDATE research_sources SET last_ok=now(), last_error='', items=$2 WHERE id=$1`, [src.id, n]);
    return { source: src.name, items: n };
  } catch (caught) { const e = caught as Caught;
    await q('UPDATE research_sources SET last_error=$2 WHERE id=$1', [src.id, String(e.message || e).slice(0, 300)]);
    return { source: src.name, error: e.message };
  }
}

// ---------------------------------------------------------------- this shop's own signals
async function demand(days = 30) {
  const searches = await q<{ term: string; times: number; people: number; last: Date; found?: number }>(`SELECT lower(trim(label)) AS term, count(*)::int AS times, count(DISTINCT visitor_id)::int AS people, max(created_at) AS last
    FROM visit_events WHERE event='search' AND label <> '' AND created_at > now() - make_interval(days => $1::int)
    GROUP BY 1 ORDER BY times DESC LIMIT 40`, [days]);
  for (const s of searches) {
    s.found = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.active AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.short_description ILIKE $1 OR c.name ILIKE $1 OR p.brand ILIKE $1)`, [`%${s.term}%`]))!.n;
  }
  const viewed = await q<{ id: number; name: string; price: number; image_id: number | null; stock: number; views: number; people: number; sold: number }>(`SELECT p.id, p.name, p.price, p.image_id, p.stock, v.views, v.people,
      coalesce((SELECT sum(i.qty)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND o.created_at > now() - make_interval(days => $1::int) AND o.status NOT IN ('cancelled')), 0) AS sold
    FROM (SELECT product_id, count(*)::int AS views, count(DISTINCT visitor_id)::int AS people FROM page_views
          WHERE product_id IS NOT NULL AND created_at > now() - make_interval(days => $1::int) GROUP BY product_id) v
    JOIN products p ON p.id=v.product_id ORDER BY v.views DESC LIMIT 25`, [days]);
  return { searches, viewed };
}

// ---------------------------------------------------------------- scoring
const pairsOf = (name: string): Prep => dupes.prepName(name);
function dice(a: Prep, b: Prep) {
  if (!a.pairs.n || !b.pairs.n) return 0;
  let both = 0;
  const [small, big] = a.pairs.m.size < b.pairs.m.size ? [a.pairs.m, b.pairs.m] : [b.pairs.m, a.pairs.m];
  for (const [k, c] of small) { const d = big.get(k); if (d) both += Math.min(c, d); }
  return (2 * both) / (a.pairs.n + b.pairs.n);
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
function niceDown(n: number) { if (!n) return null; if (n < 60) return Math.floor(n); if (n < 200) return Math.floor(n / 5) * 5; if (n < 2000) return Math.floor(n / 10) * 10 - (n >= 100 ? 0 : 0); return Math.floor(n / 50) * 50; }
function searchText(title: string) { return dupes.words(title).filter((w) => !/^\d+$/.test(w)).slice(0, 6).join(' ') || title.slice(0, 50); }

type WinnersOpts = {
  segment?: string;
  limit?: number;
  margin?: number;
  /** our own products (read from the database when not given) */
  mine?: OurRow[] | null;
};
/** a product seen in another shop, with its shop, while it is being scored */
type WinRow = ResearchItemsRow & { shop: string; segment: string; kind: string; source_since: Date; prep: Prep; score: number; why: string[] };
/** the same product in several shops */
type Group = {
  lead: WinRow; seg: string; items: WinRow[]; shops: number; min: number; max: number; median: number | null; score: number; why: string[];
  searched?: { term: string; times: number; found?: number }; sell: number | null; buyMax: number | null; term: string; best: WinRow;
  oursAll: Match[]; ours: Match | null;
};
async function winners({ segment = '', limit = 60, margin = 30, mine = null }: WinnersOpts = {}) {
  const rows = (await q<Omit<WinRow, 'prep' | 'score' | 'why'>>(`SELECT i.*, s.name AS shop, s.segment, s.kind, s.created_at AS source_since
    FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND ${FRESH} ${segment ? 'AND s.segment=$1' : ''}`, segment ? [segment] : [])) as WinRow[]; // (prep, score and why are added below)
  const { searches } = await demand(30);
  const terms = searches.map((s) => ({ ...s, prep: pairsOf(s.term) }));
  const now = Date.now();
  // 1) each item on its own
  for (const r of rows) {
    let s = 0;
    const why: string[] = [];
    if (r.rank) { s += Math.max(0, 45 * (1 - (r.rank - 1) / 300)); if (r.rank <= 30) why.push(`${r.shop}-এ সবচেয়ে বেশি বিক্রির তালিকায় #${bn(r.rank)}`); }
    const climb = r.rank && r.rank_ref ? r.rank_ref - r.rank : 0;
    if (climb >= 15) { s += Math.min(15, climb / 4); why.push(`এক সপ্তাহে ${bn(climb)} ধাপ উপরে উঠেছে`); }
    const ageDays = (now - new Date(r.first_seen).getTime()) / 864e5;
    const sinceSource = (new Date(r.first_seen).getTime() - new Date(r.source_since).getTime()) / 864e5;
    // page-by-page shops need ~10 days to read their whole shop the first time — only after that is something "new"
    if (ageDays <= 14 && sinceSource > (r.kind === 'site' ? 10 : 1)) { s += 8; why.push('বাজারে নতুন এসেছে'); }
    if (r.sold_out_count > 0) { s += Math.min(10, r.sold_out_count * 4); why.push(`${bn(r.sold_out_count)} বার স্টক শেষ হয়েছে`); }
    if (r.reviews > 0) s += Math.min(8, r.reviews / 3);
    if (r.regular_price && r.price && r.regular_price > r.price) s += 3;
    r.prep = pairsOf(r.title);
    r.score = s; r.why = why;
  }
  // 2) the same product in several shops → one group
  const sorted = rows.filter((r) => r.price).sort((a, b) => b.score - a.score).slice(0, 1500);
  const groups: Group[] = [];
  for (const r of sorted) {
    let g: Group | null = null;
    for (const x of groups) { if (x.seg === r.segment && dice(x.lead.prep, r.prep) >= 0.78) { g = x; break; } }
    if (g) g.items.push(r); else groups.push({ lead: r, seg: r.segment, items: [r] } as Group); // (the rest is worked out below)
    if (groups.length > 700) break;
  }
  for (const g of groups) {
    const shops = new Set(g.items.map((i) => i.source_id));
    const prices = g.items.map((i) => Number(i.price)).filter((x) => x > 0);
    g.shops = shops.size;
    g.min = Math.min(...prices); g.max = Math.max(...prices); g.median = median(prices);
    g.score = Math.max(...g.items.map((i) => i.score)) + (shops.size - 1) * 15;
    g.why = [...new Set(g.items.flatMap((i) => i.why))];
    if (shops.size > 1) g.why.unshift(`${bn(shops.size)}টি দোকানে বিক্রি হচ্ছে`);
    // customers searched for it here
    const t = terms.find((x) => x.prep.ws.length && x.prep.ws.every((w) => g.lead.prep.ws.some((v) => v.startsWith(w) || w.startsWith(v))));
    if (t) { g.score += 20 + Math.min(20, t.times); g.why.unshift(`আপনার সাইটে "${t.term}" খোঁজা হয়েছে ${bn(t.times)} বার${t.found ? '' : ' — কিন্তু পায়নি!'}`); g.searched = t; }
    g.sell = niceDown(Number(g.median) * 0.98);
    g.buyMax = g.sell ? Math.floor(g.sell * (1 - margin / 100)) : null;
    g.term = searchText(g.lead.title);
    g.best = g.items.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b));
  }
  groups.sort((a, b) => b.score - a.score);
  const top = groups.slice(0, limit);
  // 3) do we already sell it? (any shop's name for it, matched by model number or by words)
  const oursPrep = await ourProducts(mine);
  for (const g of top) {
    const seen = new Map<number, Match>();
    for (const it of [g.lead, ...g.items.slice(0, 6)]) for (const m of matchOurs(it.prep, oursPrep, 0.72, it)) if (!seen.has(m.id) || seen.get(m.id)!.match < m.match) seen.set(m.id, m);
    g.oursAll = [...seen.values()].sort((a, b) => b.match - a.match);
    g.ours = g.oursAll[0] || null;
  }
  return top;
}

// ---------------------------------------------------------------- is this product already in our shop?
// Names of the same product differ a lot between shops ("SG90 Micro Servo Motor" vs our
// "SG90 মাইক্রো সার্ভো মোটর 9g 180°"), so letter-pair likeness alone misses them.
// The model number (sg90, pam8403, esp32, hc-05, mg90s) decides first; words come second.
const UNIT_ONLY = /^\d+(p\d+)?(v|w|a|ma|mah|mm|cm|m|kg|g|gb|tb|mb|ml|l|inch|pcs|hz|khz|mhz|uf|nf|pf|k|ohm|rpm|x|d|s|deg|degree|years?|y)$/;
function modelCodes(ws: string[]) {
  const out = new Set<string>();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.length >= 3 && /\d/.test(w) && /[a-z]/.test(w) && !UNIT_ONLY.test(w)) out.add(w);
    // "sg 90", "hc 05", "esp 32" → sg90 / hc05 / esp32
    const nx = ws[i + 1];
    if (/^[a-z]{1,4}$/.test(w) && nx && /^\d+[a-z]{0,2}$/.test(nx) && !UNIT_ONLY.test(nx)) out.add(w + nx);
  }
  return out;
}
const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// share of a's words found in b
function cover(a: string[], b: string[]) {
  const ws = a.filter((w) => !/^\d+$/.test(w));
  if (!ws.length) return 0;
  return ws.filter((w) => b.some((v) => near(w, v))).length / ws.length;
}
function prepFull(name: string): FullPrep { const p = pairsOf(name); return Object.assign(p, { codes: modelCodes(p.ws) }); }
// 0 … 1: how sure we are that two names are the same product
type SizesOpts = {
  ws: string[];
};
function sameProduct(a: Prep, b: Prep) {
  if (!a.codes) a.codes = modelCodes(a.ws);
  if (!b.codes) b.codes = modelCodes(b.ws);
  const ac = a.codes; const bc = b.codes;
  let d = dice(a, b);
  // same kind of size with a different value (40W vs 60W, 12V vs 24V) → a different product
  const sizes = (p: SizesOpts) => { const m = new Map<string, Set<string>>(); for (const w of p.ws) { const x = w.match(/^(\d+(?:p\d+)?)([a-z]+)$/); if (x && UNIT_ONLY.test(w)) { if (!m.has(x[2])) m.set(x[2], new Set()); m.get(x[2])!.add(x[1]); } } return m; };
  const sa = sizes(a), sb = sizes(b);
  for (const [u, vals] of sa) if (sb.has(u) && ![...vals].some((v) => sb.get(u)!.has(v))) { d = Math.min(d, 0.6); return d; }
  if (ac.size && bc.size) {
    const shared = [...ac].filter((c) => bc.has(c));
    if (!shared.length) return Math.min(d, 0.6); // SG90 ≠ MG90S, PAM8403 ≠ PAM8610
    const otherWord = a.ws.some((w) => !/\d/.test(w) && w.length >= 3 && b.ws.some((v) => near(w, v)));
    if (otherWord || shared.some((c) => c.length >= 4)) return Math.max(d, 0.9);
    return Math.max(d, 0.7);
  }
  if (ac.size || bc.size) return d; // only one name has a model number: be careful
  const [s, l] = a.ws.length <= b.ws.length ? [a.ws, b.ws] : [b.ws, a.ws];
  const c = s.length >= 2 ? cover(s, l) : 0;
  return Math.max(d, c >= 0.85 && s.length >= 3 ? 0.8 : c >= 0.85 ? 0.74 : 0);
}
type OurRow = Omit<OurProduct, 'prep'>;
async function ourProducts(mine?: OurRow[] | null): Promise<OurList> {
  const rows = mine || await q<OurRow>('SELECT id, name, price, cost_price, active, sku, import_ref FROM products');
  const list: OurList = rows.map((p) => {
    const prep = prepFull(p.name);
    // a model number kept only in the SKU still counts
    if (p.sku) for (const c of modelCodes(dupes.words(p.sku))) prep.codes.add(c);
    return { ...p, prep };
  });
  // products copied from another shop remember where they came from ("shop.com#id-or-page"):
  // that shop's listing of the same product is ours whatever we renamed it to
  list.byRef = new Map();
  list.byHost = new Map();
  for (const p of list) {
    const ref = String(p.import_ref || '').toLowerCase();
    const hash = ref.indexOf('#');
    if (hash <= 0) continue;
    list.byRef.set(ref, p);
    const host = ref.slice(0, hash);
    if (!list.byHost.has(host)) list.byHost.set(host, []);
    list.byHost.get(host)!.push({ p, slug: slugOf(ref.slice(hash + 1)) });
  }
  return list;
}
const hostOfUrl = (u?: string) => { try { return new URL(u as string).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };
// last part of a product address, without .html / ids-only noise: "/product/universal-adapter-3pin/" → "universal-adapter-3pin"
function slugOf(key?: unknown) {
  let k = String(key || '').toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  try { k = decodeURIComponent(k); } catch (_) { /* keep as is */ }
  const last = k.split('/').filter(Boolean).pop() || '';
  return last.replace(/\.(html?|php|aspx?)$/, '');
}
function refsFor(item: { url?: string; ext_id?: unknown; title?: string }) {
  const host = hostOfUrl(item.url);
  if (!host) return { host: '', refs: [], slug: '' };
  const refs = new Set<string>();
  if (item.ext_id !== undefined && item.ext_id !== null && item.ext_id !== '') refs.add(`${host}#${String(item.ext_id).toLowerCase()}`);
  try { const u = new URL(item.url as string); refs.add(`${host}#${(u.pathname.replace(/\/+$/, '') + u.search).toLowerCase()}`); } catch (_) { /* no address */ }
  if (item.title) refs.add(`${host}#${String(item.title).toLowerCase()}`);
  let slug = '';
  try { slug = slugOf(new URL(item.url as string).pathname); } catch (_) { /* none */ }
  return { host, refs: [...refs].map((r) => r.slice(0, 300)), slug };
}
function matchOurs(prep: Prep, oursPrep: OurList, min = 0.72, item: { url?: string; ext_id?: unknown; title?: string } | null = null): Match[] {
  const found = new Map<number, Match>();
  const put = (p: OurProduct, match: number, via: string) => { if (!found.has(p.id) || found.get(p.id)!.match < match) found.set(p.id, { id: p.id, name: p.name, price: p.price, cost_price: p.cost_price, active: p.active, match, via }); };
  // 1) copied from exactly this shop page / this shop's product
  if (item && oursPrep.byRef) {
    const { host, refs, slug } = refsFor(item);
    for (const r of refs) { const p = oursPrep.byRef.get(r); if (p) put(p, 1, 'link'); }
    for (const { p, slug: s2 } of oursPrep.byHost?.get(host) || []) {
      if (slug && s2 && slug.length >= 6 && slug === s2) put(p, 1, 'link');
      // same shop, so names were the same when copied — a looser match is enough
      else if (sameProduct(prep, p.prep) >= 0.6) put(p, 0.9, 'shop');
    }
  }
  // 2) by model number / name
  for (const p of oursPrep) { const s = sameProduct(prep, p.prep); if (s >= min) put(p, s, 'name'); }
  return [...found.values()].sort((a, b) => b.match - a.match).slice(0, 5);
}

// ---------------------------------------------------------------- search every shop by product name
// What we already read + a live search on each shop right now (their own search, robots.txt respected).
// Everything found is saved, so it also counts for "উইনিং প্রোডাক্ট" later.
const SITE_SEARCH = ['/index.php?route=product/search&search=', '/search?q=', '/store?q=', '/?post_type=product&s=', '/catalogsearch/result/?q=', '/search?search='];
const searchHint = new Map<string, string>(); // shop → the search address that worked
// "TDA2030 amplifier board" is made with the part; "TDA2030 Audio Amplifier IC" is the part itself
const MADE_STRONG = /\b(board|module|modul|kit|shield|breakout|pcb|circuit|diy)\b|বোর্ড|মডিউল|কিট|সার্কিট/i;
const MADE_SOFT = /\b(amplifier|amp|converter|supply|charger|controller|driver|speaker|system)\b|অ্যামপ্লিফায়ার|এম্পলিফায়ার/i;
const IS_PART = /\b(ic|chip|transistor|regulator ic|to-?220|to-?92|to-?3p?|dip-?\d*|sop-?\d*|pentawatt)\b|আইসি/i;
const madeWith = (t: string) => MADE_STRONG.test(t) || (MADE_SOFT.test(t) && !IS_PART.test(t));
const recentLive = new Map<string, number>(); // search words → when every shop was last searched for them
// ---- what a search means: part numbers must be there, words mostly there
// "7812", "LM7812", "LM 7812", "78 12" → part 7812 (found in L7812CV, LM7812, KA7812 — not in 7912 or 78121)
// "voltage regulator 12v" → words; most of them must be in the name
type SearchQuery = { parts: { full: string; core: string }[]; words: string[] };
function searchQuery(term: string): SearchQuery {
  let ws = dupes.words(term);
  // glue split part numbers back: "lm 7812" → "lm7812", "78 12" → "7812", "hc 05" → "hc05"
  const glued: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], nx = ws[i + 1];
    if (nx && /^\d{1,3}$/.test(nx) && (/^[a-z]{1,4}$/.test(w) || /^\d{1,3}$/.test(w)) && !UNIT_ONLY.test(nx)) { glued.push(w + nx); i++; continue; }
    glued.push(w);
  }
  ws = glued;
  const parts: SearchQuery['parts'] = []; // { full, core }: core = the digits with what follows them ("lm317t" → "317t"? no: "317")
  const words: string[] = [];
  for (const w of ws) {
    if (UNIT_ONLY.test(w)) { words.push(w); continue; } // 12v, 60w … a size, not a part number
    if (/\d/.test(w) && (w.length >= 3 || /[a-z]/.test(w))) {
      const m = w.match(/\d+/g) || [];
      const core = m.sort((a, b) => b.length - a.length)[0] || w;
      parts.push({ full: w, core: core.length >= 3 ? core : w });
    } else if (!/^\d+$/.test(w)) words.push(w);
  }
  return { parts, words };
}
const compact = (s: string) => dupes.words(s).join(' ');
// is the part number in this name? digits must stand alone (7812 ≠ 78121, 17812)
function hasPart(name: string, part: { full: string; core: string; }) {
  if (name.includes(part.full)) return 1;
  const re = new RegExp(`(^|[^0-9])${part.core}([^0-9]|$)`);
  if (part.core !== part.full && re.test(name)) {
    // LM7812 asked, L7812CV / KA7812 found: same part, other maker's letters
    return 0.9;
  }
  if (part.core === part.full && re.test(name)) return 1;
  // 78L05 / 79L12: the small version of the same regulator
  if (/^\d{4}$/.test(part.core) && re.test(name.replace(/(\d\d)l(\d\d)/g, '$1$2'))) return 0.8;
  return 0;
}
// 0 … 1: how well a product name fits the search
function searchFit(sq: SearchQuery, title: string) {
  const name = compact(title);
  const tws = name.split(' ');
  let score = 1;
  for (const p of sq.parts) { const h = hasPart(name, p); if (!h) return 0; score = Math.min(score, h); }
  // a size asked for (12v): a name with the same kind of size but another value is a different product
  for (const w of sq.words.filter((x) => UNIT_ONLY.test(x))) {
    const unit = w.replace(/^[\dp]+/, '');
    const same = tws.filter((v) => UNIT_ONLY.test(v) && v.replace(/^[\dp]+/, '') === unit);
    if (same.length && !same.includes(w)) return 0;
  }
  // tiny words (ic, bd, of) only help when nothing else was typed
  const need = sq.words.filter((w) => w.length >= 3 || UNIT_ONLY.test(w));
  const sqw = need.length ? need : sq.words;
  if (sqw.length) {
    const c = sqw.filter((w) => tws.some((v) => near(w, v) || (w.length >= 4 && v.includes(w)))).length / sqw.length;
    // with a part number the words are only a hint; without one most words must be there
    if (!sq.parts.length && c < (sqw.length <= 2 ? 1 : 0.6)) return 0;
    if (sq.parts.length && c === 0 && sqw.length >= 2) return 0;
    score *= 0.6 + 0.4 * c;
  }
  return score;
}
function termOk(termPrep: Prep, titlePrep: Prep, sq?: SearchQuery) { return searchFit(sq || searchQuery(termPrep.ws.join(' ')), titlePrep.ws.join(' ')); }
async function liveWoo(src: ResearchSourcesRow, term: string) {
  const list = (await getJson(`${src.url}/wp-json/wc/store/v1/products?search=${encodeURIComponent(term)}&per_page=30`)) as WooItem[];
  let n = 0;
  for (const p of Array.isArray(list) ? list : []) {
    const pr = p.prices || {};
    const unit = Math.pow(10, Number(pr.currency_minor_unit ?? 0));
    const price = pr.price !== undefined && pr.price !== '' ? num(Number(pr.price) / unit) : null;
    const reg = pr.regular_price ? num(Number(pr.regular_price) / unit) : null;
    await upsert(src.id, { ext_id: p.id, title: cleanText(p.name), url: p.permalink, image: (p.images && p.images[0] && (p.images[0].thumbnail || p.images[0].src)) || '',
      category: ((p.categories || [])[0] || {}).name || '', price, regular_price: reg && price && reg > price ? reg : null, in_stock: p.is_in_stock !== false, rank: null,
      rating: num(p.average_rating), reviews: Number(p.review_count) || 0 });
    n++;
  }
  return n;
}
async function liveShopify(src: ResearchSourcesRow, term: string) {
  const d = (await getJson(`${src.url}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`)) as ShopifySuggest | null;
  const list = (((d || {}).resources || {}).results || {}).products || [];
  let n = 0;
  for (const p of list) {
    const handle = String(p.handle || p.url || '').replace(/^.*\/products\//, '').replace(/[?#].*$/, '');
    if (!handle) continue;
    const price = num(p.price);
    const cmp = num(p.compare_at_price_max || p.compare_at_price);
    await upsert(src.id, { ext_id: p.id || handle, title: cleanText(p.title), url: `${src.url}/products/${handle}`, image: p.image || (p.featured_image || {}).url || '',
      category: p.type || p.product_type || '', price, regular_price: cmp && price && cmp > price ? cmp : null, in_stock: p.available !== false, rank: null, rating: null, reviews: 0 });
    n++;
  }
  return n;
}
async function liveSite(src: ResearchSourcesRow, term: string, termPrep: unknown, until: number) {
  const host = hostKey(src.url);
  const order = searchHint.has(host) ? [searchHint.get(host)!] : SITE_SEARCH;
  for (const path of order) {
    if (Date.now() > until - 2500) return 0;
    const url = src.url + path + encodeURIComponent(term);
    if (!(await allowed(url))) continue;
    let r: Fetched;
    try { r = await fetchImpl(url, { maxBytes: 4 * 1024 * 1024, timeoutMs: Math.max(2000, Math.min(7000, until - Date.now() - 1500)), accept: 'text/html,*/*' }); } catch (_) { continue; }
    if (!r.ok) continue;
    const base = r.finalUrl || url;
    const links = pageLinks(r.body.toString('utf8'), base)
      .filter((l) => (productish(l.path) || l.near || l.img) && l.text && searchFit(searchQuery(term), l.text) > 0);
    if (!links.length) continue;
    searchHint.set(host, path);
    // open the best few product pages for price, stock and picture
    let n = 0;
    await Promise.all(links.slice(0, 10).map(async (l) => {
      try {
        if (Date.now() > until - 1200 || !(await allowed(l.url))) return;
        const pr = await fetchImpl(l.url, { maxBytes: 6 * 1024 * 1024, timeoutMs: Math.max(1500, Math.min(6000, until - Date.now() - 800)), accept: 'text/html,*/*' });
        if (!pr.ok) return;
        const parsed = importer.parseContent(pr.body, { contentType: pr.contentType || 'text/html', baseUrl: pr.finalUrl || l.url });
        const it = (parsed.items || []).find((x) => x.title && Number(x.price) > 0);
        if (!it) return;
        const link = cleanLink(pr.finalUrl || l.url, src.url) || l.url;
        await upsert(src.id, { ext_id: (() => { try { const x = new URL(link); return (x.pathname + x.search).slice(0, 120); } catch (_) { return link.slice(0, 120); } })(),
          title: cleanText(it.title), url: link, image: (it.images || [])[0] || '', category: it.category || '', price: num(it.price),
          regular_price: it.old_price && it.old_price > Number(it.price) ? num(it.old_price) : null,
          in_stock: it.in_stock === null || it.in_stock === undefined ? (it.stock === 0 ? false : null) : it.in_stock, rank: null, rating: null, reviews: 0 });
        n++;
      } catch (_) { /* one page is not important */ }
    }));
    return n;
  }
  return 0;
}

type SearchMarketOpts = {
  live?: boolean;
  fresh?: boolean;
  budgetMs?: number;
};
async function searchMarket(term: string, { live = true, fresh = false, budgetMs = 24000 }: SearchMarketOpts = {}) {
  term = String(term || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const termPrep = prepFull(term);
  const sq0 = searchQuery(term);
  if (!termPrep.ws.length && !/\d/.test(term)) return { term, items: [], shops: [] };
  const started = Date.now();
  const until = started + budgetMs;
  const sources = await q<ResearchSourcesRow>('SELECT * FROM research_sources WHERE active ORDER BY last_ok DESC NULLS LAST');
  const shops: { name: string; n: number; error: string }[] = [];
  // the same search again within 10 minutes (e.g. back from adding a product): what was just found is enough
  const key = termPrep.ws.join(' ');
  for (const [k, t] of recentLive) if (Date.now() - t > 10 * 60000) recentLive.delete(k);
  const again = !fresh && recentLive.has(key);
  if (live && !again && sources.length) recentLive.set(key, Date.now());
  const liveTerm = [...sq0.parts.map((p) => p.full), ...sq0.words.map((w) => w.replace(/(\d)p(\d)/, '$1.$2'))].join(' ') || term;
  if (live && !again && sources.length) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(14, sources.length) }, async () => {
      while (next < sources.length) {
        const src = sources[next++];
        const row = { name: src.name, n: 0, error: '' };
        shops.push(row);
        if (Date.now() > until - 2500) { row.error = 'সময় শেষ'; continue; }
        try {
          if (src.kind === 'auto') {
            // first time: what kind of shop is it? (a slow shop is tried again on the next search)
            const d = await Promise.race([detect(src.url), new Promise<never>((_, no) => setTimeout(() => no(Object.assign(new Error('slow'), { code: 'SLOW' })), Math.max(1500, Math.min(7000, until - Date.now() - 4000))))]);
            src.kind = d.kind;
            await q('UPDATE research_sources SET kind=$2 WHERE id=$1', [src.id, d.kind]);
          }
          row.n = src.kind === 'woo' ? await liveWoo(src, liveTerm) : src.kind === 'shopify' ? await liveShopify(src, liveTerm) : await liveSite(src, liveTerm, termPrep, until);
        } catch (caught) { const e = caught as Caught; row.error = e.code === 'ROBOTS' ? 'খুঁজতে দেয় না' : e.code === 'SLOW' ? 'ধীর — পরের বার' : 'খোলা যায়নি'; }
      }
    }));
  }
  // everything we know (just found + read earlier), then keep what really matches the words
  const sq = searchQuery(term);
  // ask the database for anything holding a part number or a search word, then judge each name
  const likes = [...new Set([...sq.parts.flatMap((p) => (/^\d{4}$/.test(p.core) ? [p.core, p.core.slice(0, 2) + 'l' + p.core.slice(2)] : [p.core])), ...sq.words.filter((w) => w.length >= 3)].map((w) => `%${w.replace(/[%_\\]/g, '').replace(/p(\d)/, '.$1')}%`))].slice(0, 8);
  type Found = ResearchItemsRow & { shop: string; segment: string; prep?: Prep; fit: number; fresh: boolean; ours: Match[]; made: boolean };
  const rows = (likes.length ? await q<ResearchItemsRow & { shop: string; segment: string }>(`SELECT i.*, s.name AS shop, s.segment FROM research_items i JOIN research_sources s ON s.id=i.source_id
      WHERE s.active AND i.last_seen > now() - interval '30 days' AND i.title ILIKE ANY($1::text[])
      ORDER BY i.last_seen DESC LIMIT 3000`, [likes]) : []) as Found[]; // (prep, fit, fresh, ours and made are added below)
  const oursPrep = await ourProducts();
  const items: Found[] = [];
  const seenUrl = new Set<string>();
  for (const r of rows) {
    if (seenUrl.has(r.url)) continue;
    r.prep = prepFull(r.title);
    const fit = searchFit(sq, r.title);
    if (!fit) continue;
    seenUrl.add(r.url);
    r.fit = fit;
    r.fresh = new Date(r.last_seen).getTime() >= started - 1000;
    r.ours = matchOurs(r.prep!, oursPrep, 0.72, r);
    items.push(r);
  }
  // another shop's listing of a product we copied from shop X counts too (its name may match X's, not ours)
  const known = items.filter((r) => r.ours.some((m) => m.via === 'link'));
  for (const r of items) {
    if (r.ours.length) continue;
    for (const k of known) {
      if (sameProduct(r.prep!, k.prep!) >= 0.8) { r.ours = k.ours.filter((m) => m.via === 'link').map((m) => ({ ...m, match: 0.88, via: 'other-shop' })); break; }
    }
  }
  // the part itself, or a board / module / kit made with it?
  for (const r of items) r.made = sq.parts.length > 0 && madeWith(r.title);
  items.sort((a, b) => b.fit - a.fit || (Number(a.price) || 1e12) - (Number(b.price) || 1e12));
  for (const r of items) delete r.prep;
  return { term, items: items.slice(0, 120), shops: shops.sort((a, b) => b.n - a.n), again, ms: Date.now() - started };
}

type NewInMarketOpts = {
  segment?: string;
  limit?: number;
};
async function newInMarket({ segment = '', limit = 30 }: NewInMarketOpts = {}) {
  return q(`SELECT i.*, s.name AS shop, s.segment FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.first_seen > now() - interval '7 days'
      AND i.first_seen > s.created_at + CASE WHEN s.kind='site' THEN interval '10 days' ELSE interval '1 day' END ${segment ? 'AND s.segment=$2' : ''}
    ORDER BY i.first_seen DESC LIMIT $1`, segment ? [limit, segment] : [limit]);
}
type PriceDropsOpts = {
  limit?: number;
};
async function priceDrops({ limit = 20 }: PriceDropsOpts = {}) {
  return q(`SELECT i.*, s.name AS shop FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.prev_price IS NOT NULL AND i.price < i.prev_price AND i.price_changed_at > now() - interval '7 days'
    ORDER BY (i.prev_price - i.price) / nullif(i.prev_price, 0) DESC LIMIT $1`, [limit]);
}
async function status() {
  return one(`SELECT (SELECT count(*)::int FROM research_sources WHERE active AND NOT search_only) AS sources,
    (SELECT count(*)::int FROM research_sources WHERE active AND search_only) AS search_shops,
    (SELECT count(*)::int FROM research_items i JOIN research_sources s ON s.id=i.source_id WHERE ${FRESH}) AS items,
    (SELECT max(last_ok) FROM research_sources) AS last_ok`);
}

function sourcingLinks(term: string) {
  const e = encodeURIComponent(term);
  return [
    ['1688 (চীনের পাইকারি)', `https://s.1688.com/selloffer/offer_search.htm?keywords=${e}`],
    ['Alibaba', `https://www.alibaba.com/trade/search?SearchText=${e}`],
    ['AliExpress', `https://www.aliexpress.com/wholesale?SearchText=${e}`],
    ['Daraz', `https://www.daraz.com.bd/catalog/?q=${e}`],
    ['Google', `https://www.google.com/search?q=${encodeURIComponent(term + ' wholesale price Bangladesh')}`],
  ];
}

export { searchMarket, sameProduct, prepFull, matchOurs, SEGMENTS, listSources, addSource, detect, tick, setFetch, readSitemap, pageLinks, productish, demand, winners, newInMarket, priceDrops, status, sourcingLinks, robotsRules, robotsAllow };

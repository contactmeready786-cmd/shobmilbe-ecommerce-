'use strict';
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
const { q, one } = require('../db');
const { safeFetch } = require('./safefetch');
const dupes = require('../models/duplicates');
const { bn } = require('../util');
const importer = require('./importer');

const SEGMENTS = { electronics: 'ইলেকট্রনিক্স', electrical: 'ইলেকট্রিক্যাল', fashion: 'ফ্যাশন', other: 'অন্যান্য' };
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
function robotsRules(text) {
  // groups for "*" (and our own name); Allow / Disallow with * and $
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_NAME.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (mine.length ? mine : star).flatMap((g) => g.rules);
}
function robotsAllow(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (!r.path) { if (!r.allow) continue; }
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$').replace(/\$$/, '$'));
    if (re.test(pathAndQuery)) {
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return !best || best.allow;
}
async function allowed(url) {
  const u = new URL(url);
  const host = u.origin;
  let row = await one(`SELECT robots, fetched_at FROM research_hosts WHERE host=$1 AND fetched_at > now() - interval '1 day'`, [host]);
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

async function robotsSitemaps(origin) {
  const row = await one('SELECT robots FROM research_hosts WHERE host=$1', [origin]);
  return [...String(row ? row.robots : '').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]).filter((u) => /^https?:\/\//i.test(u));
}
// pluggable for tests
let fetchImpl = (url, opts) => safeFetch(url, opts);
function setFetch(fn) { fetchImpl = fn || ((url, opts) => safeFetch(url, opts)); }

async function getJson(url) {
  if (!(await allowed(url))) { const e = new Error('এই দোকান রোবটকে এই তথ্য পড়তে দেয় না (robots.txt)।'); e.code = 'ROBOTS'; throw e; }
  const r = await fetchImpl(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 9000, accept: 'application/json' });
  if (!r.ok) { const e = new Error(`দোকান উত্তর দিয়েছে ${r.status}`); e.code = 'HTTP'; throw e; }
  try { return JSON.parse(r.body.toString('utf8')); } catch (_) { const e = new Error('দোকানের তথ্য পড়া যায়নি'); e.code = 'JSON'; throw e; }
}

// ---------------------------------------------------------------- sources
async function listSources() {
  return q(`SELECT s.*, (SELECT count(*)::int FROM research_items i WHERE i.source_id=s.id AND ${FRESH}) AS live_items,
      (SELECT count(*)::int FROM research_queue rq WHERE rq.source_id=s.id) AS queued,
      (SELECT count(*)::int FROM research_queue rq WHERE rq.source_id=s.id AND rq.checked_at IS NULL AND rq.fails < 3) AS waiting
    FROM research_sources s ORDER BY s.segment, s.name`);
}
// What kind of shop is this? → { kind, origin, name }
async function detect(input) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input); } catch (_) { throw new Error('লিংকটি ঠিক নেই।'); }
  const origin = u.origin;
  try {
    const d = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=1`);
    if (Array.isArray(d)) return { kind: 'woo', origin, name: u.hostname.replace(/^www\./, '') };
  } catch (e) { if (e.code === 'ROBOTS') throw e; }
  try {
    const d = await getJson(`${origin}/products.json?limit=1`);
    if (d && Array.isArray(d.products)) return { kind: 'shopify', origin, name: u.hostname.replace(/^www\./, '') };
  } catch (e) { if (e.code === 'ROBOTS') throw e; }
  // any other shop: read page by page (sitemap → category pages → product pages)
  if (!(await allowed(origin + '/'))) { const e = new Error('এই দোকান রোবটকে তাদের পেজ পড়তে দেয় না (robots.txt)।'); e.code = 'ROBOTS'; throw e; }
  let home;
  try { home = await fetchImpl(origin + '/', { maxBytes: 4 * 1024 * 1024, timeoutMs: 9000, accept: 'text/html,*/*' }); } catch (e) { throw new Error('দোকানের ওয়েবসাইট খোলা যায়নি: ' + e.message); }
  if (!home.ok) throw new Error(`দোকানের ওয়েবসাইট উত্তর দিয়েছে ${home.status} — হয়তো রোবট আটকে রাখে।`);
  return { kind: 'site', origin, name: u.hostname.replace(/^www\./, '') };
}
async function addSource(url, segment, name) {
  const d = await detect(url);
  const seg = SEGMENTS[segment] ? segment : 'other';
  await q(`INSERT INTO research_sources(url, name, kind, segment) VALUES($1,$2,$3,$4)
    ON CONFLICT (url) DO UPDATE SET kind=EXCLUDED.kind, segment=EXCLUDED.segment, active=true`, [d.origin, String(name || d.name).slice(0, 60), d.kind, seg]);
  return d;
}

// ---------------------------------------------------------------- reading one shop
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
function cleanText(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '–').replace(/\s+/g, ' ').trim(); }

async function upsert(sourceId, it) {
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

async function readWoo(src, started) {
  let n = 0;
  for (let page = 1; page <= RANK_PAGES; page++) {
    const list = await getJson(`${src.url}/wp-json/wc/store/v1/products?orderby=popularity&order=desc&per_page=100&page=${page}`);
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
      const fresh = await getJson(`${src.url}/wp-json/wc/store/v1/products?orderby=date&order=desc&per_page=50`);
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
async function readShopify(src, started) {
  let n = 0;
  for (let page = 1; page <= SHOPIFY_PAGES; page++) {
    const d = await getJson(`${src.url}/products.json?limit=250&page=${page}`);
    const list = (d && d.products) || [];
    if (!list.length) break;
    for (const p of list) {
      const vs = p.variants || [];
      const prices = vs.map((v) => num(v.price)).filter((x) => x !== null);
      const price = prices.length ? Math.min(...prices) : null;
      const cmp = vs.map((v) => num(v.compare_at_price)).filter((x) => x !== null && x > 0);
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
const hostKey = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };
function cleanLink(u, base) {
  let x;
  try { x = new URL(u, base); } catch (_) { return ''; }
  if (!/^https?:$/.test(x.protocol) || hostKey(x.href) !== hostKey(base)) return '';
  x.hash = '';
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|sort|order|view|limit|per_?page)/i.test(k)) x.searchParams.delete(k);
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
  return x.toString().slice(0, 600);
}
// Does this path look like one product (long name, numbers) rather than a category?
function productish(path) {
  if (importer.PRODUCT_PATH.test(path)) return true;
  const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  return last.length >= 18 && (last.match(/-/g) || []).length >= 3;
}
// Links on a list page, in page order: [{ url, img, near }]
function pageLinks(html, base) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,1500}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 1500) {
    const url = cleanLink(m[1].replace(/&amp;/g, '&'), base);
    if (!url || seen.has(url)) continue;
    let path;
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
function readSitemap(xml, base) {
  const isIndex = /<sitemapindex\b/i.test(xml.slice(0, 3000));
  const out = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)) {
    const loc = (m[1].match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lm = (m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i) || [])[1];
    const d = lm ? new Date(lm) : null;
    out.push({ url: loc.replace(/&amp;/g, '&').trim(), lastmod: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null });
  }
  return { isIndex, entries: out };
}

async function enqueue(srcId, list) {
  // one row per link (the same link can't be written twice in one go); a list/sitemap role wins over "page"
  const byUrl = new Map();
  for (const r of list) {
    const had = byUrl.get(r.url);
    if (!had || (had.kind === 'page' && r.kind !== 'page') || (had.kind === r.kind && (r.depth ?? 1) < (had.depth ?? 1))) byUrl.set(r.url, r);
  }
  const rows = [...byUrl.values()];
  if (!rows.length) return 0;
  const room = await one('SELECT count(*)::int AS n FROM research_queue WHERE source_id=$1', [srcId]);
  const take = rows.slice(0, Math.max(0, SITE_QUEUE_MAX - room.n) + rows.filter((r) => r.kind !== 'page').length);
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
async function seedSite(src) {
  await allowed(src.url + '/'); // loads robots.txt (and its Sitemap: lines)
  const maps = await robotsSitemaps(src.url);
  if (!maps.length) maps.push(src.url + '/sitemap.xml', src.url + '/sitemap_index.xml');
  await enqueue(src.id, [...maps.slice(0, 10).map((url) => ({ url, kind: 'sitemap', depth: 0 })), { url: src.url + '/', kind: 'page', depth: 0 }]);
  // every day: sitemaps, the home page, category pages and popular lists are read again → new arrivals, new ranks
  await q(`UPDATE research_queue SET checked_at=NULL, fails=0 WHERE source_id=$1 AND (kind IN ('sitemap','rank') OR (depth=0 AND is_product IS NOT TRUE))`, [src.id]);
  await q('UPDATE research_sources SET seeded_at=now() WHERE id=$1', [src.id]);
}

async function currentRank(srcId, url) {
  const r = await one('SELECT rank_hint FROM research_queue WHERE source_id=$1 AND url=$2', [srcId, url]);
  return r ? r.rank_hint : null;
}
async function readSite(src, started) {
  const until = started + 10500;
  if (!src.seeded_at || Date.now() - new Date(src.seeded_at).getTime() > 20 * 3600 * 1000) await seedSite(src);
  const batch = await q(`SELECT * FROM research_queue WHERE source_id=$1 AND fails < 3 AND (
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
  const lastErr = [];
  const work = async (row) => {
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
          const rows = [];
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
            price: num(it.price), regular_price: it.old_price && it.old_price > it.price ? num(it.old_price) : null,
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
      const add = prod.slice(0, 300).map((l, i) => ({ url: l.url, kind: 'page', depth: row.depth + 1, pos: i + 1 }));
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
    } catch (e) {
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
async function tick({ force = false } = {}) {
  const started = Date.now();
  if (!force) {
    const last = await one(`SELECT value FROM settings WHERE key='research_tick_at'`);
    if (last && Date.now() - Number(last.value) < 50 * 1000) return { skipped: true };
  }
  await q(`INSERT INTO settings(key, value) VALUES('research_tick_at', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(Date.now())]);
  const src = await one(`SELECT * FROM research_sources WHERE active AND (last_run IS NULL
      OR last_run < now() - make_interval(mins => CASE WHEN kind='site' THEN $2::int ELSE $1::int END))
    ORDER BY last_run NULLS FIRST LIMIT 1`, [force ? 0 : REFRESH_MIN, force ? 0 : SITE_REFRESH_MIN]);
  if (!src) return { idle: true };
  await q('UPDATE research_sources SET last_run=now() WHERE id=$1', [src.id]);
  try {
    if (src.kind === 'site') {
      const r = await readSite(src, started);
      const total = await one(`SELECT count(*)::int AS n FROM research_items WHERE source_id=$1 AND last_seen > now() - interval '12 days'`, [src.id]);
      await q(`UPDATE research_sources SET last_ok=CASE WHEN $3 > 0 THEN now() ELSE last_ok END, last_error='', items=$2 WHERE id=$1`, [src.id, total.n, r.pages - r.failed]);
      return { source: src.name, items: r.n, pages: r.pages };
    }
    const n = src.kind === 'woo' ? await readWoo(src, started) : await readShopify(src, started);
    await q(`UPDATE research_sources SET last_ok=now(), last_error='', items=$2 WHERE id=$1`, [src.id, n]);
    return { source: src.name, items: n };
  } catch (e) {
    await q('UPDATE research_sources SET last_error=$2 WHERE id=$1', [src.id, String(e.message || e).slice(0, 300)]);
    return { source: src.name, error: e.message };
  }
}

// ---------------------------------------------------------------- this shop's own signals
async function demand(days = 30) {
  const searches = await q(`SELECT lower(trim(label)) AS term, count(*)::int AS times, count(DISTINCT visitor_id)::int AS people, max(created_at) AS last
    FROM visit_events WHERE event='search' AND label <> '' AND created_at > now() - make_interval(days => $1::int)
    GROUP BY 1 ORDER BY times DESC LIMIT 40`, [days]);
  for (const s of searches) {
    s.found = (await one(`SELECT count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.active AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.short_description ILIKE $1 OR c.name ILIKE $1 OR p.brand ILIKE $1)`, [`%${s.term}%`])).n;
  }
  const viewed = await q(`SELECT p.id, p.name, p.price, p.image_id, p.stock, v.views, v.people,
      coalesce((SELECT sum(i.qty)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND o.created_at > now() - make_interval(days => $1::int) AND o.status NOT IN ('cancelled')), 0) AS sold
    FROM (SELECT product_id, count(*)::int AS views, count(DISTINCT visitor_id)::int AS people FROM page_views
          WHERE product_id IS NOT NULL AND created_at > now() - make_interval(days => $1::int) GROUP BY product_id) v
    JOIN products p ON p.id=v.product_id ORDER BY v.views DESC LIMIT 25`, [days]);
  return { searches, viewed };
}

// ---------------------------------------------------------------- scoring
const pairsOf = (name) => dupes.prepName(name);
function dice(a, b) {
  if (!a.pairs.n || !b.pairs.n) return 0;
  let both = 0;
  const [small, big] = a.pairs.m.size < b.pairs.m.size ? [a.pairs.m, b.pairs.m] : [b.pairs.m, a.pairs.m];
  for (const [k, c] of small) { const d = big.get(k); if (d) both += Math.min(c, d); }
  return (2 * both) / (a.pairs.n + b.pairs.n);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
function niceDown(n) { if (!n) return null; if (n < 60) return Math.floor(n); if (n < 200) return Math.floor(n / 5) * 5; if (n < 2000) return Math.floor(n / 10) * 10 - (n >= 100 ? 0 : 0); return Math.floor(n / 50) * 50; }
function searchText(title) { return dupes.words(title).filter((w) => !/^\d+$/.test(w)).slice(0, 6).join(' ') || title.slice(0, 50); }

async function winners({ segment = '', limit = 60, margin = 30, mine = null } = {}) {
  const rows = await q(`SELECT i.*, s.name AS shop, s.segment, s.kind, s.created_at AS source_since
    FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND ${FRESH} ${segment ? 'AND s.segment=$1' : ''}`, segment ? [segment] : []);
  const { searches } = await demand(30);
  const terms = searches.map((s) => ({ ...s, prep: pairsOf(s.term) }));
  const now = Date.now();
  // 1) each item on its own
  for (const r of rows) {
    let s = 0;
    const why = [];
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
  const groups = [];
  for (const r of sorted) {
    let g = null;
    for (const x of groups) { if (x.seg === r.segment && dice(x.lead.prep, r.prep) >= 0.78) { g = x; break; } }
    if (g) g.items.push(r); else groups.push({ lead: r, seg: r.segment, items: [r] });
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
    g.sell = niceDown(g.median * 0.98);
    g.buyMax = g.sell ? Math.floor(g.sell * (1 - margin / 100)) : null;
    g.term = searchText(g.lead.title);
    g.best = g.items.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b));
  }
  groups.sort((a, b) => b.score - a.score);
  const top = groups.slice(0, limit);
  // 3) do we already sell it?
  const ours = mine || await q('SELECT id, name, price, cost_price, active FROM products');
  const oursPrep = ours.map((p) => ({ ...p, prep: pairsOf(p.name) }));
  for (const g of top) {
    let best = null;
    let bs = 0;
    for (const p of oursPrep) { const d = dice(g.lead.prep, p.prep); if (d > bs) { bs = d; best = p; } }
    g.ours = bs >= 0.72 ? best : null;
  }
  return top;
}

async function newInMarket({ segment = '', limit = 30 } = {}) {
  return q(`SELECT i.*, s.name AS shop, s.segment FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.first_seen > now() - interval '7 days'
      AND i.first_seen > s.created_at + CASE WHEN s.kind='site' THEN interval '10 days' ELSE interval '1 day' END ${segment ? 'AND s.segment=$2' : ''}
    ORDER BY i.first_seen DESC LIMIT $1`, segment ? [limit, segment] : [limit]);
}
async function priceDrops({ limit = 20 } = {}) {
  return q(`SELECT i.*, s.name AS shop FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.prev_price IS NOT NULL AND i.price < i.prev_price AND i.price_changed_at > now() - interval '7 days'
    ORDER BY (i.prev_price - i.price) / nullif(i.prev_price, 0) DESC LIMIT $1`, [limit]);
}
async function status() {
  return one(`SELECT (SELECT count(*)::int FROM research_sources WHERE active) AS sources,
    (SELECT count(*)::int FROM research_items i JOIN research_sources s ON s.id=i.source_id WHERE ${FRESH}) AS items,
    (SELECT max(last_ok) FROM research_sources) AS last_ok`);
}

function sourcingLinks(term) {
  const e = encodeURIComponent(term);
  return [
    ['1688 (চীনের পাইকারি)', `https://s.1688.com/selloffer/offer_search.htm?keywords=${e}`],
    ['Alibaba', `https://www.alibaba.com/trade/search?SearchText=${e}`],
    ['AliExpress', `https://www.aliexpress.com/wholesale?SearchText=${e}`],
    ['Daraz', `https://www.daraz.com.bd/catalog/?q=${e}`],
    ['Google', `https://www.google.com/search?q=${encodeURIComponent(term + ' wholesale price Bangladesh')}`],
  ];
}

module.exports = { SEGMENTS, listSources, addSource, detect, tick, setFetch, readSitemap, pageLinks, productish, demand, winners, newInMarket, priceDrops, status, sourcingLinks, robotsRules, robotsAllow };

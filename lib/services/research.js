'use strict';
// Market research (মার্কেট রিসার্চ) — owner only, never shown on the shop.
//
// What it does, around the clock (every hour from GitHub, once a day from Vercel, and whenever the
// owner has the research page open):
//   1. Reads the public product lists of other Bangladeshi shops (WooCommerce / Shopify) —
//      only what those shops allow robots to read (robots.txt is respected).
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

const SEGMENTS = { electronics: 'ইলেকট্রনিক্স', electrical: 'ইলেকট্রিক্যাল', fashion: 'ফ্যাশন', other: 'অন্যান্য' };
const UA_NAME = 'shobmilbeimporter';
const RANK_PAGES = 3; // WooCommerce: top 300 most popular per shop
const SHOPIFY_PAGES = 4;
const REFRESH_MIN = 50; // each shop is read again after this many minutes

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
      const r = await safeFetch(host + '/robots.txt', { maxBytes: 300 * 1024, timeoutMs: 6000, accept: 'text/plain,*/*' });
      if (r.ok) text = r.body.toString('utf8');
      else if (r.status === 401 || r.status === 403) text = 'User-agent: *\nDisallow: /';
    } catch (_) { text = ''; }
    await q(`INSERT INTO research_hosts(host, robots, fetched_at) VALUES($1,$2,now()) ON CONFLICT (host) DO UPDATE SET robots=EXCLUDED.robots, fetched_at=now()`, [host, text]);
    row = { robots: text };
  }
  return robotsAllow(robotsRules(row.robots), u.pathname + u.search);
}

async function getJson(url) {
  if (!(await allowed(url))) { const e = new Error('এই দোকান রোবটকে এই তথ্য পড়তে দেয় না (robots.txt)।'); e.code = 'ROBOTS'; throw e; }
  const r = await safeFetch(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 9000, accept: 'application/json' });
  if (!r.ok) { const e = new Error(`দোকান উত্তর দিয়েছে ${r.status}`); e.code = 'HTTP'; throw e; }
  try { return JSON.parse(r.body.toString('utf8')); } catch (_) { const e = new Error('দোকানের তথ্য পড়া যায়নি'); e.code = 'JSON'; throw e; }
}

// ---------------------------------------------------------------- sources
async function listSources() {
  return q(`SELECT s.*, (SELECT count(*)::int FROM research_items i WHERE i.source_id=s.id AND i.last_seen > now() - interval '3 days') AS live_items
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
  throw new Error('এই দোকানের পণ্যের তালিকা স্বয়ংক্রিয়ভাবে পড়া যায় না (শুধু WooCommerce বা Shopify দিয়ে বানানো দোকান পড়া যায়)।');
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

// One step of the round-the-clock work: read the shop that was read longest ago.
async function tick({ force = false } = {}) {
  const started = Date.now();
  if (!force) {
    const last = await one(`SELECT value FROM settings WHERE key='research_tick_at'`);
    if (last && Date.now() - Number(last.value) < 90 * 1000) return { skipped: true };
  }
  await q(`INSERT INTO settings(key, value) VALUES('research_tick_at', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(Date.now())]);
  const src = await one(`SELECT * FROM research_sources WHERE active AND (last_run IS NULL OR last_run < now() - make_interval(mins => $1::int))
    ORDER BY last_run NULLS FIRST LIMIT 1`, [force ? 0 : REFRESH_MIN]);
  if (!src) return { idle: true };
  await q('UPDATE research_sources SET last_run=now() WHERE id=$1', [src.id]);
  try {
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
function niceDown(n) { if (!n) return null; if (n < 20) return Math.floor(n); if (n < 200) return Math.floor(n / 5) * 5; if (n < 2000) return Math.floor(n / 10) * 10 - (n >= 100 ? 0 : 0); return Math.floor(n / 50) * 50; }
function searchText(title) { return dupes.words(title).filter((w) => !/^\d+$/.test(w)).slice(0, 6).join(' ') || title.slice(0, 50); }

async function winners({ segment = '', limit = 60, margin = 30, mine = null } = {}) {
  const rows = await q(`SELECT i.*, s.name AS shop, s.segment, s.kind, s.created_at AS source_since
    FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.last_seen > now() - interval '3 days' ${segment ? 'AND s.segment=$1' : ''}`, segment ? [segment] : []);
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
    if (ageDays <= 14 && sinceSource > 1) { s += 8; why.push('বাজারে নতুন এসেছে'); }
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
    WHERE s.active AND i.first_seen > now() - interval '7 days' AND i.first_seen > s.created_at + interval '1 day' ${segment ? 'AND s.segment=$2' : ''}
    ORDER BY i.first_seen DESC LIMIT $1`, segment ? [limit, segment] : [limit]);
}
async function priceDrops({ limit = 20 } = {}) {
  return q(`SELECT i.*, s.name AS shop FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.prev_price IS NOT NULL AND i.price < i.prev_price AND i.price_changed_at > now() - interval '7 days'
    ORDER BY (i.prev_price - i.price) / nullif(i.prev_price, 0) DESC LIMIT $1`, [limit]);
}
async function status() {
  return one(`SELECT (SELECT count(*)::int FROM research_sources WHERE active) AS sources,
    (SELECT count(*)::int FROM research_items WHERE last_seen > now() - interval '3 days') AS items,
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

module.exports = { SEGMENTS, listSources, addSource, detect, tick, demand, winners, newInMarket, priceDrops, status, sourcingLinks, robotsRules, robotsAllow };

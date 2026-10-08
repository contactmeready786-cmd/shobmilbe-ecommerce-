'use strict';
// More pictures from the old site (পুরোনো সাইট থেকে আরও ছবি).
// Products came over from the old shop's Facebook feed with one picture each. Each product's
// own page on the old site often shows more pictures; this copies them in — only that
// product's own pictures, never another product's:
//   • the product is matched by its import mark (the same id it had in the feed)
//   • its old page link comes from that same feed row
//   • on the page, only pictures from the main picture's own folder are taken
//     (or, where every product shares one folder, only the pictures the page lists for it)
//   • a page that doesn't show this product's main picture is never used
//   • a picture the product already has (same photo, any size) is never added twice
// Nothing is removed: the main picture stays first, new ones go after it.
//
// The browser drives the work one product at a time (live progress, no server time limit):
//   1. POST /admin/api/morepics/plan   — read the feed → which shop products can get pictures
//   2. POST /admin/api/morepics/find   — read one old product page → its extra picture links
//   3. GET  /admin/api/import/image    — (existing) bring each picture safely; the browser
//                                         resizes + fingerprints + uploads it
//   4. POST /admin/api/morepics/attach — add the uploaded pictures to the product (no repeats)
const { html, int, str } = require('../util');
const catalog = require('../models/catalog');
const { hamming } = require('../models/duplicates');
const security = require('../security');
const db = require('../db');
const ui = require('./ui');
const importer = require('../services/importer');
const { safeFetch, FetchError } = require('../services/safefetch');
const { readUrl } = require('./import');

const SAME_PHOTO = 24; // fingerprint distance: same photo ≈ 0-30, different photo ≈ 80+

async function page(ctx) {
  const s = ctx.settings;
  const counts = await db.one(`SELECT count(*)::int AS imported,
      count(*) FILTER (WHERE (SELECT count(*) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id) <= 1)::int AS one_pic
    FROM products p WHERE p.import_ref <> ''`);
  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>📸 পুরোনো সাইট থেকে আরও ছবি</h1>
${ui.flash(ctx.flash)}
<p class="muted">পুরোনো সাইট থেকে আনা প্রতিটা পণ্যের <b>নিজের পেজ</b> খুলে সেখানে যতগুলো ছবি আছে, সেগুলো এই দোকানের ওই পণ্যেই বসিয়ে দেবে।
শুধু <b>সেই পণ্যেরই আসল ছবি</b> নেওয়া হয় — অন্য পণ্যের ছবি (যেমন "সম্পর্কিত পণ্য") কখনো আসবে না। মূল ছবি যেমন আছে তেমনই প্রথমে থাকবে, নতুন ছবি তার পরে বসবে। একই ছবি দুইবার বসবে না।</p>
<div class="kpis">
  ${ui.kpi('পুরোনো সাইট থেকে আনা পণ্য', ui.bn(counts.imported))}
  ${ui.kpi('এখনো ১টা বা ০টা ছবি', ui.bn(counts.one_pic))}
</div>

<div data-morepics>
<section class="panel" data-mp-step="1">
  <h2>ধাপ ১ — পুরোনো সাইটের ফিড লিংক</h2>
  ${ui.field('Facebook ফিড লিংক (যেটা দিয়ে পণ্য আমদানি করেছিলেন)', ui.input('mp_feed', s.morepics_feed || '', { type: 'url', placeholder: 'https://…', 'data-mp-feed': true, autocomplete: 'off' }),
    'একবার দিলে মনে রাখবে, পরের বার আবার লিখতে হবে না।')}
  <div class="field-row">
    ${ui.field('প্রতিটা পণ্যে মোট সর্বোচ্চ কয়টা ছবি', ui.select('mp_max', [['6', '৬টা (পুরোনো সাইটে যতগুলো আছে, সর্বোচ্চ ৬)'], ['5', '৫টা'], ['4', '৪টা'], ['3', '৩টা']], '6', { 'data-mp-max': true }))}
  </div>
  <button type="button" class="btn" data-mp-plan>পণ্যগুলো খুঁজুন</button>
  <p class="imp-status" data-mp-status hidden></p>
</section>

<section class="panel" data-mp-step="2" hidden>
  <h2>ধাপ ২ — ছবি আনা <small data-mp-found></small></h2>
  <p class="imp-warn" data-mp-warn>⏳ কাজ চলার সময় এই পেজটা বন্ধ করবেন না। মাঝপথে বন্ধ হলে আবার চালালে আগে বসানো ছবি বাদ দিয়ে বাকিটা করবে।</p>
  <div class="imp-bar"><span data-mp-bar></span></div>
  <p class="imp-count" data-mp-count></p>
  <div class="imp-kpis">
    <div class="kpi kpi-green"><span class="kpi-label">ছবি যোগ হয়েছে (পণ্যে)</span><b class="kpi-value" data-mp-k="done">০</b></div>
    <div class="kpi kpi-blue"><span class="kpi-label">মোট নতুন ছবি</span><b class="kpi-value" data-mp-k="pics">০</b></div>
    <div class="kpi"><span class="kpi-label">নতুন ছবি নেই (পুরোনো পেজেও নেই)</span><b class="kpi-value" data-mp-k="none">০</b></div>
    <div class="kpi kpi-red"><span class="kpi-label">পেজ পড়া যায়নি</span><b class="kpi-value" data-mp-k="error">০</b></div>
  </div>
  <div class="form-actions">
    <button type="button" class="btn btn-lg" data-mp-start>📸 ছবি আনা শুরু করুন</button>
    <button type="button" class="btn btn-ghost" data-mp-pause hidden>⏸ থামান</button>
    <a class="btn" href="/admin/products" data-mp-done hidden>সব পণ্য দেখুন</a>
  </div>
  <h3 data-mp-log-title hidden>বিস্তারিত</h3>
  <ul class="dup-list imp-log" data-mp-log></ul>
</section>

<section class="panel">
  <h2>🔍 একটা পণ্য দিয়ে পরীক্ষা</h2>
  <p class="small muted">পুরোনো সাইটের যেকোনো একটা পণ্যের পেজের লিংক দিন — কোন কোন ছবি পাওয়া যায় দেখাবে (কিছু সেভ হবে না)।</p>
  ${ui.field('পণ্যের পেজের লিংক', ui.input('mp_test', '', { type: 'url', placeholder: 'https://oldshop.com/products/…', 'data-mp-test-url': true, autocomplete: 'off' }))}
  <button type="button" class="btn btn-ghost" data-mp-test>দেখুন</button>
  <div class="mp-test" data-mp-test-out></div>
</section>
</div>`;
  return ctx.page('পুরোনো সাইট থেকে আরও ছবি', body, 'more-pics');
}

// ---------------------------------------------------------------- 1. which products
async function planApi(ctx) {
  if (!(await security.hit(db, 'mpplan:' + ctx.user.id, 60, 3600))) return ctx.json(ctx.res, 429, { error: 'এক ঘণ্টায় অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।' });
  const b = await ctx.body();
  let u = str(b.url, 2000);
  if (!u) return ctx.json(ctx.res, 400, { error: 'ফিড লিংক দিন।' });
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const max = Math.min(catalog.MAX_PRODUCT_IMAGES, Math.max(2, int(b.max, catalog.MAX_PRODUCT_IMAGES)));
  let out;
  try {
    out = await readUrl(u, { follow: false });
  } catch (e) {
    return ctx.json(ctx.res, 400, { error: e instanceof FetchError ? e.message : 'লিংকটা পড়া যায়নি।' });
  }
  if (out.error) return ctx.json(ctx.res, 400, { error: out.error });
  const items = importer.finish(out.items || [], out.finalUrl || u).filter((it) => it.link);
  if (!items.length) return ctx.json(ctx.res, 400, { error: 'এই লিংকে কোনো পণ্য (পেজের লিংকসহ) পাওয়া যায়নি। যে Facebook ফিড লিংক দিয়ে আমদানি করেছিলেন সেটাই দিন।' });
  await db.setMany({ morepics_feed: u });
  await ctx.reloadSettings();

  const byRef = new Map(items.map((it) => [it.ref, it]));
  const rows = await db.q(`SELECT p.id, p.name, p.sku, p.import_ref, p.image_id,
      (SELECT count(*)::int FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id) AS pics
    FROM products p WHERE p.import_ref = ANY($1::text[]) ORDER BY p.id`, [[...byRef.keys()]]);
  const list = [];
  let full = 0;
  for (const r of rows) {
    const it = byRef.get(r.import_ref);
    if (r.pics >= max) { full++; continue; }
    list.push({ id: r.id, name: r.name, sku: r.sku, link: it.link, main: (it.images || [])[0] || '', pics: r.pics, thumb: r.image_id ? `/media/${r.image_id}/t` : '' });
  }
  return ctx.json(ctx.res, 200, { feedItems: items.length, matched: rows.length, full, notInShop: items.length - rows.length, products: list, max });
}

// ---------------------------------------------------------------- 2. one old product page
async function findApi(ctx) {
  if (!(await security.hit(db, 'mpfind:' + ctx.user.id, 3000, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেক বেশি পেজ পড়া হয়েছে, একটু পরে চেষ্টা করুন।' });
  const b = await ctx.body();
  let link = str(b.link, 2000);
  if (!link) return ctx.json(ctx.res, 400, { error: 'লিংক দিন।' });
  if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
  const main = str(b.main, 2000);
  try {
    const r = await safeFetch(link, { maxBytes: 6 * 1024 * 1024, timeoutMs: 12000, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
    if (!r.ok) return ctx.json(ctx.res, 200, { images: [], error: r.status === 404 ? 'পেজটি আর নেই (404)' : `পেজ খোলেনি (${r.status})` });
    const text = r.body.toString('utf8');
    const g = importer.galleryImages(text, r.finalUrl, main);
    return ctx.json(ctx.res, 200, { images: g.images, rule: g.rule, confirmed: g.confirmed,
      note: g.confirmed ? '' : 'এই পেজে পণ্যটির মূল ছবি নেই — অন্য পেজ মনে হচ্ছে, তাই কিছু নেওয়া হয়নি' });
  } catch (e) {
    return ctx.json(ctx.res, 200, { images: [], error: e instanceof FetchError ? e.message : 'পেজ পড়া যায়নি' });
  }
}

// ---------------------------------------------------------------- 3. add to the product
async function attachApi(ctx) {
  const b = await ctx.body();
  const pid = int(b.product_id);
  const max = Math.min(catalog.MAX_PRODUCT_IMAGES, Math.max(2, int(b.max, catalog.MAX_PRODUCT_IMAGES)));
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => int(x)).filter((x) => x > 0).slice(0, 20);
  const p = await db.one('SELECT id, name FROM products WHERE id=$1', [pid]);
  if (!p) return ctx.json(ctx.res, 404, { error: 'পণ্যটি পাওয়া যায়নি' });
  const result = await db.tx(async (t) => {
    // lock the product so two runs never add the same picture at the same moment
    await t.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [pid]);
    const have = (await t.query(`SELECT id, sha, phash, phash_m, sort FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id`, [pid])).rows;
    // only fresh uploads that belong to nobody yet
    const fresh = ids.length ? (await t.query(`SELECT id, sha, phash, phash_m FROM media WHERE id = ANY($1::int[]) AND owner_type IS NULL`, [ids])).rows : [];
    const byId = new Map(fresh.map((m) => [m.id, m]));
    const same = (a, x) => {
      if (a.sha && x.sha && a.sha === x.sha) return true;
      const ok = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
      if (!ok(a.phash) || !ok(x.phash)) return false;
      return hamming(a.phash, x.phash) <= SAME_PHOTO || (ok(a.phash_m) && hamming(a.phash_m, x.phash) <= SAME_PHOTO);
    };
    const kept = [...have];
    let sort = have.reduce((m, x) => Math.max(m, x.sort || 0), -1) + 1;
    let added = 0, repeat = 0;
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) continue;
      if (kept.length >= max) break;
      if (kept.some((k) => same(m, k))) { repeat++; continue; }
      await t.query(`UPDATE media SET owner_type='product', owner_id=$1, sort=$2 WHERE id=$3 AND owner_type IS NULL`, [pid, sort++, id]);
      kept.push(m); added++;
    }
    if (added) await t.query(`UPDATE products SET image_id=COALESCE(image_id, (SELECT id FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id LIMIT 1)), updated_at=now() WHERE id=$1`, [pid]);
    // pictures not used are left without an owner and are cleared away automatically within a day
    return { added, repeat, total: kept.length };
  });
  if (result.added) await ctx.log('product_edit', 'product', pid, `পুরোনো সাইট থেকে ${result.added}টি ছবি যোগ: ${p.name.slice(0, 80)}`);
  return ctx.json(ctx.res, 200, result);
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/products/more-photos', perm: 'products', handler: page },
    { method: 'POST', path: '/admin/api/morepics/plan', perm: 'products', handler: planApi },
    { method: 'POST', path: '/admin/api/morepics/find', perm: 'products', handler: findApi },
    { method: 'POST', path: '/admin/api/morepics/attach', perm: 'products', handler: attachApi },
  ],
};

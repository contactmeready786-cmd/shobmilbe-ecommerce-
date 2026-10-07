'use strict';
// Product import (পণ্য আমদানি): copy products from another website, a product feed link,
// or a CSV / Excel file into this shop — every product goes through the duplicate guard,
// gets the next automatic SKU, and its pictures are copied here (resized + fingerprinted).
//
// The browser drives the work one product at a time, so even 500+ products never hit the
// server's time limit, and the admin sees live progress:
//   1. POST /admin/api/import/read   — read a link or a file → list of products (nothing saved yet)
//   2. GET  /admin/api/import/image  — bring one picture from the other site (safely) so the
//                                       browser can resize it and make its fingerprint, then upload it
//   3. POST /admin/api/import/save   — duplicate check + save one product
const { html, int, str, amount, csv, youtubeId } = require('../util');
const catalog = require('../models/catalog');
const dupes = require('../models/duplicates');
const security = require('../security');
const db = require('../db');
const ui = require('./ui');
const importer = require('../services/importer');
const { safeFetch, FetchError } = require('../services/safefetch');

const FILE_MAX = 3 * 1024 * 1024; // what fits in one request

// ---------------------------------------------------------------- page
async function page(ctx) {
  const categories = await catalog.listCategories();
  const may = ctx.can('dup_override');
  const guard = ctx.settings.dup_guard !== '0';
  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<div class="title-row"><h1>📥 পণ্য আমদানি <small>অন্য জায়গা থেকে পণ্যের তথ্য কপি করে আনুন</small></h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/products/import/template.csv">⬇️ খালি নমুনা ফাইল (Excel/CSV)</a></div>
</div>
<p class="muted">পুরোনো ওয়েবসাইট, Facebook/Google প্রোডাক্ট ফিড লিংক, অথবা CSV / Excel ফাইল থেকে পণ্যের <b>নাম, ব্র্যান্ড, ছবি, দাম</b>, বিবরণ, স্টক — সব একসাথে এই দোকানে চলে আসবে।
প্রতিটা পণ্য আসার আগে <b>ডুপ্লিকেট যাচাই</b> হবে, আর প্রতিটা পণ্য নিজে থেকে <b>SKU নম্বর</b> (১, ২, ৩…) পাবে।</p>
${guard ? '' : html`<p class="flash flash-error">⚠️ ডুপ্লিকেট যাচাই এখন বন্ধ আছে — একই পণ্য দুইবার চলে আসতে পারে। <a href="/admin/products/duplicates">চালু করুন</a></p>`}

<div data-import data-can-override="${may ? '1' : ''}">
<section class="panel" data-imp-step="1">
  <h2>ধাপ ১ — কোথা থেকে আনবেন?</h2>
  <div class="imp-tabs" role="tablist">
    <button type="button" class="imp-tab on" data-imp-tab="link">🔗 লিংক দিয়ে</button>
    <button type="button" class="imp-tab" data-imp-tab="file">📄 ফাইল দিয়ে (CSV / Excel)</button>
    <button type="button" class="imp-tab" data-imp-tab="many">📋 অনেকগুলো পণ্যের লিংক</button>
  </div>

  <div class="imp-pane" data-imp-pane="link">
    ${ui.field('লিংক', ui.input('imp_url', '', { type: 'url', placeholder: 'https://… (Facebook ফিড লিংক / পুরোনো সাইটের লিংক / একটা পণ্যের পেজ)', 'data-imp-url': true, autocomplete: 'off' }))}
    <ul class="small muted imp-hints">
      <li><b>Facebook / Google প্রোডাক্ট ফিড লিংক</b> (সবচেয়ে ভালো) — পুরোনো সাইটের সব পণ্য একবারে আসবে।</li>
      <li><b>একটা পণ্যের পেজের লিংক</b> — শুধু সেই পণ্যটা আসবে।</li>
      <li><b>ক্যাটাগরি / শপ পেজ, sitemap.xml বা দোকানের হোমপেজ</b> — সেখানে যত পণ্যের লিংক পাওয়া যাবে, একে একে সব পণ্য পড়া হবে।</li>
    </ul>
    <button type="button" class="btn" data-imp-read="link">পণ্য খুঁজুন</button>
  </div>

  <div class="imp-pane" data-imp-pane="file" hidden>
    <label class="imp-drop" data-imp-drop>
      <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xml,.json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden data-imp-file>
      <span class="imp-drop-icon">📄</span>
      <b>ফাইল বাছুন বা এখানে টেনে আনুন</b>
      <span class="small muted">CSV, Excel (.xlsx), TSV, XML ফিড বা JSON — সর্বোচ্চ ৩ MB</span>
      <span class="small" data-imp-filename></span>
    </label>
    <p class="small muted">কলামের নাম ইংরেজি বা বাংলা যেকোনোটা হতে পারে — যেমন <b>title / name / পণ্যের নাম</b>, <b>price / দাম</b>, <b>image_link / ছবি</b>, <b>brand / ব্র্যান্ড</b>। WooCommerce, Shopify, Facebook ক্যাটালগের এক্সপোর্ট ফাইল সরাসরি দেওয়া যাবে। নিজে বানাতে চাইলে উপরের "খালি নমুনা ফাইল" নামিয়ে Excel-এ ভরুন।</p>
    <button type="button" class="btn" data-imp-read="file" disabled>ফাইল পড়ুন</button>
  </div>

  <div class="imp-pane" data-imp-pane="many" hidden>
    ${ui.field('প্রতি লাইনে একটা পণ্যের লিংক', ui.textarea('imp_links', '', { rows: 6, placeholder: 'https://oldshop.com/product/abc\nhttps://oldshop.com/product/xyz', 'data-imp-links': true }))}
    <button type="button" class="btn" data-imp-read="many">পণ্য খুঁজুন</button>
  </div>
  <p class="imp-status" data-imp-read-status hidden></p>
</section>

<section class="panel" data-imp-step="2" hidden>
  <h2>ধাপ ২ — যা পাওয়া গেল <small data-imp-found></small></h2>
  <div data-imp-notes></div>
  <div class="imp-check" data-imp-check></div>
  <div class="table-wrap imp-preview"><table class="table">
    <thead><tr><th></th><th>পণ্য</th><th>ব্র্যান্ড</th><th class="num">দাম</th><th class="num">ছবি</th><th>ক্যাটাগরি</th><th class="num">স্টক</th><th>অবস্থা</th></tr></thead>
    <tbody data-imp-rows></tbody>
  </table></div>
  <p class="small muted" data-imp-more></p>

  <h2>আমদানির নিয়ম</h2>
  <div class="form imp-options">
    <div class="field-row">
      ${ui.field('ক্যাটাগরি', ui.select('imp_cat_mode', [['auto', 'স্বয়ংক্রিয় — পণ্যের নাম দেখে ঠিক সাব-ক্যাটাগরিতে (প্রস্তাবিত)'], ['match', 'ফাইল/সাইটের ক্যাটাগরির নাম মিলিয়ে বসান'], ['one', 'সব পণ্য নিচের একটা ক্যাটাগরিতে'], ['none', 'ক্যাটাগরি ছাড়া']], 'auto', { 'data-imp-opt': 'cat_mode' }),
    'স্বয়ংক্রিয় হলে নাম চেনা না গেলে ফাইলের ক্যাটাগরি, তারপর পাশের ক্যাটাগরি নেওয়া হবে।')}
      ${ui.field('না মিললে / একটা ক্যাটাগরি', ui.select('imp_cat_id', [['', 'কোনোটি না'], ...ui.catOpts(categories)], '', { 'data-imp-opt': 'category_id' }))}
    </div>
    ${ui.check('imp_create_cat', false, 'ক্যাটাগরির নাম না মিললে সেই নামে নতুন ক্যাটাগরি তৈরি করুন')}
    <div class="field-row">
      ${ui.field('স্টকের সংখ্যা না থাকলে কয়টা ধরবেন', ui.input('imp_stock', 10, { type: 'number', min: 0, 'data-imp-opt': 'default_stock' }), '"স্টকে নেই" লেখা পণ্য ০ ধরা হবে।')}
      ${ui.field('আগে একবার আনা পণ্য আবার পেলে', ui.select('imp_existing', [['skip', 'বাদ দিন (আবার আনবে না)'], ['update', 'দাম ও স্টক আপডেট করুন']], 'skip', { 'data-imp-opt': 'existing' }))}
    </div>
    ${ui.check('imp_active', true, 'আমদানি করা পণ্য সাথে সাথে দোকানে দেখাও')}
    ${ui.check('imp_hide_noimg', true, 'ছবি নেই এমন পণ্য লুকিয়ে রাখুন (পরে ছবি দিয়ে দেখাতে পারবেন)')}
  </div>
  <div class="form-actions">
    <button type="button" class="btn btn-lg" data-imp-start>📥 আমদানি শুরু করুন</button>
    <button type="button" class="btn btn-ghost" data-imp-reset>আবার শুরু থেকে</button>
  </div>
</section>

<section class="panel" data-imp-step="3" hidden>
  <h2>ধাপ ৩ — আমদানি হচ্ছে</h2>
  <p class="imp-warn" data-imp-warn>⏳ কাজ চলার সময় এই পেজটা বন্ধ করবেন না। মাঝপথে বন্ধ হয়ে গেলে আবার একই লিংক/ফাইল দিন — আগে আনা পণ্যগুলো বাদ দিয়ে বাকিগুলো আনবে।</p>
  <div class="imp-bar"><span data-imp-bar></span></div>
  <p class="imp-count" data-imp-count></p>
  <div class="imp-kpis">
    <div class="kpi kpi-green"><span class="kpi-label">নতুন যোগ হয়েছে</span><b class="kpi-value" data-imp-k="added">০</b></div>
    <div class="kpi kpi-blue"><span class="kpi-label">আপডেট হয়েছে</span><b class="kpi-value" data-imp-k="updated">০</b></div>
    <div class="kpi"><span class="kpi-label">আগেই আছে — বাদ</span><b class="kpi-value" data-imp-k="exists">০</b></div>
    <div class="kpi kpi-alert"><span class="kpi-label">ডুপ্লিকেট — আটকানো</span><b class="kpi-value" data-imp-k="duplicate">০</b></div>
    <div class="kpi kpi-red"><span class="kpi-label">সমস্যা</span><b class="kpi-value" data-imp-k="error">০</b></div>
  </div>
  <div class="form-actions">
    <button type="button" class="btn btn-ghost" data-imp-pause>⏸ থামান</button>
    <a class="btn" href="/admin/products" data-imp-done hidden>সব পণ্য দেখুন</a>
  </div>
  <h3 data-imp-log-title hidden>ডুপ্লিকেট আর সমস্যার তালিকা</h3>
  <ul class="dup-list imp-log" data-imp-log></ul>
</section>
</div>
${ui.helpBox('পুরোনো ওয়েবসাইটের ৫০০+ পণ্য কীভাবে আনবেন?', html`<ol class="steps-list">
  <li>পুরোনো সাইটের <b>Facebook প্রোডাক্ট ফিড লিংক</b>টা কপি করুন (যেটা Facebook ক্যাটালগে দেওয়া আছে)।</li>
  <li>উপরে "🔗 লিংক দিয়ে" ঘরে লিংকটা বসিয়ে <b>পণ্য খুঁজুন</b> চাপুন। কয়টা পণ্য পাওয়া গেল আর কোনগুলোতে নাম/দাম/ছবি নেই — সব দেখাবে।</li>
  <li>নিয়মগুলো দেখে <b>আমদানি শুরু করুন</b> চাপুন। প্রতিটা পণ্যের ছবি এই সাইটে কপি হবে, ছোট করা হবে, তারপর ডুপ্লিকেট যাচাই করে সেভ হবে।</li>
  <li>৫০০ পণ্যে সাধারণত ১৫-৩০ মিনিট লাগে (ইন্টারনেটের গতির উপর)। পেজটা খোলা রাখুন।</li>
  <li>শেষে "ডুপ্লিকেট" তালিকায় যেগুলো আটকেছে, সেগুলো সত্যিই আলাদা পণ্য হলে পাশের <b>"তবুও যোগ করুন"</b> চাপুন।</li>
</ol>
<p class="small muted">ফিড লিংক না থাকলে পুরোনো সাইটের হোমপেজ বা <b>/sitemap.xml</b> লিংক দিয়ে চেষ্টা করুন। কোনো সাইট নিজের পণ্য পড়তে না দিলে (লগইন লাগলে বা আটকে রাখলে) সেখান থেকে আনা যাবে না — তখন CSV/Excel ফাইল ব্যবহার করুন।</p>`)}`;
  return ctx.page('পণ্য আমদানি', body, 'product-import');
}

function template(ctx) {
  const rows = [importer.TEMPLATE_HEADER,
    ['', 'PAM8403 Mini Amplifier Board', 'Generic', '150', '120', '70', '25', 'সার্কিট', 'https://example.com/pam8403.jpg', 'https://example.com/pam8403-2.jpg, https://example.com/pam8403-3.jpg',
      '৫ ভোল্টের ছোট স্টেরিও অ্যামপ্লিফায়ার', 'বিস্তারিত বিবরণ এখানে লিখুন', '', '20 g']];
  return ctx.send(ctx.res, 200, csv(rows), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="product-import-template.csv"' });
}

// ---------------------------------------------------------------- 1. read
function nextPageUrl(u, count) {
  try {
    const url = new URL(u);
    if (/\/products\.json$/.test(url.pathname) && count >= int(url.searchParams.get('limit'), 30)) {
      url.searchParams.set('page', String(int(url.searchParams.get('page'), 1) + 1)); return url.toString();
    }
    if (/\/wp-json\/wc\/store(\/v1)?\/products$/.test(url.pathname) && count >= int(url.searchParams.get('per_page'), 10)) {
      url.searchParams.set('page', String(int(url.searchParams.get('page'), 1) + 1)); return url.toString();
    }
  } catch (_) { /* ignore */ }
  return null;
}
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,text/csv;q=0.8,*/*;q=0.5';

async function readUrl(u, { follow = true } = {}) {
  const r = await safeFetch(u, { maxBytes: 20 * 1024 * 1024, timeoutMs: follow ? 10000 : 9000, accept: PAGE_ACCEPT });
  if (!r.ok) {
    const why = r.status === 404 ? 'পেজটি পাওয়া যায়নি (404)' : r.status === 403 || r.status === 401 ? 'ওয়েবসাইটটি পড়তে দিচ্ছে না (অনুমতি নেই)' : `ওয়েবসাইট ভুল উত্তর দিয়েছে (${r.status})`;
    return { items: [], error: why + '।' };
  }
  const out = importer.parseContent(r.body, { contentType: r.contentType, baseUrl: r.finalUrl });
  out.finalUrl = r.finalUrl;
  if (out.items.length) {
    out.next = nextPageUrl(r.finalUrl, out.items.length);
    return out;
  }
  // A whole shop's home page: try the shop's own product list, then its sitemap.
  if (follow && out.format === 'html' && out.links.length < 2) {
    const origin = new URL(r.finalUrl).origin;
    const tries = out.shop === 'shopify' ? [`${origin}/products.json?limit=250&page=1`]
      : out.shop === 'woocommerce' ? [`${origin}/wp-json/wc/store/v1/products?per_page=100&page=1`]
        : [`${origin}/sitemap.xml`];
    for (const t of tries) {
      try {
        const sub = await readUrl(t, { follow: false });
        if (sub.items.length || (sub.links && sub.links.length)) return sub;
      } catch (_) { /* try next */ }
    }
  }
  return out;
}

async function readApi(ctx) {
  if (!(await security.hit(db, 'impread:' + ctx.user.id, 4000, 3600))) return ctx.json(ctx.res, 429, { error: 'এক ঘণ্টায় অনেক বেশি পড়া হয়েছে, একটু পরে চেষ্টা করুন।' });
  const b = await ctx.body();
  let out;
  let source = '';
  try {
    if (b.file && typeof b.file === 'object') {
      const name = str(b.file.name, 200);
      let buf;
      if (typeof b.file.base64 === 'string') buf = Buffer.from(b.file.base64, 'base64');
      else if (typeof b.file.text === 'string') buf = Buffer.from(b.file.text, 'utf8');
      if (!buf || !buf.length) return ctx.json(ctx.res, 400, { error: 'ফাইলটি খালি।' });
      if (buf.length > FILE_MAX) return ctx.json(ctx.res, 400, { error: 'ফাইলটি ৩ MB-এর বেশি বড়। দুই ভাগ করে দিন।' });
      out = importer.parseContent(buf, { name });
      source = '';
    } else {
      const u = str(b.url, 2000);
      if (!u) return ctx.json(ctx.res, 400, { error: 'লিংক দিন।' });
      out = await readUrl(/^https?:\/\//i.test(u) ? u : 'https://' + u, { follow: !b.single });
      source = out.finalUrl || u;
    }
  } catch (e) {
    return ctx.json(ctx.res, e instanceof FetchError ? 400 : 500, { error: e instanceof FetchError ? e.message : 'পড়তে গিয়ে সমস্যা হয়েছে।' });
  }
  if (out.error) return ctx.json(ctx.res, 400, { error: out.error });
  const items = importer.finish(out.items || [], source);
  // which of these were imported before
  const refs = items.map((i) => i.ref);
  if (refs.length) {
    const have = await db.q('SELECT id, name, sku, import_ref FROM products WHERE import_ref = ANY($1::text[])', [refs]);
    const map = new Map(have.map((h) => [h.import_ref, h]));
    for (const it of items) { const h = map.get(it.ref); if (h) it.exists = { id: h.id, name: h.name, sku: h.sku }; }
  }
  return ctx.json(ctx.res, 200, {
    format: out.format, items, links: out.links || [], next: out.next || null, notes: out.notes || [],
    columns: out.columns || [], unknownColumns: !!out.unknownColumns,
  });
}

// ---------------------------------------------------------------- 2. picture from the other site
async function imageApi(ctx) {
  if (!(await security.hit(db, 'impimg:' + ctx.user.id, 10000, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেক বেশি ছবি, একটু পরে চেষ্টা করুন।' });
  const u = str(ctx.query.get('u'), 2000);
  try {
    const r = await safeFetch(u, { maxBytes: 12 * 1024 * 1024, timeoutMs: 12000, accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.3' });
    if (!r.ok) return ctx.json(ctx.res, 400, { error: `ছবি পাওয়া যায়নি (${r.status})` });
    // The real first bytes decide: only true pictures pass, never scripts or pages.
    const mime = security.imageKind(r.body);
    if (!mime || mime === 'image/x-icon') return ctx.json(ctx.res, 400, { error: 'এটা ছবি না, বা এই ধরনের ছবি চলে না।' });
    return ctx.send(ctx.res, 200, r.body, mime, { 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  } catch (e) {
    return ctx.json(ctx.res, 400, { error: e instanceof FetchError ? e.message : 'ছবি আনা যায়নি।' });
  }
}

// ---------------------------------------------------------------- 3. save one product
function categoryFinder(categories) {
  const byName = new Map();
  for (const c of categories) {
    byName.set(String(c.name).toLowerCase().trim(), c.id);
    if (c.slug) byName.set(String(c.slug).toLowerCase(), c.id);
  }
  return (text) => {
    const first = String(text || '').split(/[,|;]/)[0];
    const parts = first.split(/>|»|\//).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const id = byName.get(parts[i].toLowerCase());
      if (id) return { id };
    }
    return { name: parts.length ? parts[parts.length - 1].slice(0, 60) : '' };
  };
}

async function saveApi(ctx) {
  if (!(await security.hit(db, 'impsave:' + ctx.user.id, 8000, 3600))) return ctx.json(ctx.res, 429, { error: 'এক ঘণ্টায় অনেক বেশি পণ্য, একটু পরে চেষ্টা করুন।' });
  const b = await ctx.body();
  const it = b.item && typeof b.item === 'object' ? b.item : {};
  const opt = b.options && typeof b.options === 'object' ? b.options : {};
  const ref = str(it.ref, 300).toLowerCase();
  const name = str(it.title, 140);
  const price = amount(it.price);
  if (!name) return ctx.json(ctx.res, 200, { result: 'error', message: 'পণ্যের নাম নেই' });
  if (!(price > 0)) return ctx.json(ctx.res, 200, { result: 'error', message: 'দাম নেই' });
  const images = (Array.isArray(b.images) ? b.images : []).map((x) => int(x)).filter((x) => x > 0).slice(0, catalog.MAX_PRODUCT_IMAGES);
  const oldPrice = amount(it.old_price) > price ? amount(it.old_price) : null;
  const hasStock = it.stock !== null && it.stock !== undefined && it.stock !== '';
  const stock = hasStock ? Math.max(0, int(it.stock)) : it.in_stock === false ? 0 : Math.max(0, int(opt.default_stock, 10));

  // imported before?
  if (ref) {
    const old = await db.one('SELECT id, name, sku, stock, product_type FROM products WHERE import_ref=$1', [ref]);
    if (old) {
      if (opt.existing !== 'update') return ctx.json(ctx.res, 200, { result: 'exists', id: old.id, sku: old.sku, name: old.name });
      await db.tx(async (t) => {
        await t.query('UPDATE products SET price=$1, old_price=$2, brand=CASE WHEN $3 <> \'\' THEN $3 ELSE brand END, updated_at=now() WHERE id=$4',
          [price, oldPrice, str(it.brand, 60), old.id]);
        if (old.product_type === 'single' && (hasStock || it.in_stock === false) && stock !== old.stock) {
          await catalog.moveStock(t, old.id, stock - old.stock, 'adjust', 'product', old.id, 'আমদানি থেকে স্টক আপডেট', ctx.user.id);
        }
      });
      await ctx.log('product_edit', 'product', old.id, `আমদানি থেকে দাম/স্টক আপডেট: ${name}`);
      return ctx.json(ctx.res, 200, { result: 'updated', id: old.id, sku: old.sku, name: old.name });
    }
  }

  const description = str(it.description, 20000);
  const youtube = youtubeId(it.youtube) ? str(it.youtube, 300) : '';
  // duplicate guard (same rules as adding a product by hand)
  const allow = !!b.allow_duplicate && ctx.can('dup_override');
  if (ctx.settings.dup_guard !== '0' && !allow) {
    const dup = await dupes.findDuplicates({ name, description, images, product_type: 'single', youtube_url: youtube }, ctx.settings);
    if (dup.blocked) {
      const matches = dup.matches.filter((m) => m.level === 'block').slice(0, 3)
        .map((m) => ({ id: m.id, name: m.name, sku: m.sku, image: m.image, emoji: m.emoji,
          reasons: m.reasons.map((r) => r.replace('নিচের সুইচ চালু করুন', '"তবুও যোগ করুন" চাপুন')) }));
      await ctx.log('product_dup_blocked', 'product', null, `আমদানি: ${name.slice(0, 80)} ≈ ${matches.map((m) => '#' + m.id).join(', ')}`);
      return ctx.json(ctx.res, 200, { result: 'duplicate', matches, images });
    }
  }

  // category
  let categoryId = null;
  if (opt.cat_mode === 'one') categoryId = int(opt.category_id) || null;
  else if (opt.cat_mode !== 'none') {
    const categories = await catalog.listCategories();
    const found = categoryFinder(categories)(it.category);
    if (found.id) categoryId = found.id;
    else if (found.name && opt.create_category && categories.length < 200) {
      categoryId = await catalog.saveCategory({ name: found.name, icon: '📦', sort: categories.length, active: true });
      await ctx.log('category_save', 'category', categoryId, `আমদানি: ${found.name}`);
    } else categoryId = int(opt.category_id) || null;
  }

  const active = !!opt.active && !(opt.hide_no_image && !images.length);
  let pid;
  try {
    pid = await catalog.saveProduct({
      name, price, old_price: oldPrice, cost_price: ctx.can('see_cost') ? amount(it.cost_price) : 0,
      short_description: str(it.short_description, 1000), description, brand: str(it.brand, 60),
      category_id: categoryId, stock, images, youtube_url: youtube, weight_g: int(it.weight_g),
      active, featured: false, emoji: '📦', unit: 'পিস', low_stock: 3, product_type: 'single', sku: '',
      allow_duplicate: allow, import_ref: ref,
    }, ctx.user.id);
  } catch (e) {
    if (/products_import_ref_uq|duplicate key/i.test(String(e && e.message))) {
      const old = await db.one('SELECT id, name, sku FROM products WHERE import_ref=$1', [ref]);
      return ctx.json(ctx.res, 200, { result: 'exists', id: old && old.id, sku: old && old.sku, name: old && old.name });
    }
    throw e;
  }
  if (opt.cat_mode === 'auto' || !opt.cat_mode) {
    try { await require('../services/autocat').apply({ ids: [pid] }); } catch (_) { /* keeps the category chosen above */ }
  }
  const p = await db.one('SELECT sku, slug FROM products WHERE id=$1', [pid]);
  await ctx.log('product_add', 'product', pid, `আমদানি: ${name.slice(0, 90)}`);
  if (allow) await ctx.log('product_dup_allow', 'product', pid, `ডুপ্লিকেট হলেও আমদানির অনুমতি: ${name.slice(0, 80)}`);
  return ctx.json(ctx.res, 200, { result: 'added', id: pid, sku: p && p.sku, active });
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/products/import', perm: 'products', handler: page },
    { method: 'GET', path: '/admin/products/import/template.csv', perm: 'products', handler: template },
    { method: 'POST', path: '/admin/api/import/read', perm: 'products', handler: readApi },
    { method: 'GET', path: '/admin/api/import/image', perm: 'products', handler: imageApi },
    { method: 'POST', path: '/admin/api/import/save', perm: 'products', handler: saveApi },
  ],
  categoryFinder, nextPageUrl,
};

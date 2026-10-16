// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → স্টক ও কেনাকাটা → 📷 স্ক্যান করে স্টক (owner, 2026-10-13)
// Scan a product's barcode (barcode gun, or the phone / laptop camera) → the product opens with its stock and box →
//   📥 মাল এসেছে: type how many came (or scan each piece, +1 every scan) → stock goes up
//   🔢 গুনে মেলান: type how many are really there → the stock is set to that (the difference is saved as "গণনা ঠিক করা")
//   📍 which box it sits in can be set right there.
// A code nobody has yet → "নতুন পণ্য হিসেবে যোগ করুন" (the new-product page opens with that barcode, box and count filled in).
// Typing a box name ("বক্স ৩") lists everything kept in that box.
import { html, raw, bn, int, str } from '../util';
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as W from '../models/warehouses';
import * as ui from './ui';
import { ASSET_V } from './layout';
import * as $services_stockalert from '../services/stockalert';

const BASE = '/admin/stock-scan';
const NOTE = '📷 স্ক্যান করে স্টক';

// what the page needs to know about one product (main store = what is at home / the online stock, not branches)
async function shape(rows) {
  const ids = rows.map((p) => p.id);
  const [st, held] = await Promise.all([W.stockFor(ids), catalog.reservedFor(ids)]);
  return rows.map((p) => {
    const main = (st.get(p.id) || { main: p.stock }).main;
    const h = held.get(p.id) || 0;
    return {
      id: p.id, name: p.name, sku: p.sku || '', barcode: p.barcode || '', model: p.model || '', unit: p.unit || 'পিস',
      location: p.location || '', stock: p.stock, main, held: h, shelf: main + h, active: p.active,
      image: p.image_id ? `/media/${p.image_id}/t` : '', emoji: p.emoji || '📦',
    };
  });
}

async function find(ctx) {
  const code = str(ctx.query.get('q'), 100).trim();
  if (!code) return ctx.json(ctx.res, 200, { exact: null, list: [] });
  const exact = await db.one(`SELECT id FROM products WHERE (upper(barcode)=upper($1) OR lower(sku)=lower($1)) AND variant_count = 0 AND product_type <> 'bundle' LIMIT 1`, [code]);
  if (exact) {
    const p = await catalog.getProduct({ id: exact.id });
    return ctx.json(ctx.res, 200, { exact: (await shape([p]))[0], list: [] });
  }
  // a box name → everything in that box
  const inBox = await db.q(`SELECT id FROM products WHERE lower(location)=lower($1) AND variant_count = 0 AND product_type <> 'bundle' ORDER BY name LIMIT 200`, [catalog.cleanLocation(code)]);
  if (inBox.length) {
    const rows = await catalog.getProductsByIds(inBox.map((r) => r.id), { includeInactive: true });
    return ctx.json(ctx.res, 200, { exact: null, box: catalog.cleanLocation(code), list: await shape(rows) });
  }
  const list = await catalog.listProducts({ q: code, type: 'single', items: true, includeInactive: true, limit: 12, sort: 'name' });
  // looks like a barcode (no spaces, letters/digits) and nothing matched → offer to make it a new product
  const looksLikeCode = /^[\x21-\x7e]{4,40}$/.test(code);
  return ctx.json(ctx.res, 200, { exact: null, list: await shape(list), unknown: looksLikeCode && !list.length ? code.toUpperCase() : '' });
}

async function save(ctx) {
  const b = await ctx.body();
  const id = int(b.id);
  const mode = ['in', 'count', 'undo'].includes(b.mode) ? b.mode : 'in';
  const p = await db.one('SELECT id, name, stock, location FROM products WHERE id=$1 AND variant_count = 0 AND product_type <> \'bundle\'', [id]);
  if (!p) return ctx.json(ctx.res, 404, { ok: false, error: 'পণ্যটি পাওয়া যায়নি।' });

  let change = 0;
  let reason = 'adjust';
  let short = 0;
  if (mode === 'in') {
    change = int(b.qty);
    if (change < 1 || change > 100000) return ctx.json(ctx.res, 400, { ok: false, error: 'কতগুলো এসেছে লিখুন (১ বা বেশি)।' });
  } else if (mode === 'count') {
    // the number typed is what is really on the shelf at home (pieces held for open orders are still on the shelf)
    const counted = int(b.qty, -1);
    if (b.qty === '' || b.qty === undefined || counted < 0 || counted > 100000) return ctx.json(ctx.res, 400, { ok: false, error: 'গুনে কতগুলো পেলেন লিখুন (০ বা বেশি)।' });
    const [now] = await shape([await catalog.getProduct({ id })]);
    change = counted - now.shelf;
    reason = 'count';
    // fewer on the shelf than open orders need: the stock can't go below 0 here — say so, so those orders get checked
    if (counted < now.held) short = now.held - counted;
  } else {
    change = int(b.change); // taking back a scan made by mistake
    if (!change) return ctx.json(ctx.res, 400, { ok: false, error: 'কিছু ফেরাতে হবে না।' });
  }

  let ok = true;
  if (change) {
    await db.tx(async (t) => {
      ok = await catalog.moveStock(t, id, change, reason, 'manual', null,
        mode === 'undo' ? `${NOTE} — ভুল ফেরত` : mode === 'count' ? `${NOTE} — গুনে মেলানো` : `${NOTE} — মাল এসেছে`, ctx.user.id, mode === 'undo' && change < 0);
    });
  }
  if (!ok) return ctx.json(ctx.res, 409, { ok: false, error: `"${p.name}" — স্টকে এতগুলো নেই, কমানো গেল না।` });

  // 📍 the box can be set at the same time
  if (b.location !== undefined && catalog.cleanLocation(b.location) !== p.location) {
    await db.q('UPDATE products SET location=$1, updated_at=now() WHERE id=$2', [catalog.cleanLocation(b.location), id]);
  }
  if (change) {
    await ctx.log('stock_adjust', 'product', id, `${p.name}: ${change > 0 ? '+' : ''}${change} (${mode === 'count' ? 'গুনে মেলানো' : mode === 'undo' ? 'ভুল ফেরত' : 'মাল এসেছে'}, স্ক্যান)`);
    $services_stockalert.check(ctx.settings, [id]).catch(() => {});
  }
  const [after] = await shape([await catalog.getProduct({ id })]);
  const msg = !change ? (mode === 'count' ? `✔ "${p.name}" — গণনা মিলে গেছে, কিছু বদলাতে হয়নি` : '✔ সেভ হয়েছে')
    : mode === 'count' ? `✔ "${p.name}" — ${change > 0 ? bn(change) + 'টি বেশি পাওয়া গেছে' : bn(-change) + 'টি কম পাওয়া গেছে'}, স্টক ঠিক করা হলো`
      : mode === 'undo' ? `↩️ "${p.name}" — ${bn(Math.abs(change))}টি ফেরানো হলো`
        : `✔ "${p.name}" +${bn(change)}টি স্টকে যোগ হলো`;
  const warn = short ? `⚠️ খোলা অর্ডারে ${bn(after.held)}টি রাখা আছে, কিন্তু তাকে পেলেন ${bn(after.held - short)}টি — ${bn(short)}টি কম। অর্ডারগুলো দেখে নিন।` : '';
  return ctx.json(ctx.res, 200, { ok: true, change, product: after, message: msg, warn });
}

async function setLocation(ctx) {
  const b = await ctx.body();
  const id = int(b.id);
  const loc = catalog.cleanLocation(b.location);
  const p = await db.one('SELECT id, name FROM products WHERE id=$1', [id]);
  if (!p) return ctx.json(ctx.res, 404, { ok: false, error: 'পণ্যটি পাওয়া যায়নি।' });
  await db.q('UPDATE products SET location=$1, updated_at=now() WHERE id=$2', [loc, id]);
  await ctx.log('product_location', 'product', id, `${p.name}: 📍 ${loc || '(খালি)'}`);
  return ctx.json(ctx.res, 200, { ok: true, location: loc, message: loc ? `📍 "${p.name}" — ${loc}` : `📍 "${p.name}" — বক্স মুছে দেওয়া হলো` });
}

async function page(ctx) {
  const locations = await catalog.listLocations();
  const box = catalog.cleanLocation(ctx.query.get('box'));
  let boxRows = [];
  if (box) {
    const ids = await db.q(`SELECT id FROM products WHERE lower(location)=lower($1) AND variant_count = 0 AND product_type <> 'bundle' ORDER BY name`, [box]);
    boxRows = ids.length ? await shape(await catalog.getProductsByIds(ids.map((r) => r.id), { includeInactive: true })) : [];
  }
  const noBox = (await db.one(`SELECT count(*)::int AS n FROM products WHERE location = '' AND variant_count = 0 AND product_type='single' AND stock > 0`)).n;
  const body = html`<div class="title-row"><h1>📷 স্ক্যান করে স্টক</h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/inventory">ইনভেন্টরি →</a></div></div>
<section class="panel ho-scan ss-scan" data-stockscan>
  <div class="ss-modes" role="tablist">
    <button type="button" class="ss-mode on" data-ss-mode="in" role="tab">📥 মাল এসেছে (স্টক ইন)</button>
    <button type="button" class="ss-mode" data-ss-mode="count" role="tab">🔢 গুনে মেলান</button>
  </div>
  <p class="small muted" data-ss-modehelp></p>
  <div class="ho-input-row">
    <input type="text" class="ho-input" data-ss-input placeholder="পণ্যের বারকোড স্ক্যান করুন, বা নাম / SKU / বক্সের নাম লিখুন" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus>
    <button type="button" class="btn" data-ss-go>খুঁজুন</button>
    <button type="button" class="btn btn-ghost" data-ss-cam>📷 ক্যামেরা</button>
  </div>
  <div class="ho-opts">
    <label class="nav-chip" data-ss-onebyone-wrap><span class="nav-chip-t">⚡ প্রতিটা পিস স্ক্যান করব — প্রতি স্ক্যানে +১ সাথে সাথে</span><span class="switch switch-sm"><input type="checkbox" data-ss-onebyone><span class="switch-ui" aria-hidden="true"></span></span></label>
    <label class="nav-chip"><span class="nav-chip-t">📍 যে বক্সে রাখছি:</span><input type="text" class="ss-boxnow" data-ss-boxnow list="ss-loc-list" maxlength="40" placeholder="যেমন: বক্স ৩" autocomplete="off"></label>
  </div>
  <datalist id="ss-loc-list">${locations.map((x) => html`<option value="${x.location}">`)}</datalist>
  <div class="ho-cam" data-ss-cambox hidden><video playsinline muted></video><div class="ho-aim"></div><button type="button" class="btn btn-sm" data-ss-camoff>✖ ক্যামেরা বন্ধ</button></div>
  <p class="ho-msg" data-ss-msg role="status" aria-live="polite"></p>
  <div data-ss-card></div>
</section>
<section class="panel table-wrap" data-ss-log-wrap hidden>
  <h2>এইমাত্র যা করলেন</h2>
  <table class="table compact"><thead><tr><th>পণ্য</th><th class="num">বদল</th><th class="num">এখন স্টক</th><th>📍</th><th></th></tr></thead><tbody data-ss-log></tbody></table>
</section>
<section class="panel">
  <h2>📍 বক্সগুলো ${noBox ? html`<small class="warn">${bn(noBox)}টি পণ্যের বক্স লেখা নেই</small>` : ''}</h2>
  ${locations.length ? html`<div class="ss-boxes">${locations.map((x) => html`<a class="ss-box ${box && x.location.toLowerCase() === box.toLowerCase() ? 'on' : ''}" href="${BASE}?box=${encodeURIComponent(x.location)}"><b>📍 ${x.location}</b><small>${bn(x.products)}টি পণ্য · ${bn(x.units)} পিস</small></a>`)}</div>`
    : html`<p class="muted">এখনো কোনো পণ্যের বক্স লেখা হয়নি। পণ্য স্ক্যান করে "📍 যে বক্সে রাখছি" ঘরে বক্সের নাম দিন — বা পণ্য এডিট পেজে "📍 কোথায় রাখা"।</p>`}
  ${box ? html`<h3>📍 ${box} — ভেতরে যা আছে</h3>${boxRows.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>পণ্য</th><th>SKU</th><th class="num">তাকে মোট</th></tr></thead><tbody>
    ${boxRows.map((p) => html`<tr><td><a href="/admin/products/${p.id}">${p.name}</a></td><td class="small">${p.sku}</td><td class="num"><b>${bn(p.shelf)}</b> <span class="small muted">${p.unit}</span></td></tr>`)}</tbody></table></div>
    <p class="small"><a class="btn btn-sm btn-ghost" href="/admin/products/labels?ids=${boxRows.map((p) => p.id).join(',')}" target="_blank">🏷️ এই বক্সের সব পণ্যের লেবেল প্রিন্ট</a></p>`
    : html`<p class="muted">এই বক্সে কিছু নেই।</p>`}` : ''}
</section>
${ui.helpBox('কীভাবে ব্যবহার করবেন', html`<ol>
  <li><b>প্রথমবার:</b> প্রতিটা পণ্যের ব্যাগে লেবেল লাগান (পণ্যের পেজে "🏷️ লেবেল প্রিন্ট", বা সব পণ্য তালিকায় টিক দিয়ে একসাথে)। একই পণ্যের সব পিস এক ব্যাগে রাখলে ব্যাগে একটা লেবেলই যথেষ্ট।</li>
  <li><b>📥 মাল এসেছে:</b> বারকোড স্ক্যান করুন → কতগুলো এসেছে লিখে Enter। প্রতিটা পিসে আলাদা লেবেল থাকলে "⚡ প্রতিটা পিস স্ক্যান করব" চালু করুন — প্রতি স্ক্যানে ১টা করে যোগ হবে।</li>
  <li><b>🔢 গুনে মেলান:</b> মাঝে মাঝে বক্স খুলে গুনুন → স্ক্যান করে আসল সংখ্যাটা লিখুন। কম-বেশি হলে স্টক নিজে থেকে ঠিক হয়ে যাবে (ইতিহাসে "গণনা ঠিক করা")। খোলা অর্ডারের জন্য রাখা মালও তাকেই আছে ধরে হিসাব হয়।</li>
  <li><b>📍 বক্স:</b> উপরের "যে বক্সে রাখছি" ঘরে বক্সের নাম লিখে রাখলে যেটাই স্ক্যান করবেন সেটা ওই বক্সে আছে বলে সেভ হবে। কুরিয়ারে হ্যান্ডওভারের সময় প্রতিটা পণ্যের পাশে বক্সের নাম দেখাবে।</li>
  <li>বারকোড চেনা না গেলে "➕ নতুন পণ্য হিসেবে যোগ করুন" — বারকোড, বক্স আর সংখ্যা বসানো অবস্থায় নতুন পণ্যের পেজ খুলবে।</li>
  <li>ভুল হলে নিচের "এইমাত্র যা করলেন" থেকে "↩️ ফেরান"।</li>
</ol>`)}
<script src="/js/scan.js?v=${ASSET_V}" defer></script>
<script src="/js/stockscan.js?v=${ASSET_V}" defer></script>`;
  return ctx.page('স্ক্যান করে স্টক', body, 'stock-scan');
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'inventory', handler: page },
    { method: 'GET', path: '/admin/api/stock-scan/find', perm: 'inventory', handler: find },
    { method: 'POST', path: '/admin/api/stock-scan/save', perm: 'inventory', handler: save },
    { method: 'POST', path: '/admin/api/stock-scan/location', perm: 'inventory', handler: setLocation },
  ];
void raw;

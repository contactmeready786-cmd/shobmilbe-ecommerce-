// Admin → স্টক ও কেনাকাটা → 📷 স্ক্যান করে স্টক (owner, 2026-10-13)
// Scan a product's barcode (barcode gun, or the phone / laptop camera) → the product opens with its stock and box →
//   📥 মাল এসেছে: type how many came (or scan each piece, +1 every scan) → stock goes up
//   🔢 গুনে মেলান: type how many are really there → the stock is set to that (the difference is saved as "গণনা ঠিক করা")
//   📍 which box it sits in can be set right there.
// A code nobody has yet → "নতুন পণ্য হিসেবে যোগ করুন" (the new-product page opens with that barcode, box and count filled in).
// Typing a box name ("বক্স ৩") lists everything kept in that box.
import { Val, attrValue, jsxList } from '../react/html';
import { raw, bn, int, str } from '../util';
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as W from '../models/warehouses';
import * as ui from './ui';
import { ASSET_V } from './layout';
import * as $services_stockalert from '../services/stockalert';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/stock-scan';
const NOTE = '📷 স্ক্যান করে স্টক';

// what the page needs to know about one product (main store = what is at home / the online stock, not branches)
async function shape(rows?: Loose) {
  const ids = rows.map((p?: Loose) => p.id);
  const [st, held] = await Promise.all([W.stockFor(ids), catalog.reservedFor(ids)]);
  return rows.map((p?: Loose) => {
    const main = (st.get(p.id) || { main: p.stock }).main;
    const h = held.get(p.id) || 0;
    return {
      id: p.id, name: p.name, sku: p.sku || '', barcode: p.barcode || '', model: p.model || '', unit: p.unit || 'পিস',
      location: p.location || '', stock: p.stock, main, held: h, shelf: main + h, active: p.active,
      image: p.image_id ? `/media/${p.image_id}/t` : '', emoji: p.emoji || '📦',
    };
  });
}

async function find(ctx: AdminCtx) {
  const code = str(ctx.query.get('q'), 100).trim();
  if (!code) return ctx.json(200, { exact: null, list: [] });
  const exact = await db.one(`SELECT id FROM products WHERE (upper(barcode)=upper($1) OR lower(sku)=lower($1)) AND variant_count = 0 AND product_type <> 'bundle' LIMIT 1`, [code]);
  if (exact) {
    const p = await catalog.getProduct({ id: exact.id });
    return ctx.json(200, { exact: (await shape([p]))[0], list: [] });
  }
  // a box name → everything in that box
  const inBox = await db.q(`SELECT id FROM products WHERE lower(location)=lower($1) AND variant_count = 0 AND product_type <> 'bundle' ORDER BY name LIMIT 200`, [catalog.cleanLocation(code)]);
  if (inBox.length) {
    const rows = await catalog.getProductsByIds(inBox.map((r) => r.id), { includeInactive: true });
    return ctx.json(200, { exact: null, box: catalog.cleanLocation(code), list: await shape(rows) });
  }
  const list = await catalog.listProducts({ q: code, type: 'single', items: true, includeInactive: true, limit: 12, sort: 'name' });
  // looks like a barcode (no spaces, letters/digits) and nothing matched → offer to make it a new product
  const looksLikeCode = /^[\x21-\x7e]{4,40}$/.test(code);
  return ctx.json(200, { exact: null, list: await shape(list), unknown: looksLikeCode && !list.length ? code.toUpperCase() : '' });
}

async function save(ctx: AdminCtx) {
  const b = await ctx.body();
  const id = int(b.id);
  const mode = ['in', 'count', 'undo'].includes(b.mode) ? b.mode : 'in';
  const p = await db.one('SELECT id, name, stock, location FROM products WHERE id=$1 AND variant_count = 0 AND product_type <> \'bundle\'', [id]);
  if (!p) return ctx.json(404, { ok: false, error: 'পণ্যটি পাওয়া যায়নি।' });

  let change = 0;
  let reason = 'adjust';
  let short = 0;
  if (mode === 'in') {
    change = int(b.qty);
    if (change < 1 || change > 100000) return ctx.json(400, { ok: false, error: 'কতগুলো এসেছে লিখুন (১ বা বেশি)।' });
  } else if (mode === 'count') {
    // the number typed is what is really on the shelf at home (pieces held for open orders are still on the shelf)
    const counted = int(b.qty, -1);
    if (b.qty === '' || b.qty === undefined || counted < 0 || counted > 100000) return ctx.json(400, { ok: false, error: 'গুনে কতগুলো পেলেন লিখুন (০ বা বেশি)।' });
    const [now] = await shape([await catalog.getProduct({ id })]);
    change = counted - now.shelf;
    reason = 'count';
    // fewer on the shelf than open orders need: the stock can't go below 0 here — say so, so those orders get checked
    if (counted < now.held) short = now.held - counted;
  } else {
    change = int(b.change); // taking back a scan made by mistake
    if (!change) return ctx.json(400, { ok: false, error: 'কিছু ফেরাতে হবে না।' });
  }

  let ok: Loose = true;
  if (change) {
    await db.tx(async (t) => {
      ok = await catalog.moveStock(t, id, change, reason, 'manual', null,
        mode === 'undo' ? `${NOTE} — ভুল ফেরত` : mode === 'count' ? `${NOTE} — গুনে মেলানো` : `${NOTE} — মাল এসেছে`, ctx.user.id, mode === 'undo' && change < 0);
    });
  }
  if (!ok) return ctx.json(409, { ok: false, error: `"${p.name}" — স্টকে এতগুলো নেই, কমানো গেল না।` });

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
  return ctx.json(200, { ok: true, change, product: after, message: msg, warn });
}

async function setLocation(ctx: AdminCtx) {
  const b = await ctx.body();
  const id = int(b.id);
  const loc = catalog.cleanLocation(b.location);
  const p = await db.one('SELECT id, name FROM products WHERE id=$1', [id]);
  if (!p) return ctx.json(404, { ok: false, error: 'পণ্যটি পাওয়া যায়নি।' });
  await db.q('UPDATE products SET location=$1, updated_at=now() WHERE id=$2', [loc, id]);
  await ctx.log('product_location', 'product', id, `${p.name}: 📍 ${loc || '(খালি)'}`);
  return ctx.json(200, { ok: true, location: loc, message: loc ? `📍 "${p.name}" — ${loc}` : `📍 "${p.name}" — বক্স মুছে দেওয়া হলো` });
}

async function page(ctx: AdminCtx) {
  const locations = await catalog.listLocations();
  const box = catalog.cleanLocation(ctx.query.get('box'));
  let boxRows: Loose[] = [];
  if (box) {
    const ids = await db.q(`SELECT id FROM products WHERE lower(location)=lower($1) AND variant_count = 0 AND product_type <> 'bundle' ORDER BY name`, [box]);
    boxRows = ids.length ? await shape(await catalog.getProductsByIds(ids.map((r) => r.id), { includeInactive: true })) : [];
  }
  const noBox = (await db.one(`SELECT count(*)::int AS n FROM products WHERE location = '' AND variant_count = 0 AND product_type='single' AND stock > 0`))!.n;
  const body = <><div className="title-row"><h1>📷 স্ক্যান করে স্টক</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href="/admin/inventory">ইনভেন্টরি →</a></div></div><section className="panel ho-scan ss-scan" data-stockscan=""><div className="ss-modes" role="tablist"><button type="button" className="ss-mode on" data-ss-mode="in" role="tab">📥 মাল এসেছে (স্টক ইন)</button>{' '}<button type="button" className="ss-mode" data-ss-mode="count" role="tab">🔢 গুনে মেলান</button></div><p className="small muted" data-ss-modehelp=""></p><div className="ho-input-row"><input type="text" className="ho-input" data-ss-input="" placeholder="পণ্যের বারকোড স্ক্যান করুন, বা নাম / SKU / বক্সের নাম লিখুন" autoComplete="off" autoCapitalize="characters" autoFocus spellcheck="false" />{' '}<button type="button" className="btn" data-ss-go="">খুঁজুন</button>{' '}<button type="button" className="btn btn-ghost" data-ss-cam="">📷 ক্যামেরা</button></div><div className="ho-opts"><label className="nav-chip" data-ss-onebyone-wrap=""><span className="nav-chip-t">⚡ প্রতিটা পিস স্ক্যান করব — প্রতি স্ক্যানে +১ সাথে সাথে</span><span className="switch switch-sm"><input type="checkbox" data-ss-onebyone="" /><span className="switch-ui" aria-hidden="true"></span></span></label>{' '}<label className="nav-chip"><span className="nav-chip-t">📍 যে বক্সে রাখছি:</span><input type="text" className="ss-boxnow" data-ss-boxnow="" list="ss-loc-list" maxLength={40} placeholder="যেমন: বক্স ৩" autoComplete="off" /></label></div><datalist id="ss-loc-list">{jsxList(locations.map((x) => <option value={attrValue(x.location)}></option>))}</datalist><div className="ho-cam" data-ss-cambox="" hidden><video playsInline muted></video><div className="ho-aim"></div><button type="button" className="btn btn-sm" data-ss-camoff="">✖ ক্যামেরা বন্ধ</button></div><p className="ho-msg" data-ss-msg="" role="status" aria-live="polite"></p><div data-ss-card=""></div></section><section className="panel table-wrap" data-ss-log-wrap="" hidden><h2>এইমাত্র যা করলেন</h2><table className="table compact"><thead><tr><th>পণ্য</th><th className="num">বদল</th><th className="num">এখন স্টক</th><th>📍</th><th></th></tr></thead><tbody data-ss-log=""></tbody></table></section><section className="panel"><h2>📍 বক্সগুলো{' '}{(noBox ? <small className="warn">{bn(noBox)}টি পণ্যের বক্স লেখা নেই</small> : null)}</h2>{(locations.length ? <div className="ss-boxes">{jsxList(locations.map((x) => <a className={`ss-box ${box && x.location.toLowerCase() === box.toLowerCase() ? 'on' : ''}`} href={`${attrValue(BASE)}?box=${attrValue(encodeURIComponent(x.location))}`}><b>📍{' '}<Val v={x.location} /></b><small>{bn(x.products)}টি পণ্য ·{' '}{bn(x.units)}{' '}পিস</small></a>))}</div> : <p className="muted">এখনো কোনো পণ্যের বক্স লেখা হয়নি। পণ্য স্ক্যান করে "📍 যে বক্সে রাখছি" ঘরে বক্সের নাম দিন — বা পণ্য এডিট পেজে "📍 কোথায় রাখা"।</p>)}{' '}{(box ? <><h3>📍{' '}<Val v={box} />{' '}— ভেতরে যা আছে</h3>{(boxRows.length ? <><div className="table-wrap"><table className="table compact"><thead><tr><th>পণ্য</th><th>SKU</th><th className="num">তাকে মোট</th></tr></thead><tbody>{jsxList(boxRows.map((p?: Loose) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a></td><td className="small"><Val v={p.sku} /></td><td className="num"><b>{bn(p.shelf)}</b>{' '}<span className="small muted"><Val v={p.unit} /></span></td></tr>))}</tbody></table></div><p className="small"><a className="btn btn-sm btn-ghost" href={`/admin/products/labels?ids=${boxRows.map((p?: Loose) => p.id).join(',')}`} target="_blank">🏷️ এই বক্সের সব পণ্যের লেবেল প্রিন্ট</a></p></> : <p className="muted">এই বক্সে কিছু নেই।</p>)}</> : null)}</section>{ui.helpBox('কীভাবে ব্যবহার করবেন', <ol><li><b>প্রথমবার:</b>{' '}প্রতিটা পণ্যের ব্যাগে লেবেল লাগান (পণ্যের পেজে "🏷️ লেবেল প্রিন্ট", বা সব পণ্য তালিকায় টিক দিয়ে একসাথে)। একই পণ্যের সব পিস এক ব্যাগে রাখলে ব্যাগে একটা লেবেলই যথেষ্ট।</li><li><b>📥 মাল এসেছে:</b>{' '}বারকোড স্ক্যান করুন → কতগুলো এসেছে লিখে Enter। প্রতিটা পিসে আলাদা লেবেল থাকলে "⚡ প্রতিটা পিস স্ক্যান করব" চালু করুন — প্রতি স্ক্যানে ১টা করে যোগ হবে।</li><li><b>🔢 গুনে মেলান:</b>{' '}মাঝে মাঝে বক্স খুলে গুনুন → স্ক্যান করে আসল সংখ্যাটা লিখুন। কম-বেশি হলে স্টক নিজে থেকে ঠিক হয়ে যাবে (ইতিহাসে "গণনা ঠিক করা")। খোলা অর্ডারের জন্য রাখা মালও তাকেই আছে ধরে হিসাব হয়।</li><li><b>📍 বক্স:</b>{' '}উপরের "যে বক্সে রাখছি" ঘরে বক্সের নাম লিখে রাখলে যেটাই স্ক্যান করবেন সেটা ওই বক্সে আছে বলে সেভ হবে। কুরিয়ারে হ্যান্ডওভারের সময় প্রতিটা পণ্যের পাশে বক্সের নাম দেখাবে।</li><li>বারকোড চেনা না গেলে "➕ নতুন পণ্য হিসেবে যোগ করুন" — বারকোড, বক্স আর সংখ্যা বসানো অবস্থায় নতুন পণ্যের পেজ খুলবে।</li><li>ভুল হলে নিচের "এইমাত্র যা করলেন" থেকে "↩️ ফেরান"।</li></ol>)}<script type="module" src={`/js/admin/stockscan.js?v=${attrValue(ASSET_V)}`} /></>;
  return ctx.page('স্ক্যান করে স্টক', body, 'stock-scan');
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'inventory', handler: page },
    { method: 'GET', path: '/admin/api/stock-scan/find', perm: 'inventory', handler: find },
    { method: 'POST', path: '/admin/api/stock-scan/save', perm: 'inventory', handler: save },
    { method: 'POST', path: '/admin/api/stock-scan/location', perm: 'inventory', handler: setLocation },
  ];
void raw;

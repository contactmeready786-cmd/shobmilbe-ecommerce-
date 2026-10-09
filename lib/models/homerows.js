'use strict';
// The owner's own home page rows ("নিজের সারি"): any title, filled from a category, a brand, a price
// range, a search word, offers / new / best sellers / "আমাদের বাছাই", or products picked by SKU.
// In the home page order (setting home_sections) each one is the key "x<id>", next to the built-in rows.
const { q, one } = require('../db');
const { int, str } = require('../util');

const SOURCES = {
  category: 'একটা ক্যাটাগরির পণ্য',
  brand: 'একটা ব্র্যান্ডের পণ্য',
  products: 'নিজে বাছাই করা পণ্য (SKU দিয়ে)',
  price: 'দামের সীমার মধ্যে (যেমন ৳৫০–৳২০০)',
  search: 'কোনো শব্দ আছে এমন পণ্য (যেমন "রিমোট")',
  offers: 'অফারে থাকা পণ্য',
  new: 'নতুন আসা পণ্য',
  bestsellers: 'সবচেয়ে বেশি বিক্রি',
  featured: '"জনপ্রিয়" টিক দেওয়া পণ্য',
};
const SORTS = { popular: 'বেশি বিক্রি আগে', new: 'নতুন আগে', price_asc: 'কম দাম আগে', price_desc: 'বেশি দাম আগে', offer: 'বড় ছাড় আগে' };
const STYLES = { rail: 'এক লাইনে, পাশে সরানো যায়', grid: 'কয়েক লাইনে গ্রিড' };

const KEY_RE = /^x(\d{1,9})$/;
const keyOf = (id) => 'x' + int(id);
const idOf = (key) => { const m = KEY_RE.exec(String(key)); return m ? int(m[1]) : 0; };

async function list() { return q('SELECT * FROM home_rows ORDER BY id'); }
async function get(id) { return one('SELECT * FROM home_rows WHERE id=$1', [int(id)]); }

// "12, 5 7" → SKUs → product ids (in the order typed)
async function idsFromSkus(text) {
  const skus = [...new Set(String(text || '').split(/[\s,;।]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 60);
  if (!skus.length) return { ids: [], missing: [] };
  const rows = await q('SELECT id, sku FROM products WHERE sku = ANY($1::text[])', [skus]);
  const by = new Map(rows.map((r) => [String(r.sku), r.id]));
  return { ids: skus.map((k) => by.get(k)).filter(Boolean), missing: skus.filter((k) => !by.has(k)) };
}
async function skusOf(ids) {
  if (!ids || !ids.length) return '';
  const rows = await q('SELECT id, sku FROM products WHERE id = ANY($1::int[])', [ids]);
  const by = new Map(rows.map((r) => [r.id, r.sku]));
  return ids.map((i) => by.get(i)).filter(Boolean).join(', ');
}

function clean(b) {
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n; };
  return {
    title: str(b.title, 80) || 'নতুন সারি',
    sub: str(b.sub, 160),
    source: SOURCES[b.source] ? b.source : 'category',
    ref: str(b.ref, 120),
    min_price: num(b.min_price), max_price: num(b.max_price),
    sort: SORTS[b.sort] ? b.sort : 'popular',
    lim: Math.min(32, Math.max(4, int(b.lim) || 16)),
    badge: str(b.badge, 20),
    style: STYLES[b.style] ? b.style : 'rail',
    in_stock_only: !!b.in_stock_only && b.in_stock_only !== '0',
  };
}

async function save(id, b) {
  const v = clean(b);
  const { ids, missing } = v.source === 'products' ? await idsFromSkus(b.skus) : { ids: [], missing: [] };
  const vals = [v.title, v.sub, v.source, v.ref, ids, v.min_price, v.max_price, v.sort, v.lim, v.badge, v.style, v.in_stock_only];
  let row;
  if (int(id)) {
    row = await one(`UPDATE home_rows SET title=$1, sub=$2, source=$3, ref=$4, product_ids=$5, min_price=$6, max_price=$7, sort=$8, lim=$9, badge=$10,
      style=$11, in_stock_only=$12, updated_at=now() WHERE id=$13 RETURNING *`, [...vals, int(id)]);
  } else {
    row = await one(`INSERT INTO home_rows(title, sub, source, ref, product_ids, min_price, max_price, sort, lim, badge, style, in_stock_only)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, vals);
  }
  return { row, missing };
}

// The products of one row, ready for the shop.
async function productsFor(r, { hideOut } = {}) {
  const catalog = require('./catalog');
  const limit = r.lim || 16;
  const base = { public: true, hideOut: hideOut || r.in_stock_only, sort: r.sort, limit };
  let items = [];
  if (r.source === 'products') {
    const got = await catalog.getProductsByIds(r.product_ids || [], { public: true });
    const pos = new Map((r.product_ids || []).map((id, i) => [id, i]));
    items = got.filter((p) => !base.hideOut || p.stock > 0).sort((a, b) => pos.get(a.id) - pos.get(b.id)).slice(0, limit);
  } else if (r.source === 'category') {
    items = r.ref ? await catalog.listProducts({ ...base, category: r.ref }) : [];
  } else if (r.source === 'brand') {
    items = int(r.ref) ? await catalog.listProducts({ ...base, brandId: int(r.ref) }) : [];
  } else if (r.source === 'price') {
    items = await catalog.listProducts({ ...base, minPrice: r.min_price, maxPrice: r.max_price });
  } else if (r.source === 'search') {
    items = r.ref ? await catalog.listProducts({ ...base, q: r.ref }) : [];
  } else if (r.source === 'offers') {
    items = await catalog.listProducts({ ...base, offer: true });
  } else if (r.source === 'new') {
    items = await catalog.listProducts({ ...base, sort: 'new' });
  } else if (r.source === 'bestsellers') {
    items = (await catalog.listProducts({ ...base, sort: 'popular' })).filter((p) => p.sold_count > 0);
  } else if (r.source === 'featured') {
    items = await catalog.listProducts({ ...base, featured: true });
  }
  return items;
}

// Where "সব দেখুন" goes for this row.
function linkFor(r) {
  if (r.source === 'category' && r.ref) return `/products?cat=${encodeURIComponent(r.ref)}`;
  if (r.source === 'search' && r.ref) return `/products?q=${encodeURIComponent(r.ref)}`;
  if (r.source === 'offers') return '/products?sort=offer';
  if (r.source === 'new') return '/products?sort=new';
  if (r.source === 'bestsellers') return '/products?sort=popular';
  if (r.source === 'price') return '/products?sort=price_asc';
  return '/products';
}

module.exports = { SOURCES, SORTS, STYLES, KEY_RE, keyOf, idOf, list, get, save, productsFor, linkFor, skusOf };

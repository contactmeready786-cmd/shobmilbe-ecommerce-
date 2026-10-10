'use strict';
// Recycle bin (রিসাইকেল বিন). Whatever anyone deletes in the admin is taken off the shop at once,
// but a full copy is kept here — what it was, who deleted it, when and from which page — until the
// owner restores it or deletes it for good.
//
// How: before the real delete, the row and the rows that belong to it are copied into `trash`
// (as JSON); pictures are not copied, they are just set aside (owner_type 'trash:…'). Restoring puts
// the same rows back with the same ids.
const { q, one, tx } = require('../db');
const { int } = require('../util');

// What each kind of thing is, and what belongs to it.
const KINDS = {
  product: {
    label: 'পণ্য', icon: '📦', table: 'products', name: (r) => r.name,
    // its variants (size / colour …) go with it and come back with it
    children: [['bundle_items', 'bundle_id'], ['bundle_items', 'product_id'], ['products', 'parent_id']], media: 'product',
  },
  category: {
    label: 'ক্যাটাগরি', icon: '🗂️', table: 'categories', name: (r) => r.name,
    // products in it lose their category; sub-categories move one level up — both remembered for restoring
    refs: [['products', 'category_id'], ['categories', 'parent_id']],
  },
  blog_post: { label: 'ব্লগ পোস্ট', icon: '📝', table: 'blog_posts', name: (r) => r.title, media: 'blog' },
  blog_category: { label: 'ব্লগ ক্যাটাগরি', icon: '🗂️', table: 'blog_categories', name: (r) => r.name, refs: [['blog_posts', 'category_id']] },
  page: { label: 'পেজ', icon: '📄', table: 'pages', name: (r) => r.title },
  home_row: { label: 'হোমপেজের নিজের সারি', icon: '🏠', table: 'home_rows', name: (r) => r.title },
  banner: { label: 'ব্যানার', icon: '🖼️', table: 'banners', name: (r) => r.title || `ব্যানার #${r.id}`, imageCol: 'image_id' },
  coupon: { label: 'কুপন', icon: '🏷️', table: 'coupons', name: (r) => r.code },
  transaction: { label: 'হিসাবের এন্ট্রি', icon: '💰', table: 'transactions', name: (r) => `${r.type} ৳${r.amount}${r.note ? ' — ' + r.note : ''}` },
  staff: { label: 'স্টাফ', icon: '👤', table: 'staff', name: (r) => `${r.name} (${r.username})`, guard: (r) => r.role !== 'owner', imageCol: 'photo_id' },
  research_source: { label: 'রিসার্চের দোকান', icon: '🏪', table: 'research_sources', name: (r) => r.name },
  question: { label: 'পণ্যের প্রশ্ন', icon: '❓', table: 'product_questions', name: (r) => String(r.question || '').slice(0, 120) },
  warehouse: { label: 'গুদাম / শাখা', icon: '🏬', table: 'warehouses', name: (r) => r.name, children: [['warehouse_stock', 'warehouse_id']] },
  customer: { label: 'কাস্টমার', icon: '👤', table: 'customers', name: (r) => `${r.name || '(নাম নেই)'} (${r.phone})` },
  // a brand: its products stay, they just lose the brand (given back when it is restored)
  brand: { label: 'ব্র্যান্ড', icon: '🏷️', table: 'brands', name: (r) => r.name, refs: [['products', 'brand_id']], imageCol: 'logo_id' },
  // an order: its items, payments and accounts entries go with it; goods still "taken" go back on the shelf
  order: {
    label: 'অর্ডার', icon: '🧾', table: 'orders', name: (r) => `${r.code} — ${r.customer_name || ''} (${r.phone})`,
    children: [['order_items', 'order_id'], ['payments', 'order_id'], ['transactions', 'order_id']],
  },
};
const RELEASED = new Set(['cancelled', 'returned']);
// Stock of an order's items: back on the shelf (sign +1) when it goes to the bin, taken again (-1) when restored.
async function orderStock(t, items, sign, orderId, note) {
  const catalog = require('./catalog');
  for (const it of items) {
    if (!it.product_id) continue;
    const parts = it.components && it.components.length ? it.components : [{ product_id: it.product_id, qty: it.qty }];
    for (const part of parts) await catalog.moveStock(t, part.product_id, sign * part.qty, sign > 0 ? 'cancel' : 'order', 'order', orderId, note);
    await t.query('UPDATE products SET sold_count = greatest(0, sold_count + $1) WHERE id=$2', [-sign * it.qty, it.product_id]);
  }
}

async function rowsOf(t, table, col, id) {
  return (await t.query(`SELECT row_to_json(x) AS r FROM ${table} x WHERE ${col}=$1`, [id])).rows.map((x) => x.r);
}

// Delete one thing into the bin. who: { id, name, path, ip }. Returns the bin entry id (or null).
async function move(kind, id, who = {}) {
  const K = KINDS[kind];
  if (!K) throw new Error('unknown kind ' + kind);
  id = int(id);
  return tx(async (t) => {
    const row = (await t.query(`SELECT row_to_json(x) AS r FROM ${K.table} x WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!row) return null;
    const r = row.r;
    if (K.guard && !K.guard(r)) return null;
    const data = { row: r, children: {}, refs: {} };
    for (const [table, col] of K.children || []) data.children[`${table}.${col}`] = await rowsOf(t, table, col, id);
    for (const [table, col] of K.refs || []) {
      data.refs[`${table}.${col}`] = (await t.query(`SELECT id FROM ${table} WHERE ${col}=$1`, [id])).rows.map((x) => x.id);
    }
    // pictures are set aside, not copied
    let media = [];
    if (K.media) {
      media = (await t.query(`UPDATE media SET owner_type=$1 WHERE owner_type=$2 AND owner_id=$3 RETURNING id`, ['trash:' + K.media, K.media, id])).rows.map((x) => x.id);
    }
    if (K.imageCol && r[K.imageCol]) {
      await t.query(`UPDATE media SET owner_type='trash:' || coalesce(owner_type, '') WHERE id=$1 AND owner_type NOT LIKE 'trash:%'`, [r[K.imageCol]]);
      media.push(r[K.imageCol]);
    }
    if (kind === 'category') await t.query('UPDATE categories SET parent_id=$2 WHERE parent_id=$1', [id, r.parent_id || null]);
    if (kind === 'brand') await t.query(`UPDATE products SET brand='', brand_id=NULL WHERE brand_id=$1`, [id]);
    if (kind === 'order') {
      if (!RELEASED.has(r.status)) {
        await orderStock(t, data.children['order_items.order_id'] || [], 1, id, 'অর্ডার মুছে ফেলা হয়েছে');
        data.released = true;
      }
      await t.query('DELETE FROM transactions WHERE order_id=$1', [id]);
    }
    await t.query(`DELETE FROM ${K.table} WHERE id=$1`, [id]);
    const e = (await t.query(`INSERT INTO trash(kind, ref_id, name, data, media, deleted_by, deleted_by_name, from_path, ip)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [kind, id, String(K.name(r) || '').slice(0, 300), JSON.stringify(data), media, who.id || null, who.name || '', String(who.path || '').slice(0, 200), String(who.ip || '').slice(0, 60)])).rows[0];
    return e.id;
  });
}

// Every product into the bin at once (owner only). Fast: one statement per step, not one per product.
async function moveAllProducts(who = {}) {
  return tx(async (t) => {
    const n = (await t.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    if (!n) return 0;
    await t.query(`INSERT INTO trash(kind, ref_id, name, data, media, deleted_by, deleted_by_name, from_path, ip)
      SELECT 'product', p.id, p.name,
        jsonb_build_object('row', to_jsonb(p), 'refs', '{}'::jsonb, 'children', jsonb_build_object(
          'bundle_items.bundle_id', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM bundle_items b WHERE b.bundle_id=p.id), '[]'::jsonb),
          'bundle_items.product_id', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM bundle_items b WHERE b.product_id=p.id), '[]'::jsonb))),
        coalesce((SELECT array_agg(m.id) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id), '{}'),
        $1, $2, $3, $4
      FROM products p`, [who.id || null, who.name || '', String(who.path || '').slice(0, 200), String(who.ip || '').slice(0, 60)]);
    await t.query(`UPDATE media SET owner_type='trash:product' WHERE owner_type='product' AND owner_id IN (SELECT id FROM products)`);
    await t.query('DELETE FROM bundle_items');
    await t.query('DELETE FROM products');
    return n;
  });
}

async function list({ kind = '', limit = 200, offset = 0 } = {}) {
  const params = [];
  let where = '';
  if (KINDS[kind]) { params.push(kind); where = 'WHERE kind=$1'; }
  params.push(limit, offset);
  return q(`SELECT id, kind, ref_id, name, media, deleted_by, deleted_by_name, from_path, deleted_at,
      data->'row'->>'sku' AS sku, data->'row'->>'price' AS price, data->'row'->>'image_id' AS image_id
    FROM trash ${where} ORDER BY deleted_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function counts() {
  return q('SELECT kind, count(*)::int AS n FROM trash GROUP BY kind ORDER BY n DESC');
}
async function get(id) { return one('SELECT * FROM trash WHERE id=$1', [int(id)]); }

// Put it back exactly as it was (same id). Returns { ok } or { error }.
async function restore(id) {
  const e = await get(id);
  if (!e) return { error: 'পাওয়া যায়নি।' };
  const K = KINDS[e.kind];
  try {
    await tx(async (t) => {
      const ins = async (table, r) => t.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(r)]);
      const row = { ...e.data.row };
      // a category whose main category is gone goes back to the top level
      if (e.kind === 'category' && row.parent_id) {
        const p = (await t.query('SELECT id FROM categories WHERE id=$1', [row.parent_id])).rows[0];
        if (!p) row.parent_id = null;
      }
      if (e.kind === 'product' && row.category_id) {
        const c = (await t.query('SELECT id FROM categories WHERE id=$1', [row.category_id])).rows[0];
        if (!c) row.category_id = null;
      }
      // a product whose brand or supplier is gone comes back without it
      if (e.kind === 'product' && row.brand_id && !(await t.query('SELECT 1 FROM brands WHERE id=$1', [row.brand_id])).rows.length) { row.brand_id = null; row.brand = ''; }
      if (e.kind === 'product' && row.supplier_id && !(await t.query('SELECT 1 FROM suppliers WHERE id=$1', [row.supplier_id])).rows.length) row.supplier_id = null;
      // a variant comes back only under its main product
      if (e.kind === 'product' && row.parent_id && !(await t.query('SELECT 1 FROM products WHERE id=$1', [row.parent_id])).rows.length) throw new Error('parent');
      const done = await ins(K.table, row);
      if (!done.rowCount) throw new Error('same');
      for (const [key, rows] of Object.entries(e.data.children || {})) {
        const table = key.split('.')[0];
        for (const r of rows) {
          // only parts whose other side still exists
          if (r.bundle_id && r.product_id) {
            const ok = (await t.query('SELECT count(*)::int AS n FROM products WHERE id = ANY($1::int[])', [[r.bundle_id, r.product_id]])).rows[0].n === 2;
            if (!ok) continue;
          }
          await ins(table, r);
        }
      }
      for (const [key, ids] of Object.entries(e.data.refs || {})) {
        const [table, col] = key.split('.');
        if (ids.length) await t.query(`UPDATE ${table} SET ${col}=$1 WHERE id = ANY($2::int[]) AND ${col} IS NOT DISTINCT FROM $3`,
          [e.ref_id, ids, table === 'categories' ? (e.data.row.parent_id || null) : null]);
      }
      if (e.kind === 'order' && e.data.released) await orderStock(t, e.data.children['order_items.order_id'] || [], -1, e.ref_id, 'মুছে ফেলা অর্ডার ফেরত আনা হয়েছে');
      if (e.kind === 'brand') await t.query('UPDATE products SET brand=$1 WHERE brand_id=$2', [row.name, e.ref_id]);
      if (e.kind === 'product') {
        const pid = row.parent_id || ((await t.query('SELECT 1 FROM products WHERE parent_id=$1 LIMIT 1', [e.ref_id])).rows.length ? e.ref_id : null);
        if (pid) await require('./catalog').syncVariants(t, pid);
      }
      if (e.media && e.media.length) {
        await t.query(`UPDATE media SET owner_type=substring(owner_type from 7) WHERE id = ANY($1::int[]) AND owner_type LIKE 'trash:%'`, [e.media]);
        await t.query(`UPDATE media SET owner_type=NULL WHERE id = ANY($1::int[]) AND owner_type=''`, [e.media]);
      }
      await t.query('DELETE FROM trash WHERE id=$1', [e.id]);
    });
  } catch (err) {
    if (String(err.message) === 'parent') return { error: `"${e.name}" একটা ভ্যারিয়েন্ট — আগে এর মূল পণ্যটা ফেরত আনুন।` };
    if (String(err.message) === 'same') return { error: `"${e.name}" ফেরত আনা যায়নি — একই নাম/লিংকের আরেকটা ${K.label} এখন আছে, বা এটা আগেই ফেরত আনা হয়েছে।` };
    if (/duplicate key|unique/i.test(String(err.message))) return { error: `"${e.name}" ফেরত আনা যায়নি — একই নাম/লিংক/কোডের আরেকটা ${K.label} এখন আছে। সেটার নাম বদলে আবার চেষ্টা করুন।` };
    throw err;
  }
  return { ok: true, kind: e.kind, id: e.ref_id };
}

// Gone for good. When no products are left anywhere (shop or bin), SKU numbers start again from 1.
async function purge(ids) {
  const clean = (Array.isArray(ids) ? ids : [ids]).map((x) => int(x)).filter(Boolean);
  if (!clean.length) return 0;
  const n = await tx(async (t) => {
    const rows = (await t.query('DELETE FROM trash WHERE id = ANY($1::int[]) RETURNING media', [clean])).rows;
    const media = rows.flatMap((r) => r.media || []);
    if (media.length) await t.query(`DELETE FROM media WHERE id = ANY($1::int[]) AND owner_type LIKE 'trash:%'`, [media]);
    return rows.length;
  });
  await resetSkuIfEmpty();
  return n;
}
async function purgeAll() {
  const ids = (await q('SELECT id FROM trash')).map((r) => r.id);
  return purge(ids);
}
async function resetSkuIfEmpty() {
  const left = await one(`SELECT (SELECT count(*)::int FROM products) + (SELECT count(*)::int FROM trash WHERE kind='product') AS n`);
  if (left && left.n === 0) await q(`INSERT INTO settings(key, value) VALUES('sku_counter','0') ON CONFLICT (key) DO UPDATE SET value='0'`);
}

module.exports = { KINDS, move, moveAllProducts, list, counts, get, restore, purge, purgeAll };

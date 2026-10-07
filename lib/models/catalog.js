'use strict';
// Categories, products, bundles, images (media) and stock movements.
const { q, one, tx, uniqueSlug } = require('../db');
const { slugify, int, str, youtubeId, amount } = require('../util');

// ---------------------------------------------------------------- media
// sha = exact file fingerprint; phash / phash_m = picture fingerprint (and its mirror image)
// made in the browser, so a resized or re-saved copy of the same photo is still recognised.
const HASH_RE = /^[0-9a-f]{64}$/; // 256-bit picture fingerprint
function cleanHash(h) { const v = String(h ?? '').toLowerCase(); return HASH_RE.test(v) ? v : (v === '' && h !== undefined && h !== null ? '' : null); }
async function saveMedia({ mime, data, thumb, width, height, ownerType = null, ownerId = null, phash, phashM }) {
  const sha = require('crypto').createHash('sha256').update(data).digest('hex');
  const row = await one(
    `INSERT INTO media(mime, data, thumb, width, height, owner_type, owner_id, sha, phash, phash_m) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [mime, data, thumb || null, width || null, height || null, ownerType, ownerId, sha, cleanHash(phash), cleanHash(phashM)]);
  return row.id;
}
// Older pictures get their fingerprint later, from the admin's browser.
async function mediaWithoutHash(limit = 40) {
  return q(`SELECT id FROM media WHERE owner_type='product' AND phash IS NULL ORDER BY id DESC LIMIT $1`, [limit]);
}
async function setMediaHash(id, phash, phashM) {
  const h = cleanHash(phash);
  if (h === null) return;
  await q('UPDATE media SET phash=$1, phash_m=$2 WHERE id=$3 AND phash IS NULL', [h, h ? cleanHash(phashM) : '', int(id)]);
}
// ---------------------------------------------------------------- watermark copies
// Product pictures whose marked copy is missing or was made with older watermark settings.
async function mediaNeedingWatermark(ver, limit = 6) {
  return q(`SELECT id FROM media WHERE owner_type='product' AND wm_ver IS DISTINCT FROM $1 ORDER BY id DESC LIMIT $2`, [ver, limit]);
}
async function watermarkProgress(ver) {
  return one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE wm_ver = $1)::int AS done FROM media WHERE owner_type='product'`, [ver]);
}
async function setWatermark(id, ver, data) {
  await q('UPDATE media SET wm=$1, wm_ver=$2 WHERE id=$3 AND owner_type=$4', [data, ver, int(id), 'product']);
}
// The marked copy when it matches the current settings (null → show the normal picture).
async function getWatermarked(id, ver) {
  return one(`SELECT mime, CASE WHEN wm IS NOT NULL AND wm_ver = $2 THEN wm END AS wm, data FROM media WHERE id=$1`, [id, ver]);
}
async function getMedia(id, wantThumb) {
  return one(`SELECT mime, ${wantThumb ? 'coalesce(thumb, data)' : 'data'} AS data FROM media WHERE id=$1`, [id]);
}
// Give media rows to an owner in the given order; that owner's other media are removed.
async function attachMedia(t, ids, ownerType, ownerId) {
  const clean = ids.map((x) => int(x)).filter((x) => x > 0);
  await t.query(`DELETE FROM media WHERE owner_type=$1 AND owner_id=$2 AND NOT (id = ANY($3::int[]))`, [ownerType, ownerId, clean]);
  for (const [i, id] of clean.entries()) {
    await t.query(`UPDATE media SET owner_type=$1, owner_id=$2, sort=$3 WHERE id=$4 AND (owner_type IS NULL OR (owner_type=$1 AND owner_id=$2))`,
      [ownerType, ownerId, i, id]);
  }
  return clean;
}
// Claim a single uploaded image for a setting/banner etc. (no owner deletion logic).
async function claimMedia(id, ownerType, ownerId = 0) {
  if (!int(id)) return null;
  await q(`UPDATE media SET owner_type=$1, owner_id=$2 WHERE id=$3 AND owner_type IS NULL`, [ownerType, ownerId, int(id)]);
  return int(id);
}
async function deleteMedia(id) { if (int(id)) await q('DELETE FROM media WHERE id=$1', [int(id)]); }
async function cleanupMedia() {
  await q(`DELETE FROM media WHERE owner_type IS NULL AND created_at < now() - interval '1 day'`);
}

// ---------------------------------------------------------------- categories
// Every category (flat, in display order). product_count = this category's own products;
// total_count (added by categoryTree) = its own + all its sub-categories'.
async function listCategories({ includeInactive = true } = {}) {
  const rows = await q(`SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id=c.id AND p.active) AS product_count
            FROM categories c ${includeInactive ? '' : 'WHERE coalesce(c.active, true)'} ORDER BY sort, id`);
  // a sub-category whose main category is hidden is hidden too
  if (!includeInactive) {
    const ids = new Set(rows.map((r) => r.id));
    const all = await q('SELECT id, parent_id, coalesce(active,true) AS active FROM categories');
    const byId = new Map(all.map((r) => [r.id, r]));
    const visible = (c) => { let x = c; for (let i = 0; x && i < 20; i++) { if (!x.active) return false; x = x.parent_id ? byId.get(x.parent_id) : null; } return true; };
    return rows.filter((r) => visible(byId.get(r.id)) && (!r.parent_id || ids.has(r.parent_id)));
  }
  return rows;
}
// Flat list → tree. Each node gets: children[], depth, path (main → … → this), total_count.
function categoryTree(list) {
  const byId = new Map(list.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const parent = c.parent_id && byId.get(c.parent_id);
    if (parent && parent !== c) parent.children.push(c); else roots.push(c);
  }
  const seen = new Set();
  const walk = (nodes, depth, path) => {
    let sum = 0;
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      n.depth = depth; n.path = [...path, n];
      n.total_count = (n.product_count || 0) + walk(n.children, depth + 1, n.path);
      sum += n.total_count;
    }
    return sum;
  };
  walk(roots, 0, []);
  return { roots, byId };
}
// Tree as a flat list in menu order (for selects): [{…, depth}]
function categoryOptions(list) {
  const { roots } = categoryTree(list);
  const out = [];
  const walk = (nodes) => nodes.forEach((n) => { out.push(n); walk(n.children); });
  walk(roots);
  return out;
}
// ids of a category and everything inside it
async function categorySubtree(id) {
  return (await q(`WITH RECURSIVE t AS (SELECT id FROM categories WHERE id=$1
    UNION SELECT c.id FROM categories c JOIN t ON c.parent_id=t.id) SELECT id FROM t`, [int(id)])).map((r) => r.id);
}
async function saveCategory({ id, name, icon, sort, active, imageId, parentId }) {
  const vals = [str(name, 60), str(icon, 8) || '📦', int(sort), active !== false, int(imageId) || null];
  let parent = parentId === undefined ? undefined : (int(parentId) || null);
  if (id && parent) {
    // a category can't go inside itself or inside one of its own sub-categories
    const inside = await categorySubtree(id);
    if (inside.includes(parent)) parent = undefined;
  }
  if (id) {
    await q('UPDATE categories SET name=$1, icon=$2, sort=$3, active=$4, image_id=coalesce($5, image_id) WHERE id=$6', [...vals, id]);
    if (parent !== undefined) await q('UPDATE categories SET parent_id=$1 WHERE id=$2', [parent, id]);
    return id;
  }
  const slug = await uniqueSlug('categories', slugify(name));
  return (await one('INSERT INTO categories(name,icon,sort,active,image_id,slug,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [...vals, slug, parent || null])).id;
}
// Deleting a category: its sub-categories move up one level, its products become uncategorised.
async function deleteCategory(id) {
  await tx(async (t) => {
    await t.query('UPDATE categories SET parent_id=(SELECT parent_id FROM categories WHERE id=$1) WHERE parent_id=$1', [id]);
    await t.query('DELETE FROM categories WHERE id=$1', [id]);
  });
}

// ---------------------------------------------------------------- products
const STOCK_EXPR = `CASE WHEN p.product_type='bundle' THEN
  coalesce((SELECT min(c2.stock / greatest(bi.qty,1)) FROM bundle_items bi JOIN products c2 ON c2.id=bi.product_id WHERE bi.bundle_id=p.id), 0)
  ELSE p.stock END`;
const PRODUCT_COLS = `p.id, p.name, p.slug, p.category_id, p.price, p.old_price, ${STOCK_EXPR} AS stock, p.stock AS own_stock,
  p.description, p.short_description, p.emoji, p.image_id, (p.image_id IS NOT NULL) AS has_image, p.featured, p.active,
  p.sku, p.cost_price, p.youtube_url, p.product_type, p.seo_title, p.seo_description, p.seo_keywords, p.low_stock, p.weight_g, p.unit,
  p.brand, p.allow_duplicate, p.sold_count, p.created_at, p.updated_at, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon`;

function productWhere({ category, categoryId, q: search, featured, includeInactive, type, lowStock, offer, maxPrice }, params) {
  const where = [];
  if (maxPrice) { params.push(Number(maxPrice)); where.push(`p.price <= $${params.length}`); }
  if (!includeInactive) where.push('p.active');
  // a category shows its own products and those of all its sub-categories
  const SUBTREE = (cond) => `p.category_id IN (WITH RECURSIVE t AS (SELECT id FROM categories WHERE ${cond}
    UNION SELECT c3.id FROM categories c3 JOIN t ON c3.parent_id=t.id) SELECT id FROM t)`;
  if (category) { params.push(category); where.push(SUBTREE(`slug=$${params.length}`)); }
  if (categoryId) { params.push(int(categoryId)); where.push(SUBTREE(`id=$${params.length}`)); }
  if (featured) where.push('p.featured');
  if (type) { params.push(type); where.push(`p.product_type=$${params.length}`); }
  if (offer) where.push('p.old_price > p.price');
  if (lowStock) where.push(`(${STOCK_EXPR}) <= p.low_stock`);
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.short_description ILIKE $${n} OR c.name ILIKE $${n} OR p.brand ILIKE $${n})`);
  }
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}
const SORTS = {
  price_asc: 'p.price ASC', price_desc: 'p.price DESC', new: 'p.created_at DESC', popular: 'p.sold_count DESC, p.created_at DESC',
  name: 'p.name ASC', stock_asc: 'stock ASC', offer: '(p.old_price - p.price) DESC NULLS LAST',
};
async function listProducts(opts = {}) {
  const params = [];
  const where = productWhere(opts, params);
  const order = SORTS[opts.sort] || 'p.featured DESC, (p.stock > 0 OR p.product_type=\'bundle\') DESC, p.created_at DESC';
  let sql = `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where} ORDER BY ${order}, p.id DESC`;
  if (opts.limit) { params.push(opts.limit); sql += ` LIMIT $${params.length}`; }
  if (opts.offset) { params.push(opts.offset); sql += ` OFFSET $${params.length}`; }
  return q(sql, params);
}
async function countProducts(opts = {}) {
  const params = [];
  const where = productWhere(opts, params);
  return (await one(`SELECT count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where}`, params)).n;
}
async function getProduct({ id, slug }) {
  const p = await one(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${id ? 'p.id=$1' : 'p.slug=$1'}`, [id || slug]);
  if (!p) return null;
  p.images = (await q(`SELECT id FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id`, [p.id])).map((r) => r.id);
  if (!p.images.length && p.image_id) p.images = [p.image_id];
  p.bundle = p.product_type === 'bundle' ? await bundleItems(p.id) : [];
  return p;
}
async function getProductsByIds(ids, { includeInactive = false } = {}) {
  const clean = ids.map((x) => int(x)).filter((x) => x > 0);
  if (!clean.length) return [];
  return q(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id
            WHERE p.id = ANY($1::int[]) ${includeInactive ? '' : 'AND p.active'}`, [clean]);
}
async function bundleItems(bundleId) {
  return q(`SELECT bi.product_id, bi.qty, p.name, p.sku, p.stock, p.price, p.cost_price, p.image_id, p.emoji
            FROM bundle_items bi JOIN products p ON p.id=bi.product_id WHERE bi.bundle_id=$1 ORDER BY bi.id`, [bundleId]);
}

// ---------------------------------------------------------------- automatic SKU (1, 2, 3 …)
// Every new product gets the next number by itself. A number is never handed out twice,
// even if that product is deleted later, and numbers typed by hand are skipped.
const SKU_LOCK = 726301;
async function takeSku(t) {
  await t.query('SELECT pg_advisory_xact_lock($1)', [SKU_LOCK]);
  const r = (await t.query(`SELECT greatest(
      coalesce((SELECT value::bigint FROM settings WHERE key='sku_counter' AND value ~ '^[0-9]{1,15}$'), 0),
      coalesce((SELECT max(sku::bigint) FROM products WHERE sku ~ '^[0-9]{1,15}$'), 0)) + 1 AS n`)).rows[0];
  const n = String(r.n);
  await t.query(`INSERT INTO settings(key, value) VALUES('sku_counter', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [n]);
  return n;
}
// The number the next new product will get (shown on the "new product" form).
async function nextSku() {
  const r = await one(`SELECT greatest(
      coalesce((SELECT value::bigint FROM settings WHERE key='sku_counter' AND value ~ '^[0-9]{1,15}$'), 0),
      coalesce((SELECT max(sku::bigint) FROM products WHERE sku ~ '^[0-9]{1,15}$'), 0)) + 1 AS n`);
  return String(r ? r.n : 1);
}

async function skuTaken(sku, exceptId) {
  if (!sku) return false;
  const r = await one('SELECT id FROM products WHERE lower(sku)=lower($1) AND id<>$2', [sku, exceptId || 0]);
  return !!r;
}

const MAX_PRODUCT_IMAGES = 6;
// "a, b ,, c" -> "a, b, c" (no empty or repeated words)
function cleanKeywords(v) {
  const seen = new Set();
  return String(v || '').split(/[,،\n]+/).map((k) => k.replace(/\s+/g, ' ').trim()).filter((k) => {
    const key = k.toLowerCase();
    if (!k || seen.has(key)) return false;
    seen.add(key); return true;
  }).join(', ').slice(0, 300);
}

// Create or update a product with its images and bundle parts. Returns the id.
async function saveProduct(data, staffId) {
  const type = data.product_type === 'bundle' ? 'bundle' : 'single';
  const f = {
    name: str(data.name, 140),
    category_id: int(data.category_id) || null,
    price: amount(data.price),
    old_price: amount(data.old_price) > 0 ? amount(data.old_price) : null,
    cost_price: amount(data.cost_price),
    short_description: str(data.short_description, 1000),
    description: str(data.description, 20000),
    emoji: str(data.emoji, 8) || '📦',
    featured: !!data.featured,
    active: !!data.active,
    sku: str(data.sku, 60),
    youtube_url: youtubeId(data.youtube_url) ? `https://www.youtube.com/watch?v=${youtubeId(data.youtube_url)}` : '',
    product_type: type,
    seo_title: str(data.seo_title, 120),
    seo_description: str(data.seo_description, 300),
    seo_keywords: cleanKeywords(data.seo_keywords),
    low_stock: Math.max(0, int(data.low_stock, 3)),
    weight_g: Math.max(0, int(data.weight_g)),
    unit: str(data.unit, 20) || 'পিস',
    brand: str(data.brand, 60),
    allow_duplicate: !!data.allow_duplicate,
  };
  const images = (Array.isArray(data.images) ? data.images : String(data.images || '').split(','))
    .map((x) => int(x)).filter((x) => x > 0).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_PRODUCT_IMAGES);
  const parts = (data.bundle || []).map((b) => ({ product_id: int(b.product_id), qty: Math.max(1, int(b.qty, 1)) }))
    .filter((b) => b.product_id > 0);
  const newStock = type === 'bundle' ? 0 : Math.max(0, int(data.stock));
  const id = int(data.id) || null;

  return tx(async (t) => {
    let pid = id;
    const cols = Object.keys(f);
    if (pid) {
      const before = (await t.query('SELECT stock, sku FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!before) throw new Error('Product not found');
      // A product never stays without a SKU: an emptied box gets the next number.
      if (!f.sku) f.sku = before.sku || await takeSku(t);
      await t.query(`UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}, updated_at=now() WHERE id=$${cols.length + 1}`,
        [...cols.map((c) => f[c]), pid]);
      if (type === 'single' && data.stock !== undefined && newStock !== before.stock) {
        await moveStock(t, pid, newStock - before.stock, 'adjust', 'product', pid, 'পণ্য এডিট থেকে স্টক বদল', staffId);
      }
    } else {
      if (!f.sku) f.sku = await takeSku(t);
      const slug = await uniqueSlug('products', slugify(f.name) === 'item' ? 'product' : slugify(f.name));
      pid = (await t.query(`INSERT INTO products(${cols.join(',')}, slug, stock) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, 0) RETURNING id`,
        [...cols.map((c) => f[c]), slug])).rows[0].id;
      if (data.import_ref) await t.query('UPDATE products SET import_ref=$1 WHERE id=$2', [str(data.import_ref, 300), pid]);
      if (type === 'single' && newStock > 0) await moveStock(t, pid, newStock, 'opening', 'product', pid, 'শুরুর স্টক', staffId);
    }
    const kept = await attachMedia(t, images, 'product', pid);
    const main = (await t.query(`SELECT id FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id LIMIT 1`, [pid])).rows[0];
    await t.query('UPDATE products SET image_id=$1 WHERE id=$2', [main ? main.id : null, pid]);
    void kept;
    await t.query('DELETE FROM bundle_items WHERE bundle_id=$1', [pid]);
    if (type === 'bundle') {
      for (const part of parts) {
        if (part.product_id === pid) continue;
        const ok = (await t.query(`SELECT id FROM products WHERE id=$1 AND product_type='single'`, [part.product_id])).rows[0];
        if (ok) await t.query('INSERT INTO bundle_items(bundle_id, product_id, qty) VALUES($1,$2,$3)', [pid, part.product_id, part.qty]);
      }
    }
    return pid;
  });
}

async function deleteProduct(id) {
  await tx(async (t) => {
    await t.query(`DELETE FROM media WHERE owner_type='product' AND owner_id=$1`, [id]);
    await t.query('DELETE FROM products WHERE id=$1', [id]);
  });
}
// Remove every product (with its pictures and stock history) and start SKU numbers again from 1.
// Old orders keep the product name and price they were placed with.
async function deleteAllProducts() {
  return tx(async (t) => {
    const n = (await t.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    await t.query(`DELETE FROM media WHERE owner_type='product'`);
    await t.query('DELETE FROM stock_movements');
    await t.query('DELETE FROM bundle_items');
    await t.query('DELETE FROM products');
    await t.query('SELECT pg_advisory_xact_lock($1)', [SKU_LOCK]);
    await t.query(`INSERT INTO settings(key, value) VALUES('sku_counter', '0') ON CONFLICT (key) DO UPDATE SET value='0'`);
    return n;
  });
}
async function duplicateProduct(id, staffId) {
  const p = await getProduct({ id });
  if (!p) return null;
  return saveProduct({ ...p, id: null, name: p.name + ' (কপি)', sku: '', active: false, images: [], stock: 0, allow_duplicate: false,
    bundle: p.bundle }, staffId);
}

// ---------------------------------------------------------------- stock
// Change a product's stock by `change` and record why. With mustHave=true the
// call fails (returns null) instead of going below zero.
async function moveStock(t, productId, change, reason, refType = '', refId = null, note = '', staffId = null, mustHave = false) {
  if (!change) return true;
  const res = await t.query(
    `UPDATE products SET stock = ${mustHave ? 'stock + $1' : 'greatest(0, stock + $1)'}, updated_at=now()
     WHERE id=$2 ${mustHave ? 'AND stock + $1 >= 0' : ''} RETURNING stock`, [change, productId]);
  if (!res.rows.length) return null;
  await t.query(`INSERT INTO stock_movements(product_id, change, balance, reason, ref_type, ref_id, note, staff_id)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [productId, change, res.rows[0].stock, reason, refType, refId, note, staffId]);
  return true;
}

// The real stock parts a cart line uses: a bundle uses its components.
async function stockParts(t, productId, qty) {
  const p = (await t.query('SELECT id, product_type FROM products WHERE id=$1', [productId])).rows[0];
  if (!p) return [];
  if (p.product_type !== 'bundle') return [{ product_id: productId, qty }];
  const parts = (await t.query('SELECT product_id, qty FROM bundle_items WHERE bundle_id=$1', [productId])).rows;
  return parts.map((x) => ({ product_id: x.product_id, qty: x.qty * qty }));
}

const STOCK_REASONS = {
  opening: 'শুরুর স্টক', order: 'অর্ডার', cancel: 'অর্ডার বাতিল/ফেরত', edit: 'অর্ডার এডিট', purchase: 'পারচেজ (কেনা)',
  purchase_cancel: 'পারচেজ বাতিল', adjust: 'হাতে বদল', damage: 'নষ্ট/ভাঙা', lost: 'হারানো', count: 'গণনা ঠিক করা', return: 'কাস্টমার ফেরত',
};
async function stockMovements({ productId, limit = 100 } = {}) {
  const params = [];
  let where = '';
  if (productId) { params.push(productId); where = 'WHERE m.product_id=$1'; }
  params.push(limit);
  return q(`SELECT m.*, p.name AS product_name, p.sku, s.name AS staff_name FROM stock_movements m
            LEFT JOIN products p ON p.id=m.product_id LEFT JOIN staff s ON s.id=m.staff_id
            ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length}`, params);
}

async function inventorySummary() {
  return one(`SELECT count(*)::int AS products,
      coalesce(sum(stock),0)::int AS units,
      coalesce(sum(stock * cost_price),0)::numeric(14,2) AS cost_value,
      coalesce(sum(stock * price),0)::numeric(14,2) AS sale_value,
      count(*) FILTER (WHERE stock <= low_stock)::int AS low,
      count(*) FILTER (WHERE stock = 0)::int AS out
    FROM products WHERE active AND product_type='single'`);
}

module.exports = {
  saveMedia, mediaWithoutHash, setMediaHash, getMedia, mediaNeedingWatermark, watermarkProgress, setWatermark, getWatermarked, attachMedia, claimMedia, deleteMedia, cleanupMedia,
  listCategories, categoryTree, categoryOptions, categorySubtree, saveCategory, deleteCategory,
  listProducts, countProducts, getProduct, getProductsByIds, bundleItems, saveProduct, deleteProduct, deleteAllProducts, duplicateProduct, skuTaken, nextSku,
  moveStock, stockParts, stockMovements, inventorySummary, STOCK_REASONS, MAX_PRODUCT_IMAGES,
};

'use strict';
// Categories, products, bundles, images (media) and stock movements.
const { q, one, tx, uniqueSlug } = require('../db');
const { slugify, int, str, youtubeId } = require('../util');

// ---------------------------------------------------------------- media
async function saveMedia({ mime, data, thumb, width, height, ownerType = null, ownerId = null }) {
  const row = await one(
    `INSERT INTO media(mime, data, thumb, width, height, owner_type, owner_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [mime, data, thumb || null, width || null, height || null, ownerType, ownerId]);
  return row.id;
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
async function listCategories({ includeInactive = true } = {}) {
  return q(`SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id=c.id AND p.active) AS product_count
            FROM categories c ${includeInactive ? '' : 'WHERE coalesce(c.active, true)'} ORDER BY sort, id`);
}
async function saveCategory({ id, name, icon, sort, active, imageId }) {
  const vals = [str(name, 60), str(icon, 8) || '📦', int(sort), active !== false, int(imageId) || null];
  if (id) {
    await q('UPDATE categories SET name=$1, icon=$2, sort=$3, active=$4, image_id=coalesce($5, image_id) WHERE id=$6', [...vals, id]);
    return id;
  }
  const slug = await uniqueSlug('categories', slugify(name));
  return (await one('INSERT INTO categories(name,icon,sort,active,image_id,slug) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [...vals, slug])).id;
}
async function deleteCategory(id) { await q('DELETE FROM categories WHERE id=$1', [id]); }

// ---------------------------------------------------------------- products
const STOCK_EXPR = `CASE WHEN p.product_type='bundle' THEN
  coalesce((SELECT min(c2.stock / greatest(bi.qty,1)) FROM bundle_items bi JOIN products c2 ON c2.id=bi.product_id WHERE bi.bundle_id=p.id), 0)
  ELSE p.stock END`;
const PRODUCT_COLS = `p.id, p.name, p.slug, p.category_id, p.price, p.old_price, ${STOCK_EXPR} AS stock, p.stock AS own_stock,
  p.description, p.short_description, p.emoji, p.image_id, (p.image_id IS NOT NULL) AS has_image, p.featured, p.active,
  p.sku, p.cost_price, p.youtube_url, p.product_type, p.seo_title, p.seo_description, p.seo_keywords, p.low_stock, p.weight_g, p.unit,
  p.brand, p.sold_count, p.created_at, p.updated_at, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon`;

function productWhere({ category, categoryId, q: search, featured, includeInactive, type, lowStock, offer }, params) {
  const where = [];
  if (!includeInactive) where.push('p.active');
  if (category) { params.push(category); where.push(`c.slug=$${params.length}`); }
  if (categoryId) { params.push(int(categoryId)); where.push(`p.category_id=$${params.length}`); }
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
    price: Math.max(0, int(data.price)),
    old_price: int(data.old_price) > 0 ? int(data.old_price) : null,
    cost_price: Math.max(0, int(data.cost_price)),
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
      const before = (await t.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!before) throw new Error('Product not found');
      await t.query(`UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}, updated_at=now() WHERE id=$${cols.length + 1}`,
        [...cols.map((c) => f[c]), pid]);
      if (type === 'single' && data.stock !== undefined && newStock !== before.stock) {
        await moveStock(t, pid, newStock - before.stock, 'adjust', 'product', pid, 'পণ্য এডিট থেকে স্টক বদল', staffId);
      }
    } else {
      const slug = await uniqueSlug('products', slugify(f.name) === 'item' ? 'product' : slugify(f.name));
      pid = (await t.query(`INSERT INTO products(${cols.join(',')}, slug, stock) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, 0) RETURNING id`,
        [...cols.map((c) => f[c]), slug])).rows[0].id;
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
async function duplicateProduct(id, staffId) {
  const p = await getProduct({ id });
  if (!p) return null;
  return saveProduct({ ...p, id: null, name: p.name + ' (কপি)', sku: '', active: false, images: [], stock: 0,
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
      coalesce(sum(stock * cost_price),0)::bigint AS cost_value,
      coalesce(sum(stock * price),0)::bigint AS sale_value,
      count(*) FILTER (WHERE stock <= low_stock)::int AS low,
      count(*) FILTER (WHERE stock = 0)::int AS out
    FROM products WHERE active AND product_type='single'`);
}

module.exports = {
  saveMedia, getMedia, attachMedia, claimMedia, deleteMedia, cleanupMedia,
  listCategories, saveCategory, deleteCategory,
  listProducts, countProducts, getProduct, getProductsByIds, bundleItems, saveProduct, deleteProduct, duplicateProduct, skuTaken,
  moveStock, stockParts, stockMovements, inventorySummary, STOCK_REASONS, MAX_PRODUCT_IMAGES,
};

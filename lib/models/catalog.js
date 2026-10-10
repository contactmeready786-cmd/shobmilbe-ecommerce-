'use strict';
// Categories, products, bundles, images (media) and stock movements.
const { q, one, tx, uniqueSlug } = require('../db');
const { slugify, int, str, youtubeId, amount } = require('../util');
const imagekit = require('../services/imagekit');

// ---------------------------------------------------------------- media
// sha = exact file fingerprint; phash / phash_m = picture fingerprint (and its mirror image)
// made in the browser, so a resized or re-saved copy of the same photo is still recognised.
const HASH_RE = /^[0-9a-f]{64}$/; // 256-bit picture fingerprint
function cleanHash(h) { const v = String(h ?? '').toLowerCase(); return HASH_RE.test(v) ? v : (v === '' && h !== undefined && h !== null ? '' : null); }
// The picture itself goes to ImageKit (when set up); the database keeps its address and fingerprints.
// keepPrivate: profile / face photos never leave the database.
async function saveMedia({ mime, data, thumb, width, height, ownerType = null, ownerId = null, phash, phashM, keepPrivate = false }) {
  const sha = require('crypto').createHash('sha256').update(data).digest('hex');
  let ik = null;
  if (!keepPrivate && ownerType !== 'staff' && imagekit.configured()) {
    try { ik = await imagekit.upload(data, mime, sha.slice(0, 16)); } catch (e) { console.error('ImageKit upload failed, kept in database:', e.message); }
  }
  const row = await one(
    `INSERT INTO media(mime, data, thumb, width, height, owner_type, owner_id, sha, phash, phash_m, ik_url, ik_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [mime, ik ? null : data, ik ? null : (thumb || null), width || null, height || null, ownerType, ownerId, sha, cleanHash(phash), cleanHash(phashM), ik ? ik.url : null, ik ? ik.fileId : null]);
  return row.id;
}
// A picture that has to stay private (staff photo): bring it back from ImageKit into the database.
async function keepPrivate(id) {
  const m = await one('SELECT ik_url, ik_id FROM media WHERE id=$1', [int(id)]);
  if (!m || !m.ik_url) return;
  const r = await fetch(m.ik_url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('picture could not be read back');
  await q('UPDATE media SET data=$1, ik_url=NULL, ik_id=NULL WHERE id=$2', [Buffer.from(await r.arrayBuffer()), int(id)]);
  await q('INSERT INTO ik_trash(file_id) VALUES($1) ON CONFLICT DO NOTHING', [m.ik_id]);
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
// waitWhite: while the white background is on, a picture gets its mark only after it has been made white
// (otherwise the mark would be drawn on the old background and then thrown away)
async function mediaNeedingWatermark(ver, limit = 6, waitWhite = false) {
  return q(`SELECT id FROM media WHERE owner_type='product' AND wm_ver IS DISTINCT FROM $1
    ${waitWhite ? "AND (ik_url IS NULL OR wb_state IN ('done','already','kept','skip','fail','need_ai'))" : ''} ORDER BY id DESC LIMIT $2`, [ver, limit]);
}
async function watermarkProgress(ver) {
  return one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE wm_ver = $1)::int AS done FROM media WHERE owner_type='product'`, [ver]);
}
async function setWatermark(id, ver, data) {
  if (data && imagekit.configured()) {
    try {
      const w = await imagekit.upload(data, 'image/jpeg', `m${int(id)}-wm`, 'wm');
      await q('UPDATE media SET wm=NULL, wm_url=$1, wm_ik_id=$2, wm_ver=$3 WHERE id=$4 AND owner_type=$5', [w.url, w.fileId, ver, int(id), 'product']);
      return;
    } catch (e) { console.error('ImageKit watermark upload failed, kept in database:', e.message); }
  }
  await q('UPDATE media SET wm=$1, wm_url=NULL, wm_ik_id=NULL, wm_ver=$2 WHERE id=$3 AND owner_type=$4', [data, ver, int(id), 'product']);
}
// The marked copy when it matches the current settings (null → show the normal picture).
async function getWatermarked(id, ver) {
  return one(`SELECT mime, CASE WHEN wm IS NOT NULL AND wm_ver = $2 THEN wm END AS wm, CASE WHEN wm_url IS NOT NULL AND wm_ver = $2 THEN wm_url END AS wm_url, data, ik_url, wb_orig_url, wb_orig_mime FROM media WHERE id=$1
    AND (owner_type IS NULL OR owner_type NOT IN ('staff', 'trash:staff', 'return', 'complaint', 'review_wait'))`, [id, ver]);
}
async function getMedia(id, wantThumb) {
  // staff profile pictures are private: only the admin sees them (/admin/avatar/<staff id>)
  return one(`SELECT mime, ${wantThumb ? 'coalesce(thumb, data)' : 'data'} AS data, ik_url, wb_orig_url, wb_orig_mime FROM media WHERE id=$1
    AND (owner_type IS NULL OR owner_type NOT IN ('staff', 'trash:staff', 'return', 'complaint', 'review_wait'))`, [id]);
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
  const rows = await q(`SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id=c.id AND p.active AND p.parent_id IS NULL) AS product_count
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
async function saveCategory({ id, name, icon, sort, active, imageId, parentId, seo, sizeChart }) {
  const vals = [str(name, 60), str(icon, 8) || '📦', int(sort), active !== false, int(imageId) || null];
  // SEO title / description, the text shown above the products, and a wide banner picture (Admin → ক্যাটাগরি → SEO ও ব্যানার)
  const saveSeo = async (cid) => {
    if (sizeChart !== undefined) await q('UPDATE categories SET size_chart=$1 WHERE id=$2', [str(sizeChart, 3000), cid]);
    if (!seo) return;
    await q('UPDATE categories SET seo_title=$1, seo_description=$2, description=$3, banner_id=$4, noindex=$5 WHERE id=$6',
      [str(seo.title, 120), str(seo.description, 300), str(seo.text, 3000), int(seo.bannerId) || null, !!seo.noindex, cid]);
  };
  let parent = parentId === undefined ? undefined : (int(parentId) || null);
  if (id && parent) {
    // a category can't go inside itself or inside one of its own sub-categories
    const inside = await categorySubtree(id);
    if (inside.includes(parent)) parent = undefined;
  }
  if (id) {
    await q('UPDATE categories SET name=$1, icon=$2, sort=$3, active=$4, image_id=coalesce($5, image_id) WHERE id=$6', [...vals, id]);
    if (parent !== undefined) await q('UPDATE categories SET parent_id=$1 WHERE id=$2', [parent, id]);
    await saveSeo(id);
    return id;
  }
  const slug = await uniqueSlug('categories', slugify(name));
  const nid = (await one('INSERT INTO categories(name,icon,sort,active,image_id,slug,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [...vals, slug, parent || null])).id;
  await saveSeo(nid);
  return nid;
}
// Deleting a category: its sub-categories move up one level, its products become uncategorised.
async function deleteCategory(id) {
  await tx(async (t) => {
    await t.query('UPDATE categories SET parent_id=(SELECT parent_id FROM categories WHERE id=$1) WHERE parent_id=$1', [id]);
    await t.query('DELETE FROM categories WHERE id=$1', [id]);
  });
}

// ---------------------------------------------------------------- products
const STOCK_EXPR = `CASE WHEN p.variant_count > 0 THEN
  coalesce((SELECT sum(greatest(v.stock, 0)) FROM products v WHERE v.parent_id=p.id AND v.active), 0)::int
  WHEN p.product_type='bundle' THEN
  coalesce((SELECT min(c2.stock / greatest(bi.qty,1)) FROM bundle_items bi JOIN products c2 ON c2.id=bi.product_id WHERE bi.bundle_id=p.id), 0)
  ELSE p.stock END`;
// A running flash sale: the lowest sale price for this product right now (null when there is none).
// A sale item with a piece limit ends for that product once the limit is sold.
const FLASH_SUB = `(SELECT min(fi.price) FROM flash_items fi JOIN flash_sales fs ON fs.id=fi.sale_id
  WHERE fi.product_id=p.id AND fs.active AND now() >= fs.starts_at AND now() < fs.ends_at AND (fi.max_qty = 0 OR fi.sold < fi.max_qty) AND fi.price < p.price)`;
const FLASH_END = `(SELECT min(fs.ends_at) FROM flash_items fi JOIN flash_sales fs ON fs.id=fi.sale_id
  WHERE fi.product_id=p.id AND fs.active AND now() >= fs.starts_at AND now() < fs.ends_at AND (fi.max_qty = 0 OR fi.sold < fi.max_qty) AND fi.price < p.price)`;
// Shop side: the price customers pay now (flash sale price when one runs; the normal price shows crossed out).
const PRICE_COLS = `coalesce(${FLASH_SUB}, p.price) AS price,
  CASE WHEN ${FLASH_SUB} IS NOT NULL THEN greatest(coalesce(p.old_price, 0), p.price) ELSE p.old_price END AS old_price,
  ${FLASH_END} AS flash_ends, p.price AS base_price`;
const PUBLIC_COLS = `p.id, p.name, p.slug, p.category_id, ${PRICE_COLS}, ${STOCK_EXPR} AS stock, p.stock AS own_stock,
  p.description, p.short_description, p.emoji, p.image_id, (p.image_id IS NOT NULL) AS has_image, p.featured, p.active,
  p.sku, p.youtube_url, p.product_type, p.seo_title, p.seo_description, p.seo_keywords, p.low_stock, p.weight_g, p.unit,
  p.brand, p.brand_id, (SELECT slug FROM brands WHERE id=p.brand_id AND active) AS brand_slug, p.model, p.specs, p.is_new, p.noindex, p.warranty, p.warranty_type, p.barcode,
  p.allow_duplicate, (p.preorder OR coalesce((SELECT pp.preorder FROM products pp WHERE pp.id=p.parent_id), false)) AS preorder,
  greatest(p.preorder_days, coalesce((SELECT pp.preorder_days FROM products pp WHERE pp.id=p.parent_id), 0)) AS preorder_days, p.sold_count, p.wish_count, p.rating_avg, p.rating_count, p.created_at, p.updated_at,
  p.parent_id, p.variant_label, p.variant_count, p.variant_title,
  c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon`;
// The admin also sees the buying price, damaged stock and the usual supplier.
// The shop side (customers, robots, feeds) never even loads these — they are not in the public query at all.
// In the admin the price is the saved normal price (so editing never saves a sale price by mistake).
const PRODUCT_COLS = PUBLIC_COLS.replace(PRICE_COLS, `p.price, p.old_price, ${FLASH_SUB} AS flash_price, ${FLASH_END} AS flash_ends, p.price AS base_price`)
  + ', p.cost_price, p.damaged_stock, p.supplier_id';
if (/cost|supplier|damaged/.test(PUBLIC_COLS)) throw new Error('PUBLIC_COLS must not contain private columns');
const colsFor = (o) => (o && o.public ? PUBLIC_COLS : PRODUCT_COLS);

function productWhere({ hideOut, category, categoryId, brandId, brandIds, damaged, supplierId, q: search, featured, includeInactive, type, lowStock, offer, maxPrice, minPrice, status, outStock, inStock, isNew, newDays, items, ids, specs }, params) {
  const where = [];
  // Variants (size / colour / model) are products of their own under a "parent" product.
  // Lists show the parent only; items=true (stock, orders, counter sale) shows each variant instead of its parent.
  where.push(items ? 'p.variant_count = 0' : 'p.parent_id IS NULL');
  if (brandId) { params.push(int(brandId)); where.push(`p.brand_id=$${params.length}`); }
  if (isNew) { params.push(Math.max(0, int(newDays))); where.push(`(p.is_new OR ($${params.length} > 0 AND p.created_at > now() - make_interval(days => $${params.length})))`); }
  // price filters use the price the customer pays now (a running flash-sale price counts)
  if (maxPrice) { params.push(Number(maxPrice)); where.push(`coalesce(${FLASH_SUB}, p.price) <= $${params.length}`); }
  if (minPrice) { params.push(Number(minPrice)); where.push(`coalesce(${FLASH_SUB}, p.price) >= $${params.length}`); }
  if (Array.isArray(brandIds) && brandIds.length) { params.push(brandIds.map(int).filter((x) => x > 0)); where.push(`p.brand_id = ANY($${params.length}::int[])`); }
  if (inStock) where.push(`(${STOCK_EXPR}) > 0`);
  // spec filters: { "voltage": ["12v", "5v"], "watt": ["60w"] } — values of one spec are OR, different specs are AND
  if (specs && typeof specs === 'object') {
    for (const [k, vals] of Object.entries(specs).slice(0, 6)) {
      if (!Array.isArray(vals) || !vals.length) continue;
      params.push(String(k).toLowerCase().trim()); const kn = params.length;
      params.push(vals.slice(0, 20).map((v) => String(v).toLowerCase().trim())); const vn = params.length;
      where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.specs)='array' THEN p.specs ELSE '[]'::jsonb END) e
        WHERE lower(trim(e->>0)) = $${kn} AND lower(trim(e->>1)) = ANY($${vn}::text[]))`);
    }
  }
  // smart search (shop side): the matching product ids, already ranked
  if (Array.isArray(ids)) { params.push(ids.map(int)); where.push(`p.id = ANY($${params.length}::int[])`); }
  if (!includeInactive) where.push('p.active');
  if (status === 'on') where.push('p.active');
  if (status === 'off') where.push('NOT p.active');
  if (outStock) where.push(`(${STOCK_EXPR}) <= 0`);
  // a category shows its own products and those of all its sub-categories
  const SUBTREE = (cond) => `p.category_id IN (WITH RECURSIVE t AS (SELECT id FROM categories WHERE ${cond}
    UNION SELECT c3.id FROM categories c3 JOIN t ON c3.parent_id=t.id) SELECT id FROM t)`;
  if (category) { params.push(category); where.push(SUBTREE(`slug=$${params.length}`)); }
  if (categoryId) { params.push(int(categoryId)); where.push(SUBTREE(`id=$${params.length}`)); }
  if (featured) where.push('p.featured');
  if (type) { params.push(type); where.push(`p.product_type=$${params.length}`); }
  if (offer) where.push(`(p.old_price > p.price OR ${FLASH_SUB} IS NOT NULL)`);
  if (lowStock) where.push(`(${STOCK_EXPR}) <= p.low_stock`);
  if (hideOut) where.push(`(${STOCK_EXPR}) > 0`);
  if (damaged) where.push('p.damaged_stock > 0');
  if (supplierId) { params.push(int(supplierId)); where.push(`p.supplier_id=$${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.model ILIKE $${n} OR p.short_description ILIKE $${n} OR c.name ILIKE $${n} OR p.brand ILIKE $${n} OR p.barcode ILIKE $${n})`);
  }
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}
const SORTS = {
  price_asc: 'p.price ASC', price_desc: 'p.price DESC', new: 'p.created_at DESC', popular: 'p.sold_count DESC, p.created_at DESC',
  name: 'p.name ASC', stock_asc: 'stock ASC', offer: '(p.old_price - p.price) DESC NULLS LAST',
  // SKU 1, 2, 3 … in number order (not 1, 10, 100, 2 …); hand-typed codes come after the numbers
  sku: `(CASE WHEN p.sku ~ '^[0-9]{1,15}$' THEN p.sku::bigint END) ASC NULLS LAST, lower(coalesce(p.sku, '')) ASC, p.id ASC`,
  sku_desc: `(CASE WHEN p.sku ~ '^[0-9]{1,15}$' THEN p.sku::bigint END) DESC NULLS LAST, lower(coalesce(p.sku, '')) DESC`,
};
async function listProducts(opts = {}) {
  const params = [];
  const where = productWhere(opts, params);
  let order = SORTS[opts.sort] || 'p.featured DESC, (p.stock > 0 OR p.product_type=\'bundle\') DESC, p.created_at DESC';
  // smart search with no sort chosen: best match first
  if (Array.isArray(opts.ids) && !SORTS[opts.sort]) { params.push(opts.ids.map(int)); order = `array_position($${params.length}::int[], p.id)`; }
  let sql = `SELECT ${colsFor(opts)} FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where} ORDER BY ${order}, p.id DESC`;
  if (opts.limit) { params.push(opts.limit); sql += ` LIMIT $${params.length}`; }
  if (opts.offset) { params.push(opts.offset); sql += ` OFFSET $${params.length}`; }
  return q(sql, params);
}
async function countProducts(opts = {}) {
  const params = [];
  const where = productWhere(opts, params);
  return (await one(`SELECT count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where}`, params)).n;
}
// Counts for the small summary chips above the admin product list.
async function productStats({ type } = {}) {
  const params = [];
  let where = 'WHERE p.parent_id IS NULL';
  if (type) { params.push(type); where += ` AND p.product_type=$1`; }
  return one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE p.active)::int AS active,
      count(*) FILTER (WHERE NOT p.active)::int AS hidden,
      count(*) FILTER (WHERE (${STOCK_EXPR}) <= 0)::int AS out,
      count(*) FILTER (WHERE (${STOCK_EXPR}) <= p.low_stock)::int AS low
    FROM products p ${where}`, params);
}
async function getProduct({ id, slug, public: pub = false }) {
  const p = await one(`SELECT ${colsFor({ public: pub })} FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${id ? 'p.id=$1' : 'p.slug=$1'}`, [id || slug]);
  if (!p) return null;
  p.images = (await q(`SELECT id FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id`, [p.id])).map((r) => r.id);
  if (!p.images.length && p.image_id) p.images = [p.image_id];
  p.bundle = p.product_type === 'bundle' ? await bundleItems(p.id, pub) : [];
  p.variants = p.variant_count > 0 ? await listVariants(p.id, { public: pub }) : [];
  return p;
}
// The variants of a product (size / colour / model …), in the owner's order. Shop side: only the ones switched on.
async function listVariants(parentId, { public: pub = false } = {}) {
  return q(`SELECT ${colsFor({ public: pub })} FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.parent_id=$1 ${pub ? 'AND p.active' : ''} ORDER BY p.variant_sort, p.id`, [int(parentId)]);
}
async function getProductsByIds(ids, { includeInactive = false, public: pub = false } = {}) {
  const clean = ids.map((x) => int(x)).filter((x) => x > 0);
  if (!clean.length) return [];
  return q(`SELECT ${colsFor({ public: pub })} FROM products p LEFT JOIN categories c ON c.id=p.category_id
            WHERE p.id = ANY($1::int[]) ${includeInactive ? '' : 'AND p.active AND (p.parent_id IS NULL OR EXISTS (SELECT 1 FROM products pp WHERE pp.id=p.parent_id AND pp.active))'}`, [clean]);
}
async function bundleItems(bundleId, pub = false) {
  return q(`SELECT bi.product_id, bi.qty, p.name, p.sku, p.stock, p.price, ${pub ? '' : 'p.cost_price, '}p.image_id, p.emoji
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
// Warranty choices (owner: from 7 days up to 5 years). Stored as the key; a typed one is kept as "c:<text>".
const WARRANTY = { '7d': '৭ দিন', '15d': '১৫ দিন', '1m': '১ মাস', '3m': '৩ মাস', '6m': '৬ মাস', '1y': '১ বছর', '2y': '২ বছর', '3y': '৩ বছর', '4y': '৪ বছর', '5y': '৫ বছর' };
const WARRANTY_TYPES = { replace: 'রিপ্লেসমেন্ট', service: 'সার্ভিস', brand: 'ব্র্যান্ড/কোম্পানি' };
function warrantyText(p) {
  const w = String((p && p.warranty) || '');
  if (!w) return '';
  const len = w.startsWith('c:') ? w.slice(2) : WARRANTY[w];
  if (!len) return '';
  const t = WARRANTY_TYPES[p.warranty_type];
  return t ? `${len} ${t} ওয়ারেন্টি` : `${len} ওয়ারেন্টি`;
} // owner: at most 6 pictures per product (2026-10-10)
// "a, b ,, c" -> "a, b, c" (no empty or repeated words)
function cleanKeywords(v) {
  const seen = new Set();
  return String(v || '').split(/[,،\n]+/).map((k) => k.replace(/\s+/g, ' ').trim()).filter((k) => {
    const key = k.toLowerCase();
    if (!k || seen.has(key)) return false;
    seen.add(key); return true;
  }).join(', ').slice(0, 300);
}

// ---------------------------------------------------------------- price history
// Every change of the selling price / old price is written to the activity log ("price_change"),
// and every change of the buying price separately ("cost_change", shown only to the owner).
const n2 = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100);
function moneyTxt(v) { return v === null ? 'নেই' : '৳' + (Number.isInteger(v) ? v : v.toFixed(2)); }
async function logPriceChange(t, productId, before, after, staffId, via = '') {
  const parts = [];
  if (after.price !== undefined && n2(before.price) !== n2(after.price)) parts.push(`বিক্রির দাম ${moneyTxt(n2(before.price))} → ${moneyTxt(n2(after.price))}`);
  if (after.old_price !== undefined && n2(before.old_price) !== n2(after.old_price)) parts.push(`আগের দাম ${moneyTxt(n2(before.old_price))} → ${moneyTxt(n2(after.old_price))}`);
  const tag = via ? ` (${via})` : '';
  const name = String(before.name || after.name || '').slice(0, 80);
  if (parts.length) {
    await t.query(`INSERT INTO activity_log(staff_id, action, entity, entity_id, detail) VALUES($1,'price_change','product',$2,$3)`,
      [staffId || null, productId, `${name}: ${parts.join(' · ')}${tag}`.slice(0, 500)]);
  }
  if (after.cost_price !== undefined && n2(before.cost_price || 0) !== n2(after.cost_price || 0)) {
    await t.query(`INSERT INTO activity_log(staff_id, action, entity, entity_id, detail) VALUES($1,'cost_change','product',$2,$3)`,
      [staffId || null, productId, `${name}: কেনা দাম ${moneyTxt(n2(before.cost_price || 0))} → ${moneyTxt(n2(after.cost_price || 0))}${tag}`.slice(0, 500)]);
  }
}
async function priceHistory(productId, { withCost = false, limit = 30 } = {}) {
  return q(`SELECT a.action, a.detail, a.created_at, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id
    WHERE a.entity='product' AND a.entity_id=$1 AND a.action = ANY($2::text[]) ORDER BY a.created_at DESC, a.id DESC LIMIT $3`,
  [productId, withCost ? ['price_change', 'cost_change'] : ['price_change'], limit]);
}

// ---------------------------------------------------------------- brands
// 🔧 Spec filters for a shop list: the specifications that many of its products share (e.g. ভোল্টেজ: 5V / 12V / 24V).
// A spec shows when ≥2 products have it with 2–15 different short values. Spelling of the name/value: the most common one.
async function specFacets(opts = {}) {
  const params = [];
  const where = productWhere({ ...opts, specs: null }, params);
  const rows = await q(`SELECT lower(trim(e->>0)) AS k, lower(trim(e->>1)) AS v, mode() WITHIN GROUP (ORDER BY trim(e->>0)) AS kl,
      mode() WITHIN GROUP (ORDER BY trim(e->>1)) AS vl, count(DISTINCT p.id)::int AS n
    FROM products p LEFT JOIN categories c ON c.id=p.category_id,
      jsonb_array_elements(CASE WHEN jsonb_typeof(p.specs)='array' THEN p.specs ELSE '[]'::jsonb END) e
    ${where}${where ? ' AND' : ' WHERE'} length(trim(e->>1)) BETWEEN 1 AND 30 AND length(trim(e->>0)) BETWEEN 1 AND 40
    GROUP BY 1, 2`, params);
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.k)) byKey.set(r.k, { key: r.k, label: r.kl, total: 0, values: [] });
    const f = byKey.get(r.k);
    f.total += r.n;
    f.values.push({ value: r.v, label: r.vl, n: r.n });
  }
  const num = (x) => { const m = String(x).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  return [...byKey.values()].filter((f) => f.total >= 2 && f.values.length >= 2 && f.values.length <= 15)
    .sort((a, b) => b.total - a.total).slice(0, 5)
    .map((f) => ({ ...f, values: f.values.sort((a, b) => (num(a.label) !== null && num(b.label) !== null ? num(a.label) - num(b.label) : b.n - a.n)) }));
}

// Brands among the products a shop list shows (for the brand filter), with how many products each has.
async function brandsIn(opts = {}) {
  const params = [];
  const where = productWhere({ ...opts, brandIds: null, brandId: null }, params);
  return q(`SELECT b.id, b.name, b.slug, count(*)::int AS n FROM products p LEFT JOIN categories c ON c.id=p.category_id
    JOIN brands b ON b.id=p.brand_id AND b.active ${where} GROUP BY b.id ORDER BY count(*) DESC, b.name LIMIT 40`, params);
}
async function listBrands({ activeOnly = false } = {}) {
  return q(`SELECT b.*, (SELECT count(*)::int FROM products p WHERE p.brand_id=b.id) AS product_count,
      (SELECT count(*)::int FROM products p WHERE p.brand_id=b.id AND p.active) AS active_count
    FROM brands b ${activeOnly ? 'WHERE b.active' : ''} ORDER BY b.sort, lower(b.name)`);
}
async function getBrand({ id, slug }) {
  return one(`SELECT * FROM brands WHERE ${id ? 'id=$1' : 'slug=$1'}`, [id || slug]);
}
async function saveBrand({ id, name, logoId, description, seoTitle, seoDescription, active, sort, noindex = false }) {
  const n = str(name, 60);
  if (!n) throw new Error('ব্র্যান্ডের নাম লিখুন।');
  const clash = await one('SELECT id FROM brands WHERE lower(name)=lower($1) AND id<>$2', [n, int(id)]);
  if (clash) throw new Error('এই নামে ব্র্যান্ড আগে থেকেই আছে।');
  const vals = [n, int(logoId) || null, str(description, 3000), str(seoTitle, 120), str(seoDescription, 300), active !== false, int(sort)];
  if (id) {
    await tx(async (t) => {
      await t.query('UPDATE brands SET name=$1, logo_id=$2, description=$3, seo_title=$4, seo_description=$5, active=$6, sort=$7, noindex=$9 WHERE id=$8', [...vals, int(id), !!noindex]);
      await t.query('UPDATE products SET brand=$1 WHERE brand_id=$2 AND brand<>$1', [n, int(id)]); // renamed: products follow
    });
    return int(id);
  }
  const slug = await uniqueSlug('brands', slugify(n) === 'item' ? 'brand' : slugify(n));
  return (await one('INSERT INTO brands(name, logo_id, description, seo_title, seo_description, active, sort, slug, noindex) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [...vals, slug, !!noindex])).id;
}
// The brand with this name (any letter case) — made on the spot when it doesn't exist yet.
async function brandIdFor(t, name) {
  const n = str(name, 60);
  if (!n) return null;
  const found = (await t.query('SELECT id FROM brands WHERE lower(name)=lower($1)', [n])).rows[0];
  if (found) return found.id;
  let slug = slugify(n) === 'item' ? 'brand' : slugify(n);
  for (let i = 2; (await t.query('SELECT 1 FROM brands WHERE slug=$1', [slug])).rows.length; i++) slug = `${slugify(n)}-${i}`;
  const r = (await t.query('INSERT INTO brands(name, slug) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id', [n, slug])).rows[0];
  return r ? r.id : (await t.query('SELECT id FROM brands WHERE lower(name)=lower($1)', [n])).rows[0].id;
}

// Specifications: [["Voltage", "5V"], ["Power", "3W"]] — from the admin form's two columns.
function cleanSpecs(keys, vals) {
  const k = [].concat(keys ?? []);
  const v = [].concat(vals ?? []);
  const out = [];
  for (let i = 0; i < k.length && out.length < 40; i++) {
    const a = str(k[i], 60); const b = str(v[i], 300);
    if (a && b) out.push([a, b]);
  }
  return out;
}

// ---------------------------------------------------------------- linked products
// related = "একই রকম আরও পণ্য" (replaces the automatic same-category list), cross = "এর সাথে যা লাগবে"
// (also suggested in the cart), upsell = "আরও ভালো বিকল্প".
const LINK_KINDS = { related: 'একই রকম পণ্য', cross: 'এর সাথে যা লাগবে (ক্রস-সেল)', upsell: 'আরও ভালো বিকল্প (আপসেল)' };
async function linkedSkus(productId) {
  const rows = await q(`SELECT l.kind, p.sku FROM product_links l JOIN products p ON p.id=l.linked_id WHERE l.product_id=$1 ORDER BY l.kind, l.sort`, [int(productId)]);
  const out = { related: [], cross: [], upsell: [] };
  rows.forEach((r) => { if (out[r.kind]) out[r.kind].push(r.sku); });
  return out;
}
// skus: "12, 45 , 7" — unknown SKUs and the product itself are skipped. Returns the SKUs that were not found.
async function setLinks(t, productId, kind, skus) {
  if (!LINK_KINDS[kind]) return [];
  const want = [...new Set(String(skus || '').split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 24);
  await t.query('DELETE FROM product_links WHERE product_id=$1 AND kind=$2', [productId, kind]);
  const missing = [];
  let sort = 0;
  for (const sku of want) {
    const r = (await t.query('SELECT id FROM products WHERE sku=$1', [sku])).rows[0];
    if (!r || r.id === productId) { if (!r) missing.push(sku); continue; }
    await t.query('INSERT INTO product_links(product_id, linked_id, kind, sort) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [productId, r.id, kind, sort++]);
  }
  return missing;
}
async function linkedProducts(productId, kind, limit = 8) {
  return q(`SELECT ${PUBLIC_COLS} FROM product_links l JOIN products p ON p.id=l.linked_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE l.product_id=$1 AND l.kind=$2 AND p.active ORDER BY l.sort LIMIT $3`, [int(productId), kind, limit]);
}
// Cart suggestions: what the cart's products list as "goes with", minus what is already in the cart.
async function crossFor(ids, limit = 6) {
  const clean = (ids || []).map((x) => int(x)).filter((x) => x > 0);
  if (!clean.length) return [];
  return q(`SELECT DISTINCT ON (p.id) ${PUBLIC_COLS} FROM product_links l JOIN products p ON p.id=l.linked_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE l.product_id = ANY($1::int[]) AND l.kind='cross' AND p.active AND p.stock > 0 AND NOT (p.id = ANY($1::int[])) ORDER BY p.id LIMIT $2`, [clean, limit]);
}

// ---------------------------------------------------------------- old links keep working
async function addRedirect(t, from, to) {
  if (!from || from === to) return;
  await t.query('DELETE FROM redirects WHERE from_path=$1', [to]); // a link that is used again by a product
  await t.query('UPDATE redirects SET to_path=$2 WHERE to_path=$1', [from, to]); // no chains: a → b → c becomes a → c
  await t.query(`INSERT INTO redirects(from_path, to_path) VALUES($1,$2) ON CONFLICT (from_path) DO UPDATE SET to_path=EXCLUDED.to_path`, [from, to]);
}
async function findRedirect(path) {
  const r = await one('SELECT to_path FROM redirects WHERE from_path=$1', [path]);
  if (r) q('UPDATE redirects SET hits=hits+1 WHERE from_path=$1', [path]).catch(() => {});
  return r ? r.to_path : null;
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
    model: str(data.model, 80),
    is_new: !!data.is_new,
    noindex: !!data.noindex,
    allow_duplicate: !!data.allow_duplicate,
  };
  // ⏳ pre-order: only when the form sends it (copies / imports / bulk edits never change it)
  if (data.preorder_form !== undefined) {
    f.preorder = !!data.preorder && type !== 'bundle';
    f.preorder_days = Math.max(0, Math.min(180, int(data.preorder_days)));
  }
  // specifications: from the form (spec_key[] / spec_val[]) or already as a list (copy, import)
  if (data.spec_key !== undefined) f.specs = JSON.stringify(cleanSpecs(data.spec_key, data.spec_val));
  else if (Array.isArray(data.specs)) f.specs = JSON.stringify(cleanSpecs(data.specs.map((x) => x[0]), data.specs.map((x) => x[1])));
  if (data.supplier_id !== undefined) f.supplier_id = int(data.supplier_id) || null;
  // barcode: typed by the owner (e.g. the maker's EAN) or left empty → the shop's own SB000123
  if (data.barcode !== undefined) {
    f.barcode = String(data.barcode || '').toUpperCase().replace(/[^\x21-\x7e]/g, '').slice(0, 40);
    if (f.barcode) {
      const clash = await one('SELECT id, name FROM products WHERE barcode=$1 AND id<>coalesce($2,0)', [f.barcode, int(data.id) || null]);
      if (clash) throw new Error(`এই বারকোড (${f.barcode}) আগে থেকেই "${clash.name}" পণ্যে আছে — প্রতিটা পণ্যের বারকোড আলাদা হতে হবে।`);
    }
  }
  // warranty: only when the form sends it, so copies / imports / bulk edits never wipe it
  if (data.warranty !== undefined) {
    const w = String(data.warranty || '');
    f.warranty = w === 'custom' ? (str(data.warranty_custom, 60) ? 'c:' + str(data.warranty_custom, 60) : '') : (WARRANTY[w] ? w : '');
    f.warranty_type = f.warranty && WARRANTY_TYPES[data.warranty_type] ? data.warranty_type : '';
  }
  const images = (Array.isArray(data.images) ? data.images : String(data.images || '').split(','))
    .map((x) => int(x)).filter((x) => x > 0).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_PRODUCT_IMAGES);
  const parts = (data.bundle || []).map((b) => ({ product_id: int(b.product_id), qty: Math.max(1, int(b.qty, 1)) }))
    .filter((b) => b.product_id > 0);
  const newStock = type === 'bundle' ? 0 : Math.max(0, int(data.stock));
  const id = int(data.id) || null;

  return tx(async (t) => {
    let pid = id;
    // brand typed as a name: linked to that brand (made on the spot if it's new)
    f.brand_id = f.brand ? await brandIdFor(t, f.brand) : null;
    if (f.brand_id) f.brand = (await t.query('SELECT name FROM brands WHERE id=$1', [f.brand_id])).rows[0].name;
    const cols = Object.keys(f);
    if (pid) {
      const before = (await t.query('SELECT stock, sku, slug, name, price, old_price, cost_price FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
      if (!before) throw new Error('Product not found');
      // the link (/p/…) was changed by hand: the old link keeps working and sends people (and Google) to the new one
      const wanted = data.slug !== undefined ? slugify(String(data.slug).trim()) : '';
      if (wanted && wanted !== 'item' && wanted !== before.slug) {
        const slug = await uniqueSlug('products', wanted, pid);
        if (slug !== before.slug) {
          await t.query('UPDATE products SET slug=$1 WHERE id=$2', [slug, pid]);
          await addRedirect(t, '/p/' + before.slug, '/p/' + slug);
        }
      }
      await logPriceChange(t, pid, before, { price: f.price, old_price: f.old_price, cost_price: f.cost_price, name: f.name }, staffId);
      // A product never stays without a SKU: an emptied box gets the next number.
      if (!f.sku) f.sku = before.sku || await takeSku(t);
      await t.query(`UPDATE products SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}, updated_at=now() WHERE id=$${cols.length + 1}`,
        [...cols.map((c) => f[c]), pid]);
      // stock below 0 = pieces owed to pre-orders: leaving the box as it was keeps that number
      if (type === 'single' && data.stock !== undefined && before.stock < 0 && int(data.stock) === before.stock) { /* unchanged */ } else
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
    // a variant's picture that was taken off the main product is cleared; then names / price follow the main product
    await t.query(`UPDATE products SET image_id=NULL WHERE parent_id=$1 AND image_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM media m WHERE m.id=products.image_id AND m.owner_type='product' AND m.owner_id=$1)`, [pid]);
    if ((await t.query('SELECT 1 FROM products WHERE parent_id=$1 LIMIT 1', [pid])).rows.length) await syncVariants(t, pid);
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

// ---------------------------------------------------------------- variants (size / colour / model)
// Each variant is a product row of its own (parent_id = the main product): its own price, stock, SKU and barcode,
// so cart, orders, stock, counter sale (POS) and courier scanning all work for it unchanged.
// The main product shows a picker; its price is the cheapest variant and its stock the sum of all variants.
const MAX_VARIANTS = 40;
// Keep the variants in line with their main product (name, category, brand …) and the main product's price/stock line.
async function syncVariants(t, parentId) {
  const p = (await t.query('SELECT id, name, category_id, brand, brand_id, emoji, unit, weight_g, warranty, warranty_type, image_id FROM products WHERE id=$1', [parentId])).rows[0];
  if (!p) return;
  await t.query(`UPDATE products SET name = left($2 || ' — ' || variant_label, 200), category_id=$3, brand=$4, brand_id=$5, emoji=$6, unit=$7,
      weight_g = CASE WHEN weight_g > 0 THEN weight_g ELSE $8 END, warranty = $9, warranty_type = $10, noindex = true,
      image_id = coalesce(image_id, $11), updated_at = now()
    WHERE parent_id=$1`, [p.id, p.name, p.category_id, p.brand, p.brand_id, p.emoji, p.unit, p.weight_g || 0, p.warranty || '', p.warranty_type || '', p.image_id]);
  const agg = (await t.query(`SELECT count(*) FILTER (WHERE active)::int AS n, min(price) FILTER (WHERE active) AS lo,
      (array_agg(old_price ORDER BY price) FILTER (WHERE active))[1] AS old FROM products WHERE parent_id=$1`, [p.id])).rows[0];
  await t.query(`UPDATE products SET variant_count=$2, price = coalesce($3, price), old_price = CASE WHEN $2 > 0 THEN $4 ELSE old_price END WHERE id=$1`,
    [p.id, agg.n, agg.lo, agg.old && Number(agg.old) > Number(agg.lo) ? agg.old : null]);
}
// rows: [{ id?, label, price, old_price, cost_price?, stock, sku, image_id, active, remove }] — from the variants page.
// withCost: only the owner may set buying prices.
async function saveVariants(parentId, { title, rows }, staffId, { withCost = false } = {}) {
  return tx(async (t) => {
    const parent = (await t.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [int(parentId)])).rows[0];
    if (!parent) throw new Error('পণ্য পাওয়া যায়নি।');
    if (parent.parent_id) throw new Error('এটা নিজেই একটা ভ্যারিয়েন্ট — মূল পণ্যে গিয়ে ভ্যারিয়েন্ট যোগ করুন।');
    if (parent.product_type === 'bundle') throw new Error('বান্ডেল/প্যাকেজে ভ্যারিয়েন্ট দেওয়া যায় না।');
    await t.query('UPDATE products SET variant_title=$1 WHERE id=$2', [str(title, 40), parent.id]);
    const existing = new Map((await t.query('SELECT * FROM products WHERE parent_id=$1', [parent.id])).rows.map((r) => [r.id, r]));
    const images = new Set((await t.query(`SELECT id FROM media WHERE owner_type='product' AND owner_id=$1`, [parent.id])).rows.map((r) => r.id));
    const seen = new Set();
    let sort = 0;
    let kept = [...existing.values()].length;
    const removed = [];
    for (const r of rows.slice(0, MAX_VARIANTS + 10)) {
      const id = int(r.id);
      const old = id ? existing.get(id) : null;
      if (id && !old) continue; // not this product's variant
      if (old && r.remove) { removed.push(old.id); kept -= 1; continue; }
      const label = str(r.label, 60);
      if (!label) { if (old) throw new Error('প্রতিটা ভ্যারিয়েন্টের নাম দিন (যেমন: লাল / XL)।'); continue; }
      const key = label.toLowerCase();
      if (seen.has(key)) throw new Error(`"${label}" নামে দুইটা ভ্যারিয়েন্ট আছে — নামগুলো আলাদা দিন।`);
      seen.add(key);
      const price = amount(r.price);
      if (!(price > 0)) throw new Error(`"${label}" এর বিক্রির দাম দিন।`);
      const oldPrice = amount(r.old_price) > price ? amount(r.old_price) : null;
      const img = images.has(int(r.image_id)) ? int(r.image_id) : null;
      const stock = Math.max(0, int(r.stock));
      let sku = str(r.sku, 60);
      if (sku && (await t.query('SELECT id FROM products WHERE lower(sku)=lower($1) AND id<>$2', [sku, old ? old.id : 0])).rows[0]) {
        throw new Error(`SKU "${sku}" অন্য একটা পণ্যে আছে — আলাদা SKU দিন বা খালি রাখুন (নিজে থেকে বসবে)।`);
      }
      sort += 1;
      if (old) {
        if (!sku) sku = old.sku || await takeSku(t);
        const cost = withCost && r.cost_price !== undefined && r.cost_price !== '' ? amount(r.cost_price) : old.cost_price;
        await logPriceChange(t, old.id, old, { price, old_price: oldPrice, cost_price: cost, name: old.name }, staffId, 'ভ্যারিয়েন্ট');
        await t.query(`UPDATE products SET variant_label=$1, price=$2, old_price=$3, cost_price=$4, sku=$5, image_id=$6, active=$7, variant_sort=$8, updated_at=now() WHERE id=$9`,
          [label, price, oldPrice, cost, sku, img, !!r.active, sort, old.id]);
        if (stock !== old.stock) await moveStock(t, old.id, stock - old.stock, 'adjust', 'product', old.id, 'ভ্যারিয়েন্ট পেজ থেকে স্টক বদল', staffId);
      } else {
        if (kept >= MAX_VARIANTS) throw new Error(`একটা পণ্যে সর্বোচ্চ ${MAX_VARIANTS}টা ভ্যারিয়েন্ট রাখা যায়।`);
        if (!sku) sku = await takeSku(t);
        const slug = await uniqueSlug('products', `${parent.slug}-v`.slice(0, 80) + '-' + slugify(label).slice(0, 30));
        const cost = withCost ? amount(r.cost_price) : Number(parent.cost_price) || 0;
        const vid = (await t.query(`INSERT INTO products(name, slug, category_id, price, old_price, cost_price, stock, description, short_description, emoji,
            active, sku, product_type, parent_id, variant_label, variant_sort, image_id, brand, brand_id, unit, weight_g, noindex, low_stock, supplier_id)
          VALUES($1,$2,$3,$4,$5,$6,0,'','',$7,$8,$9,'single',$10,$11,$12,$13,$14,$15,$16,$17,true,$18,$19) RETURNING id`,
        [`${parent.name} — ${label}`.slice(0, 200), slug, parent.category_id, price, oldPrice, cost, parent.emoji, !!r.active, sku, parent.id, label, sort,
          img, parent.brand, parent.brand_id, parent.unit, parent.weight_g || 0, parent.low_stock, parent.supplier_id])).rows[0].id;
        kept += 1;
        if (stock > 0) await moveStock(t, vid, stock, 'opening', 'product', vid, 'ভ্যারিয়েন্টের শুরুর স্টক', staffId);
      }
    }
    // The main product's own pieces (from before it had variants) can't be sold any more: put them on the first variant.
    if (parent.stock > 0 && kept - removed.length > 0) {
      const first = (await t.query('SELECT id FROM products WHERE parent_id=$1 AND NOT (id = ANY($2::int[])) ORDER BY variant_sort, id LIMIT 1', [parent.id, removed])).rows[0];
      if (first) {
        await moveStock(t, parent.id, -parent.stock, 'adjust', 'product', parent.id, 'ভ্যারিয়েন্টে সরানো হয়েছে', staffId);
        await moveStock(t, first.id, parent.stock, 'adjust', 'product', parent.id, 'মূল পণ্যের স্টক এই ভ্যারিয়েন্টে এলো', staffId);
      }
    }
    await syncVariants(t, parent.id);
    return { removed };
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

// ⏳ Pre-order: take `qty` even when the shelf has less — the stock goes below 0 (= pieces owed to pre-orders).
// Returns how many of them were not on the shelf. A purchase later adds stock as usual, which pays the debt first.
async function oweStock(t, productId, qty, refId = null, staffId = null) {
  const before = (await t.query('SELECT stock FROM products WHERE id=$1 FOR UPDATE', [productId])).rows[0];
  if (!before) return 0;
  const r = (await t.query('UPDATE products SET stock = stock - $1, updated_at=now() WHERE id=$2 RETURNING stock', [qty, productId])).rows[0];
  await t.query(`INSERT INTO stock_movements(product_id, change, balance, reason, ref_type, ref_id, note, staff_id)
                 VALUES($1,$2,$3,'order','order',$4,$5,$6)`, [productId, -qty, r.stock, refId, 'প্রি-অর্ডার', staffId]);
  return Math.min(qty, qty - Math.max(0, Number(before.stock) || 0));
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
  purchase_cancel: 'পারচেজ বাতিল', adjust: 'হাতে বদল', damage: 'নষ্ট/ভাঙা → নষ্ট স্টকে', lost: 'হারানো', count: 'গণনা ঠিক করা', return: 'কাস্টমার ফেরত',
  return_damaged: 'ফেরত আসা নষ্ট মাল → নষ্ট স্টকে', damage_out: 'নষ্ট মাল ফেলে দেওয়া', repair: 'মেরামত হয়ে আবার বিক্রিযোগ্য',
};
// Damaged goods are kept apart from the stock that can be sold: a change can move pieces between the two.
// stock / damaged = how much each one changes (e.g. { stock: -2, damaged: 2 } = 2 pieces broke). Null if not enough.
async function changeDamaged(t, productId, { stock = 0, damaged = 0 }, reason, refType = '', refId = null, note = '', staffId = null) {
  if (!stock && !damaged) return true;
  const res = await t.query(`UPDATE products SET stock = stock + $1, damaged_stock = damaged_stock + $2, updated_at=now()
    WHERE id=$3 AND stock + $1 >= 0 AND damaged_stock + $2 >= 0 RETURNING stock`, [stock, damaged, productId]);
  if (!res.rows.length) return null;
  await t.query(`INSERT INTO stock_movements(product_id, change, damaged_change, balance, reason, ref_type, ref_id, note, staff_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [productId, stock, damaged, res.rows[0].stock, reason, refType, refId, note, staffId]);
  return true;
}
// Pieces taken by orders that are not shipped yet (new, confirmed, packing, on hold) — still on the shelf.
const OPEN_STATUSES = ['pending', 'confirmed', 'processing', 'hold'];
async function reservedFor(ids) {
  const clean = (ids || []).map((x) => int(x)).filter((x) => x > 0);
  if (!clean.length) return new Map();
  const rows = await q(`SELECT pid, sum(qty)::int AS qty FROM (
      SELECT CASE WHEN c.value IS NULL THEN oi.product_id ELSE (c.value->>'product_id')::int END AS pid,
             CASE WHEN c.value IS NULL THEN oi.qty ELSE (c.value->>'qty')::int END AS qty
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(oi.components)='array' THEN oi.components ELSE '[]'::jsonb END) c ON true
      WHERE o.status = ANY($2::text[])) x
    WHERE pid = ANY($1::int[]) GROUP BY pid`, [clean, OPEN_STATUSES]);
  return new Map(rows.map((r) => [r.pid, r.qty]));
}
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
      coalesce(sum(damaged_stock),0)::int AS damaged,
      count(*) FILTER (WHERE damaged_stock > 0)::int AS damaged_products,
      coalesce(sum(damaged_stock * cost_price),0)::numeric(14,2) AS damaged_value,
      coalesce(sum(stock * cost_price),0)::numeric(14,2) AS cost_value,
      coalesce(sum(stock * price),0)::numeric(14,2) AS sale_value,
      count(*) FILTER (WHERE stock <= low_stock)::int AS low,
      count(*) FILTER (WHERE stock = 0)::int AS out
    FROM products WHERE active AND product_type='single' AND variant_count = 0`);
}

module.exports = {
  brandsIn, oweStock, specFacets,
  saveMedia, keepPrivate, mediaWithoutHash, setMediaHash, getMedia, mediaNeedingWatermark, watermarkProgress, setWatermark, getWatermarked, attachMedia, claimMedia, deleteMedia, cleanupMedia,
  listCategories, categoryTree, categoryOptions, categorySubtree, saveCategory, deleteCategory,
  listBrands, getBrand, saveBrand, brandIdFor, cleanSpecs, addRedirect, findRedirect,
  LINK_KINDS, linkedSkus, setLinks, linkedProducts, crossFor,
  listProducts, countProducts, productStats, getProduct, getProductsByIds, listVariants, saveVariants, syncVariants, MAX_VARIANTS, bundleItems, saveProduct, deleteProduct, deleteAllProducts, duplicateProduct, skuTaken, nextSku,
  moveStock, changeDamaged, reservedFor, OPEN_STATUSES, stockParts, stockMovements, inventorySummary, STOCK_REASONS, MAX_PRODUCT_IMAGES, WARRANTY, WARRANTY_TYPES, warrantyText, logPriceChange, priceHistory,
};

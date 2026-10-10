'use strict';
// Product reviews: customers write them on the product page; they show only after approval
// (unless the owner turned on "show at once"). A review from a phone number that really bought
// the product (delivered order) is marked "✓ যাচাই করা ক্রেতা".
const { q, one, tx } = require('../db');
const { int, str } = require('../util');

const STATUS = { pending: 'অনুমোদনের অপেক্ষায়', approved: 'দেখানো হচ্ছে', hidden: 'লুকানো' };

// Recount a product's average rating (only approved reviews count).
async function refresh(t, productId) {
  await t.query(`UPDATE products p SET rating_count = x.n, rating_avg = x.a
    FROM (SELECT count(*)::int AS n, coalesce(round(avg(rating)::numeric, 2), 0) AS a FROM reviews WHERE product_id=$1 AND status='approved') x
    WHERE p.id=$1`, [productId]);
}

class ReviewError extends Error {}

// Is this product in this order? (its own line, or inside a package)
async function orderHas(orderId, productId) {
  return !!(await one(`SELECT 1 FROM order_items WHERE order_id=$1 AND (product_id=$2 OR components @> $3::jsonb) LIMIT 1`,
    [orderId, productId, JSON.stringify([{ product_id: productId }])]));
}
// The products of a delivered order and whether each one already has a review from this order.
async function forOrder(orderId) {
  return q(`SELECT DISTINCT ON (i.product_id) i.product_id, i.name, p.slug, p.active, r.id AS review_id, r.rating, r.status
    FROM order_items i LEFT JOIN products p ON p.id=i.product_id LEFT JOIN reviews r ON r.order_id=i.order_id AND r.product_id=i.product_id
    WHERE i.order_id=$1 AND i.product_id IS NOT NULL ORDER BY i.product_id`, [orderId]);
}

// A review is accepted only from a customer whose order was DELIVERED and has this product —
// one review per product per order. The caller has already checked that the order belongs to this browser.
// 📸 photos with a review (max 3, made small in the browser). They stay hidden ('review_wait') until the review is shown.
async function savePhotos(list, visible) {
  const security = require('../security');
  const catalog = require('./catalog');
  const out = [];
  for (const d of (Array.isArray(list) ? list : []).slice(0, 3)) {
    const m = String(d || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const data = Buffer.from(m[1], 'base64');
    if (data.length > 1.2 * 1024 * 1024) throw new ReviewError('একটা ছবি অনেক বড়। ছোট ছবি দিন।');
    const mime = security.imageKind(data);
    if (!mime || !/^image\/(jpeg|png|webp)$/.test(mime)) throw new ReviewError('শুধু JPG, PNG বা WebP ছবি দিন।');
    out.push(await catalog.saveMedia({ mime, data, ownerType: visible ? 'review' : 'review_wait', ownerId: 0, keepPrivate: true }));
  }
  return out;
}

async function submit({ code, productId, name, rating, body, ip, photos }, settings) {
  const pid = int(productId);
  const r = int(rating);
  const text = str(body, 1500).replace(/\s+\n/g, '\n');
  if (!(r >= 1 && r <= 5)) throw new ReviewError('১ থেকে ৫ এর মধ্যে রেটিং দিন।');
  if (text.length < 5) throw new ReviewError('আপনার মতামত একটু লিখুন।');
  if (/(https?:\/\/|www\.)/i.test(text)) throw new ReviewError('রিভিউতে লিংক দেওয়া যাবে না।');
  const o = await one('SELECT id, phone, customer_id, customer_name, status FROM orders WHERE code=$1', [str(code, 20).toUpperCase()]);
  if (!o) throw new ReviewError('অর্ডারটি পাওয়া যায়নি।');
  if (o.status !== 'delivered') throw new ReviewError('পণ্য হাতে পাওয়ার (ডেলিভারি হওয়ার) পরে রিভিউ দেওয়া যাবে।');
  const p = await one('SELECT id, name FROM products WHERE id=$1', [pid]);
  if (!p || !(await orderHas(o.id, pid))) throw new ReviewError('এই পণ্যটি এই অর্ডারে নেই।');
  if (await one('SELECT 1 FROM reviews WHERE order_id=$1 AND product_id=$2', [o.id, pid])) throw new ReviewError('এই অর্ডারের এই পণ্যের রিভিউ আগেই দেওয়া হয়েছে। ধন্যবাদ!');
  const who = str(name, 60) || String(o.customer_name || '').trim().split(/\s+/)[0] || 'কাস্টমার';
  const auto = settings.reviews_auto_approve === '1';
  const photoIds = settings.review_photos_on === '0' ? [] : await savePhotos(photos, auto);
  return tx(async (t) => {
    const row = (await t.query(`INSERT INTO reviews(product_id, customer_id, order_id, name, phone, rating, body, status, verified, ip, approved_at, photos)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id, status`,
    [pid, o.customer_id, o.id, who.slice(0, 60), o.phone, r, text, auto ? 'approved' : 'pending', str(ip, 64), auto ? new Date() : null, photoIds])).rows[0];
    if (!row) throw new ReviewError('এই অর্ডারের এই পণ্যের রিভিউ আগেই দেওয়া হয়েছে। ধন্যবাদ!');
    if (auto) await refresh(t, pid);
    return { id: row.id, status: row.status, verified: true, product: p.name };
  });
}

async function forProduct(productId, limit = 30) {
  const pid = int(productId);
  const [rows, stats] = await Promise.all([
    q(`SELECT id, name, rating, body, reply, verified, photos, created_at FROM reviews WHERE product_id=$1 AND status='approved'
      ORDER BY verified DESC, created_at DESC LIMIT $2`, [pid, limit]),
    q(`SELECT rating, count(*)::int AS n FROM reviews WHERE product_id=$1 AND status='approved' GROUP BY rating`, [pid]),
  ]);
  const dist = {};
  let count = 0; let sum = 0;
  stats.forEach((s) => { dist[s.rating] = s.n; count += s.n; sum += s.rating * s.n; });
  return { reviews: rows, stats: { count, avg: count ? Math.round((sum / count) * 10) / 10 : 0, dist } };
}

async function list({ status, q: search, productId, limit = 50, offset = 0 } = {}) {
  const w = []; const params = [];
  if (STATUS[status]) { params.push(status); w.push(`r.status=$${params.length}`); }
  if (productId) { params.push(int(productId)); w.push(`r.product_id=$${params.length}`); }
  if (search) { params.push(`%${search}%`); w.push(`(r.body ILIKE $${params.length} OR r.name ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const rows = await q(`SELECT r.*, p.name AS product_name, p.slug AS product_slug, p.sku, p.image_id FROM reviews r JOIN products p ON p.id=r.product_id
    ${where} ORDER BY (r.status='pending') DESC, r.created_at DESC LIMIT ${int(limit)} OFFSET ${int(offset)}`, params);
  const total = (await one(`SELECT count(*)::int AS n FROM reviews r JOIN products p ON p.id=r.product_id ${where}`, params)).n;
  return { rows, total };
}
async function counts() {
  const rows = await q(`SELECT status, count(*)::int AS n FROM reviews GROUP BY status`);
  const c = { pending: 0, approved: 0, hidden: 0, all: 0 };
  rows.forEach((r) => { c[r.status] = r.n; c.all += r.n; });
  return c;
}
async function setStatus(id, status) {
  if (!STATUS[status]) return null;
  return tx(async (t) => {
    const r = (await t.query(`UPDATE reviews SET status=$1, approved_at = CASE WHEN $1='approved' THEN coalesce(approved_at, now()) ELSE approved_at END
      WHERE id=$2 RETURNING product_id, photos`, [status, int(id)])).rows[0];
    if (r) await refresh(t, r.product_id);
    // photos are seen in the shop only while the review is shown
    if (r && r.photos && r.photos.length) await t.query(`UPDATE media SET owner_type=$1 WHERE id = ANY($2::int[]) AND owner_type IN ('review','review_wait')`, [status === 'approved' ? 'review' : 'review_wait', r.photos]);
    return r;
  });
}
async function reply(id, text) {
  return one('UPDATE reviews SET reply=$1 WHERE id=$2 RETURNING product_id', [str(text, 1000), int(id)]);
}
async function remove(id) {
  return tx(async (t) => {
    const r = (await t.query('DELETE FROM reviews WHERE id=$1 RETURNING product_id, photos', [int(id)])).rows[0];
    if (r) await refresh(t, r.product_id);
    if (r && r.photos && r.photos.length) await t.query(`DELETE FROM media WHERE id = ANY($1::int[]) AND owner_type IN ('review','review_wait')`, [r.photos]);
    return r;
  });
}

module.exports = { STATUS, ReviewError, submit, forOrder, forProduct, list, counts, setStatus, reply, remove, refresh };

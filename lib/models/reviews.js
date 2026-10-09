'use strict';
// Product reviews: customers write them on the product page; they show only after approval
// (unless the owner turned on "show at once"). A review from a phone number that really bought
// the product (delivered order) is marked "✓ যাচাই করা ক্রেতা".
const { q, one, tx } = require('../db');
const { int, str, normalizePhone } = require('../util');

const STATUS = { pending: 'অনুমোদনের অপেক্ষায়', approved: 'দেখানো হচ্ছে', hidden: 'লুকানো' };

// Recount a product's average rating (only approved reviews count).
async function refresh(t, productId) {
  await t.query(`UPDATE products p SET rating_count = x.n, rating_avg = x.a
    FROM (SELECT count(*)::int AS n, coalesce(round(avg(rating)::numeric, 2), 0) AS a FROM reviews WHERE product_id=$1 AND status='approved') x
    WHERE p.id=$1`, [productId]);
}

// The delivered order (if any) of this phone that has this product in it.
async function boughtBy(phone, productId) {
  if (!phone) return null;
  return one(`SELECT o.id, o.customer_id FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.phone=$1 AND o.status='delivered' AND (i.product_id=$2 OR i.components @> $3::jsonb)
    ORDER BY o.id DESC LIMIT 1`, [phone, productId, JSON.stringify([{ product_id: productId }])]);
}

class ReviewError extends Error {}

async function submit({ productId, name, phone, rating, body, ip }, settings) {
  const pid = int(productId);
  const r = int(rating);
  const text = str(body, 1500).replace(/\s+\n/g, '\n');
  const who = str(name, 60);
  if (!(r >= 1 && r <= 5)) throw new ReviewError('১ থেকে ৫ এর মধ্যে রেটিং দিন।');
  if (who.length < 2) throw new ReviewError('আপনার নাম লিখুন।');
  if (text.length < 5) throw new ReviewError('আপনার মতামত একটু লিখুন।');
  if (/(https?:\/\/|www\.)/i.test(text)) throw new ReviewError('রিভিউতে লিংক দেওয়া যাবে না।');
  const p = await one('SELECT id, name FROM products WHERE id=$1 AND active', [pid]);
  if (!p) throw new ReviewError('পণ্যটি পাওয়া যায়নি।');
  const ph = normalizePhone(phone);
  const validPh = /^01[3-9]\d{8}$/.test(ph);
  if (settings.reviews_verified_only === '1' && !validPh) throw new ReviewError('যে মোবাইল নম্বরে অর্ডার করেছিলেন সেটা লিখুন।');
  const bought = validPh ? await boughtBy(ph, pid) : null;
  if (settings.reviews_verified_only === '1' && !bought) throw new ReviewError('শুধু যারা এই পণ্যটি কিনে হাতে পেয়েছেন তারাই রিভিউ দিতে পারবেন।');
  // one review per phone per product
  if (validPh && await one('SELECT 1 FROM reviews WHERE product_id=$1 AND phone=$2', [pid, ph])) throw new ReviewError('এই নম্বর থেকে এই পণ্যের রিভিউ আগেই দেওয়া হয়েছে। ধন্যবাদ!');
  const auto = settings.reviews_auto_approve === '1';
  return tx(async (t) => {
    const row = (await t.query(`INSERT INTO reviews(product_id, customer_id, order_id, name, phone, rating, body, status, verified, ip, approved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, status`,
    [pid, bought ? bought.customer_id : null, bought ? bought.id : null, who, validPh ? ph : '', r, text, auto ? 'approved' : 'pending', !!bought,
      str(ip, 64), auto ? new Date() : null])).rows[0];
    if (auto) await refresh(t, pid);
    return { id: row.id, status: row.status, verified: !!bought, product: p.name };
  });
}

async function forProduct(productId, limit = 30) {
  const pid = int(productId);
  const [rows, stats] = await Promise.all([
    q(`SELECT id, name, rating, body, reply, verified, created_at FROM reviews WHERE product_id=$1 AND status='approved'
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
      WHERE id=$2 RETURNING product_id`, [status, int(id)])).rows[0];
    if (r) await refresh(t, r.product_id);
    return r;
  });
}
async function reply(id, text) {
  return one('UPDATE reviews SET reply=$1 WHERE id=$2 RETURNING product_id', [str(text, 1000), int(id)]);
}
async function remove(id) {
  return tx(async (t) => {
    const r = (await t.query('DELETE FROM reviews WHERE id=$1 RETURNING product_id', [int(id)])).rows[0];
    if (r) await refresh(t, r.product_id);
    return r;
  });
}

module.exports = { STATUS, ReviewError, submit, forProduct, list, counts, setStatus, reply, remove, refresh };

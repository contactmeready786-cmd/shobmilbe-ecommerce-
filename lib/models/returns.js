'use strict';
// Returns & refunds.
//   Customer: from a delivered order's page (or "আমার অ্যাকাউন্ট") — which items, how many, why, photos, refund number.
//   Shop:     Admin → অর্ডার → রিটার্ন — approve / reject with a reply, "পণ্য ফেরত পেয়েছি" (each item back on the shelf,
//             to damaged stock, or nowhere), then the refund (recorded on the order and, if chosen, in the accounts) or a replacement.
const db = require('../db');
const security = require('../security');
const { str, int, amount, round2, randomCode, normalizePhone, validPhone } = require('../util');
const catalog = require('./catalog');

class ReturnError extends Error {}
const STATUSES = {
  requested: 'নতুন আবেদন', approved: 'অনুমোদিত (পণ্য আসার অপেক্ষায়)', received: 'পণ্য ফেরত এসেছে',
  refunded: 'টাকা ফেরত দেওয়া হয়েছে', replaced: 'বদলে দেওয়া হয়েছে', rejected: 'বাতিল (গ্রহণ হয়নি)', cancelled: 'কাস্টমার বাতিল করেছেন',
};
const OPEN = ['requested', 'approved', 'received'];
const REASONS = Object.fromEntries(require('../views/account').REASONS);
const WANTS = Object.fromEntries(require('../views/account').WANTS);

// Photos come from the browser already made small (data: URLs). Kept private: only the admin can see them.
async function savePhotos(list) {
  const out = [];
  for (const d of (Array.isArray(list) ? list : []).slice(0, 4)) {
    const m = String(d || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const data = Buffer.from(m[1], 'base64');
    if (data.length > 1.2 * 1024 * 1024) throw new ReturnError('একটা ছবি অনেক বড়। ছোট ছবি দিন।');
    const mime = security.imageKind(data);
    if (!mime || !/^image\/(jpeg|png|webp)$/.test(mime)) throw new ReturnError('শুধু JPG, PNG বা WebP ছবি দিন।');
    out.push(await catalog.saveMedia({ mime, data, ownerType: 'return', ownerId: 0, keepPrivate: true }));
  }
  return out;
}

// How many of each order item are already in an open / finished return (rejected and cancelled ones don't count).
async function alreadyAsked(orderId) {
  const rows = await db.q(`SELECT items FROM return_requests WHERE order_id=$1 AND status NOT IN ('rejected','cancelled')`, [orderId]);
  const m = new Map();
  rows.forEach((r) => (r.items || []).forEach((i) => m.set(int(i.item_id), (m.get(int(i.item_id)) || 0) + int(i.qty))));
  return m;
}

// wanted = [{ item_id, qty }]
async function create({ order, wanted, reason, want, details, photos, refundMethod, refundNumber, customerId = null, source = 'customer', settings, staffId = null }) {
  if (order.status !== 'delivered') throw new ReturnError('ডেলিভারি হওয়া অর্ডারেই রিটার্নের আবেদন করা যায়।');
  const days = Number(settings.returns_days) || 7;
  const since = order.delivered_at || order.updated_at || order.created_at;
  if (source === 'customer' && Date.now() - new Date(since).getTime() > days * 864e5) {
    throw new ReturnError(`ডেলিভারির ${days} দিন পেরিয়ে গেছে, তাই অনলাইনে আবেদন করা যাচ্ছে না। ওয়ারেন্টির জন্য আমাদের কল করুন।`);
  }
  const asked = await alreadyAsked(order.id);
  const items = [];
  for (const w of wanted) {
    const it = (order.items || []).find((x) => x.id === int(w.item_id) && x.product_id);
    if (!it) continue;
    const left = it.qty - (asked.get(it.id) || 0);
    const qty = Math.min(int(w.qty), left);
    if (qty < 1) continue;
    items.push({ item_id: it.id, product_id: it.product_id, name: it.name, qty, ordered: it.qty, price: Number(it.price), components: it.components || null });
  }
  if (!items.length) throw new ReturnError('যে পণ্য ফেরত দিতে চান সেটায় টিক দিন (আগে আবেদন করা পণ্য আবার দেওয়া যায় না)।');
  const why = REASONS[reason] ? reason : 'other';
  const text = str(details, 1000);
  if (source === 'customer' && text.length < 10) throw new ReturnError('সমস্যাটা একটু বিস্তারিত লিখুন।');
  const rn = refundNumber ? str(refundNumber, 60) : '';
  if (rn && /^01/.test(rn.replace(/\D/g, '')) && !validPhone(normalizePhone(rn))) throw new ReturnError('টাকা নেওয়ার নম্বরটা ঠিক নেই।');
  const photoIds = await savePhotos(photos);
  const r = await db.one(`INSERT INTO return_requests(code, order_id, customer_id, phone, items, reason, details, photos, want, refund_method, refund_number, source, handled_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, code`,
  ['R' + randomCode(6), order.id, customerId || order.customer_id || null, order.phone, JSON.stringify(items), why, text, photoIds,
    WANTS[want] ? want : 'refund', str(refundMethod, 20), rn, source, staffId]);
  if (photoIds.length) await db.q(`UPDATE media SET owner_id=$1 WHERE id = ANY($2::int[])`, [r.id, photoIds]);
  return r;
}

async function forOrder(orderId) {
  return db.q('SELECT * FROM return_requests WHERE order_id=$1 ORDER BY id DESC', [orderId]);
}
async function list({ status = 'open', q = '', limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status === 'open') where.push(`r.status = ANY('{requested,approved,received}')`);
  else if (STATUSES[status]) { params.push(status); where.push(`r.status=$${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(r.code ILIKE $${params.length} OR o.code ILIKE $${params.length} OR r.phone ILIKE $${params.length} OR o.customer_name ILIKE $${params.length})`); }
  params.push(limit, offset);
  return db.q(`SELECT r.*, o.code AS order_code, o.customer_name, o.total AS order_total, s.name AS staff_name FROM return_requests r JOIN orders o ON o.id=r.order_id
    LEFT JOIN staff s ON s.id=r.handled_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function counts() {
  const rows = await db.q('SELECT status, count(*)::int AS n, coalesce(sum(refund_amount),0)::numeric(14,2) AS refunded FROM return_requests GROUP BY status');
  const out = { all: 0, open: 0, refunded_total: 0 };
  rows.forEach((r) => { out[r.status] = r.n; out.all += r.n; if (OPEN.includes(r.status)) out.open += r.n; out.refunded_total += Number(r.refunded); });
  return out;
}
async function get(id) {
  return db.one(`SELECT r.*, o.code AS order_code, o.customer_name, o.total AS order_total, o.paid_amount, o.payment, o.status AS order_status, s.name AS staff_name
    FROM return_requests r JOIN orders o ON o.id=r.order_id LEFT JOIN staff s ON s.id=r.handled_by WHERE r.id=$1`, [int(id)]);
}

// approve / reject / cancel with a reply the customer sees
async function decide(id, status, { reply, note }, staffId) {
  if (!['approved', 'rejected', 'cancelled', 'replaced'].includes(status)) throw new ReturnError('অজানা কাজ।');
  const r = await db.one(`UPDATE return_requests SET status=$1, reply=CASE WHEN $2<>'' THEN $2 ELSE reply END, admin_note=CASE WHEN $3<>'' THEN $3 ELSE admin_note END,
      handled_by=$4, updated_at=now() WHERE id=$5 AND status = ANY($6::text[]) RETURNING *`,
  [status, str(reply, 500), str(note, 1000), staffId, int(id), status === 'replaced' ? ['approved', 'received', 'requested'] : ['requested', 'approved', 'received']]);
  if (!r) throw new ReturnError('এই আবেদনের অবস্থা এখন বদলানো যায় না।');
  return r;
}

// The goods came back: each item to the shelf ("stock"), to damaged stock ("damaged"), or nowhere ("none" — thrown away / kept by courier).
async function receive(id, actions, staffId) {
  return db.tx(async (t) => {
    const r = (await t.query('SELECT * FROM return_requests WHERE id=$1 FOR UPDATE', [int(id)])).rows[0];
    if (!r) throw new ReturnError('আবেদন পাওয়া যায়নি।');
    if (r.received_at) throw new ReturnError('এই আবেদনের পণ্য আগেই ফেরত নেওয়া হয়েছে।');
    if (!['requested', 'approved'].includes(r.status)) throw new ReturnError('এই আবেদনের অবস্থায় পণ্য ফেরত নেওয়া যায় না।');
    const done = [];
    for (const it of r.items || []) {
      const how = ['stock', 'damaged', 'none'].includes(actions[it.item_id]) ? actions[it.item_id] : 'stock';
      // a bundle comes back as its parts (the part's share for the pieces returned)
      const parts = it.components && it.components.length ? it.components.map((c) => ({ product_id: c.product_id, qty: Math.max(1, Math.round((c.qty * it.qty) / Math.max(1, it.ordered || it.qty))) }))
        : [{ product_id: it.product_id, qty: it.qty }];
      for (const part of parts) {
        const exists = (await t.query('SELECT id FROM products WHERE id=$1', [part.product_id])).rows[0];
        if (!exists) continue;
        if (how === 'stock') await catalog.moveStock(t, part.product_id, part.qty, 'return', 'return', r.id, `রিটার্ন ${r.code}`, staffId);
        if (how === 'damaged') await catalog.changeDamaged(t, part.product_id, { damaged: part.qty }, 'return_damaged', 'return', r.id, `রিটার্ন ${r.code} — নষ্ট`, staffId);
      }
      if (how !== 'none') await t.query('UPDATE products SET sold_count = greatest(0, sold_count - $1) WHERE id=$2', [it.qty, it.product_id]);
      done.push({ item_id: it.item_id, how });
    }
    await t.query(`UPDATE return_requests SET status='received', restock=$1, received_at=now(), handled_by=$2, updated_at=now() WHERE id=$3`, [JSON.stringify(done), staffId, r.id]);
    return done;
  });
}

// Money back: written on the order (paid amount goes down) and in the return. Never more than was paid.
async function refund(id, { amount: amt, method, reference, note }, staffId) {
  return db.tx(async (t) => {
    const r = (await t.query('SELECT * FROM return_requests WHERE id=$1 FOR UPDATE', [int(id)])).rows[0];
    if (!r) throw new ReturnError('আবেদন পাওয়া যায়নি।');
    if (['rejected', 'cancelled'].includes(r.status)) throw new ReturnError('বাতিল আবেদনে টাকা ফেরত দেওয়া যায় না।');
    const o = (await t.query('SELECT id, code, paid_amount FROM orders WHERE id=$1 FOR UPDATE', [r.order_id])).rows[0];
    const a = round2(amount(amt));
    if (!(a > 0)) throw new ReturnError('ফেরতের টাকার পরিমাণ দিন।');
    if (a > Number(o.paid_amount) + 0.001) throw new ReturnError(`এই অর্ডারে পরিশোধ হয়েছে ${o.paid_amount} টাকা — এর বেশি ফেরত দেওয়া যায় না।`);
    await t.query('INSERT INTO refunds(order_id, amount, method, reference, note, staff_id) VALUES($1,$2,$3,$4,$5,$6)',
      [o.id, a, str(method, 30), str(reference, 80), `রিটার্ন ${r.code}${note ? ' — ' + str(note, 150) : ''}`, staffId]);
    await t.query(`UPDATE orders SET paid_amount = greatest(0, paid_amount - $1::numeric), refund_amount = refund_amount + $1::numeric, refunded_at = now(),
      payment_status = CASE WHEN paid_amount - $1::numeric <= 0.001 THEN 'refunded' ELSE 'partial' END, updated_at=now() WHERE id=$2`, [a, o.id]);
    await t.query(`UPDATE return_requests SET status='refunded', refund_amount = refund_amount + $1::numeric, refunded_at=now(), handled_by=$2, updated_at=now() WHERE id=$3`, [a, staffId, r.id]);
    return { amount: a, order: o, request: r };
  });
}

// What the returned items were worth (the most that would usually be refunded).
function itemsValue(r) { return round2((r.items || []).reduce((s, i) => s + Number(i.price) * int(i.qty), 0)); }

module.exports = { ReturnError, STATUSES, OPEN, REASONS, WANTS, create, forOrder, list, counts, get, decide, receive, refund, itemsValue };

'use strict';
// Loyalty points (Admin → মার্কেটিং → লয়ালটি পয়েন্ট). Customers are known by their mobile number — no login needed.
//   • earn: 1 point for every ৳earn_per of goods (after discounts, without delivery), given when the order is DELIVERED
//   • spend: at checkout, 1 point = ৳point_value off; at least min_redeem points, at most max_pct % of the goods
//   • a cancelled / returned order gives the spent points back and takes back the points it earned
// Every change is a row in loyalty_ledger; customers.points is the running balance.
const { q, one } = require('../db');
const { int, str } = require('../util');

function cfg(settings = {}) {
  return {
    on: settings.loyalty_on === '1',
    earnPer: Math.max(1, Number(settings.loyalty_earn_per) || 100),
    value: Math.max(0.01, Number(settings.loyalty_point_value) || 1),
    min: Math.max(1, int(settings.loyalty_min_redeem) || 1),
    maxPct: Math.min(100, Math.max(1, int(settings.loyalty_max_pct) || 20)),
  };
}
// How many points an order of this value earns.
function earnFor(settings, goodsValue) {
  const c = cfg(settings);
  return c.on ? Math.max(0, Math.floor(Number(goodsValue || 0) / c.earnPer)) : 0;
}
// The most points that can be used on goods worth `goods` with this balance → { points, discount }
function usable(settings, balance, goods) {
  const c = cfg(settings);
  const cap = Math.floor(((Number(goods) || 0) * c.maxPct) / 100 / c.value);
  const pts = Math.min(int(balance), cap);
  if (!c.on || pts < c.min) return { points: 0, discount: 0 };
  return { points: pts, discount: Math.round(pts * c.value * 100) / 100 };
}

async function add(t, customerId, points, kind, { orderId = null, note = '', staffId = null } = {}) {
  if (!customerId || !points) return;
  await t.query('UPDATE customers SET points = greatest(0, points + $1) WHERE id=$2', [points, customerId]);
  await t.query('INSERT INTO loyalty_ledger(customer_id, order_id, points, kind, note, staff_id) VALUES($1,$2,$3,$4,$5,$6)',
    [customerId, orderId, points, kind, str(note, 200), staffId]);
}

// At checkout (inside the order's transaction). Returns { points, discount } actually used.
async function redeem(t, customerId, settings, goods, orderId) {
  const row = (await t.query('SELECT points FROM customers WHERE id=$1 FOR UPDATE', [customerId])).rows[0];
  if (!row) return { points: 0, discount: 0 };
  const u = usable(settings, row.points, goods);
  if (!u.points) return u;
  await add(t, customerId, -u.points, 'redeem', { orderId, note: `অর্ডারে ব্যবহার (৳${u.discount} ছাড়)` });
  return u;
}

// Called when an order's status changes (inside setStatus's transaction).
async function onStatus(t, orderId, prev, next) {
  const o = (await t.query('SELECT id, customer_id, code, subtotal, discount, points_used, points_discount, points_earned FROM orders WHERE id=$1', [orderId])).rows[0];
  if (!o || !o.customer_id) return;
  const settings = await require('../db').getSettings();
  const back = next === 'cancelled' || next === 'returned';
  if (next === 'delivered' && !o.points_earned) {
    const pts = earnFor(settings, Number(o.subtotal) - Number(o.discount) - Number(o.points_discount));
    if (pts > 0) {
      await add(t, o.customer_id, pts, 'earn', { orderId, note: `অর্ডার ${o.code} ডেলিভারি` });
      await t.query('UPDATE orders SET points_earned=$1 WHERE id=$2', [pts, orderId]);
    }
  }
  if (back && o.points_earned > 0) {
    await add(t, o.customer_id, -o.points_earned, 'reverse', { orderId, note: `অর্ডার ${o.code} ${next === 'returned' ? 'ফেরত' : 'বাতিল'} — দেওয়া পয়েন্ট ফেরত নেওয়া` });
    await t.query('UPDATE orders SET points_earned=0 WHERE id=$1', [orderId]);
  }
  // spent points come back once; if the order is opened again they are spent again
  if (o.points_used > 0) {
    const given = (await t.query(`SELECT coalesce(sum(points),0)::int AS n FROM loyalty_ledger WHERE order_id=$1 AND kind IN ('refund','respend')`, [orderId])).rows[0].n;
    if (back && given === 0) await add(t, o.customer_id, o.points_used, 'refund', { orderId, note: `অর্ডার ${o.code} ${next === 'returned' ? 'ফেরত' : 'বাতিল'} — ব্যবহার করা পয়েন্ট ফেরত` });
    if (!back && (prev === 'cancelled' || prev === 'returned') && given > 0) {
      await add(t, o.customer_id, -o.points_used, 'respend', { orderId, note: `অর্ডার ${o.code} আবার চালু` });
    }
  }
}

async function forPhone(phone) {
  return one('SELECT id, name, points FROM customers WHERE phone=$1', [phone]);
}
async function history(customerId, limit = 50) {
  return q(`SELECT l.*, o.code AS order_code, s.name AS staff_name FROM loyalty_ledger l LEFT JOIN orders o ON o.id=l.order_id
    LEFT JOIN staff s ON s.id=l.staff_id WHERE l.customer_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT $2`, [customerId, limit]);
}
async function summary() {
  return one(`SELECT (SELECT coalesce(sum(points),0)::int FROM customers) AS outstanding,
    (SELECT count(*)::int FROM customers WHERE points > 0) AS holders,
    (SELECT coalesce(sum(points),0)::int FROM loyalty_ledger WHERE kind='earn' AND created_at > now() - interval '30 days') AS earned30,
    (SELECT coalesce(-sum(points),0)::int FROM loyalty_ledger WHERE kind='redeem' AND created_at > now() - interval '30 days') AS spent30`);
}
async function top(limit = 20) {
  return q('SELECT id, name, phone, points FROM customers WHERE points > 0 ORDER BY points DESC, id LIMIT $1', [limit]);
}
const KINDS = { earn: '➕ অর্ডারে পাওয়া', redeem: '➖ অর্ডারে খরচ', refund: '↩️ বাতিল অর্ডারের পয়েন্ট ফেরত', reverse: '↩️ ফেরত অর্ডারের পয়েন্ট বাদ', respend: '➖ অর্ডার আবার চালু', adjust: '✏️ হাতে বদল' };

module.exports = { cfg, earnFor, usable, add, redeem, onStatus, forPhone, history, summary, top, KINDS };

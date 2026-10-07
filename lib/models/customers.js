'use strict';
// Customers, block list and fraud signals.
const { q, one } = require('../db');
const { normalizePhone, str, int } = require('../util');

async function upsertCustomer(t, { name, phone, email, address, district, thana }) {
  const res = await t.query(
    `INSERT INTO customers(name, phone, email, address, district, thana) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name, email=CASE WHEN EXCLUDED.email<>'' THEN EXCLUDED.email ELSE customers.email END,
       address=EXCLUDED.address, district=EXCLUDED.district, thana=EXCLUDED.thana, updated_at=now()
     RETURNING id`, [name, phone, email || '', address || '', district || '', thana || '']);
  return res.rows[0].id;
}

const STATS = `count(o.id)::int AS orders,
  count(o.id) FILTER (WHERE o.status='delivered')::int AS delivered,
  count(o.id) FILTER (WHERE o.status='cancelled')::int AS cancelled,
  count(o.id) FILTER (WHERE o.status='returned')::int AS returned,
  coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0)::numeric(14,2) AS spent,
  max(o.created_at) AS last_order`;

async function listCustomers({ q: search, blocked, limit = 50, offset = 0, sort } = {}) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.address ILIKE $${params.length})`);
  }
  if (blocked) where.push(`EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone)`);
  const order = { spent: 'spent DESC', orders: 'orders DESC', name: 'c.name ASC' }[sort] || 'last_order DESC NULLS LAST, c.id DESC';
  params.push(limit, offset);
  return q(`SELECT c.*, ${STATS}, EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone) AS blocked
            FROM customers c LEFT JOIN orders o ON o.phone=c.phone
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            GROUP BY c.id ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countCustomers({ q: search } = {}) {
  const params = [];
  let where = '';
  if (search) { params.push(`%${search}%`); where = 'WHERE name ILIKE $1 OR phone ILIKE $1 OR address ILIKE $1'; }
  return (await one(`SELECT count(*)::int AS n FROM customers ${where}`, params)).n;
}
async function getCustomer(id) {
  const c = await one(`SELECT c.*, ${STATS} FROM customers c LEFT JOIN orders o ON o.phone=c.phone WHERE c.id=$1 GROUP BY c.id`, [id]);
  if (!c) return null;
  c.block = await one(`SELECT * FROM blocklist WHERE kind='phone' AND value=$1`, [c.phone]);
  return c;
}
async function updateCustomer(id, data) {
  await q(`UPDATE customers SET name=$1, email=$2, address=$3, district=$4, thana=$5, note=$6, updated_at=now() WHERE id=$7`,
    [str(data.name, 80), str(data.email, 120), str(data.address, 400), str(data.district, 60), str(data.thana, 60), str(data.note, 1000), id]);
}

// History of a phone number across all orders — used as a fraud signal.
async function phoneStats(phone) {
  return one(`SELECT count(*)::int AS orders,
      count(*) FILTER (WHERE status='delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('cancelled','returned'))::int AS failed,
      count(*) FILTER (WHERE status IN ('pending','confirmed','processing','shipped','hold'))::int AS open,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day
    FROM orders WHERE phone=$1`, [normalizePhone(phone)]);
}
// A simple risk label from past orders.
function riskOf(stats) {
  if (!stats || !stats.orders) return { level: 'new', label: 'নতুন কাস্টমার', ratio: null };
  const done = stats.delivered + stats.failed;
  const ratio = done ? Math.round((stats.delivered / done) * 100) : null;
  if (done >= 2 && ratio !== null && ratio < 50) return { level: 'high', label: 'ঝুঁকিপূর্ণ', ratio };
  if (stats.failed >= 1 && ratio !== null && ratio < 80) return { level: 'medium', label: 'সতর্ক থাকুন', ratio };
  return { level: 'low', label: 'বিশ্বস্ত', ratio };
}

// ---------------------------------------------------------------- block list
async function isBlocked(phone, ip) {
  const r = await one(`SELECT kind, reason FROM blocklist WHERE (kind='phone' AND value=$1) OR (kind='ip' AND value=$2 AND $2<>'') LIMIT 1`,
    [normalizePhone(phone), String(ip || '')]);
  return r;
}
async function block(kind, value, reason, staffId) {
  const v = kind === 'phone' ? normalizePhone(value) : str(value, 64);
  if (!v) return false;
  await q(`INSERT INTO blocklist(kind, value, reason, created_by) VALUES($1,$2,$3,$4)
           ON CONFLICT (kind, value) DO UPDATE SET reason=EXCLUDED.reason`, [kind === 'ip' ? 'ip' : 'phone', v, str(reason, 300), staffId || null]);
  return true;
}
async function unblock(id) { await q('DELETE FROM blocklist WHERE id=$1', [int(id)]); }
async function unblockValue(kind, value) { await q('DELETE FROM blocklist WHERE kind=$1 AND value=$2', [kind, value]); }
async function listBlocked() {
  return q(`SELECT b.*, s.name AS staff_name, c.name AS customer_name, c.id AS customer_id FROM blocklist b
            LEFT JOIN staff s ON s.id=b.created_by LEFT JOIN customers c ON b.kind='phone' AND c.phone=b.value
            ORDER BY b.created_at DESC`);
}

module.exports = {
  upsertCustomer, listCustomers, countCustomers, getCustomer, updateCustomer, phoneStats, riskOf,
  isBlocked, block, unblock, unblockValue, listBlocked,
};

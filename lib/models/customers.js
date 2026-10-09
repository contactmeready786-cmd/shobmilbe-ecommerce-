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

// Ready-made groups worked out from each customer's orders.
const SEGMENTS = {
  new: ['🆕 নতুন (১টি অর্ডার)', 'count(o.id) = 1'],
  repeat: ['🔁 আবার কিনেছেন (২+ ডেলিভারি)', "count(o.id) FILTER (WHERE o.status='delivered') >= 2"],
  vip: ['⭐ VIP (বেশি কেনাকাটা)', "coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0) >= $VIP"],
  inactive: ['😴 ৯০ দিন কোনো অর্ডার নেই', "max(o.created_at) < now() - interval '90 days'"],
  risky: ['⚠️ ঝুঁকিপূর্ণ (বেশি বাতিল/ফেরত)', "count(o.id) FILTER (WHERE o.status IN ('cancelled','returned')) >= 2 AND count(o.id) FILTER (WHERE o.status IN ('cancelled','returned')) >= count(o.id) FILTER (WHERE o.status='delivered')"],
  none: ['🚫 কোনো অর্ডার নেই', 'count(o.id) = 0'],
};
function customerQuery({ q: search, blocked, segment, grp, tag, vipMin = 5000 }, params) {
  const where = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.address ILIKE $${params.length} OR c.tags ILIKE $${params.length})`);
  }
  if (blocked) where.push(`EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone)`);
  if (grp) { params.push(grp); where.push(`c.grp=$${params.length}`); }
  if (tag) { params.push(`%${tag}%`); where.push(`c.tags ILIKE $${params.length}`); }
  let having = '';
  if (SEGMENTS[segment]) having = 'HAVING ' + SEGMENTS[segment][1].replace('$VIP', String(Math.max(0, Number(vipMin) || 0)));
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', having };
}
async function listCustomers({ limit = 50, offset = 0, sort, ...f } = {}) {
  const params = [];
  const { where, having } = customerQuery(f, params);
  const order = { spent: 'spent DESC', orders: 'orders DESC', name: 'c.name ASC' }[sort] || 'last_order DESC NULLS LAST, c.id DESC';
  params.push(limit, offset);
  return q(`SELECT c.*, ${STATS}, EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone) AS blocked
            FROM customers c LEFT JOIN orders o ON o.phone=c.phone
            ${where} GROUP BY c.id ${having} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countCustomers(f = {}) {
  const params = [];
  const { where, having } = customerQuery(f, params);
  return (await one(`SELECT count(*)::int AS n FROM (SELECT c.id FROM customers c LEFT JOIN orders o ON o.phone=c.phone ${where} GROUP BY c.id ${having}) x`, params)).n;
}
async function segmentCounts(vipMin) {
  const out = {};
  for (const k of Object.keys(SEGMENTS)) out[k] = await countCustomers({ segment: k, vipMin });
  return out;
}
// Every different address this customer has ordered to (newest first).
async function addresses(phone) {
  return q(`SELECT address, district, thana, max(created_at) AS last, count(*)::int AS n FROM orders WHERE phone=$1
    GROUP BY address, district, thana ORDER BY last DESC LIMIT 10`, [normalizePhone(phone)]);
}
async function getCustomer(id) {
  const c = await one(`SELECT c.*, ${STATS} FROM customers c LEFT JOIN orders o ON o.phone=c.phone WHERE c.id=$1 GROUP BY c.id`, [id]);
  if (!c) return null;
  c.block = await one(`SELECT * FROM blocklist WHERE kind='phone' AND value=$1`, [c.phone]);
  return c;
}
function cleanTags(v) {
  const seen = new Set();
  return String(v || '').split(/[,،]+/).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 30)).filter((t) => {
    const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 12).join(', ');
}
async function updateCustomer(id, data) {
  await q(`UPDATE customers SET name=$1, email=$2, address=$3, district=$4, thana=$5, note=$6, tags=$7, grp=$8, updated_at=now() WHERE id=$9`,
    [str(data.name, 80), str(data.email, 120), str(data.address, 400), str(data.district, 60), str(data.thana, 60), str(data.note, 1000),
      cleanTags(data.tags), str(data.grp, 40), id]);
}
async function allTags() {
  const rows = await q(`SELECT tags FROM customers WHERE tags <> ''`);
  const n = new Map();
  rows.forEach((r) => r.tags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => n.set(t, (n.get(t) || 0) + 1)));
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
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
  SEGMENTS, segmentCounts, addresses, allTags, cleanTags,
  upsertCustomer, listCustomers, countCustomers, getCustomer, updateCustomer, phoneStats, riskOf,
  isBlocked, block, unblock, unblockValue, listBlocked,
};

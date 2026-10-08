'use strict';
// Incomplete orders (অসম্পূর্ণ অর্ডার): a shopper typed a mobile number at checkout but did not press "অর্ডার কনফার্ম".
// The checkout page saves what was typed (only after a full, valid BD mobile number, and with a visible notice under the
// phone box). When the same number orders later, the draft is marked "অর্ডার হয়েছে" by itself.
// Admin → অর্ডার ও কাস্টমার → অসম্পূর্ণ অর্ডার: call them, turn it into an order, or drop it. Can be switched off there.
const db = require('../db');
const catalog = require('../models/catalog');
const { str, int, normalizePhone, validPhone } = require('../util');

const ID_RE = /^[a-f0-9]{20}$/;
const STATUSES = {
  open: ['🆕', 'নতুন — কল করা হয়নি'],
  called: ['📞', 'কল করা হয়েছে'],
  ordered: ['✅', 'অর্ডার হয়েছে'],
  closed: ['🚫', 'বাদ দেওয়া হয়েছে'],
};

async function save({ b, ip, settings }) {
  if (settings.draft_capture_on === '0') return { off: 1 };
  const id = String(b.id || '');
  const phone = normalizePhone(b.phone);
  if (!ID_RE.test(id) || !validPhone(phone)) return {};
  // what was in the cart, with today's names and prices (the shopper's own numbers are never trusted)
  const wanted = (Array.isArray(b.items) ? b.items : []).slice(0, 30)
    .map((i) => ({ id: int(i && i.id), qty: Math.min(999, Math.max(1, int(i && i.qty, 1))) })).filter((i) => i.id > 0);
  const prods = wanted.length ? await catalog.getProductsByIds(wanted.map((i) => i.id), { includeInactive: true }) : [];
  const items = wanted.map((i) => {
    const p = prods.find((x) => x.id === i.id);
    return p ? { id: p.id, name: p.name, sku: p.sku || '', price: Number(p.price) || 0, qty: i.qty } : null;
  }).filter(Boolean);
  const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0));
  const vid = ID_RE.test(String(b.vid || '')) ? String(b.vid) : '';
  const sid = ID_RE.test(String(b.sid || '')) ? String(b.sid) : '';
  // one open draft per number: a second visit with the same number updates the same row
  const same = await db.one(`SELECT id FROM checkout_drafts WHERE phone = $1 AND status IN ('open','called') AND updated_at > now() - interval '1 day'
    ORDER BY updated_at DESC LIMIT 1`, [phone]);
  const key = same ? same.id : id;
  await db.q(`INSERT INTO checkout_drafts(id, visitor_id, session_id, name, phone, district, thana, address, note, items, subtotal, ip)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    ON CONFLICT (id) DO UPDATE SET visitor_id = CASE WHEN EXCLUDED.visitor_id <> '' THEN EXCLUDED.visitor_id ELSE checkout_drafts.visitor_id END,
      session_id = CASE WHEN EXCLUDED.session_id <> '' THEN EXCLUDED.session_id ELSE checkout_drafts.session_id END,
      name = EXCLUDED.name, phone = EXCLUDED.phone, district = EXCLUDED.district, thana = EXCLUDED.thana, address = EXCLUDED.address,
      note = EXCLUDED.note, items = CASE WHEN jsonb_array_length(EXCLUDED.items) > 0 THEN EXCLUDED.items ELSE checkout_drafts.items END,
      subtotal = CASE WHEN jsonb_array_length(EXCLUDED.items) > 0 THEN EXCLUDED.subtotal ELSE checkout_drafts.subtotal END,
      ip = EXCLUDED.ip, updated_at = now()
    WHERE checkout_drafts.status IN ('open', 'called')`,
  [key, vid, sid, str(b.name, 80), phone, str(b.district, 60), str(b.thana, 60), str(b.address, 400), str(b.note, 300), JSON.stringify(items), subtotal, str(ip, 64)]);
  if (Math.random() < 0.02) db.q(`DELETE FROM checkout_drafts WHERE updated_at < now() - interval '90 days'`).catch(() => {});
  return { ok: 1 };
}

// An order was placed with this number: its drafts are done.
async function markOrdered(phone, code) {
  try {
    await db.q(`UPDATE checkout_drafts SET status = 'ordered', order_code = $2, updated_at = now()
      WHERE phone = $1 AND status IN ('open','called') AND created_at > now() - interval '14 days'`, [normalizePhone(phone), String(code || '')]);
  } catch (e) { console.error('drafts', e.message); }
}

function where(f, params) {
  const w = [];
  if (f.status && STATUSES[f.status]) { params.push(f.status); w.push(`d.status = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = params.length;
    w.push(`(d.phone ILIKE $${n} OR d.name ILIKE $${n} OR d.address ILIKE $${n} OR d.district ILIKE $${n} OR d.thana ILIKE $${n} OR d.items::text ILIKE $${n})`);
  }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}
async function list(f, { limit = 50, offset = 0 } = {}) {
  const params = [];
  const w = where(f, params);
  params.push(limit, offset);
  return db.q(`SELECT d.*, c.id AS customer_id, s.name AS caller_name,
      (SELECT count(*)::int FROM orders o WHERE o.phone = d.phone) AS past_orders,
      (d.updated_at > now() - interval '10 minutes' AND d.status = 'open') AS still_here
    FROM checkout_drafts d LEFT JOIN customers c ON c.phone = d.phone LEFT JOIN staff s ON s.id = d.called_by
    ${w} ORDER BY d.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function count(f) {
  const params = [];
  return (await db.one(`SELECT count(*)::int AS n FROM checkout_drafts d ${where(f, params)}`, params)).n;
}
async function counts() {
  const rows = await db.q(`SELECT status, count(*)::int AS n, coalesce(sum(subtotal),0)::int AS value FROM checkout_drafts GROUP BY status`);
  const out = { all: 0 };
  rows.forEach((r) => { out[r.status] = r; out.all += r.n; });
  return out;
}
async function get(id) { return ID_RE.test(String(id)) ? db.one('SELECT * FROM checkout_drafts WHERE id = $1', [id]) : null; }
async function setStatus(id, status, staffId) {
  if (!STATUSES[status] || !ID_RE.test(String(id))) return;
  await db.q(`UPDATE checkout_drafts SET status = $2, updated_at = now(),
    called_by = CASE WHEN $2 = 'called' THEN $3::int ELSE called_by END, called_at = CASE WHEN $2 = 'called' THEN now() ELSE called_at END
    WHERE id = $1`, [id, status, staffId || null]);
}
async function setNote(id, note) { if (ID_RE.test(String(id))) await db.q('UPDATE checkout_drafts SET admin_note = $2 WHERE id = $1', [id, str(note, 500)]); }
async function remove(id) { if (ID_RE.test(String(id))) await db.q('DELETE FROM checkout_drafts WHERE id = $1', [id]); }

module.exports = { STATUSES, ID_RE, save, markOrdered, list, count, counts, get, setStatus, setNote, remove };

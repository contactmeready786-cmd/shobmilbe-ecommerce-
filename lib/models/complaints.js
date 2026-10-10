'use strict';
// 📮 অভিযোগ (complaints). Bangladesh's Digital Commerce Operation Guidelines 2021 ask every online shop to give customers a
// way to complain, keep a record of each complaint and solve it within 72 hours. This keeps that record:
//  • the customer fills a short form (/complaint) — gets a complaint number by SMS and can see its status any time;
//  • the owner gets a phone notification; Admin → অভিযোগ shows each one with the hours left (red when late);
//  • staff write notes (inside only) or a reply to the customer (also sent by SMS), then mark it solved.
const crypto = require('crypto');
const db = require('../db');
const security = require('../security');
const { str, int, normalizePhone, validPhone, bn } = require('../util');

class ComplaintError extends Error {}

const TOPICS = {
  late: 'ডেলিভারি দেরি / পণ্য পাইনি',
  wrong: 'ভুল, ভাঙা বা নষ্ট পণ্য',
  warranty: '🛡️ ওয়ারেন্টি দাবি (পণ্য নষ্ট হয়ে গেছে)',
  missing: 'পণ্য কম এসেছে',
  refund: 'টাকা ফেরত',
  payment: 'পেমেন্টের সমস্যা',
  behaviour: 'ডেলিভারিম্যান / স্টাফের আচরণ',
  other: 'অন্যান্য',
};
const STATUS = {
  open: ['🆕', 'নতুন'],
  working: ['🔧', 'কাজ চলছে'],
  solved: ['✅', 'সমাধান হয়েছে'],
  closed: ['🚫', 'বন্ধ'],
};
const OPEN = ['open', 'working'];
const hoursOf = (s) => Math.max(1, Math.min(240, int(s.complaint_hours, 72)));

async function newCode() {
  for (let i = 0; i < 8; i++) {
    const c = 'C' + String(crypto.randomInt(100000, 1000000));
    if (!(await db.one('SELECT 1 FROM complaints WHERE code=$1', [c]))) return c;
  }
  return 'C' + Date.now().toString().slice(-8);
}

// photos: data:image URLs made small in the browser (max 4) — kept private (only staff see them)
async function savePhotos(list) {
  const catalog = require('./catalog');
  const out = [];
  for (const d of (Array.isArray(list) ? list : []).slice(0, 4)) {
    const m = String(d || '').match(/^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const data = Buffer.from(m[1], 'base64');
    if (data.length > 1.2 * 1024 * 1024) throw new ComplaintError('একটা ছবি অনেক বড়। ছোট ছবি দিন।');
    const mime = security.imageKind(data);
    if (!mime || !/^image\/(jpeg|png|webp)$/.test(mime)) throw new ComplaintError('শুধু JPG, PNG বা WebP ছবি দিন।');
    out.push(await catalog.saveMedia({ mime, data, ownerType: 'complaint', ownerId: 0, keepPrivate: true }));
  }
  return out;
}

// 🛡️ warranty: until when a delivered product is covered (null = no warranty, 'unknown' = the owner's own wording)
function warrantyEnd(item, deliveredAt) {
  const w = String((item && item.warranty) || '');
  if (!w || !deliveredAt) return null;
  let n; let unit;
  const fixed = w.match(/^(\d+)([dmy])$/);
  if (fixed) { n = Number(fixed[1]); unit = fixed[2]; } else if (w.startsWith('c:')) {
    const t = w.slice(2).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
    const m = t.match(/(\d+)\s*(দিন|day|মাস|month|বছর|year)/i);
    if (!m) return 'unknown';
    n = Number(m[1]); unit = /দিন|day/i.test(m[2]) ? 'd' : /মাস|month/i.test(m[2]) ? 'm' : 'y';
  } else return null;
  const d = new Date(deliveredAt);
  if (unit === 'd') d.setUTCDate(d.getUTCDate() + n);
  if (unit === 'm') d.setUTCMonth(d.getUTCMonth() + n);
  if (unit === 'y') d.setUTCFullYear(d.getUTCFullYear() + n);
  return d;
}
// the products of a delivered order that have a warranty, with the end date and whether it still runs
function warrantyItems(order) {
  if (!order || order.status !== 'delivered') return [];
  const at = order.delivered_at || order.updated_at;
  const seen = new Set();
  return (order.items || []).filter((i) => i.product_id && i.warranty && !seen.has(i.product_id) && seen.add(i.product_id)).map((i) => {
    const end = warrantyEnd(i, at);
    return { product_id: i.product_id, name: i.name, end, valid: end === 'unknown' || (end instanceof Date && end.getTime() >= Date.now()) };
  }).filter((x) => x.end);
}

async function create({ name, phone, email, orderCode, topic, message, photos, ip, source = 'web', settings, productId }) {
  const nm = str(name, 80).trim();
  const ph = normalizePhone(phone);
  const msg = str(message, 2000).trim();
  if (nm.length < 2) throw new ComplaintError('আপনার নাম লিখুন।');
  if (!validPhone(ph)) throw new ComplaintError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678 — এই নম্বরে আপনাকে জানানো হবে।');
  if (msg.length < 10) throw new ComplaintError('সমস্যাটা একটু বিস্তারিত লিখুন (কমপক্ষে ১০ অক্ষর)।');
  const em = str(email, 120).trim();
  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new ComplaintError('ইমেইল ঠিক নেই (না দিলেও চলবে)।');
  let oc = str(orderCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (oc && !(await db.one('SELECT 1 FROM orders WHERE code=$1', [oc]))) oc = ''; // a wrong order number is just left out
  // 🛡️ a warranty claim must name a product of a delivered order whose warranty still runs
  let item = null;
  if (topic === 'warranty') {
    if (!oc) throw new ComplaintError('ওয়ারেন্টি দাবির জন্য অর্ডার নম্বর দিন (অর্ডারের পেজের "ওয়ারেন্টি দাবি করুন" বাটন থেকে এলে নিজে থেকেই বসে)।');
    const O = require('./orders');
    const order = await O.getOrder({ code: oc });
    if (!order || order.phone !== ph) throw new ComplaintError('এই অর্ডার নম্বর আর মোবাইল নম্বর মিলছে না — যে নম্বরে অর্ডার করেছিলেন সেটা দিন।');
    const list = warrantyItems(order);
    if (!list.length) throw new ComplaintError(order.status === 'delivered' ? 'এই অর্ডারের কোনো পণ্যে ওয়ারেন্টি নেই।' : 'পণ্য হাতে পাওয়ার (ডেলিভারির) পরে ওয়ারেন্টি দাবি করা যায়।');
    item = list.find((x) => x.product_id === int(productId)) || (list.length === 1 ? list[0] : null);
    if (!item) throw new ComplaintError('কোন পণ্যের ওয়ারেন্টি দাবি করছেন বাছাই করুন।');
    if (!item.valid) throw new ComplaintError(`"${item.name}" এর ওয়ারেন্টির মেয়াদ শেষ হয়ে গেছে। তবুও সমস্যা জানাতে চাইলে বিষয় "অন্যান্য" দিয়ে লিখুন।`);
  }
  const photoIds = await savePhotos(photos);
  const code = await newCode();
  const row = await db.one(`INSERT INTO complaints(code, name, phone, email, order_code, topic, message, photos, source, ip, due_at, product_id, item_name, warranty_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(hours => $11), $12, $13, $14) RETURNING *`,
  [code, nm, ph, em, oc, TOPICS[topic] ? topic : 'other', msg, photoIds, source, str(ip, 64), hoursOf(settings),
    item ? item.product_id : null, item ? str(item.name, 200) : '', item && item.end instanceof Date ? item.end.toISOString().slice(0, 10) : null]);
  return row;
}

// what the customer may see: the status and the replies sent to them (never the staff's inside notes)
async function forCustomer(code, phone) {
  const c = await db.one('SELECT * FROM complaints WHERE code=$1 AND phone=$2', [str(code, 12).toUpperCase().trim(), normalizePhone(phone)]);
  if (!c) return null;
  c.replies = await db.q('SELECT body, created_at FROM complaint_notes WHERE complaint_id=$1 AND to_customer ORDER BY id', [c.id]);
  return c;
}

function where(f, params) {
  const w = [];
  if (f.status === 'late') w.push(`c.status IN ('open','working') AND c.due_at < now()`);
  else if (f.status === 'active') w.push(`c.status IN ('open','working')`);
  else if (STATUS[f.status]) { params.push(f.status); w.push(`c.status=$${params.length}`); }
  if (f.q) {
    params.push(`%${f.q}%`);
    w.push(`(c.code ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.order_code ILIKE $${params.length} OR c.message ILIKE $${params.length})`);
  }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}
async function list(f = {}, { limit = 50, offset = 0 } = {}) {
  const params = [];
  const w = where(f, params);
  return db.q(`SELECT c.*, s.name AS staff_name, (SELECT count(*)::int FROM complaint_notes n WHERE n.complaint_id=c.id) AS notes
    FROM complaints c LEFT JOIN staff s ON s.id=c.assigned_to ${w}
    ORDER BY (c.status IN ('open','working')) DESC, CASE WHEN c.status IN ('open','working') THEN c.due_at END ASC, c.created_at DESC
    LIMIT ${int(limit)} OFFSET ${int(offset)}`, params);
}
async function count(f = {}) { const params = []; return (await db.one(`SELECT count(*)::int AS n FROM complaints c ${where(f, params)}`, params)).n; }
async function counts() {
  return db.one(`SELECT count(*) FILTER (WHERE status IN ('open','working'))::int AS active,
      count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE status='working')::int AS working,
      count(*) FILTER (WHERE status IN ('open','working') AND due_at < now())::int AS late,
      count(*) FILTER (WHERE status IN ('open','working') AND due_at >= now() AND due_at < now() + interval '24 hours')::int AS soon,
      count(*) FILTER (WHERE status='solved')::int AS solved, count(*) FILTER (WHERE status='closed')::int AS closed, count(*)::int AS total,
      count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= due_at AND created_at > now() - interval '30 days')::int AS ontime30,
      count(*) FILTER (WHERE resolved_at IS NOT NULL AND created_at > now() - interval '30 days')::int AS done30
    FROM complaints`);
}
async function get(id) {
  const c = await db.one('SELECT c.*, s.name AS staff_name FROM complaints c LEFT JOIN staff s ON s.id=c.assigned_to WHERE c.id=$1', [int(id)]);
  if (!c) return null;
  c.notes = await db.q('SELECT n.*, s.name AS staff_name FROM complaint_notes n LEFT JOIN staff s ON s.id=n.staff_id WHERE n.complaint_id=$1 ORDER BY n.id', [c.id]);
  c.history = await db.q(`SELECT id, code, status, created_at FROM complaints WHERE phone=$1 AND id<>$2 ORDER BY id DESC LIMIT 10`, [c.phone, c.id]);
  return c;
}

// a note: inside only, or a reply that the customer sees (and gets by SMS when SMS works)
async function addNote(id, { staffId, body, toCustomer, settings }) {
  const c = await db.one('SELECT * FROM complaints WHERE id=$1', [int(id)]);
  if (!c) throw new ComplaintError('অভিযোগটি পাওয়া যায়নি।');
  const text = str(body, 1000).trim();
  if (text.length < 2) throw new ComplaintError('কিছু লিখুন।');
  let smsOk = null;
  if (toCustomer) {
    const SMS = require('../services/sms');
    if (SMS.ready(settings).ok) {
      const r = await SMS.send(settings, c.phone, `${settings.store_name || ''}: অভিযোগ ${c.code} — ${text}`.slice(0, 600), { kind: 'complaint' });
      smsOk = r.ok;
    }
  }
  await db.q('INSERT INTO complaint_notes(complaint_id, staff_id, body, to_customer, sms_ok) VALUES($1,$2,$3,$4,$5)', [c.id, staffId || null, text, !!toCustomer, smsOk]);
  await db.q(`UPDATE complaints SET updated_at=now(), first_reply_at = CASE WHEN $2 THEN coalesce(first_reply_at, now()) ELSE first_reply_at END,
    status = CASE WHEN status='open' THEN 'working' ELSE status END WHERE id=$1`, [c.id, !!toCustomer]);
  return { smsOk };
}
async function setStatus(id, { status, resolution, staffId, settings }) {
  if (!STATUS[status]) throw new ComplaintError('অবস্থা ঠিক নেই।');
  const c = await db.one('SELECT * FROM complaints WHERE id=$1', [int(id)]);
  if (!c) throw new ComplaintError('অভিযোগটি পাওয়া যায়নি।');
  const res = str(resolution, 1000).trim();
  if ((status === 'solved' || status === 'closed') && res.length < 3) throw new ComplaintError('কী সমাধান হলো (বা কেন বন্ধ করছেন) ছোট করে লিখুন — রেকর্ডে থাকবে।');
  const done = status === 'solved' || status === 'closed';
  await db.q(`UPDATE complaints SET status=$2, resolution = CASE WHEN $3 <> '' THEN $3 ELSE resolution END,
    resolved_at = CASE WHEN $4 THEN coalesce(resolved_at, now()) ELSE NULL END, updated_at=now() WHERE id=$1`, [c.id, status, res, done]);
  // the customer hears that it's solved (once)
  if (status === 'solved' && c.status !== 'solved' && settings.complaint_sms_on !== '0') {
    const SMS = require('../services/sms');
    if (SMS.ready(settings).ok) {
      const r = await SMS.send(settings, c.phone, `${settings.store_name || ''}: আপনার অভিযোগ ${c.code} এর সমাধান হয়েছে — ${res}`.slice(0, 600), { kind: 'complaint' });
      await db.q('INSERT INTO complaint_notes(complaint_id, staff_id, body, to_customer, sms_ok) VALUES($1,$2,$3,true,$4)', [c.id, staffId || null, `✅ সমাধান: ${res}`, r.ok]);
    }
  }
}
async function assign(id, staffId) { await db.q('UPDATE complaints SET assigned_to=$2, updated_at=now() WHERE id=$1', [int(id), staffId ? int(staffId) : null]); }

// "time left" in words: "৪১ ঘণ্টা বাকি" / "৫ ঘণ্টা দেরি"
function timeLeft(c) {
  if (!OPEN.includes(c.status)) return null;
  const ms = new Date(c.due_at).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 36e5);
  return ms >= 0 ? { late: false, soon: ms < 24 * 36e5, text: h < 1 ? '১ ঘণ্টারও কম বাকি' : `${bn(h)} ঘণ্টা বাকি` }
    : { late: true, text: `${bn(Math.max(1, h))} ঘণ্টা দেরি` };
}

module.exports = { warrantyEnd, warrantyItems, ComplaintError, TOPICS, STATUS, OPEN, create, forCustomer, list, count, counts, get, addNote, setStatus, assign, timeLeft, hoursOf };

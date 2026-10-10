'use strict';
// Small shop helpers that customers use on the product page:
//   🔔 "স্টকে এলে জানাও" — a mobile number left on an out-of-stock product; an SMS goes out when it is back
//   ❓ প্রশ্ন-উত্তর      — customers ask about a product; the shop answers; answered questions show on the page
const db = require('../db');
const { str, int, normalizePhone, validPhone, fmtDate } = require('../util');

// ---------------------------------------------------------------- stock alerts
class UserError extends Error {}

async function subscribeStock({ productId, phone, ip }) {
  const pid = int(productId);
  const ph = normalizePhone(phone);
  if (!validPhone(ph)) throw new UserError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
  const p = await db.one(`SELECT p.id, p.name, p.stock, p.variant_count FROM products p WHERE p.id=$1 AND p.active
    AND (p.parent_id IS NULL OR EXISTS (SELECT 1 FROM products pp WHERE pp.id=p.parent_id AND pp.active))`, [pid]);
  if (!p) throw new UserError('পণ্যটা পাওয়া যায়নি।');
  if (p.variant_count > 0) throw new UserError('আগে সাইজ/রং/মডেল বাছাই করুন।');
  if (p.stock > 0) throw new UserError('পণ্যটা এখন স্টকে আছে — এখনই কার্টে যোগ করতে পারেন।');
  const r = await db.one(`INSERT INTO stock_alerts(product_id, phone, ip) VALUES($1,$2,$3)
    ON CONFLICT (product_id, phone) DO UPDATE SET notified_at=NULL, result='', created_at=now() RETURNING (xmax = 0) AS fresh`, [p.id, ph, str(ip, 60)]);
  return { name: p.name, fresh: !!(r && r.fresh) };
}

// Products that came back: SMS everyone waiting for them (a few at a time; the rest next time).
// Runs after admin work and on the hourly tick. Without SMS set up nothing is lost — they keep waiting.
async function restockSweep(settings, { limit = 30 } = {}) {
  const SMS = require('../services/sms');
  if (!SMS.ready(settings).ok) return { sent: 0, waiting: true };
  const rows = await db.q(`SELECT a.id, a.phone, p.id AS product_id, p.name, coalesce(pp.slug, p.slug) AS slug, p.id AS vid, p.parent_id
    FROM stock_alerts a JOIN products p ON p.id=a.product_id LEFT JOIN products pp ON pp.id=p.parent_id
    WHERE a.notified_at IS NULL AND p.active AND p.stock > 0 AND (pp.id IS NULL OR pp.active)
      AND a.created_at > now() - interval '120 days'
    ORDER BY a.id LIMIT $1`, [limit]);
  if (!rows.length) return { sent: 0 };
  const base = String(settings.site_url || '').replace(/\/+$/, '');
  const tpl = String(settings.restock_sms || '').trim() || '{shop}: আপনি যে পণ্যটার খবর চেয়েছিলেন "{product}" আবার স্টকে এসেছে। এখনই অর্ডার করুন: {link}';
  let sent = 0;
  for (const r of rows) {
    // claim the row first, so two runs at once never SMS the same person twice
    const mine = await db.one(`UPDATE stock_alerts SET notified_at=now(), result='পাঠানো হচ্ছে' WHERE id=$1 AND notified_at IS NULL RETURNING id`, [r.id]);
    if (!mine) continue;
    const link = base ? `${base}/p/${encodeURIComponent(r.slug)}${r.parent_id ? `?v=${r.vid}` : ''}` : '';
    const text = tpl.replace(/\{shop\}/g, settings.store_name || '').replace(/\{product\}/g, String(r.name).slice(0, 60)).replace(/\{link\}/g, link).trim();
    const res = await SMS.send(settings, r.phone, text, { kind: 'restock' });
    await db.q('UPDATE stock_alerts SET result=$1 WHERE id=$2', [res.ok ? '✅ SMS গেছে' : `❌ ${String(res.msg || '').slice(0, 120)}`, r.id]);
    if (res.ok) sent += 1;
    else if (/balance|credit|key|invalid/i.test(String(res.msg))) break; // the SMS company refuses everything — try later
  }
  return { sent };
}

async function stockAlertList({ status = 'waiting', limit = 200 } = {}) {
  const where = status === 'sent' ? 'a.notified_at IS NOT NULL' : status === 'all' ? 'true' : 'a.notified_at IS NULL';
  return db.q(`SELECT a.*, p.name, p.sku, p.stock, p.image_id, p.emoji, coalesce(p.parent_id, p.id) AS edit_id
    FROM stock_alerts a JOIN products p ON p.id=a.product_id WHERE ${where} ORDER BY a.created_at DESC LIMIT $1`, [limit]);
}
// Most wanted products that are out of stock — what to buy first.
async function stockAlertTop(limit = 15) {
  return db.q(`SELECT p.id, p.name, p.sku, p.stock, p.image_id, p.emoji, coalesce(p.parent_id, p.id) AS edit_id, count(*)::int AS n, max(a.created_at) AS last_at
    FROM stock_alerts a JOIN products p ON p.id=a.product_id WHERE a.notified_at IS NULL
    GROUP BY p.id ORDER BY count(*) DESC, max(a.created_at) DESC LIMIT $1`, [limit]);
}

// ---------------------------------------------------------------- questions & answers
const Q_STATUSES = { pending: 'উত্তরের অপেক্ষায়', published: 'দোকানে দেখাচ্ছে', hidden: 'লুকানো' };

async function askQuestion({ productId, name, phone, question, ip }) {
  const text = str(question, 500).replace(/\s+/g, ' ');
  if (text.length < 5) throw new UserError('প্রশ্নটা একটু বিস্তারিত লিখুন।');
  if (/https?:\/\/|www\./i.test(text)) throw new UserError('প্রশ্নে লিংক দেওয়া যায় না।');
  const ph = phone ? normalizePhone(phone) : '';
  if (ph && !validPhone(ph)) throw new UserError('মোবাইল নম্বর ঠিক নেই (না দিলেও চলবে)।');
  const p = await db.one('SELECT id, name FROM products WHERE id=$1 AND active AND parent_id IS NULL', [int(productId)]);
  if (!p) throw new UserError('পণ্যটা পাওয়া যায়নি।');
  const dup = await db.one(`SELECT id FROM product_questions WHERE product_id=$1 AND lower(question)=lower($2) AND created_at > now() - interval '1 day'`, [p.id, text]);
  if (dup) return { id: dup.id, product: p.name, dup: true };
  const r = await db.one(`INSERT INTO product_questions(product_id, name, phone, question, ip) VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [p.id, str(name, 60), ph, text, str(ip, 60)]);
  return { id: r.id, product: p.name };
}
async function publishedQuestions(productId, limit = 30) {
  return db.q(`SELECT id, name, question, answer, created_at FROM product_questions
    WHERE product_id=$1 AND status='published' AND answer<>'' ORDER BY answered_at DESC NULLS LAST, id DESC LIMIT $2`, [int(productId), limit]);
}
async function listQuestions({ status = 'pending', limit = 100, offset = 0 } = {}) {
  const params = [];
  let where = '';
  if (Q_STATUSES[status]) { params.push(status); where = `WHERE q.status=$1`; }
  params.push(limit, offset);
  return db.q(`SELECT q.*, p.name AS product_name, p.slug, p.image_id, p.emoji, s.name AS answered_by_name FROM product_questions q
    JOIN products p ON p.id=q.product_id LEFT JOIN staff s ON s.id=q.answered_by ${where}
    ORDER BY q.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function questionCounts() {
  const rows = await db.q('SELECT status, count(*)::int AS n FROM product_questions GROUP BY status');
  const out = { all: 0 };
  rows.forEach((r) => { out[r.status] = r.n; out.all += r.n; });
  return out;
}
// Save the shop's answer. publish=false keeps it hidden. Returns the question (for the "answered" SMS).
async function answerQuestion(id, { answer, publish, question }, staffId) {
  const a = str(answer, 1500);
  const q = await db.one('SELECT * FROM product_questions WHERE id=$1', [int(id)]);
  if (!q) throw new UserError('প্রশ্নটা পাওয়া যায়নি।');
  const status = publish && a ? 'published' : a ? 'hidden' : q.status === 'published' ? 'pending' : q.status;
  const fixedQ = str(question, 500) || q.question;
  await db.q(`UPDATE product_questions SET answer=$1, status=$2, question=$3, answered_by=$4, answered_at = CASE WHEN $1<>'' THEN coalesce(answered_at, now()) ELSE NULL END WHERE id=$5`,
    [a, status, fixedQ, staffId || null, q.id]);
  return { ...q, answer: a, status, firstAnswer: !q.answer && !!a };
}

module.exports = {
  UserError, subscribeStock, restockSweep, stockAlertList, stockAlertTop,
  Q_STATUSES, askQuestion, publishedQuestions, listQuestions, questionCounts, answerQuestion, fmtDate,
};

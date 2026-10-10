'use strict';
// 💳 Gift cards and 🎁 referrals.
//   Gift card: a code with a balance (৳). Sold in the admin (counter / phone order) or requested on the shop's
//   /gift-card page with a Send Money TrxID (the shop checks the money, then switches it on). The code goes to the
//   receiver by SMS; at checkout the code pays part or all of an order. Cancelled / returned order → money back on the card.
//   Referral: every customer has a code. A new customer who orders with it gets a discount; when that first order is
//   delivered, the customer who shared the code gets a gift card (Admin → মার্কেটিং → রেফারেল ও গিফট কার্ড).
const db = require('../db');
const { str, int, amount, round2, randomCode, normalizePhone, validPhone, ymd, bn } = require('../util');

class GiftError extends Error {}
const STATUSES = { pending: 'পেমেন্ট যাচাইয়ের অপেক্ষায়', active: 'চালু', used: 'শেষ (টাকা নেই)', disabled: 'বন্ধ', expired: 'মেয়াদ শেষ' };

const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newCode() { const r = randomCode(8); return `GC${r.slice(0, 4)}${r.slice(4)}`; }
// GC7KQ29XMP → GC-7KQ2-9XMP (easier to read out on the phone)
function pretty(code) { const c = cleanCode(code); return c.length === 10 ? `${c.slice(0, 2)}-${c.slice(2, 6)}-${c.slice(6)}` : c; }

async function issue({ amount: amt, status = 'active', source = 'admin', buyerName = '', buyerPhone = '', recipientName = '', recipientPhone = '', message = '',
  validDays = 0, payMethod = '', trxId = '', payNumber = '', price = null, customerId = null, note = '', staffId = null, ip = '' }) {
  const a = round2(amount(amt));
  if (!(a >= 1) || a > 100000) throw new GiftError('গিফট কার্ডের টাকার পরিমাণ ঠিক নেই।');
  const rp = recipientPhone ? normalizePhone(recipientPhone) : '';
  if (rp && !validPhone(rp)) throw new GiftError('প্রাপকের মোবাইল নম্বর ঠিক নেই।');
  const days = Math.max(0, int(validDays));
  for (let i = 0; i < 5; i++) {
    const row = await db.one(`INSERT INTO gift_cards(code, initial, balance, status, source, buyer_name, buyer_phone, recipient_name, recipient_phone, message, expires_on,
        pay_method, trx_id, pay_number, price, customer_id, note, created_by, ip, activated_at)
      VALUES($1,$2::numeric,$2::numeric,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10::int > 0 THEN (now() AT TIME ZONE 'Asia/Dhaka')::date + $10::int END, $11,$12,$13,$14,$15,$16,$17,$18, CASE WHEN $3='active' THEN now() END)
      ON CONFLICT (code) DO NOTHING RETURNING *`,
    [newCode(), a, status, source, str(buyerName, 80), buyerPhone ? normalizePhone(buyerPhone) : '', str(recipientName, 80), rp, str(message, 120), days,
      str(payMethod, 30), str(trxId, 40).toUpperCase(), payNumber ? normalizePhone(payNumber) : '', price === null ? a : round2(amount(price)), customerId, str(note, 300), staffId, str(ip, 60)]);
    if (row) {
      await db.q('INSERT INTO gift_card_ledger(card_id, amount, balance, note, staff_id) VALUES($1,$2,$2,$3,$4)', [row.id, a, source === 'referral' ? 'রেফারেলের পুরস্কার' : 'কার্ড তৈরি', staffId]);
      return row;
    }
  }
  throw new GiftError('কোড তৈরি করা যায়নি, আবার চেষ্টা করুন।');
}

// The SMS with the code, to the receiver.
async function sendCodeSms(settings, card) {
  const SMS = require('../services/sms');
  if (!card.recipient_phone || !SMS.ready(settings).ok) return { ok: false, msg: 'SMS চালু নেই বা নম্বর নেই' };
  const tpl = String(settings.gift_sms || '').trim() || '{shop}: আপনার জন্য {amount} টাকার গিফট কার্ড{from}! কোড: {code}{expiry}। চেকআউটে কোডটা দিন।{message}';
  const text = tpl.replace(/\{shop\}/g, settings.store_name || '').replace(/\{amount\}/g, String(Number(card.balance)))
    .replace(/\{from\}/g, card.buyer_name && card.source !== 'referral' ? ` — ${card.buyer_name} পাঠিয়েছেন` : '')
    .replace(/\{code\}/g, pretty(card.code)).replace(/\{expiry\}/g, card.expires_on ? `, মেয়াদ ${String(card.expires_on).slice(0, 10)}` : '')
    .replace(/\{message\}/g, card.message ? ` "${card.message}"` : '');
  return SMS.send(settings, card.recipient_phone, text, { kind: 'giftcard' });
}

// For the checkout box: is this a usable card, and how much is on it?
async function check(code) {
  const c = await db.one('SELECT * FROM gift_cards WHERE code=$1', [cleanCode(code)]);
  if (!c) return { ok: false, message: 'এই গিফট কার্ড কোডটা সঠিক নয়।' };
  if (c.status === 'pending') return { ok: false, message: 'এই গিফট কার্ডের পেমেন্ট এখনো যাচাই হয়নি।' };
  if (c.status === 'disabled') return { ok: false, message: 'এই গিফট কার্ড বন্ধ করা আছে।' };
  if (c.expires_on && String(c.expires_on).slice(0, 10) < ymd()) return { ok: false, message: 'এই গিফট কার্ডের মেয়াদ শেষ।' };
  if (!(Number(c.balance) > 0)) return { ok: false, message: 'এই গিফট কার্ডে আর টাকা নেই।' };
  return { ok: true, card: c, balance: Number(c.balance), code: c.code, message: `গিফট কার্ডে আছে ৳${bn(Number(c.balance))}` };
}

// Inside the order: take up to `want` from the card (locked, so two orders can't spend the same money).
async function spend(t, code, want, orderId) {
  const c = (await t.query('SELECT * FROM gift_cards WHERE code=$1 FOR UPDATE', [cleanCode(code)])).rows[0];
  const ok = c && c.status === 'active' && Number(c.balance) > 0 && !(c.expires_on && String(c.expires_on).slice(0, 10) < ymd());
  if (!ok) return null;
  const take = round2(Math.min(Number(c.balance), want));
  if (!(take > 0)) return null;
  const left = round2(Number(c.balance) - take);
  await t.query(`UPDATE gift_cards SET balance=$1::numeric, status=CASE WHEN $1::numeric <= 0 THEN 'used' ELSE status END WHERE id=$2`, [left, c.id]);
  await t.query('INSERT INTO gift_card_ledger(card_id, order_id, amount, balance, note) VALUES($1,$2,$3,$4,$5)', [c.id, orderId, -take, left, 'অর্ডারে খরচ']);
  return { code: c.code, amount: take };
}
// A cancelled / returned order: the card money comes back (once).
async function refundOrder(orderId, staffId = null) {
  return db.tx(async (t) => {
    const o = (await t.query('SELECT id, code, gift_code, gift_amount, paid_amount FROM orders WHERE id=$1 FOR UPDATE', [int(orderId)])).rows[0];
    if (!o || !o.gift_code || !(Number(o.gift_amount) > 0)) return null;
    const c = (await t.query('SELECT * FROM gift_cards WHERE code=$1 FOR UPDATE', [o.gift_code])).rows[0];
    if (!c) return null;
    const net = (await t.query('SELECT coalesce(sum(amount),0)::numeric(14,2) AS n FROM gift_card_ledger WHERE card_id=$1 AND order_id=$2', [c.id, o.id])).rows[0];
    const back = round2(-Number(net.n));
    if (!(back > 0)) return null; // already given back
    const bal = round2(Number(c.balance) + back);
    await t.query(`UPDATE gift_cards SET balance=$1, status=CASE WHEN status='used' THEN 'active' ELSE status END WHERE id=$2`, [bal, c.id]);
    await t.query('INSERT INTO gift_card_ledger(card_id, order_id, amount, balance, note, staff_id) VALUES($1,$2,$3,$4,$5,$6)', [c.id, o.id, back, bal, `অর্ডার ${o.code} বাতিল/ফেরত — টাকা কার্ডে ফেরত`, staffId]);
    await t.query(`UPDATE orders SET paid_amount = greatest(0, paid_amount - $1::numeric), payment_status = CASE WHEN paid_amount - $1::numeric <= 0.001 THEN 'unpaid' ELSE 'partial' END WHERE id=$2`, [back, o.id]);
    return { code: c.code, amount: back };
  });
}
// Again taken when a cancelled order is switched back on (if the card still has the money).
async function respendOrder(orderId) {
  return db.tx(async (t) => {
    const o = (await t.query('SELECT id, gift_code, gift_amount, total, paid_amount FROM orders WHERE id=$1 FOR UPDATE', [int(orderId)])).rows[0];
    if (!o || !o.gift_code || !(Number(o.gift_amount) > 0)) return null;
    const c = (await t.query('SELECT id FROM gift_cards WHERE code=$1', [o.gift_code])).rows[0];
    if (!c) return null;
    const net = (await t.query('SELECT coalesce(sum(amount),0)::numeric(14,2) AS n FROM gift_card_ledger WHERE card_id=$1 AND order_id=$2', [c.id, o.id])).rows[0];
    if (-Number(net.n) > 0) return null; // still spent
    const got = await spend(t, o.gift_code, Number(o.gift_amount), o.id);
    if (!got) return null;
    await t.query(`UPDATE orders SET paid_amount = paid_amount + $1::numeric, payment_status = CASE WHEN paid_amount + $1::numeric >= total THEN 'paid' ELSE 'partial' END WHERE id=$2`, [got.amount, o.id]);
    return got;
  });
}

async function list({ status = '', q = '', limit = 100 } = {}) {
  const params = []; const where = [];
  if (STATUSES[status]) { params.push(status); where.push(`g.status=$${params.length}`); }
  if (q) { params.push(`%${cleanCode(q) || q}%`, `%${q}%`); where.push(`(g.code ILIKE $${params.length - 1} OR g.recipient_phone ILIKE $${params.length} OR g.buyer_phone ILIKE $${params.length} OR g.recipient_name ILIKE $${params.length})`); }
  params.push(limit);
  return db.q(`SELECT g.*, s.name AS staff_name FROM gift_cards g LEFT JOIN staff s ON s.id=g.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.id DESC LIMIT $${params.length}`, params);
}
async function stats() {
  return db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status='pending')::int AS pending,
    coalesce(sum(balance) FILTER (WHERE status='active'),0)::numeric(14,2) AS outstanding,
    coalesce(sum(initial) FILTER (WHERE status<>'pending' AND source<>'referral'),0)::numeric(14,2) AS sold,
    coalesce(sum(initial) FILTER (WHERE source='referral'),0)::numeric(14,2) AS rewards FROM gift_cards`);
}
async function get(id) { return db.one('SELECT * FROM gift_cards WHERE id=$1', [int(id)]); }
async function ledger(cardId) {
  return db.q(`SELECT l.*, o.code AS order_code, s.name AS staff_name FROM gift_card_ledger l LEFT JOIN orders o ON o.id=l.order_id LEFT JOIN staff s ON s.id=l.staff_id
    WHERE l.card_id=$1 ORDER BY l.id`, [int(cardId)]);
}
async function forPhone(phone) {
  const ph = normalizePhone(phone);
  return db.q(`SELECT * FROM gift_cards WHERE (recipient_phone=$1 OR buyer_phone=$1) ORDER BY id DESC LIMIT 30`, [ph]);
}
async function setStatus(id, status, staffId, note = '') {
  if (!STATUSES[status]) throw new GiftError('অজানা অবস্থা।');
  const c = await db.one(`UPDATE gift_cards SET status=$1, activated_at = CASE WHEN $1='active' THEN coalesce(activated_at, now()) ELSE activated_at END,
    note = CASE WHEN $3<>'' THEN left(note || ' ' || $3, 300) ELSE note END WHERE id=$2 RETURNING *`, [status, int(id), str(note, 100)]);
  if (c) await db.q('INSERT INTO gift_card_ledger(card_id, amount, balance, note, staff_id) VALUES($1,0,$2,$3,$4)', [c.id, c.balance, `অবস্থা: ${STATUSES[status]}`, staffId]);
  return c;
}
async function adjust(id, change, note, staffId) {
  return db.tx(async (t) => {
    const c = (await t.query('SELECT * FROM gift_cards WHERE id=$1 FOR UPDATE', [int(id)])).rows[0];
    if (!c) throw new GiftError('কার্ড পাওয়া যায়নি।');
    const d = round2(Number(change) || 0);
    const bal = round2(Number(c.balance) + d);
    if (!d || bal < 0) throw new GiftError('ব্যালেন্স শূন্যের নিচে যেতে পারে না।');
    await t.query(`UPDATE gift_cards SET balance=$1::numeric, status=CASE WHEN $1::numeric <= 0 AND status='active' THEN 'used' WHEN $1::numeric > 0 AND status='used' THEN 'active' ELSE status END WHERE id=$2`, [bal, c.id]);
    await t.query('INSERT INTO gift_card_ledger(card_id, amount, balance, note, staff_id) VALUES($1,$2,$3,$4,$5)', [c.id, d, bal, str(note, 200) || 'হাতে বদল', staffId]);
    return bal;
  });
}

// ---------------------------------------------------------------- referral
function refCfg(s) {
  return { on: s.ref_on === '1', friendGets: Math.max(0, Number(s.ref_friend_amount) || 0), friendMin: Math.max(0, Number(s.ref_friend_min) || 0),
    youGet: Math.max(0, Number(s.ref_reward_amount) || 0), validDays: Math.max(0, int(s.ref_reward_days, 90)) };
}
// The customer's own referral code (made the first time it is needed): e.g. RAHIM-K7
async function refCodeFor(customerId) {
  const c = await db.one('SELECT id, name, ref_code FROM customers WHERE id=$1', [int(customerId)]);
  if (!c) return null;
  if (c.ref_code) return c.ref_code;
  const base = (String(c.name || '').normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6)) || 'SM';
  for (let i = 0; i < 6; i++) {
    const code = `${base}${randomCode(3)}`;
    const r = await db.one('UPDATE customers SET ref_code=$1 WHERE id=$2 AND ref_code IS NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE upper(ref_code)=upper($1)) RETURNING ref_code', [code, c.id]);
    if (r) return r.ref_code;
    const again = await db.one('SELECT ref_code FROM customers WHERE id=$1', [c.id]);
    if (again && again.ref_code) return again.ref_code;
  }
  return null;
}
async function referrerFor(code) {
  const c = cleanCode(code);
  if (!c || c.length < 4) return null;
  return db.one('SELECT id, name, phone, ref_code FROM customers WHERE upper(ref_code)=$1', [c]);
}
// May this phone use this referral code? (a new customer, not the code's own owner, order big enough)
async function checkReferral(settings, code, phone, subtotal, exceptOrderId = 0) {
  const R = refCfg(settings);
  if (!R.on || !R.friendGets) return { ok: false, message: 'এই কোডটা সঠিক নয়।' };
  const ref = await referrerFor(code);
  if (!ref) return { ok: false, message: 'এই কোডটা সঠিক নয়।' };
  const ph = normalizePhone(phone);
  if (!validPhone(ph)) return { ok: false, message: 'রেফারেল কোড দিতে আগে আপনার মোবাইল নম্বর লিখুন।' };
  if (ph === ref.phone) return { ok: false, message: 'নিজের রেফারেল কোড নিজে ব্যবহার করা যায় না।' };
  const before = await db.one(`SELECT count(*)::int AS n FROM orders WHERE phone=$1 AND status <> 'cancelled' AND id <> $2`, [ph, int(exceptOrderId)]);
  if (before.n > 0) return { ok: false, message: 'রেফারেল কোড শুধু নতুন কাস্টমারের প্রথম অর্ডারে চলে।' };
  if (R.friendMin && subtotal < R.friendMin) return { ok: false, message: `রেফারেল ছাড় পেতে কমপক্ষে ৳${bn(R.friendMin)} এর পণ্য কিনতে হবে।` };
  const discount = round2(Math.min(R.friendGets, subtotal));
  return { ok: true, referrer: ref, discount, message: `রেফারেল কোড যোগ হয়েছে — ৳${bn(discount)} ছাড়!` };
}
// The friend's first order was delivered: the person who shared the code gets the gift card (once).
async function rewardReferral(settings, orderId) {
  const R = refCfg(settings);
  if (!R.on || !R.youGet) return null;
  const o = await db.one(`UPDATE orders SET ref_rewarded=true WHERE id=$1 AND ref_by IS NOT NULL AND NOT ref_rewarded AND status='delivered' RETURNING id, code, ref_by, customer_name`, [int(orderId)]);
  if (!o) return null;
  const ref = await db.one('SELECT id, name, phone FROM customers WHERE id=$1', [o.ref_by]);
  if (!ref) return null;
  const card = await issue({ amount: R.youGet, source: 'referral', recipientName: ref.name, recipientPhone: ref.phone, validDays: R.validDays, customerId: ref.id,
    note: `রেফারেল: ${o.code} (${o.customer_name || ''})`, price: 0 });
  await sendCodeSms(settings, card).catch(() => null);
  return card;
}
async function referralStats(customerId) {
  return db.one(`SELECT count(*)::int AS joined, count(*) FILTER (WHERE ref_rewarded)::int AS rewarded FROM orders WHERE ref_by=$1 AND status<>'cancelled'`, [int(customerId)]);
}

module.exports = {
  GiftError, STATUSES, cleanCode, pretty, issue, sendCodeSms, check, spend, refundOrder, respendOrder, list, stats, get, ledger, forPhone, setStatus, adjust,
  refCfg, refCodeFor, referrerFor, checkReferral, rewardReferral, referralStats,
};

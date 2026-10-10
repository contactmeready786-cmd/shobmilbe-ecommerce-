'use strict';
// 🛡️ Fraud check: how reliable is this mobile number? Three sources, put together into one simple answer:
//   1. this shop's own orders (always) — delivered vs cancelled / returned
//   2. Pathao (when Pathao is connected) — the number's delivery record across Pathao merchants
//   3. FraudBD (fraudbd.com, with the owner's API key) — the number's parcels at Steadfast, Pathao, RedX, Paperfly…
// Results are kept for 24 hours so the same number doesn't use up the API every time.
const db = require('../db');
const customers = require('../models/customers');
const courier = require('./courier');
const { normalizePhone, validPhone } = require('../util');

const CACHE_HOURS = 24;

async function fraudbd(s, phone) {
  const key = String(s.fraudbd_api_key || '').trim();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://fraudbd.com/api/check-courier-info', { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_key: key }, body: JSON.stringify({ phone_number: phone }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.status === false) return { ok: false, message: (j && j.message) || `FraudBD: HTTP ${r.status}` };
    const d = j.data || {};
    const couriers = Object.entries(d.Summaries || {}).map(([name, x]) => ({
      name, type: x.data_type || 'delivery', total: Number(x.total) || 0, success: Number(x.success) || 0, cancel: Number(x.cancel) || 0,
      rating: x.customer_rating || '', risk: x.risk_level || '', message: x.message || '',
    }));
    const t = d.totalSummary || {};
    return { ok: true, couriers, total: Number(t.total) || 0, success: Number(t.success) || 0, cancel: Number(t.cancel) || 0, rate: t.successRate !== undefined ? Number(t.successRate) : null };
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? 'FraudBD সময়মতো উত্তর দেয়নি' : e.message };
  } finally { clearTimeout(timer); }
}

// One answer from everything: level = new / low / medium / high, plus a sentence in Bangla.
function judge(own, pathao, fbd) {
  const ownDone = own.delivered + own.failed;
  let total = 0; let ok = 0;
  if (fbd && fbd.ok) { total += fbd.total; ok += fbd.success; }
  else if (pathao && pathao.ok) { total += pathao.total; ok += pathao.success; }
  total += ownDone; ok += own.delivered;
  const rate = total ? Math.round((ok / total) * 100) : null;
  let level = 'new';
  if (total) level = rate < 50 && total >= 2 ? 'high' : rate < 75 ? 'medium' : 'low';
  // a Pathao "risky" rating or many recent orders lift the level
  const pathaoRisk = [pathao && pathao.rating, ...((fbd && fbd.couriers) || []).map((c) => c.risk || c.rating)].join(' ').toLowerCase();
  if (/high|fraud|risky|bad/.test(pathaoRisk) && level !== 'high') level = 'high';
  let burst = false;
  if (own.last_day >= 3 && (level === 'low' || level === 'new')) { level = 'medium'; burst = true; }
  const LBL = { new: '🆕 নতুন — আগে কোনো রেকর্ড নেই', low: '✅ বিশ্বস্ত', medium: '⚠️ সতর্ক থাকুন', high: '⛔ ঝুঁকিপূর্ণ' };
  const ADV = { new: 'প্রথম অর্ডার — কল করে কনফার্ম করে নিন।', low: 'সাধারণত পণ্য নেন। পাঠিয়ে দিতে পারেন।',
    medium: 'আগে কিছু পার্সেল ফেরত দিয়েছেন। কল করে কনফার্ম করুন, চাইলে ডেলিভারি চার্জ আগে নিন।',
    high: 'অনেক পার্সেল নেননি। ডেলিভারি চার্জ বা পুরো টাকা আগে না নিয়ে পাঠাবেন না।' };
  const advice = burst ? `২৪ ঘণ্টায় এই নম্বর থেকে ${own.last_day}টি অর্ডার — একই অর্ডার বারবার এসেছে কিনা কল করে দেখুন।` : ADV[level];
  return { level, label: LBL[level], advice, total, success: ok, rate };
}

async function check(settings, phoneRaw, { fresh = false } = {}) {
  const phone = normalizePhone(phoneRaw);
  if (!validPhone(phone)) return { ok: false, message: 'ফোন নম্বর ঠিক নেই।' };
  const ownStats = await customers.phoneStats(phone);
  const own = { orders: ownStats.orders, delivered: ownStats.delivered, failed: ownStats.failed, open: ownStats.open, last_day: ownStats.last_day };
  let ext = null;
  if (!fresh) {
    const c = await db.one(`SELECT data, checked_at FROM fraud_checks WHERE phone=$1 AND checked_at > now() - make_interval(hours => $2)`, [phone, CACHE_HOURS]);
    if (c) ext = { ...c.data, cached_at: c.checked_at };
  }
  if (!ext) {
    const [pathao, fbd] = await Promise.all([
      courier.configured(settings, 'pathao') ? courier.pathaoSuccess(phone, settings).catch((e) => ({ ok: false, message: e.message })) : null,
      fraudbd(settings, phone),
    ]);
    ext = { pathao: pathao ? { ok: pathao.ok, total: pathao.total || 0, success: pathao.success || 0, rating: pathao.rating || '', message: pathao.message || '' } : null, fraudbd: fbd };
    if ((pathao && pathao.ok) || (fbd && fbd.ok)) {
      await db.q(`INSERT INTO fraud_checks(phone, data, checked_at) VALUES($1,$2,now()) ON CONFLICT (phone) DO UPDATE SET data=EXCLUDED.data, checked_at=now()`, [phone, JSON.stringify(ext)]);
    }
  }
  const verdict = judge(own, ext.pathao, ext.fraudbd);
  return { ok: true, phone, own, pathao: ext.pathao, fraudbd: ext.fraudbd, cached_at: ext.cached_at || null, ...verdict,
    sources: { pathao: courier.configured(settings, 'pathao'), fraudbd: !!String(settings.fraudbd_api_key || '').trim() } };
}
// Only what is already known (no API call) — for lists.
async function cachedLevels(phones) {
  const list = [...new Set((phones || []).map((p) => normalizePhone(p)).filter(validPhone))];
  if (!list.length) return new Map();
  const rows = await db.q(`SELECT phone, data FROM fraud_checks WHERE phone = ANY($1::text[]) AND checked_at > now() - interval '7 days'`, [list]);
  const stats = await db.q(`SELECT phone, count(*) FILTER (WHERE status='delivered')::int AS delivered, count(*) FILTER (WHERE status IN ('cancelled','returned'))::int AS failed,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day FROM orders WHERE phone = ANY($1::text[]) GROUP BY phone`, [list]);
  const sm = new Map(stats.map((r) => [r.phone, r]));
  const out = new Map();
  for (const ph of list) {
    const r = rows.find((x) => x.phone === ph);
    const st = sm.get(ph) || { delivered: 0, failed: 0, last_day: 0 };
    out.set(ph, judge({ ...st }, r ? r.data.pathao : null, r ? r.data.fraudbd : null));
  }
  return out;
}

module.exports = { check, cachedLevels, judge, fraudbd };

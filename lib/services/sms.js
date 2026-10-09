'use strict';
// SMS to customers (Admin → মার্কেটিং → কাস্টমারকে SMS). Works with the common Bangladeshi SMS companies
// (you buy SMS credit from them and paste the API key here), or any company that gives a "link" API.
// Sent: when an order comes in, is confirmed, handed to the courier, delivered (each with its own switch and text).
// Every SMS is written to sms_log (success or the company's error), so the owner can see what happened.
const db = require('../db');
const { safeFetch } = require('./safefetch');
const { normalizePhone, validPhone, str } = require('../util');

const PROVIDERS = {
  bulksmsbd: { label: 'BulkSMSBD (bulksmsbd.net)', site: 'https://bulksmsbd.net', needsSender: true },
  smsnetbd: { label: 'Alpha SMS (sms.net.bd)', site: 'https://sms.net.bd', needsSender: false },
  greenweb: { label: 'Greenweb (greenweb.com.bd)', site: 'https://greenweb.com.bd', needsSender: false },
  custom: { label: 'অন্য কোম্পানি (নিজের লিংক)', site: '', needsSender: false },
};

function ready(settings) {
  const p = PROVIDERS[settings.sms_provider] ? settings.sms_provider : 'bulksmsbd';
  if (settings.sms_on !== '1') return { ok: false, why: 'SMS বন্ধ আছে' };
  if (p === 'custom') return /^https:\/\//i.test(settings.sms_custom_url || '') ? { ok: true, p } : { ok: false, why: 'কোম্পানির লিংক (https://…) দিন' };
  if (!settings.sms_api_key) return { ok: false, why: 'API key দেওয়া নেই' };
  if (PROVIDERS[p].needsSender && !settings.sms_sender_id) return { ok: false, why: 'Sender ID দেওয়া নেই' };
  return { ok: true, p };
}
// 01712345678 → 8801712345678
const intl = (phone) => '88' + normalizePhone(phone);
// SMS length: Bangla text = 70 characters per SMS part (67 when it is long), English = 160 (153).
function parts(text) {
  const t = String(text || '');
  const uni = /[^\x00-\x7F]/.test(t);
  const one = uni ? 70 : 160; const multi = uni ? 67 : 153;
  return t.length <= one ? 1 : Math.ceil(t.length / multi);
}

function buildRequest(settings, p, to, message) {
  const key = settings.sms_api_key || '';
  if (p === 'bulksmsbd') {
    return 'https://bulksmsbd.net/api/smsapi?' + new URLSearchParams({ api_key: key, type: 'text', number: to, senderid: settings.sms_sender_id || '', message });
  }
  if (p === 'smsnetbd') return 'https://api.sms.net.bd/sendsms?' + new URLSearchParams({ api_key: key, msg: message, to });
  if (p === 'greenweb') return 'https://api.greenweb.com.bd/api.php?' + new URLSearchParams({ token: key, to, message });
  // custom: the owner's link with {to}, {message}, {key}, {sender}
  return String(settings.sms_custom_url).replace(/\{(to|message|key|sender)\}/g, (_, k) => encodeURIComponent(
    { to, message, key, sender: settings.sms_sender_id || '' }[k]));
}
// The company's answer → ok / its message
function readAnswer(p, status, text) {
  const t = String(text || '').slice(0, 400);
  let j = null;
  try { j = JSON.parse(t); } catch (_) { /* not JSON */ }
  if (status < 200 || status >= 300) return { ok: false, msg: `HTTP ${status}: ${t.slice(0, 150)}` };
  if (p === 'bulksmsbd') return j && Number(j.response_code) === 202 ? { ok: true, msg: j.success_message || 'পাঠানো হয়েছে' } : { ok: false, msg: (j && (j.error_message || j.response_code)) || t.slice(0, 150) };
  if (p === 'smsnetbd') return j && Number(j.error) === 0 ? { ok: true, msg: j.msg || 'পাঠানো হয়েছে' } : { ok: false, msg: (j && (j.msg || j.error)) || t.slice(0, 150) };
  if (p === 'greenweb') return /ok/i.test(t) && !/error/i.test(t) ? { ok: true, msg: t.slice(0, 120) } : { ok: false, msg: t.slice(0, 150) };
  return /error|invalid|fail/i.test(t) ? { ok: false, msg: t.slice(0, 150) } : { ok: true, msg: t.slice(0, 120) || 'পাঠানো হয়েছে' };
}

// Send one SMS. Never throws — returns { ok, msg } and writes the log.
async function send(settings, phone, text, { kind = 'manual', orderId = null, staffId = null } = {}) {
  const r = ready(settings);
  const ph = normalizePhone(phone);
  const message = str(text, 640);
  let result;
  if (!r.ok) result = { ok: false, msg: r.why };
  else if (!validPhone(ph)) result = { ok: false, msg: 'মোবাইল নম্বর ঠিক নেই' };
  else if (!message) result = { ok: false, msg: 'লেখা খালি' };
  else {
    try {
      const res = await safeFetch(buildRequest(settings, r.p, intl(ph), message), { maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 2 });
      result = readAnswer(r.p, res.status, res.body.toString('utf8'));
    } catch (e) {
      result = { ok: false, msg: 'সংযোগ হয়নি: ' + String(e.message || e).slice(0, 120) };
    }
  }
  await db.q('INSERT INTO sms_log(phone, body, kind, ok, detail, order_id, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ph || String(phone || '').slice(0, 20), message, kind, result.ok, str(result.msg, 300), orderId, staffId]).catch(() => {});
  return result;
}

// Order messages: {shop} {code} {total} {name} {tracking} {points}
const ORDER_EVENTS = { placed: 'অর্ডার এলে', confirmed: 'কনফার্ম হলে', shipped: 'কুরিয়ারে দিলে', delivered: 'ডেলিভারি হলে' };
function fill(tpl, o, settings, site = '') {
  const track = o.tracking_code ? `ট্র্যাকিং: ${o.tracking_code}` : site ? `ট্র্যাক করুন: ${site.replace(/\/+$/, '')}/order/${o.code}` : '';
  const pts = o.points_earned > 0 ? ` আপনি ${o.points_earned} পয়েন্ট পেয়েছেন।` : '';
  return String(tpl || '').replace(/\{(shop|code|total|name|tracking|points)\}/g, (_, k) => ({
    shop: settings.store_name || '', code: o.code || '', total: `৳${Math.round(Number(o.total || 0))}`, name: String(o.customer_name || o.name || '').split(' ')[0],
    tracking: track, points: pts,
  }[k])).replace(/\s+/g, ' ').trim();
}
// Called after an order is placed or its status changes. Quietly does nothing when that SMS is switched off.
async function orderEvent(settings, event, order, site = '') {
  if (!ORDER_EVENTS[event] || settings[`sms_on_${event}`] !== '1' || !ready(settings).ok || !order) return null;
  // the same order never gets the same message twice (e.g. status set to "confirmed" again)
  const dup = await db.one('SELECT 1 FROM sms_log WHERE order_id=$1 AND kind=$2 AND ok', [order.id, 'order_' + event]).catch(() => null);
  if (dup) return null;
  return send(settings, order.phone, fill(settings[`sms_tpl_${event}`], order, settings, site), { kind: 'order_' + event, orderId: order.id });
}

module.exports = { PROVIDERS, ORDER_EVENTS, ready, send, orderEvent, fill, parts };

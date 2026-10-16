// @ts-nocheck — converted from JavaScript; types are added file by file.
// SMS to customers (Admin → মার্কেটিং → কাস্টমারকে SMS). Works with the common Bangladeshi SMS companies
// (you buy SMS credit from them and paste the API key here), or any company that gives a "link" API.
// Sent: when an order comes in, is confirmed, handed to the courier, delivered (each with its own switch and text).
// Every SMS is written to sms_log (success or the company's error), so the owner can see what happened.
import * as db from '../db';
import { safeFetch } from './safefetch';
import { normalizePhone, validPhone, str } from '../util';

const PROVIDERS = {
  // 📱 the owner's own phone + SIM (e.g. Grameenphone) sends the SMS through the free "SMS Gateway for Android" app
  // (sms-gate.app, cloud mode). Username → Sender ID box, Password → API Key box. Each SMS costs the SIM's normal rate.
  android: { label: '📱 নিজের ফোনের SIM দিয়ে (SMS Gateway অ্যাপ, ফ্রি)', site: 'https://sms-gate.app', needsSender: true },
  // 📱 textbee.dev (owner, 2026-10): the same idea — an Android phone with a SIM sends the SMS — but steadier.
  // Free plan: 1 phone, about 50 SMS a day / 300 a month. API Key box = textbee API key; Sender ID box = Device ID (optional).
  textbee: { label: '📱 নিজের ফোনের SIM দিয়ে (textbee.dev, ফ্রি)', site: 'https://textbee.dev', needsSender: false },
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
  if (p === 'textbee' && (status === 401 || status === 403)) return { ok: false, msg: 'textbee-র API Key মিলছে না — textbee.dev ড্যাশবোর্ড থেকে নতুন Key কপি করুন' };
  if (p === 'android' && status === 401) return { ok: false, msg: 'অ্যাপের Username/Password মিলছে না — অ্যাপের Cloud Server অংশ থেকে আবার কপি করুন' };
  if (status < 200 || status >= 300) return { ok: false, msg: `HTTP ${status}: ${t.slice(0, 150)}` };
  if (p === 'android') return j && j.id ? { ok: true, id: String(j.id), msg: 'ফোনে পাঠানো হয়েছে (' + (j.state || 'Pending') + ')' } : { ok: false, msg: (j && (j.message || j.error)) || t.slice(0, 150) };
  if (p === 'textbee') {
    const d = (j && (j.data || j)) || {};
    if (d.success === false || (Number(d.failureCount) > 0 && !Number(d.successCount))) return { ok: false, msg: String(d.message || d.error || t.slice(0, 150)) };
    return { ok: true, id: String(d.smsBatchId || ''), msg: 'ফোনে পাঠানো হয়েছে' };
  }
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
      const res = r.p === 'textbee'
        ? await safeFetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
          method: 'POST', maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': String(settings.sms_api_key || '').trim() },
          body: JSON.stringify({ recipients: ['+' + intl(ph)], message, ...(/^[A-Za-z0-9_-]{6,60}$/.test(String(settings.sms_sender_id || '').trim()) ? { deviceId: String(settings.sms_sender_id).trim() } : {}) }),
        })
        : r.p === 'android'
        ? await safeFetch('https://api.sms-gate.app/3rdparty/v1/messages', {
          method: 'POST', maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${String(settings.sms_sender_id || '').trim()}:${String(settings.sms_api_key || '').trim()}`).toString('base64') },
          body: JSON.stringify({ textMessage: { text: message }, phoneNumbers: ['+' + intl(ph)] }),
        })
        : await safeFetch(buildRequest(settings, r.p, intl(ph), message), { maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 2 });
      result = readAnswer(r.p, res.status, res.body.toString('utf8'));
    } catch (e) {
      result = { ok: false, msg: 'সংযোগ হয়নি: ' + String(e.message || e).slice(0, 120) };
    }
  }
  await db.q('INSERT INTO sms_log(phone, body, kind, ok, detail, order_id, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ph || String(phone || '').slice(0, 20), message, kind, result.ok, str(result.msg, 300), orderId, staffId]).catch(() => {});
  return result;
}

// 📣 Offer SMS have their own small allowance, so a free own-SIM plan (e.g. textbee: ~50 a day, 300 a month) is never
// used up by offers — checkout codes and order SMS always have room. 0 = no limit (for a paid SMS company).
const MKT_KINDS = ['bulk'];
async function mktLeft(settings) {
  const perDay = Math.max(0, Number(settings.sms_mkt_day) || 0);
  const perMonth = Math.max(0, Number(settings.sms_mkt_month) || 0);
  const r = await db.one(`SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS d,
      count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS m
    FROM sms_log WHERE ok AND kind = ANY($1::text[])`, [MKT_KINDS]).catch(() => ({ d: 0, m: 0 }));
  const day = perDay ? Math.max(0, perDay - r.d) : Infinity;
  const month = perMonth ? Math.max(0, perMonth - r.m) : Infinity;
  return { left: Math.min(day, month), day, month, usedDay: r.d, usedMonth: r.m, perDay, perMonth };
}

// Order messages: {shop} {code} {total} {name} {tracking} {points} {link} (the order's page — reviews are given there)
const ORDER_EVENTS = { placed: 'অর্ডার এলে', confirmed: 'কনফার্ম হলে', shipped: 'কুরিয়ারে দিলে', delivered: 'ডেলিভারি হলে' };
function fill(tpl, o, settings, site = '') {
  const track = o.tracking_code ? `ট্র্যাকিং: ${o.tracking_code}` : site ? `ট্র্যাক করুন: ${site.replace(/\/+$/, '')}/order/${o.code}` : '';
  const pts = o.points_earned > 0 ? ` আপনি ${o.points_earned} পয়েন্ট পেয়েছেন।` : '';
  return String(tpl || '').replace(/\{(shop|code|total|name|tracking|points|link)\}/g, (_, k) => ({
    shop: settings.store_name || '', code: o.code || '', total: `৳${Math.round(Number(o.total || 0))}`, name: String(o.customer_name || o.name || '').split(' ')[0],
    tracking: track, points: pts, link: site ? `${site.replace(/\/+$/, '')}/order/${o.code}` : '',
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

// 📱 own-SIM app: what happened to a message the website handed to the phone?
//   Pending = the phone hasn't picked it up (app stopped / no internet), Processed = the phone has it,
//   Sent / Delivered = it left the SIM, Failed = the phone tried and couldn't (error says why).
async function androidState(settings, id) {
  if (!id) return null;
  const res = await safeFetch(`https://api.sms-gate.app/3rdparty/v1/messages/${encodeURIComponent(id)}`, {
    maxBytes: 64 * 1024, timeoutMs: 8000, maxRedirects: 0,
    headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(`${String(settings.sms_sender_id || '').trim()}:${String(settings.sms_api_key || '').trim()}`).toString('base64') },
  });
  if (res.status < 200 || res.status >= 300) return null;
  let j = null;
  try { j = JSON.parse(res.body.toString('utf8')); } catch (_) { return null; }
  const rc = (j && Array.isArray(j.recipients) && j.recipients[0]) || {};
  return { state: String((j && j.state) || ''), error: rc.error ? String(rc.error).slice(0, 150) : '' };
}

export { PROVIDERS, ORDER_EVENTS, ready, send, orderEvent, fill, parts, androidState, mktLeft };

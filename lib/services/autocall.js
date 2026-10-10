'use strict';
// 📞 অটো কল — a robot voice call to the customer right after an order, to confirm it.
// A website cannot dial from a SIM card by itself, so the call is placed by a Bangladeshi voice-call company
// (IVR / "press 1 to confirm") through its web API. This file works with any such company:
//   • the owner pastes the company's API address, key and the request body (with {{placeholders}}),
//   • the company calls the customer and reads the message (Bangla text-to-speech or a recorded voice),
//   • when the customer presses a key, the company calls back /webhook/autocall/<secret> with the result,
//   • the order is confirmed / put on hold / cancelled (as the owner chose) and the owner is notified.
const crypto = require('crypto');
const db = require('../db');
const { fetchJson, str } = require('../util');

const STATES = {
  calling: ['📞', 'কল যাচ্ছে'],
  confirmed: ['✅', 'কাস্টমার কনফার্ম করেছে (১ চেপেছে)'],
  cancelled: ['❌', 'কাস্টমার বাতিল করেছে (২ চেপেছে)'],
  no_answer: ['📵', 'ফোন ধরেনি / ব্যস্ত'],
  no_input: ['🤐', 'ফোন ধরেছে কিন্তু কিছু চাপেনি'],
  failed: ['⚠️', 'কল যায়নি (সার্ভিসে সমস্যা)'],
};

// Ready-made starting points. The exact API differs per company — the owner checks it against their docs.
const PRESETS = {
  epbx: { label: 'ePBX (epbx.bd) — অটো অর্ডার কল', url: 'https://epbx.bd/api/v1/calls/initiate', header: 'Authorization', body: JSON.stringify({ phone_number: '{{phone}}', customer_name: '{{name}}', amount: '{{amount}}', order_id: '{{order_code}}', confirm_text: '{{message}}', cancel_text: 'অর্ডার বাতিল করতে ২ চাপুন', callback_url: '{{callback_url}}' }, null, 2) },
  manydial: { label: 'ManyDial', url: 'https://api.manydial.com/v1/calls', header: 'Authorization', body: JSON.stringify({ to: '{{phone_intl}}', from: '{{caller_id}}', message: '{{message}}', reference: '{{order_code}}', webhook: '{{callback_url}}' }, null, 2) },
  custom: { label: 'অন্য কোম্পানি (নিজে API বসান)', url: '', header: 'Authorization', body: JSON.stringify({ phone: '{{phone}}', message: '{{message}}', reference: '{{order_code}}', callback: '{{callback_url}}' }, null, 2) },
};

// Message the robot reads. {{name}} {{amount}} {{shop}} {{order_code}} {{items}} are filled in.
const MESSAGES = [
  'আসসালামু আলাইকুম {{name}}। {{shop}} থেকে বলছি। আপনি {{amount}} টাকার একটি অর্ডার করেছেন। অর্ডারটি কনফার্ম করতে ১ চাপুন, বাতিল করতে ২ চাপুন।',
  'প্রিয় {{name}}, {{shop}}-এ অর্ডার করার জন্য ধন্যবাদ। আপনার অর্ডার নম্বর {{order_code}}, মোট {{amount}} টাকা, ক্যাশ অন ডেলিভারি। পণ্যটি নিশ্চিতভাবে নিতে চাইলে ১ চাপুন। ভুল করে অর্ডার হয়ে থাকলে ২ চাপুন।',
  'হ্যালো {{name}}, {{shop}} থেকে আপনার {{items}} এর অর্ডারটি পেয়েছি। মোট {{amount}} টাকা। আমরা কি পাঠিয়ে দেব? পাঠাতে ১, বাতিল করতে ২ চাপুন।',
];

function on(s) { return s.autocall_on === '1' && !!s.autocall_url; }
function secret(s) { return String(s.autocall_token || ''); }
async function ensureSecret(s) {
  if (secret(s)) return secret(s);
  const t = crypto.randomBytes(18).toString('base64url');
  await db.setSetting('autocall_token', t);
  return t;
}
function callbackUrl(site, token) { return `${String(site || '').replace(/\/+$/, '')}/webhook/autocall/${token}`; }
const localPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('880') ? '0' + d.slice(3) : d; };
const intlPhone = (p) => { const l = localPhone(p); return l.startsWith('0') ? '880' + l.slice(1) : l; };
const words = (n) => String(Math.round(Number(n || 0)));

function fill(tpl, vars, { json = false } = {}) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k] == null ? '' : String(vars[k]);
    return json ? JSON.stringify(v).slice(1, -1) : v;
  });
}
function varsFor(s, o, site, token) {
  const vars = {
    name: str(o.customer_name || o.name, 60) || 'গ্রাহক', phone: localPhone(o.phone), phone_intl: intlPhone(o.phone), phone_plus: '+' + intlPhone(o.phone),
    amount: words(o.total), order_code: o.code, shop: s.store_name || 'সবমিলবে', caller_id: s.autocall_caller || '',
    items: (o.items || o.lines || []).slice(0, 2).map((i) => str(i.name, 40)).join(' আর ') || 'পণ্যের',
    callback_url: callbackUrl(site, token),
  };
  vars.message = fill(s.autocall_message || MESSAGES[0], vars);
  return vars;
}

// Place one call. Returns { ok, ref, error }.
async function call(s, order, site, { test = false } = {}) {
  const token = await ensureSecret(s);
  const vars = varsFor(s, order, site, token);
  let body = fill(s.autocall_body || PRESETS.custom.body, vars, { json: true });
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (_) { /* sent as typed */ }
  const headers = { 'Content-Type': parsed ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (s.autocall_api_key) headers[(s.autocall_header || 'Authorization').trim() || 'Authorization'] = s.autocall_api_key;
  const url = fill(s.autocall_url, vars).trim();
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'কল কোম্পানির API ঠিকানা https:// দিয়ে শুরু হতে হবে।' };
  const r = await fetchJson(url, { method: (s.autocall_method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST', headers, body: (s.autocall_method || 'POST').toUpperCase() === 'GET' ? undefined : body }, 12000);
  const d = r.data || {};
  const ref = String(d.call_id || d.id || d.callId || d.uuid || d.sid || (d.data && (d.data.call_id || d.data.id)) || '').slice(0, 80);
  const failed = !r.ok || d.success === false || d.status === 'error' || d.error;
  if (!test) {
    await db.q(`INSERT INTO autocalls(order_id, phone, state, ref, attempt, detail) VALUES($1,$2,$3,$4,
      coalesce((SELECT max(attempt) FROM autocalls WHERE order_id=$1),0)+1, $5)`,
    [order.id, localPhone(order.phone), failed ? 'failed' : 'calling', ref, failed ? str(r.text || JSON.stringify(d), 300) : '']).catch((e) => console.error('autocall log', e.message));
    await db.logActivity(null, 'autocall', 'order', order.id, failed ? `📞 অটো কল যায়নি: ${str(r.text, 120)}` : `📞 অটো কল পাঠানো হয়েছে (${localPhone(order.phone)})`).catch(() => {});
  }
  await db.logIntegration('autocall', test ? 'test call' : 'call ' + order.code, !failed, failed ? str(r.text || JSON.stringify(d), 300) : `ref ${ref || '—'}`, order.code || '').catch(() => {});
  return failed ? { ok: false, error: str((d && (d.message || d.error)) || r.text || `HTTP ${r.status}`, 300) } : { ok: true, ref };
}

// After a new order (from the checkout)
async function afterOrder(s, order, site) {
  if (!on(s)) return null;
  if (s.autocall_only_cod !== '0' && order.payment && order.payment !== 'cod') return null;
  return call(s, order, site);
}

// ---------------------------------------------------------------- the company's reply (webhook)
// Accepts JSON or form data. Looks for the order (code / reference / call id / phone) and what was pressed.
function pick(b, keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), b);
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
  }
  return '';
}
function resultOf(b) {
  const key = pick(b, ['digit', 'dtmf', 'key', 'pressed', 'keypress', 'input', 'Digits', 'data.digit', 'data.dtmf', 'data.keypress']).trim();
  const st = pick(b, ['result', 'status', 'call_status', 'CallStatus', 'event', 'data.status', 'data.result']).toLowerCase();
  if (key === '1' || /^(confirm|confirmed|approve|approved|yes|accept)/.test(st)) return 'confirmed';
  if (key === '2' || /^(cancel|cancelled|canceled|reject|rejected|no|decline)/.test(st)) return 'cancelled';
  if (/(no.?answer|not.?answered|busy|unreachable|switched.?off|missed|no-answer|failed-to-connect)/.test(st)) return 'no_answer';
  if (/(no.?input|timeout|no.?key|answered|completed)/.test(st)) return 'no_input';
  if (/(fail|error)/.test(st)) return 'failed';
  return null;
}
async function hook(s, token, b) {
  if (!secret(s) || !require('../security').safeEqual(String(token || ''), secret(s))) return { status: 401, body: { ok: false } };
  const code = pick(b, ['order_code', 'order_id', 'reference', 'ref', 'custom_id', 'metadata.order_code', 'data.order_code', 'data.reference']);
  const callId = pick(b, ['call_id', 'id', 'callId', 'uuid', 'CallSid', 'data.call_id']);
  const phone = localPhone(pick(b, ['phone', 'phone_number', 'to', 'msisdn', 'To', 'data.phone']));
  let row = null;
  if (code) row = await db.one(`SELECT a.*, o.code, o.status AS order_status, o.total, o.customer_name, o.phone AS o_phone FROM autocalls a JOIN orders o ON o.id=a.order_id
    WHERE o.code=$1 ORDER BY a.id DESC LIMIT 1`, [code.toUpperCase()]);
  if (!row && callId) row = await db.one(`SELECT a.*, o.code, o.status AS order_status, o.total, o.customer_name, o.phone AS o_phone FROM autocalls a JOIN orders o ON o.id=a.order_id WHERE a.ref=$1 ORDER BY a.id DESC LIMIT 1`, [callId]);
  if (!row && phone) row = await db.one(`SELECT a.*, o.code, o.status AS order_status, o.total, o.customer_name, o.phone AS o_phone FROM autocalls a JOIN orders o ON o.id=a.order_id
    WHERE a.phone=$1 AND a.created_at > now() - interval '2 days' ORDER BY a.id DESC LIMIT 1`, [phone]);
  const result = resultOf(b);
  await db.logIntegration('autocall', 'webhook', !!(row && result), `${result || 'অজানা ফলাফল'} · ${str(JSON.stringify(b), 250)}`, row ? row.code : code).catch(() => {});
  if (!row) return { status: 200, body: { ok: false, message: 'order not found' } };
  if (!result) return { status: 200, body: { ok: true, message: 'noted' } };
  await db.q('UPDATE autocalls SET state=$1, digit=$2, detail=$3, updated_at=now() WHERE id=$4',
    [result, pick(b, ['digit', 'dtmf', 'key', 'pressed', 'keypress', 'Digits', 'data.digit']).slice(0, 4), str(JSON.stringify(b), 500), row.id]);
  await apply(s, row, result);
  return { status: 200, body: { ok: true } };
}

// What happens to the order, and telling the owner
async function apply(s, row, result) {
  const O = require('../models/orders');
  const [ic, label] = STATES[result] || ['ℹ️', result];
  let did = '';
  if (row.order_status === 'pending') {
    try {
      if (result === 'confirmed' && s.autocall_on_confirm !== 'note') { await O.setStatus(row.order_id, 'confirmed', null); did = ' → অর্ডার "কনফার্ম" করা হলো'; }
      if (result === 'cancelled' && s.autocall_on_cancel === 'cancel') { await O.setStatus(row.order_id, 'cancelled', null); did = ' → অর্ডার বাতিল করা হলো'; }
      if (result === 'cancelled' && (s.autocall_on_cancel || 'hold') === 'hold') { await O.setStatus(row.order_id, 'hold', null); did = ' → অর্ডার "হোল্ডে" রাখা হলো (একবার ফোন করে নিশ্চিত হোন)'; }
    } catch (e) { did = ` (অবস্থা বদলানো যায়নি: ${e.message})`; }
  }
  await db.logActivity(null, 'autocall', 'order', row.order_id, `${ic} অটো কল: ${label}${did}`).catch(() => {});
  if (s.autocall_notify === '0') return;
  const notify = require('./notify');
  const site = String(s.site_url || '').replace(/\/+$/, '');
  const text = `${ic} অটো কল — অর্ডার ${row.code}\n${row.customer_name || ''} (${localPhone(row.o_phone)}) · ৳${row.total}\nফলাফল: ${label}${did}\n${site}/admin/orders/${row.order_id}`;
  const jobs = [];
  try {
    const push = require('./push');
    jobs.push(push.count().then((n) => (n ? push.sendAll({ title: `${ic} অটো কল: ${label}`, body: `${row.code} · ${row.customer_name || ''}${did}`, url: `/admin/orders/${row.order_id}`, tag: 'autocall-' + row.order_id }) : null)).catch(() => null));
  } catch (_) { /* no push */ }
  if (notify.waConfig(s).ready && s.autocall_notify_wa !== '0') jobs.push(notify.sendWhatsApp(s, text).catch(() => null));
  if (notify.emailConfig(s).ready && s.autocall_notify_email === '1') jobs.push(notify.sendEmail(s, `${ic} অটো কল ${row.code}: ${label}`, text, `<pre style="font-family:Arial,sans-serif;font-size:15px">${notify.escapeHtml(text)}</pre>`).catch(() => null));
  await Promise.all(jobs);
}

async function forOrder(orderId) {
  return db.q('SELECT * FROM autocalls WHERE order_id=$1 ORDER BY id DESC LIMIT 10', [orderId]).catch(() => []);
}

module.exports = { STATES, PRESETS, MESSAGES, on, call, afterOrder, hook, resultOf, forOrder, ensureSecret, callbackUrl, localPhone, varsFor, fill };

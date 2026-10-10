'use strict';
// Admin → অর্ডার ও কাস্টমার → 📦 কুরিয়ারে হ্যান্ডওভার (স্ক্যান):
// scan the barcode on the parcel's ইনভয়েস (or type the order / consignment number) → the order opens;
// optionally scan every product's own barcode to check the box is packed right; press হ্যান্ডওভার →
// the order becomes "কুরিয়ারে দেওয়া হয়েছে" and its goods leave the shelf count in the inventory.
// A barcode gun (USB/Bluetooth) types into the box; the phone/laptop camera works too (public/js/scan.js).
const { html, raw, bn, fmtDate, money, str } = require('../util');
const db = require('../db');
const O = require('../models/orders');
const ui = require('./ui');
const { ASSET_V } = require('./layout');

const BASE = '/admin/handover';
const READY = ['confirmed', 'processing', 'hold'];

async function findOrder(code) {
  const c = str(code, 60).trim().toUpperCase();
  if (!c) return null;
  const r = await db.one(`SELECT id FROM orders WHERE upper(code)=$1 OR (consignment_id<>'' AND upper(consignment_id)=$1) OR (coalesce(tracking_code,'')<>'' AND upper(tracking_code)=$1) ORDER BY id DESC LIMIT 1`, [c]);
  return r ? O.getOrder({ id: r.id }) : null;
}
function view(o) {
  const due = Math.max(0, Number(o.total) - Number(o.paid_amount || 0));
  // each product line with what its barcode is (bundles: the parts inside)
  const lines = [];
  for (const it of o.items) {
    if (Array.isArray(it.components) && it.components.length) {
      for (const c of it.components) lines.push({ product_id: c.product_id, name: `${c.name || it.name} (প্যাকেজের ভেতরে)`, qty: c.qty * (it.qty || 1), barcode: c.barcode || '', image: it.image_id ? `/media/${it.image_id}/t` : '' });
    } else lines.push({ product_id: it.product_id, name: it.name, qty: it.qty, barcode: it.barcode || '', sku: it.sku || '', image: it.image_id ? `/media/${it.image_id}/t` : '' });
  }
  return {
    id: o.id, code: o.code, status: o.status, status_text: O.STATUSES[o.status] || o.status, customer: o.customer_name, phone: o.phone,
    area: O.areaLabel(o), address: o.address, total: Number(o.total), due, courier: o.courier || '', consignment: o.consignment_id || '',
    handed_at: o.handed_at || null, ready: READY.includes(o.status) || o.status === 'pending', items: lines,
  };
}
async function partsBarcodes(order) {
  // bundle parts need their own product barcodes
  const ids = [];
  for (const it of order.items) if (Array.isArray(it.components)) it.components.forEach((c) => ids.push(c.product_id));
  if (!ids.length) return;
  const rows = await db.q('SELECT id, name, barcode FROM products WHERE id = ANY($1::int[])', [ids]);
  const m = new Map(rows.map((r) => [r.id, r]));
  for (const it of order.items) if (Array.isArray(it.components)) it.components.forEach((c) => { const p = m.get(c.product_id); if (p) { c.barcode = p.barcode; c.name = c.name || p.name; } });
}

async function lookup(ctx) {
  const code = ctx.query.get('code');
  const o = await findOrder(code);
  if (!o) {
    const p = await db.one('SELECT id, name, stock FROM products WHERE upper(barcode)=upper($1)', [str(code, 60).trim()]).catch(() => null);
    if (p) return ctx.json(ctx.res, 200, { ok: false, product: p, error: `এটা একটা পণ্যের বারকোড: "${p.name}"। আগে ইনভয়েসের (অর্ডারের) বারকোড স্ক্যান করুন।` });
    return ctx.json(ctx.res, 404, { ok: false, error: `"${str(code, 40)}" নম্বরে কোনো অর্ডার পাওয়া যায়নি।` });
  }
  await partsBarcodes(o);
  return ctx.json(ctx.res, 200, { ok: true, order: view(o) });
}

async function handover(ctx) {
  const b = await ctx.body();
  const o = await findOrder(b.code);
  if (!o) return ctx.json(ctx.res, 404, { ok: false, error: 'অর্ডার পাওয়া যায়নি।' });
  if (o.status === 'shipped') return ctx.json(ctx.res, 409, { ok: false, already: true, error: `${o.code} আগেই কুরিয়ারে দেওয়া হয়েছে${o.handed_at ? ` (${fmtDate(o.handed_at)})` : ''}।` });
  if (!READY.includes(o.status) && !(o.status === 'pending' && b.force)) {
    if (o.status === 'pending') return ctx.json(ctx.res, 409, { ok: false, pending: true, error: `${o.code} এখনো কনফার্ম হয়নি। তবুও হ্যান্ডওভার করবেন?` });
    return ctx.json(ctx.res, 409, { ok: false, error: `${o.code} এর অবস্থা "${O.STATUSES[o.status] || o.status}" — এটা কুরিয়ারে দেওয়া যাবে না।` });
  }
  // not booked with the courier yet → book it now with the default courier (when connected), then hand over
  const s = ctx.settings;
  const courier = require('../services/courier');
  let booked = '';
  if (!o.consignment_id && s.handover_book !== '0' && s.courier_default && courier.configured(s, s.courier_default)) {
    const r = await require('./orders').sendToCourier(ctx, o.id, s.courier_default, { handover: true });
    if (!r.ok) return ctx.json(ctx.res, 502, { ok: false, error: `কুরিয়ারে বুকিং হয়নি: ${r.message} — অর্ডারটা হ্যান্ডওভার করা হয়নি, আবার চেষ্টা করুন বা অর্ডারের পাতা থেকে পাঠান।` });
    booked = ` ${courier.label(s.courier_default)}-এ বুকিং হলো (${r.consignment_id})।`;
  }
  try {
    const cur = await db.one('SELECT status FROM orders WHERE id=$1', [o.id]);
    if (cur.status !== 'shipped') await O.setStatus(o.id, 'shipped', ctx.user.id);
  } catch (e) { return ctx.json(ctx.res, 400, { ok: false, error: e.message }); }
  await db.q('UPDATE orders SET handed_at=now(), handed_by=$1 WHERE id=$2', [ctx.user.id, o.id]);
  await ctx.log('handover', 'order', o.id, `📦 কুরিয়ারে হ্যান্ডওভার (স্ক্যান)${b.verified ? ' — সব পণ্যের বারকোড মিলিয়ে' : ''}`);
  return ctx.json(ctx.res, 200, { ok: true, code: o.code, message: `✅ ${o.code} কুরিয়ারে দেওয়া হলো — স্টক থেকে কমেছে।${booked}` });
}
async function undo(ctx) {
  const b = await ctx.body();
  const o = await findOrder(b.code);
  if (!o || o.status !== 'shipped') return ctx.json(ctx.res, 409, { ok: false, error: 'এই অর্ডার এখন "কুরিয়ারে দেওয়া" অবস্থায় নেই।' });
  await O.setStatus(o.id, 'processing', ctx.user.id);
  await db.q('UPDATE orders SET handed_at=NULL, handed_by=NULL WHERE id=$1', [o.id]);
  await ctx.log('handover_undo', 'order', o.id, '↩️ হ্যান্ডওভার বাতিল — আবার "প্যাকিং চলছে"');
  return ctx.json(ctx.res, 200, { ok: true, message: `↩️ ${o.code} আবার "প্যাকিং চলছে" — স্টকে ফিরেছে।` });
}

async function page(ctx) {
  const [today, waiting] = await Promise.all([
    db.q(`SELECT o.id, o.code, o.customer_name, o.total, o.paid_amount, o.courier, o.handed_at, s.name AS by_name FROM orders o LEFT JOIN staff s ON s.id=o.handed_by
      WHERE o.handed_at > date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka' ORDER BY o.handed_at DESC LIMIT 200`),
    db.one(`SELECT count(*)::int AS n FROM orders WHERE status IN ('confirmed','processing')`),
  ]);
  const cod = today.reduce((t, o) => t + Math.max(0, Number(o.total) - Number(o.paid_amount || 0)), 0);
  const body = html`<div class="title-row"><h1>📦 কুরিয়ারে হ্যান্ডওভার <small>স্ক্যান করুন</small></h1>
  <a class="btn btn-ghost btn-sm" href="/admin/orders?status=processing">প্যাক বাকি অর্ডার →</a></div>
<div class="kpis kpis-tight">
  ${ui.kpi('আজ হ্যান্ডওভার', `${bn(today.length)}টি`, `কুরিয়ার থেকে পাবেন ${money(cod)}`, 'kpi-green')}
  ${ui.kpi('দেওয়ার অপেক্ষায়', `${bn(waiting.n)}টি`, 'কনফার্ম / প্যাকিং চলছে', waiting.n ? 'kpi-alert' : '')}
</div>
${(() => {
    const s = ctx.settings; const courier = require('../services/courier');
    const ok = s.courier_default && courier.configured(s, s.courier_default);
    return html`<p class="flash ${ok ? '' : 'flash-error'} small ho-courier-line">${ok
      ? html`🛵 সংযুক্ত কুরিয়ার: <b>${courier.label(s.courier_default)}</b> · ${s.courier_auto_send === '1' ? 'কনফার্ম হলেই বুকিং হয়' : 'কনফার্মে বুকিং বন্ধ'} · ${s.handover_book !== '0' ? 'বুকিং না থাকলে হ্যান্ডওভারের সময় নিজে থেকে বুকিং হবে' : 'হ্যান্ডওভারে বুকিং হয় না'}`
      : html`⚠️ কোনো কুরিয়ার API সংযুক্ত নেই — হ্যান্ডওভার কাজ করবে, কিন্তু কুরিয়ারে বুকিং নিজে থেকে হবে না।`} <a href="/admin/integrations/courier">কুরিয়ার সেটিংস →</a></p>`;
  })()}
<section class="panel ho-scan" data-handover>
  <div class="ho-input-row">
    <input type="text" class="ho-input" data-ho-input placeholder="ইনভয়েসের বারকোড স্ক্যান করুন বা অর্ডার / কনসাইনমেন্ট নম্বর লিখুন" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus>
    <button type="button" class="btn" data-ho-go>খুঁজুন</button>
    <button type="button" class="btn btn-ghost" data-ho-cam>📷 ক্যামেরা</button>
  </div>
  <div class="ho-opts">
    <label class="nav-chip"><span class="nav-chip-t">প্যাকিং যাচাই — প্রতিটা পণ্যের বারকোডও স্ক্যান করব</span><span class="switch switch-sm"><input type="checkbox" data-ho-verify><span class="switch-ui" aria-hidden="true"></span></span></label>
    <label class="nav-chip"><span class="nav-chip-t">⚡ স্ক্যান করলেই সাথে সাথে হ্যান্ডওভার</span><span class="switch switch-sm"><input type="checkbox" data-ho-auto><span class="switch-ui" aria-hidden="true"></span></span></label>
  </div>
  <div class="ho-cam" data-ho-cambox hidden><video playsinline muted></video><div class="ho-aim"></div><button type="button" class="btn btn-sm" data-ho-camoff>✖ ক্যামেরা বন্ধ</button></div>
  <p class="ho-msg" data-ho-msg role="status" aria-live="polite"></p>
  <div data-ho-order></div>
</section>
<section class="panel table-wrap">
  <h2>আজ কুরিয়ারে দেওয়া <small>${bn(today.length)}টি</small></h2>
  <div data-ho-today>${today.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>অর্ডার</th><th>কাস্টমার</th><th class="num">নিতে হবে</th><th>কে দিল</th><th></th></tr></thead>
  <tbody>${today.map((o) => html`<tr><td class="small">${fmtDate(o.handed_at)}</td><td><a href="/admin/orders/${o.id}"><b>${o.code}</b></a>${o.courier ? html`<br><span class="small muted">${o.courier}</span>` : ''}</td><td>${o.customer_name}</td>
    <td class="num">${money(Math.max(0, Number(o.total) - Number(o.paid_amount || 0)))}</td><td class="small">${o.by_name || ''}</td>
    <td><button type="button" class="link-btn small" data-ho-undo="${o.code}">↩️ ভুল হয়েছে</button></td></tr>`)}</tbody></table>` : html`<p class="muted">আজ এখনো কিছু দেওয়া হয়নি।</p>`}</div>
</section>
${ui.helpBox('কীভাবে ব্যবহার করবেন', html`<ol>
  <li>প্যাক করা বক্সে <b>ইনভয়েস</b> লাগান (অর্ডারের পাতা বা অর্ডার তালিকা থেকে প্রিন্ট)। এর বড় বারকোডটাই অর্ডারের পরিচয়।</li>
  <li>কুরিয়ারের লোক এলে এই পেজ খুলুন, বারকোড স্ক্যান করুন — <b>বারকোড স্ক্যানার</b> (USB/Bluetooth, ৳১৫০০-২৫০০) থাকলে শুধু তাক করুন; না থাকলে <b>📷 ক্যামেরা</b> চাপুন।</li>
  <li>চাইলে "প্যাকিং যাচাই" চালু রেখে বক্সের প্রতিটা পণ্যের বারকোড স্ক্যান করুন — ভুল পণ্য বা কম-বেশি হলে লাল সংকেত দেবে।</li>
  <li><b>✅ হ্যান্ডওভার</b> চাপুন — অর্ডার "কুরিয়ারে দেওয়া হয়েছে" হবে আর ইনভেন্টরিতে তাকের স্টক থেকে কমে যাবে। ভুল হলে নিচের তালিকা থেকে "↩️ ভুল হয়েছে"।</li>
  <li>অনেক পার্সেল একসাথে দিলে "⚡ স্ক্যান করলেই সাথে সাথে হ্যান্ডওভার" চালু করে একটার পর একটা স্ক্যান করে যান।</li>
</ol>`)}
<script src="/js/scan.js?v=${ASSET_V}" defer></script>`;
  return ctx.page('কুরিয়ারে হ্যান্ডওভার', body, 'handover');
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'orders_edit', handler: page },
    { method: 'GET', path: '/admin/api/handover', perm: 'orders_edit', handler: lookup },
    { method: 'POST', path: '/admin/api/handover', perm: 'orders_edit', handler: handover },
    { method: 'POST', path: '/admin/api/handover/undo', perm: 'orders_edit', handler: undo },
  ],
};
void raw;

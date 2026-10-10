'use strict';
// Admin → অর্ডার ও কাস্টমার → ↩️ রিটার্ন ও রিফান্ড.
// Customers' return requests (and ones the staff record by phone): approve / reject with a reply, take the goods back
// (each item to the shelf, to damaged stock, or nowhere), then refund (also written in the accounts if chosen) or replace.
const { html, raw, int, str, bn, money, fmtDate, normalizePhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const R = require('../models/returns');
const O = require('../models/orders');
const finance = require('../models/finance');

const BASE = '/admin/returns';
const PILL = { requested: 'pill-warn', approved: 'pill-blue', received: 'pill-blue', refunded: 'pill-ok', replaced: 'pill-ok', rejected: '', cancelled: '' };
const HOW = { stock: '✅ স্টকে ফেরত (আবার বিক্রি হবে)', damaged: '⚠️ নষ্ট স্টকে (বিক্রি হবে না)', none: '✖ কোথাও না (ফেলে দেওয়া / কুরিয়ারের কাছে)' };

async function listPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'settings') {
      if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
      await db.setMany({ returns_on: b.returns_on ? '1' : '0', returns_days: String(Math.max(1, Math.min(365, int(b.returns_days, 7)))) });
      await ctx.log('settings', 'settings', null, `রিটার্ন আবেদন: ${b.returns_on ? 'চালু' : 'বন্ধ'}, ${int(b.returns_days, 7)} দিন`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'new') {
      // the staff records a return a customer asked for by phone / in the shop
      const order = await O.getOrder({ code: str(b.order_code, 20).toUpperCase() });
      if (!order) return ctx.fail(BASE, 'এই নম্বরের অর্ডার পাওয়া যায়নি।');
      return ctx.redirect(ctx.res, `${BASE}/new/${order.id}`);
    }
    return ctx.back(BASE);
  }
  const status = R.STATUSES[ctx.query.get('status')] || ['all', 'open'].includes(ctx.query.get('status')) ? ctx.query.get('status') : 'open';
  const q = str(ctx.query.get('q'), 40);
  const [rows, counts] = await Promise.all([R.list({ status, q, limit: 100 }), R.counts()]);
  const tab = (k, l, n) => html`<a class="chip ${status === k ? 'on' : ''}" href="${BASE}?status=${k}">${l} <b>${bn(n || 0)}</b></a>`;
  const body = html`<div class="title-row"><h1>↩️ রিটার্ন ও রিফান্ড</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}?status=${status}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('কাজ বাকি', bn(counts.open), 'নতুন + অনুমোদিত + পণ্য এসেছে', counts.open ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('মোট টাকা ফেরত', money(counts.refunded_total), 'রিটার্ন থেকে')}
  ${ui.kpi('অনলাইন আবেদন', s.returns_on === '1' ? '✅ চালু' : '⚪ বন্ধ', s.returns_on === '1' ? `ডেলিভারির ${bn(s.returns_days || 7)} দিনের মধ্যে` : 'কাস্টমার নিজে আবেদন করতে পারবে না')}
</div>
<div class="chips">${tab('open', 'কাজ বাকি', counts.open)}${tab('requested', 'নতুন', counts.requested)}${tab('approved', 'অনুমোদিত', counts.approved)}${tab('received', 'পণ্য এসেছে', counts.received)}
  ${tab('refunded', 'টাকা ফেরত', counts.refunded)}${tab('replaced', 'বদলে দেওয়া', counts.replaced)}${tab('rejected', 'বাতিল', counts.rejected)}${tab('all', 'সব', counts.all)}</div>
<form method="get" action="${BASE}" class="filters"><input type="hidden" name="status" value="${status}"><input type="search" name="q" value="${q}" placeholder="রিটার্ন/অর্ডার নম্বর, মোবাইল, নাম"><button class="btn btn-sm">খুঁজুন</button></form>
${rows.length ? html`<div class="table-wrap panel"><table class="table"><thead><tr><th>রিটার্ন</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>কারণ</th><th>চাই</th><th class="num">টাকা</th><th>অবস্থা</th><th></th></tr></thead><tbody>
${rows.map((r) => html`<tr><td><a href="${BASE}/${r.id}"><b class="mono">${r.code}</b></a><br><span class="small muted">${fmtDate(r.created_at)}</span></td>
  <td><a href="/admin/orders/${r.order_id}" class="mono">${r.order_code}</a></td><td>${r.customer_name}<br><span class="small mono">${r.phone}</span></td>
  <td class="small">${(r.items || []).map((i) => `${i.name} ×${bn(i.qty)}`).join(', ')}</td><td class="small">${R.REASONS[r.reason] || r.reason}${r.photos && r.photos.length ? html` <span title="ছবি আছে">📷${bn(r.photos.length)}</span>` : ''}</td>
  <td class="small">${R.WANTS[r.want] || r.want}</td><td class="num">${money(R.itemsValue(r))}${Number(r.refund_amount) ? html`<br><span class="small good">ফেরত ${money(r.refund_amount)}</span>` : ''}</td>
  <td>${ui.pill(R.STATUSES[r.status] || r.status, PILL[r.status] || '')}</td><td><a class="btn btn-sm btn-ghost" href="${BASE}/${r.id}">খুলুন</a></td></tr>`)}
</tbody></table></div>` : ui.empty('কোনো রিটার্ন নেই।')}
<div class="two-col">
  <section class="panel"><h2>ফোনে/দোকানে বলা রিটার্ন লিখুন</h2>
    <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="new">
      ${ui.field('অর্ডার নম্বর', ui.input('order_code', '', { required: true, maxlength: 20, placeholder: 'SM…', autocapitalize: 'characters' }))}
      <button class="btn btn-sm">পরের ধাপ →</button></form></section>
  ${ctx.can('settings') ? html`<section class="panel"><h2>⚙️ কাস্টমারের অনলাইন আবেদন</h2>
    <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="settings">
      ${ui.switchRow('returns_on', s.returns_on === '1', 'অর্ডারের পেজে "রিটার্ন / রিফান্ড আবেদন"', 'ডেলিভারি হওয়া অর্ডারে কাস্টমার পণ্য, কারণ, ছবি আর টাকা নেওয়ার নম্বর দিয়ে আবেদন করতে পারবেন।')}
      ${ui.field('ডেলিভারির কত দিনের মধ্যে', ui.input('returns_days', s.returns_days || 7, { type: 'number', min: 1, max: 365, class: 'w-num' }), 'এর পরে অনলাইনে আবেদন করা যাবে না (আপনি এখান থেকে লিখতে পারবেন)')}
      <button class="btn btn-sm">সেভ করুন</button></form></section>` : ''}
</div>`;
  return ctx.page('রিটার্ন ও রিফান্ড', body, 'returns');
}

// staff records a return on behalf of the customer
async function newPage(ctx, m) {
  const order = await O.getOrder({ id: int(m[1]) });
  if (!order) return ctx.redirect(ctx.res, BASE);
  const V = require('../views/account');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ids = [].concat(b.item || []).map((x) => int(x));
    try {
      const r = await R.create({ order, wanted: ids.map((id) => ({ item_id: id, qty: int(b[`qty_${id}`], 1) })), reason: b.reason, want: b.want, details: b.details,
        photos: [], refundMethod: b.refund_method, refundNumber: b.refund_number, source: 'admin', settings: ctx.settings, staffId: ctx.user.id });
      await ctx.log('return_create', 'order', order.id, `রিটার্ন ${r.code} লেখা হয়েছে`);
      return ctx.back(`${BASE}/${r.id}`, 'added');
    } catch (e) {
      if (!(e instanceof R.ReturnError)) throw e;
      return ctx.fail(`${BASE}/new/${order.id}`, e.message);
    }
  }
  const items = (order.items || []).filter((i) => i.product_id);
  const body = html`<p class="crumbs"><a href="${BASE}">← সব রিটার্ন</a></p><h1>নতুন রিটার্ন — <a href="/admin/orders/${order.id}" class="mono">${order.code}</a></h1>${ui.flash(ctx.flash)}
${order.status !== 'delivered' ? html`<p class="flash flash-error">এই অর্ডার এখনো "ডেলিভারি সম্পন্ন" না (${O.STATUSES[order.status]})। পুরো অর্ডার কুরিয়ার থেকে ফেরত এলে অর্ডারের পেজে "ফেরত এসেছে" দিন।</p>` : html`
<form method="post" action="${BASE}/new/${order.id}" class="form panel">
  <p>${order.customer_name} · <span class="mono">${order.phone}</span></p>
  <table class="table compact"><tbody>${items.map((it) => html`<tr><td><label class="check"><input type="checkbox" name="item" value="${it.id}"> <span>${it.name}</span></label></td>
    <td class="num"><input type="number" name="qty_${it.id}" min="1" max="${it.qty}" value="${it.qty}" class="w-num"> / ${bn(it.qty)}</td><td class="num">${money(it.price)}</td></tr>`)}</tbody></table>
  <div class="field-row">${ui.field('কারণ', ui.select('reason', V.REASONS, 'broken'))}${ui.field('কাস্টমার চান', ui.select('want', V.WANTS, 'refund'))}</div>
  ${ui.field('বিস্তারিত', ui.textarea('details', '', { rows: 2, maxlength: 1000 }))}
  <div class="field-row">${ui.field('টাকা কোথায় দেবেন', ui.select('refund_method', [['bkash', 'বিকাশ'], ['nagad', 'নগদ'], ['rocket', 'রকেট'], ['bank', 'ব্যাংক'], ['cash', 'নগদ টাকা']], 'bkash'))}
    ${ui.field('নম্বর / অ্যাকাউন্ট', ui.input('refund_number', order.phone, { maxlength: 60 }))}</div>
  <button class="btn">রিটার্ন সেভ করুন</button>
</form>`}`;
  return ctx.page('নতুন রিটার্ন', body, 'returns');
}

async function detail(ctx, m) {
  const id = int(m[1]);
  const r = await R.get(id);
  if (!r) return ctx.redirect(ctx.res, BASE);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (['approved', 'rejected', 'replaced', 'cancelled'].includes(b.action)) {
        const x = await R.decide(id, b.action, { reply: b.reply, note: b.note }, ctx.user.id);
        await ctx.log('return_' + b.action, 'order', r.order_id, `${r.code}: ${R.STATUSES[b.action]}${b.reply ? ' — ' + str(b.reply, 80) : ''}`);
        // tell the customer by SMS (when SMS is on)
        if (b.sms === '1' && x.phone) {
          const SMS = require('../services/sms');
          if (SMS.ready(ctx.settings).ok) {
            const word = { approved: 'অনুমোদন করা হয়েছে', rejected: 'গ্রহণ করা যায়নি', replaced: 'বদলে দেওয়া হচ্ছে', cancelled: 'বাতিল হয়েছে' }[b.action];
            await SMS.send(ctx.settings, x.phone, `${ctx.settings.store_name}: আপনার রিটার্ন আবেদন ${x.code} ${word}।${b.reply ? ' ' + str(b.reply, 120) : ''}`, { kind: 'return', orderId: r.order_id, staffId: ctx.user.id });
          }
        }
        return ctx.back(back, 'status');
      }
      if (b.action === 'receive') {
        const acts = {};
        (r.items || []).forEach((it) => { acts[it.item_id] = b[`how_${it.item_id}`]; });
        const done = await R.receive(id, acts, ctx.user.id);
        await ctx.log('return_receive', 'order', r.order_id, `${r.code}: পণ্য ফেরত — ${done.map((d) => HOW[d.how].split(' ')[0]).join(' ')}`);
        return ctx.back(back, 'saved');
      }
      if (b.action === 'refund') {
        const x = await R.refund(id, { amount: b.amount, method: b.method, reference: b.reference, note: b.note }, ctx.user.id);
        if (int(b.account_id) && ctx.can('accounting')) {
          await finance.addTransaction({ type: 'expense', category: 'রিফান্ড', amount: x.amount, account_id: b.account_id, order_id: r.order_id, note: `${r.order_code} রিটার্ন ${r.code} ${str(b.reference, 60)}` }, ctx.user.id);
        }
        await ctx.log('order_refund', 'order', r.order_id, `রিটার্ন ${r.code}: ৳${x.amount} ফেরত`);
        if (b.sms === '1') {
          const SMS = require('../services/sms');
          if (SMS.ready(ctx.settings).ok) await SMS.send(ctx.settings, r.phone, `${ctx.settings.store_name}: রিটার্ন ${r.code} এর ৳${x.amount} ফেরত পাঠানো হয়েছে${b.method ? ` (${b.method})` : ''}${b.reference ? `, রেফারেন্স ${str(b.reference, 30)}` : ''}।`, { kind: 'return', orderId: r.order_id, staffId: ctx.user.id });
        }
        return ctx.back(back, 'paid');
      }
      if (b.action === 'note') {
        await db.q('UPDATE return_requests SET admin_note=$1, updated_at=now() WHERE id=$2', [str(b.note, 1000), id]);
        return ctx.back(back, 'saved');
      }
    } catch (e) {
      if (!(e instanceof R.ReturnError) && !/টাকা|অ্যাকাউন্ট/.test(e.message)) throw e;
      return ctx.fail(back, e.message);
    }
    return ctx.back(back);
  }
  const [accounts, order] = await Promise.all([ctx.can('accounting') ? finance.listAccounts() : [], O.getOrder({ id: r.order_id })]);
  const value = R.itemsValue(r);
  const open = R.OPEN.includes(r.status);
  const canRefund = !['rejected', 'cancelled'].includes(r.status) && Number(order.paid_amount) > 0;
  const body = html`<p class="crumbs"><a href="${BASE}">← সব রিটার্ন</a></p>
<div class="title-row"><h1>রিটার্ন <span class="mono">${r.code}</span> ${ui.pill(R.STATUSES[r.status], PILL[r.status] || '')}</h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/orders/${r.order_id}">🧾 অর্ডার ${r.order_code}</a></div></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <div>
    <section class="panel"><h2>কী ফেরত দিতে চান</h2>
      <p>${r.customer_name} · <a href="tel:${r.phone}" class="mono">${r.phone}</a> · ${fmtDate(r.created_at)} · ${r.source === 'admin' ? 'স্টাফ লিখেছেন' : 'কাস্টমার অনলাইনে'}</p>
      <table class="table compact"><thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">দাম</th>${r.restock ? html`<th>কোথায় গেছে</th>` : ''}</tr></thead><tbody>
      ${(r.items || []).map((it) => html`<tr><td>${it.name}</td><td class="num">${bn(it.qty)}${it.ordered && it.ordered !== it.qty ? html` <span class="small muted">/ ${bn(it.ordered)}</span>` : ''}</td><td class="num">${money(it.price * it.qty)}</td>
        ${r.restock ? html`<td class="small">${HOW[((r.restock || []).find((d) => d.item_id === it.item_id) || {}).how] || ''}</td>` : ''}</tr>`)}</tbody>
      <tfoot><tr><td>মোট</td><td></td><td class="num"><b>${money(value)}</b></td></tr></tfoot></table>
      <p><b>কারণ:</b> ${R.REASONS[r.reason] || r.reason} · <b>চান:</b> ${R.WANTS[r.want] || r.want}</p>
      ${r.details ? html`<p class="note">${r.details}</p>` : ''}
      ${r.refund_number ? html`<p><b>টাকা নেবেন:</b> ${r.refund_method} — <span class="mono">${r.refund_number}</span></p>` : ''}
      ${r.photos && r.photos.length ? html`<div class="ret-photos">${r.photos.map((pid) => html`<a href="${BASE}/photo/${pid}" target="_blank" rel="noopener"><img src="${BASE}/photo/${pid}" alt="রিটার্নের ছবি" loading="lazy"></a>`)}</div>` : ''}
    </section>
    <section class="panel"><h2>ভেতরের নোট</h2><form method="post" action="${back}" class="form"><input type="hidden" name="action" value="note">
      ${ui.textarea('note', r.admin_note, { rows: 2, maxlength: 1000, placeholder: 'শুধু অ্যাডমিনে দেখা যায়' })}<button class="btn btn-sm btn-ghost">সেভ করুন</button></form>
      ${r.staff_name ? html`<p class="small muted">শেষ কাজ: ${r.staff_name} · ${fmtDate(r.updated_at)}</p>` : ''}</section>
  </div>
  <div>
    ${open ? html`<section class="panel"><h2>১) সিদ্ধান্ত</h2>
      <form method="post" action="${back}" class="form">
        ${ui.field('কাস্টমারকে বার্তা (অর্ডারের পেজে দেখাবে)', ui.textarea('reply', r.reply, { rows: 2, maxlength: 500, placeholder: 'যেমন: পণ্যটা কুরিয়ারে ফেরত পাঠান, আমরা পেয়ে টাকা ফেরত দেব।' }))}
        ${ui.check('sms', true, 'কাস্টমারকে SMS-এও জানাও (SMS চালু থাকলে)')}
        <div class="row-actions">
          ${r.status === 'requested' ? html`<button class="btn btn-sm" name="action" value="approved">✅ অনুমোদন করুন</button>` : ''}
          <button class="btn btn-sm btn-ghost" name="action" value="replaced">🔄 বদলে দেওয়া হয়েছে</button>
          <button class="btn btn-sm btn-danger" name="action" value="rejected" data-confirm-btn="আবেদন বাতিল করবেন?">✖ বাতিল</button>
        </div>
      </form></section>` : ''}
    ${['requested', 'approved'].includes(r.status) && !r.received_at ? html`<section class="panel"><h2>২) পণ্য ফেরত পেয়েছি</h2>
      <form method="post" action="${back}" class="form" data-confirm="পণ্য ফেরত নেওয়া হয়েছে লিখবেন? স্টক বদলে যাবে।"><input type="hidden" name="action" value="receive">
        ${(r.items || []).map((it) => ui.field(`${it.name} ×${bn(it.qty)}`, ui.select(`how_${it.item_id}`, Object.entries(HOW), 'stock')))}
        <button class="btn btn-sm">📦 পণ্য ফেরত নেওয়া হয়েছে</button></form></section>` : ''}
    ${canRefund ? html`<section class="panel"><h2>৩) টাকা ফেরত</h2>
      <p class="small muted">এই অর্ডারে পরিশোধ হয়েছে ${money(order.paid_amount)}${Number(r.refund_amount) ? ` · এই রিটার্নে আগে ফেরত ${money(r.refund_amount)}` : ''}। কুরিয়ার/ডেলিভারি চার্জ কাটবেন কি না আপনার সিদ্ধান্ত।</p>
      <form method="post" action="${back}" class="form" data-confirm="টাকা ফেরত দেওয়া রেকর্ড করবেন?"><input type="hidden" name="action" value="refund">
        <div class="field-row">${ui.field('কত টাকা', ui.input('amount', Math.min(value, Number(order.paid_amount)) - Number(r.refund_amount || 0) > 0 ? Math.min(value, Number(order.paid_amount)) - Number(r.refund_amount || 0) : '', { type: 'number', min: 0.01, step: '0.01', required: true }))}
          ${ui.field('কীভাবে', ui.select('method', [['bkash', 'বিকাশ'], ['nagad', 'নগদ'], ['rocket', 'রকেট'], ['bank', 'ব্যাংক'], ['cash', 'নগদ টাকা']], r.refund_method || 'bkash'))}</div>
        ${ui.field('ট্রানজেকশন / রেফারেন্স', ui.input('reference', '', { maxlength: 80 }))}
        ${accounts.length ? ui.field('কোন অ্যাকাউন্ট থেকে গেছে (হিসাবে খরচ হিসেবে লেখা হবে)', ui.select('account_id', [['', '— হিসাবে লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`])], '')) : ''}
        ${ui.check('sms', true, 'কাস্টমারকে SMS-এ জানাও')}
        <button class="btn btn-sm">💵 টাকা ফেরত রেকর্ড করুন</button></form></section>` : ''}
  </div>
</div>`;
  return ctx.page(`রিটার্ন ${r.code}`, body, 'returns');
}

// a return's photo (private: only logged-in staff)
async function photo(ctx, m) {
  const p = await db.one(`SELECT mime, data FROM media WHERE id=$1 AND owner_type='return'`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(ctx.res, 404, 'Not found', 'text/plain');
  ctx.res.writeHead(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

void raw; void normalizePhone;
module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: '*', path: /^\/admin\/returns\/new\/(\d+)$/, perm: 'orders_edit', handler: newPage },
    { method: 'GET', path: /^\/admin\/returns\/photo\/(\d+)$/, perm: 'orders', handler: photo },
    { method: '*', path: /^\/admin\/returns\/(\d+)$/, perm: (ctx) => (ctx.method === 'GET' ? 'orders' : 'orders_edit'), handler: detail },
  ],
};

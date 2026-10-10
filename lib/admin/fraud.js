'use strict';
// Admin → অর্ডার ও কাস্টমার → 🛡️ ফ্রড চেক: check any mobile number's parcel record (this shop + Pathao + FraudBD),
// the FraudBD key, and what happens to new orders from risky numbers (a note, or "হোল্ড").
const { html, str, bn, fmtDate, normalizePhone, validPhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const fraud = require('../services/fraud');
const courier = require('../services/courier');

const BASE = '/admin/fraud';

function resultBox(r) {
  if (!r) return '';
  if (!r.ok) return html`<p class="flash flash-error">${r.message}</p>`;
  return html`<div class="risk risk-${r.level}"><b>${r.label}</b>${r.rate !== null ? html` — সব মিলিয়ে সফল <b>${bn(r.rate)}%</b> (${bn(r.success)}/${bn(r.total)})` : ''}<span>${r.advice}</span></div>
  <ul class="fraud-list">
    <li>🏪 এই দোকানে: মোট অর্ডার ${bn(r.own.orders)} · ডেলিভারি <b>${bn(r.own.delivered)}</b> · বাতিল/ফেরত <b>${bn(r.own.failed)}</b>${r.own.last_day > 1 ? html` · ⚠️ ২৪ ঘণ্টায় ${bn(r.own.last_day)}টি অর্ডার` : ''}</li>
    ${r.fraudbd && r.fraudbd.ok ? r.fraudbd.couriers.map((c) => html`<li>🚚 ${c.name}: ${c.type === 'rating' ? (c.message || c.rating || '—') : html`মোট <b>${bn(c.total)}</b> · সফল <b>${bn(c.success)}</b> · বাতিল <b>${bn(c.cancel)}</b>`}</li>`) : ''}
    ${r.fraudbd && !r.fraudbd.ok ? html`<li class="muted">FraudBD: ${r.fraudbd.message}</li>` : ''}
    ${r.pathao ? html`<li>${r.pathao.ok ? html`🚚 Pathao: মোট <b>${bn(r.pathao.total)}</b> · সফল <b>${bn(r.pathao.success)}</b>${r.pathao.rating ? ` · ${r.pathao.rating}` : ''}` : html`<span class="muted">Pathao: ${r.pathao.message}</span>`}</li>` : ''}
  </ul>
  <p class="row-actions"><a class="btn btn-sm btn-ghost" href="/admin/orders?q=${r.phone}">এই নম্বরের অর্ডার</a> <a class="btn btn-sm btn-ghost" href="/admin/blocklist">ব্লক লিস্ট</a></p>`;
}

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    const b = await ctx.body();
    const v = { fraud_auto: b.fraud_auto ? '1' : '0', fraud_hold: b.fraud_hold ? '1' : '0' };
    if (b.clear_key === '1') v.fraudbd_api_key = '';
    else if (str(b.fraudbd_api_key, 200)) v.fraudbd_api_key = str(b.fraudbd_api_key, 200);
    await db.setMany(v);
    await ctx.log('settings', 'settings', null, `ফ্রড চেক: নতুন অর্ডারে নিজে থেকে ${v.fraud_auto === '1' ? 'চালু' : 'বন্ধ'}${v.fraudbd_api_key ? ', নতুন FraudBD key' : ''}`);
    return ctx.back(BASE, 'saved');
  }
  const phone = normalizePhone(ctx.query.get('phone') || '');
  const result = phone ? (validPhone(phone) ? await fraud.check(s, phone, { fresh: ctx.query.get('fresh') === '1' }) : { ok: false, message: 'ফোন নম্বর ঠিক নেই।' }) : null;
  const recent = await db.q('SELECT phone, data, checked_at FROM fraud_checks ORDER BY checked_at DESC LIMIT 20');
  const hasKey = !!String(s.fraudbd_api_key || '').trim();
  const body = html`<h1>🛡️ ফ্রড চেক (কাস্টমারের পার্সেল রেকর্ড)</h1>${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel"><h2>🔍 একটা নম্বর চেক করুন</h2>
    <form method="get" action="${BASE}" class="coupon-row"><input name="phone" value="${phone}" inputmode="tel" placeholder="01XXXXXXXXX" required maxlength="20"><button class="btn btn-sm">চেক করুন</button></form>
    <div class="mt">${resultBox(result)}</div>
    ${result && result.ok && result.cached_at ? html`<p class="small muted">২৪ ঘণ্টার ভেতরের আগের চেক। <a href="${BASE}?phone=${phone}&fresh=1">আবার নতুন করে চেক করুন</a></p>` : ''}
  </section>
  <section class="panel"><h2>⚙️ কোথা থেকে তথ্য আসে</h2>
    <ul class="small">
      <li>🏪 <b>এই দোকানের অর্ডার</b> — সবসময়।</li>
      <li>🚚 <b>Pathao</b> — ${courier.configured(s, 'pathao') ? '✅ সংযুক্ত (কুরিয়ার সেটিংস)' : html`সংযুক্ত নেই — <a href="/admin/integrations/courier">কুরিয়ার সেটিংস</a>`}</li>
      <li>🌐 <b>FraudBD</b> (fraudbd.com) — Steadfast, Pathao, RedX, Paperfly সব কুরিয়ারে এই নম্বরের পার্সেল কতগুলো সফল/বাতিল। ${hasKey ? '✅ key দেওয়া আছে' : 'key দেওয়া নেই'}</li>
    </ul>
    ${ctx.can('settings') ? html`<form method="post" action="${BASE}" class="form">
      ${ui.field('FraudBD API key', ui.input('fraudbd_api_key', '', { type: 'password', maxlength: 200, autocomplete: 'off', placeholder: hasKey ? '•••••••• (সেভ করা আছে — বদলাতে নতুনটা দিন)' : 'fraudbd.com এ অ্যাকাউন্ট খুলে API key কপি করুন' }), 'প্রতি চেকে তাদের প্যাকেজ থেকে ক্রেডিট কাটে; একই নম্বর ২৪ ঘণ্টায় একবারই চেক হয়।')}
      ${hasKey ? ui.check('clear_key', false, 'key মুছে দিন') : ''}
      ${ui.switchRow('fraud_auto', s.fraud_auto === '1', 'নতুন অর্ডার এলে নিজে থেকে চেক', 'ঝুঁকিপূর্ণ নম্বর হলে অর্ডারের ভেতরের নোটে ⛔ লেখা হবে, আর মালিকের ফোনে নোটিফিকেশন যাবে (চালু থাকলে)।')}
      ${ui.switchRow('fraud_hold', s.fraud_hold === '1', 'ঝুঁকিপূর্ণ হলে অর্ডার "হোল্ডে" রাখুন', 'কল করে নিশ্চিত না হওয়া পর্যন্ত কুরিয়ারে যাবে না।')}
      <button class="btn btn-sm">সেভ করুন</button></form>` : ''}
  </section>
</div>
<section class="panel table-wrap"><h2>সম্প্রতি চেক করা নম্বর</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>নম্বর</th><th>ফল</th><th class="num">সব কুরিয়ারে</th><th>কখন</th></tr></thead><tbody>
  ${recent.map((r) => { const j = fraud.judge({ delivered: 0, failed: 0, last_day: 0 }, r.data.pathao, r.data.fraudbd); return html`<tr><td class="mono"><a href="${BASE}?phone=${r.phone}">${r.phone}</a></td><td><span class="risk-dot risk-${j.level}">${j.label}</span></td>
    <td class="num">${j.total ? html`${bn(j.success)}/${bn(j.total)} (${bn(j.rate)}%)` : '—'}</td><td class="small">${fmtDate(r.checked_at)}</td></tr>`; })}
  </tbody></table>` : html`<p class="muted">এখনো কিছু নেই।</p>`}
</section>`;
  return ctx.page('ফ্রড চেক', body, 'fraud');
}

module.exports = { routes: [{ method: '*', path: BASE, perm: (ctx) => (ctx.method === 'POST' ? 'settings' : 'orders'), handler: page }] };

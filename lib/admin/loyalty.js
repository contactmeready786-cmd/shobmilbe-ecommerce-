'use strict';
// Admin → মার্কেটিং → লয়ালটি পয়েন্ট: the rules, who has the most points, and adding / taking points by hand.
const { html, bn, int, str, money, fmtDate, normalizePhone, validPhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const L = require('../models/loyalty');

const BASE = '/admin/marketing/loyalty';

async function page(ctx, error = null) {
  if (ctx.method === 'POST' && !error) return save(ctx);
  const s = ctx.settings;
  const c = L.cfg(s);
  const phone = normalizePhone(ctx.query.get('phone'));
  const [sum, top] = await Promise.all([L.summary(), L.top(20)]);
  const cust = validPhone(phone) ? await db.one('SELECT id, name, phone, points FROM customers WHERE phone=$1', [phone]) : null;
  const hist = cust ? await L.history(cust.id, 30) : [];
  const body = html`<h1>🎖️ লয়ালটি পয়েন্ট</h1>${ui.flash(ctx.flash)}
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
${ui.helpBox('লয়ালটি পয়েন্ট কীভাবে কাজ করে', html`<ul>
  <li>কাস্টমার প্রতি <b>${money(c.earnPer)}</b> এর পণ্য কিনলে <b>১ পয়েন্ট</b> পায় — অর্ডার <b>ডেলিভারি হলে</b> পয়েন্ট যোগ হয় (বাতিল/ফেরত হলে পায় না)।</li>
  <li>পরের অর্ডারে চেকআউটে মোবাইল নম্বর লিখলে তার পয়েন্ট দেখায়; টিক দিলে <b>১ পয়েন্ট = ${money(c.value)}</b> ছাড়। কমপক্ষে ${bn(c.min)} পয়েন্ট লাগে, আর পণ্যের দামের সর্বোচ্চ ${bn(c.maxPct)}% পর্যন্ত।</li>
  <li>লগইন লাগে না — মোবাইল নম্বরই কাস্টমারের পরিচয়। অর্ডার বাতিল/ফেরত হলে খরচ করা পয়েন্ট ফেরত যায়।</li>
  <li>উদাহরণ: ${money(c.earnPer * 10)} এর কেনাকাটায় ১০ পয়েন্ট = পরের বার ${money(10 * c.value)} ছাড়। মানে প্রায় ${bn(Math.round((c.value / c.earnPer) * 1000) / 10)}% ক্যাশব্যাক।</li>
</ul>`)}
<div class="kpis">
  ${ui.kpi('কাস্টমারদের হাতে মোট পয়েন্ট', bn(sum.outstanding), `${money(sum.outstanding * c.value)} সমান · ${bn(sum.holders)} জন`)}
  ${ui.kpi('গত ৩০ দিনে দেওয়া', bn(sum.earned30), 'পয়েন্ট')}
  ${ui.kpi('গত ৩০ দিনে খরচ', bn(sum.spent30), `${money(sum.spent30 * c.value)} ছাড়`)}
</div>
<div class="two-col">
  <section class="panel">
    <h2>⚙️ নিয়ম</h2>
    <form method="post" action="${BASE}" class="form">
      <input type="hidden" name="action" value="settings">
      ${ui.switchRow('loyalty_on', c.on, 'লয়ালটি পয়েন্ট চালু', 'চালু করলে চেকআউটে পয়েন্ট দেখাবে আর ডেলিভারি হওয়া অর্ডারে পয়েন্ট যোগ হবে।')}
      <div class="field-row">
        ${ui.field('কত টাকায় ১ পয়েন্ট (৳)', ui.input('loyalty_earn_per', s.loyalty_earn_per, { type: 'number', min: 1, class: 'w-num' }), 'ডেলিভারি চার্জ বাদে, ছাড়ের পরের দাম ধরে')}
        ${ui.field('১ পয়েন্ট = কত টাকা ছাড় (৳)', ui.input('loyalty_point_value', s.loyalty_point_value, { type: 'number', min: 0.01, step: '0.01', class: 'w-num' }))}
      </div>
      <div class="field-row">
        ${ui.field('কমপক্ষে কত পয়েন্ট হলে খরচ করা যাবে', ui.input('loyalty_min_redeem', s.loyalty_min_redeem, { type: 'number', min: 1, class: 'w-num' }))}
        ${ui.field('এক অর্ডারে সর্বোচ্চ কত % ছাড়', ui.input('loyalty_max_pct', s.loyalty_max_pct, { type: 'number', min: 1, max: 100, class: 'w-num' }), 'পণ্যের দামের যত % পর্যন্ত পয়েন্টে কাটা যাবে')}
      </div>
      <button class="btn">সেভ করুন</button>
    </form>
  </section>
  <section class="panel">
    <h2>🔎 কাস্টমারের পয়েন্ট দেখুন / বদলান</h2>
    <form method="get" action="${BASE}" class="toolbar"><input type="search" name="phone" value="${phone || ''}" placeholder="মোবাইল নম্বর 01XXXXXXXXX" inputmode="tel"><button class="btn btn-sm">দেখুন</button></form>
    ${phone && !cust ? html`<p class="muted">এই নম্বরে কোনো কাস্টমার নেই।</p>` : ''}
    ${cust ? html`<p><a href="/admin/customers/${cust.id}"><b translate="no">${cust.name || cust.phone}</b></a> · ${cust.phone} — এখন <b>${bn(cust.points)}</b> পয়েন্ট (${money(cust.points * c.value)})</p>
      <form method="post" action="${BASE}" class="form">
        <input type="hidden" name="action" value="adjust"><input type="hidden" name="customer_id" value="${cust.id}"><input type="hidden" name="phone" value="${cust.phone}">
        <div class="field-row">
          ${ui.field('কত পয়েন্ট (কমাতে − দিন)', ui.input('points', '', { type: 'number', required: true, class: 'w-num', placeholder: 'যেমন 50 বা -20' }))}
          ${ui.field('কারণ', ui.input('note', '', { required: true, maxlength: 150, placeholder: 'যেমন: অভিযোগের জন্য উপহার' }))}
        </div>
        <button class="btn btn-sm">পয়েন্ট বদলান</button>
      </form>
      ${hist.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>কী</th><th class="num">পয়েন্ট</th></tr></thead><tbody>${hist.map((h) => html`<tr>
        <td class="small">${fmtDate(h.created_at)}</td><td class="small">${L.KINDS[h.kind] || h.kind}${h.order_code ? html` · <a href="/admin/orders/${h.order_id}">${h.order_code}</a>` : ''}${h.note ? html`<br><span class="muted">${h.note}</span>` : ''}${h.staff_name ? html` <span class="muted">(${h.staff_name})</span>` : ''}</td>
        <td class="num ${h.points < 0 ? 'warn' : 'good'}">${h.points > 0 ? '+' : ''}${bn(h.points)}</td></tr>`)}</tbody></table>` : ''}` : ''}
    <h3>সবচেয়ে বেশি পয়েন্ট</h3>
    ${top.length ? html`<table class="table compact"><tbody>${top.map((t) => html`<tr><td><a href="${BASE}?phone=${t.phone}" translate="no">${t.name || t.phone}</a><br><span class="small muted">${t.phone}</span></td><td class="num"><b>${bn(t.points)}</b></td></tr>`)}</tbody></table>`
    : html`<p class="muted small">এখনো কারো পয়েন্ট নেই।</p>`}
  </section>
</div>`;
  return ctx.page('লয়ালটি পয়েন্ট', body, 'loyalty', { status: error ? 400 : 200 });
}

async function save(ctx) {
  const b = await ctx.body();
  if (b.action === 'adjust') {
    const pts = int(b.points);
    const cid = int(b.customer_id);
    const note = str(b.note, 150);
    if (!pts || !note) return ctx.fail(`${BASE}?phone=${encodeURIComponent(b.phone || '')}`, 'পয়েন্টের সংখ্যা আর কারণ দুটোই লিখুন।');
    if (Math.abs(pts) > 100000) return ctx.fail(`${BASE}?phone=${encodeURIComponent(b.phone || '')}`, 'এত বেশি পয়েন্ট একবারে বদলানো যাবে না।');
    await db.tx((t) => L.add(t, cid, pts, 'adjust', { note, staffId: ctx.user.id }));
    await ctx.log('customer_edit', 'customer', cid, `পয়েন্ট ${pts > 0 ? '+' : ''}${pts}: ${note}`);
    return ctx.redirect(ctx.res, `${BASE}?phone=${encodeURIComponent(b.phone || '')}&msg=saved`);
  }
  const v = {
    loyalty_on: b.loyalty_on ? '1' : '0',
    loyalty_earn_per: String(Math.max(1, Math.min(100000, int(b.loyalty_earn_per, 100)))),
    loyalty_point_value: String(Math.max(0.01, Math.min(1000, Number(b.loyalty_point_value) || 1))),
    loyalty_min_redeem: String(Math.max(1, Math.min(100000, int(b.loyalty_min_redeem, 50)))),
    loyalty_max_pct: String(Math.max(1, Math.min(100, int(b.loyalty_max_pct, 20)))),
  };
  await db.setMany(v);
  await ctx.log('settings', 'marketing', null, `লয়ালটি: ${v.loyalty_on === '1' ? 'চালু' : 'বন্ধ'}, ৳${v.loyalty_earn_per}=১ পয়েন্ট, ১ পয়েন্ট=৳${v.loyalty_point_value}, কমপক্ষে ${v.loyalty_min_redeem}, সর্বোচ্চ ${v.loyalty_max_pct}%`);
  return ctx.back(BASE, 'saved');
}

module.exports = { routes: [{ method: '*', path: BASE, perm: 'marketing', handler: (ctx) => page(ctx) }] };

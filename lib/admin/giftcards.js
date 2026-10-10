'use strict';
// Admin → মার্কেটিং → 💳 গিফট কার্ড ও 🎁 রেফারেল.
//   Gift cards: sell / give one here (code goes by SMS), check the shop's online requests (TrxID) and switch them on,
//   see every card's balance and history, switch a card off or change its balance.
//   Referral: switch on, what the new friend gets and what the sharer gets.
const { html, int, str, bn, money, fmtDate, ymd } = require('../util');
const db = require('../db');
const ui = require('./ui');
const G = require('../models/giftcards');
const finance = require('../models/finance');

const BASE = '/admin/giftcards';
const PILL = { pending: 'pill-warn', active: 'pill-ok', used: '', disabled: '', expired: '' };

async function listPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'gift_settings') {
      await db.setMany({ gift_on: b.gift_on ? '1' : '0', gift_sell_online: b.gift_sell_online ? '1' : '0', gift_amounts: String(b.gift_amounts || '').split(/[,\s]+/).map((x) => Math.round(Number(x))).filter((x) => x > 0).slice(0, 8).join(','),
        gift_min: String(Math.max(1, int(b.gift_min, 200))), gift_max: String(Math.max(1, int(b.gift_max, 20000))), gift_valid_days: String(Math.max(0, int(b.gift_valid_days, 365))), gift_sms: str(b.gift_sms, 300) });
      await ctx.log('settings', 'marketing', null, `গিফট কার্ড: ${b.gift_on ? 'চালু' : 'বন্ধ'}`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'ref_settings') {
      await db.setMany({ ref_on: b.ref_on ? '1' : '0', ref_friend_amount: String(Math.max(0, int(b.ref_friend_amount))), ref_friend_min: String(Math.max(0, int(b.ref_friend_min))),
        ref_reward_amount: String(Math.max(0, int(b.ref_reward_amount))), ref_reward_days: String(Math.max(0, int(b.ref_reward_days, 90))) });
      await ctx.log('settings', 'marketing', null, `রেফারেল: ${b.ref_on ? 'চালু' : 'বন্ধ'}, বন্ধু ৳${int(b.ref_friend_amount)}, পুরস্কার ৳${int(b.ref_reward_amount)}`);
      return ctx.back(BASE + '#referral', 'saved');
    }
    if (b.action === 'issue') {
      try {
        const card = await G.issue({ amount: b.amount, status: 'active', source: 'admin', buyerName: b.buyer_name, buyerPhone: b.buyer_phone, recipientName: b.recipient_name,
          recipientPhone: b.recipient_phone, message: b.message, validDays: b.valid_days, price: b.price === '' || b.price === undefined ? null : b.price, note: b.note, staffId: ctx.user.id });
        await ctx.log('giftcard_issue', 'giftcard', card.id, `${G.pretty(card.code)} ৳${card.initial}`);
        // money received for the card → income in the accounts (optional)
        if (int(b.account_id) && Number(card.price) > 0 && ctx.can('accounting')) {
          await finance.addTransaction({ type: 'income', category: 'গিফট কার্ড বিক্রি', amount: card.price, account_id: b.account_id, note: `গিফট কার্ড ${G.pretty(card.code)}` }, ctx.user.id);
        }
        let note = '';
        if (b.sms === '1' && card.recipient_phone) { const r = await G.sendCodeSms(ctx.settings, card); note = r.ok ? ' কোড SMS-এ পাঠানো হয়েছে।' : ` (SMS যায়নি: ${r.msg})`; }
        return ctx.redirect(ctx.res, `${BASE}/${card.id}?info=` + encodeURIComponent(`গিফট কার্ড তৈরি হয়েছে: ${G.pretty(card.code)}.${note}`));
      } catch (e) { if (!(e instanceof G.GiftError)) throw e; return ctx.fail(BASE, e.message); }
    }
    return ctx.back(BASE);
  }
  const status = G.STATUSES[ctx.query.get('status')] ? ctx.query.get('status') : '';
  const q = str(ctx.query.get('q'), 40);
  const [rows, st, accounts] = await Promise.all([G.list({ status, q }), G.stats(), ctx.can('accounting') ? finance.listAccounts() : []]);
  const R = G.refCfg(s);
  const refStats = await db.one(`SELECT count(*) FILTER (WHERE ref_by IS NOT NULL AND status<>'cancelled')::int AS orders, count(*) FILTER (WHERE ref_rewarded)::int AS rewarded,
    coalesce(sum(ref_discount) FILTER (WHERE status<>'cancelled'),0)::numeric(14,2) AS given FROM orders`);
  const body = html`<div class="title-row"><h1>💳 গিফট কার্ড ও 🎁 রেফারেল</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}">🔄 রিফ্রেশ</a>${s.gift_on === '1' ? html`<a class="btn btn-ghost btn-sm" href="/gift-card" target="_blank" rel="noopener">দোকানের পেজ ↗</a>` : ''}</div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('যাচাই বাকি', bn(st.pending), 'অনলাইনে কেনার অনুরোধ', st.pending ? 'kpi-alert' : '', `${BASE}?status=pending`)}
  ${ui.kpi('কার্ডে জমা টাকা', money(st.outstanding), 'কাস্টমার এখনো খরচ করেননি (আপনার দেনা)')}
  ${ui.kpi('মোট বিক্রি', money(st.sold), `${bn(st.n)}টি কার্ড`)}
  ${ui.kpi('রেফারেল', `${bn(refStats.orders)} অর্ডার`, `${bn(refStats.rewarded)}টি পুরস্কার · ছাড় ${money(refStats.given)}`)}
</div>
<div class="two-col">
  <section class="panel"><h2>➕ নতুন গিফট কার্ড দিন / বিক্রি করুন</h2>
    <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="issue">
      <div class="field-row">${ui.field('কার্ডে টাকা (৳)', ui.input('amount', '', { type: 'number', min: 1, required: true, class: 'w-num' }))}
        ${ui.field('কাস্টমার কত দিয়েছেন (৳)', ui.input('price', '', { type: 'number', min: 0, class: 'w-num' }), 'খালি = কার্ডের সমান; উপহার দিলে ০')}
        ${ui.field('মেয়াদ (দিন)', ui.input('valid_days', s.gift_valid_days || 365, { type: 'number', min: 0, class: 'w-num' }), '০ = মেয়াদ নেই')}</div>
      <div class="field-row">${ui.field('প্রাপকের নাম', ui.input('recipient_name', '', { maxlength: 80 }))}${ui.field('প্রাপকের মোবাইল', ui.input('recipient_phone', '', { maxlength: 20, inputmode: 'tel' }), 'কোড এখানে SMS-এ যাবে')}</div>
      <div class="field-row">${ui.field('ক্রেতার নাম', ui.input('buyer_name', '', { maxlength: 80 }))}${ui.field('ক্রেতার মোবাইল', ui.input('buyer_phone', '', { maxlength: 20, inputmode: 'tel' }))}</div>
      ${ui.field('শুভেচ্ছা বার্তা (SMS-এ যাবে)', ui.input('message', '', { maxlength: 120 }))}
      ${accounts.length ? ui.field('টাকা কোন অ্যাকাউন্টে এসেছে (হিসাবে আয় লেখা হবে)', ui.select('account_id', [['', '— লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, a.name])], '')) : ''}
      ${ui.field('ভেতরের নোট', ui.input('note', '', { maxlength: 200 }))}
      ${ui.check('sms', true, 'প্রাপককে কোড SMS করুন')}
      <button class="btn">গিফট কার্ড তৈরি করুন</button></form></section>
  <section class="panel"><h2>⚙️ গিফট কার্ড সেটিংস</h2>
    <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="gift_settings">
      ${ui.switchRow('gift_on', s.gift_on === '1', 'গিফট কার্ড চালু', 'চেকআউটে "গিফট কার্ড আছে?" ঘর, "আমার অ্যাকাউন্ট" এ গিফট কার্ড, আর ফুটারে লিংক।')}
      ${ui.switchRow('gift_sell_online', s.gift_sell_online !== '0', 'দোকানে অনলাইনে বিক্রি (/gift-card)', 'কাস্টমার Send Money করে TrxID দেন; আপনি এখানে যাচাই করে চালু করেন। (পেমেন্ট সেটিংসে Send Money নম্বর থাকতে হবে)')}
      ${ui.field('বাছাইয়ের পরিমাণ (কমা দিয়ে)', ui.input('gift_amounts', s.gift_amounts || '500,1000,2000,5000', { maxlength: 60 }))}
      <div class="field-row">${ui.field('সর্বনিম্ন ৳', ui.input('gift_min', s.gift_min || 200, { type: 'number', min: 1, class: 'w-num' }))}${ui.field('সর্বোচ্চ ৳', ui.input('gift_max', s.gift_max || 20000, { type: 'number', min: 1, class: 'w-num' }))}
        ${ui.field('মেয়াদ (দিন)', ui.input('gift_valid_days', s.gift_valid_days || 365, { type: 'number', min: 0, class: 'w-num' }))}</div>
      ${ui.field('কোডের SMS', ui.textarea('gift_sms', s.gift_sms || '{shop}: আপনার জন্য {amount} টাকার গিফট কার্ড{from}! কোড: {code}{expiry}। চেকআউটে কোডটা দিন।{message}', { rows: 3, maxlength: 300 }),
    html`<code>{code}</code> কোড (অবশ্যই রাখুন), <code>{amount}</code> টাকা, <code>{from}</code> কে পাঠিয়েছেন, <code>{expiry}</code> মেয়াদ, <code>{message}</code> বার্তা`)}
      <button class="btn btn-sm">সেভ করুন</button></form></section>
</div>
<section class="panel" id="referral"><h2>🎁 রেফারেল প্রোগ্রাম — বন্ধুকে আনলে দুজনেই ছাড়</h2>
  <p class="muted small">প্রতিটা কাস্টমার "আমার অ্যাকাউন্ট" এ নিজের কোড আর লিংক পান। নতুন কেউ সেই কোড (চেকআউটের কুপন ঘরে) বা লিংক দিয়ে প্রথম অর্ডার করলে ছাড় পান; সেই অর্ডার <b>ডেলিভারি হলে</b> কোডের মালিক একটা গিফট কার্ড পান (SMS-এ)। নিজের কোড নিজে, বা পুরোনো কাস্টমার ব্যবহার করতে পারেন না। (কাস্টমার অ্যাকাউন্ট চালু থাকলেই কোড দেখা যায়)</p>
  <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="ref_settings">
    ${ui.switchRow('ref_on', R.on, 'রেফারেল চালু', s.acct_on === '1' ? '' : '⚠️ কাস্টমার অ্যাকাউন্ট বন্ধ — চালু করলে তবেই কাস্টমাররা নিজের কোড দেখবেন।')}
    <div class="field-row">${ui.field('নতুন বন্ধু পাবেন (৳ ছাড়)', ui.input('ref_friend_amount', R.friendGets || 50, { type: 'number', min: 0, class: 'w-num' }))}
      ${ui.field('কমপক্ষে কত টাকার অর্ডারে (৳)', ui.input('ref_friend_min', R.friendMin || 300, { type: 'number', min: 0, class: 'w-num' }))}
      ${ui.field('কোডের মালিক পাবেন (৳ গিফট কার্ড)', ui.input('ref_reward_amount', R.youGet || 50, { type: 'number', min: 0, class: 'w-num' }))}
      ${ui.field('পুরস্কারের মেয়াদ (দিন)', ui.input('ref_reward_days', R.validDays || 90, { type: 'number', min: 0, class: 'w-num' }))}</div>
    <button class="btn btn-sm">সেভ করুন</button></form>
</section>
<section class="panel table-wrap"><h2>সব গিফট কার্ড</h2>
  <div class="chips"><a class="chip ${!status ? 'on' : ''}" href="${BASE}">সব</a>${Object.entries(G.STATUSES).map(([k, l]) => html`<a class="chip ${status === k ? 'on' : ''}" href="${BASE}?status=${k}">${l}</a>`)}</div>
  <form method="get" action="${BASE}" class="filters"><input type="search" name="q" value="${q}" placeholder="কোড, মোবাইল বা নাম"><button class="btn btn-sm">খুঁজুন</button></form>
  ${rows.length ? html`<table class="table compact"><thead><tr><th>কোড</th><th>কার জন্য</th><th class="num">টাকা</th><th class="num">বাকি</th><th>কোথা থেকে</th><th>অবস্থা</th><th>মেয়াদ</th><th></th></tr></thead><tbody>
  ${rows.map((c) => html`<tr><td><a href="${BASE}/${c.id}" class="mono"><b>${G.pretty(c.code)}</b></a><br><span class="small muted">${fmtDate(c.created_at)}</span></td>
    <td>${c.recipient_name || '—'}<br><span class="small mono">${c.recipient_phone}</span></td><td class="num">${money(c.initial)}</td><td class="num"><b>${money(c.balance)}</b></td>
    <td class="small">${c.source === 'shop' ? `অনলাইন (TrxID ${c.trx_id})` : c.source === 'referral' ? 'রেফারেলের পুরস্কার' : `অ্যাডমিন${c.staff_name ? ` — ${c.staff_name}` : ''}`}</td>
    <td>${ui.pill(G.STATUSES[c.status], PILL[c.status] || '')}</td><td class="small">${c.expires_on ? String(c.expires_on).slice(0, 10) : '—'}</td>
    <td><a class="btn btn-sm btn-ghost" href="${BASE}/${c.id}">খুলুন</a></td></tr>`)}</tbody></table>` : html`<p class="muted">কোনো গিফট কার্ড নেই।</p>`}
</section>`;
  return ctx.page('গিফট কার্ড ও রেফারেল', body, 'giftcards');
}

async function detail(ctx, m) {
  const id = int(m[1]);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'activate' || b.action === 'disable' || b.action === 'enable') {
        const c = await G.setStatus(id, b.action === 'disable' ? 'disabled' : 'active', ctx.user.id, b.action === 'activate' ? 'পেমেন্ট যাচাই করে চালু' : '');
        await ctx.log('giftcard_status', 'giftcard', id, `${G.pretty(c.code)}: ${G.STATUSES[c.status]}`);
        let note = '';
        if (b.action === 'activate') {
          if (int(b.account_id) && ctx.can('accounting') && Number(c.price) > 0) {
            await finance.addTransaction({ type: 'income', category: 'গিফট কার্ড বিক্রি', amount: c.price, account_id: b.account_id, note: `গিফট কার্ড ${G.pretty(c.code)} (TrxID ${c.trx_id})` }, ctx.user.id);
          }
          const r = await G.sendCodeSms(ctx.settings, c);
          note = r.ok ? ' কোড প্রাপককে SMS-এ পাঠানো হয়েছে।' : ` (SMS যায়নি: ${r.msg} — কোডটা নিজে জানিয়ে দিন)`;
        }
        return ctx.redirect(ctx.res, `${back}?info=` + encodeURIComponent('সেভ হয়েছে।' + note));
      }
      if (b.action === 'adjust') {
        const bal = await G.adjust(id, Number(b.change), b.note, ctx.user.id);
        await ctx.log('giftcard_adjust', 'giftcard', id, `ব্যালেন্স বদল ${b.change} → ${bal}`);
        return ctx.back(back, 'saved');
      }
      if (b.action === 'sms') {
        const c = await G.get(id);
        const r = await G.sendCodeSms(ctx.settings, c);
        return ctx.redirect(ctx.res, `${back}?info=` + encodeURIComponent(r.ok ? 'SMS পাঠানো হয়েছে।' : `SMS যায়নি: ${r.msg}`));
      }
      if (b.action === 'expiry') {
        await db.q('UPDATE gift_cards SET expires_on=$1 WHERE id=$2', [/^\d{4}-\d{2}-\d{2}$/.test(b.expires_on || '') ? b.expires_on : null, id]);
        return ctx.back(back, 'saved');
      }
    } catch (e) { if (!(e instanceof G.GiftError)) throw e; return ctx.fail(back, e.message); }
    return ctx.back(back);
  }
  const c = await G.get(id);
  if (!c) return ctx.redirect(ctx.res, BASE);
  const [led, accounts] = await Promise.all([G.ledger(id), ctx.can('accounting') ? finance.listAccounts() : []]);
  const expired = c.expires_on && String(c.expires_on).slice(0, 10) < ymd();
  const body = html`<p class="crumbs"><a href="${BASE}">← সব গিফট কার্ড</a></p>
<div class="title-row"><h1 class="mono">${G.pretty(c.code)} ${ui.pill(expired ? 'মেয়াদ শেষ' : G.STATUSES[c.status], PILL[c.status] || '')}</h1></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">${ui.kpi('বাকি', money(c.balance), `শুরুতে ${money(c.initial)}`, 'kpi-blue')}${ui.kpi('মেয়াদ', c.expires_on ? String(c.expires_on).slice(0, 10) : 'নেই', '')}${ui.kpi('দাম পেয়েছেন', money(c.price), c.pay_method ? `${c.pay_method} · ${c.pay_number}` : '')}</div>
<div class="two-col">
  <section class="panel"><h2>তথ্য</h2>
    <p><b>প্রাপক:</b> ${c.recipient_name || '—'} <span class="mono">${c.recipient_phone}</span><br><b>ক্রেতা:</b> ${c.buyer_name || '—'} <span class="mono">${c.buyer_phone}</span>
    ${c.message ? html`<br><b>বার্তা:</b> ${c.message}` : ''}${c.trx_id ? html`<br><b>TrxID:</b> <span class="mono">${c.trx_id}</span>` : ''}${c.note ? html`<br><b>নোট:</b> ${c.note}` : ''}</p>
    ${c.status === 'pending' ? html`<form method="post" action="${back}" class="form panel-inner"><input type="hidden" name="action" value="activate">
      <p class="note">বিকাশ/নগদে <b>${money(c.price)}</b> এসেছে কিনা দেখুন (TrxID <b class="mono">${c.trx_id}</b>, নম্বর ${c.pay_number})। মিললে চালু করুন — প্রাপক SMS-এ কোড পাবেন।</p>
      ${accounts.length ? ui.field('টাকা কোন অ্যাকাউন্টে এসেছে', ui.select('account_id', [['', '— হিসাবে লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, a.name])], '')) : ''}
      <button class="btn">✅ টাকা পেয়েছি — চালু করুন</button></form>` : ''}
    <div class="row-actions mt">
      ${c.status === 'active' ? html`<form method="post" action="${back}" data-confirm="কার্ডটা বন্ধ করবেন? আর ব্যবহার করা যাবে না।"><input type="hidden" name="action" value="disable"><button class="btn btn-sm btn-danger">⛔ বন্ধ করুন</button></form>` : ''}
      ${c.status === 'disabled' ? html`<form method="post" action="${back}"><input type="hidden" name="action" value="enable"><button class="btn btn-sm">আবার চালু</button></form>` : ''}
      ${c.recipient_phone && c.status === 'active' ? html`<form method="post" action="${back}"><input type="hidden" name="action" value="sms"><button class="btn btn-sm btn-ghost">📨 কোড আবার SMS করুন</button></form>` : ''}
    </div>
    <form method="post" action="${back}" class="form mt"><input type="hidden" name="action" value="adjust">
      <div class="field-row">${ui.field('ব্যালেন্স বাড়ান/কমান (৳, কমাতে − দিন)', ui.input('change', '', { type: 'number', step: '0.01', required: true, class: 'w-num' }))}${ui.field('কারণ', ui.input('note', '', { maxlength: 200 }))}</div>
      <button class="btn btn-sm btn-ghost">সেভ করুন</button></form>
    <form method="post" action="${back}" class="form mt"><input type="hidden" name="action" value="expiry">
      ${ui.field('মেয়াদ বদলান', ui.input('expires_on', c.expires_on ? String(c.expires_on).slice(0, 10) : '', { type: 'date' }), 'খালি = মেয়াদ নেই')}<button class="btn btn-sm btn-ghost">সেভ করুন</button></form>
  </section>
  <section class="panel table-wrap"><h2>হিসাব (কোথায় কত খরচ)</h2>
    <table class="table compact"><thead><tr><th>সময়</th><th>কী</th><th class="num">টাকা</th><th class="num">বাকি</th></tr></thead><tbody>
    ${led.map((l) => html`<tr><td class="small nowrap">${fmtDate(l.created_at)}</td><td class="small">${l.note}${l.order_code ? html` · <a href="/admin/orders/${l.order_id}">${l.order_code}</a>` : ''}${l.staff_name ? ` · ${l.staff_name}` : ''}</td>
      <td class="num ${Number(l.amount) < 0 ? 'warn' : 'good'}">${Number(l.amount) ? money(l.amount) : '—'}</td><td class="num">${money(l.balance)}</td></tr>`)}</tbody></table>
  </section>
</div>`;
  return ctx.page(`গিফট কার্ড ${G.pretty(c.code)}`, body, 'giftcards');
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'marketing', handler: listPage },
    { method: '*', path: /^\/admin\/giftcards\/(\d+)$/, perm: 'marketing', handler: detail },
  ],
};

'use strict';
// Admin → অর্ডার ও কাস্টমার → 🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ): switch it on/off, the SMS text, how long a checked number is
// remembered, what happens when SMS can't go, the daily limit — and what happened lately (codes, orders by how they were checked).
const { html, str, int, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const CO = require('../models/checkoutotp');

const BASE = '/admin/checkout-otp';

async function page(ctx) {
  const s = ctx.settings;
  const SMS = require('../services/sms');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.co_otp_on && !SMS.ready(s).ok) return ctx.fail(BASE, `আগে SMS চালু করুন (মার্কেটিং → কাস্টমারকে SMS) — কোড SMS-এ যায়। এখন: ${SMS.ready(s).why}।`);
    let tpl = str(b.co_otp_sms, 200).trim();
    if (tpl && !tpl.includes('{code}')) return ctx.fail(BASE, 'SMS-এর লেখায় {code} অবশ্যই রাখুন — ওখানেই কোডটা বসে।');
    if (tpl === CO.DEF_SMS) tpl = '';
    await db.setMany({
      co_otp_on: b.co_otp_on ? '1' : '0', co_otp_sms: tpl,
      co_otp_remember_days: String(Math.max(0, Math.min(365, int(b.co_otp_remember_days)))),
      co_otp_failopen: b.co_otp_failopen ? '1' : '0',
      co_otp_daily_cap: String(Math.max(0, Math.min(100000, int(b.co_otp_daily_cap)))),
      co_otp_webotp: b.co_otp_webotp ? '1' : '0',
    });
    await ctx.log('settings', 'settings', null, `চেকআউট OTP: ${b.co_otp_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const [st, recent] = await Promise.all([CO.stats(), CO.recent(30)]);
  const smsOk = SMS.ready(s).ok;
  const on = s.co_otp_on === '1';
  const o30 = st.orders30 || {};
  const checked30 = (o30.otp || 0) + (o30.remembered || 0) + (o30.account || 0);
  const tpl = s.co_otp_sms || CO.DEF_SMS;
  const sample = tpl.replace(/\{shop\}/g, s.store_name || '').replace(/\{code\}/g, '4827').replace(/\{min\}/g, bn(CO.CODE_MIN));
  const body = html`<h1>🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ)</h1>${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', on ? (smsOk ? '✅ চালু' : '⚠️ SMS বন্ধ') : '⚪ বন্ধ', on ? (smsOk ? 'চেকআউটে কোড চাওয়া হচ্ছে' : 'SMS চালু না থাকায় কোড ছাড়াই অর্ডার নেওয়া হচ্ছে') : '')}
  ${ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(st.sent24), `সঠিক দিয়েছেন ${bn(st.ok24)} জন${st.fail24 ? ` · SMS যায়নি ${bn(st.fail24)}` : ''}`)}
  ${ui.kpi('৩০ দিনে যাচাই হওয়া অর্ডার', bn(checked30), `OTP ছাড়া (SMS যায়নি): ${bn(o30.skipped || 0)}`)}
  ${ui.kpi('কোড নিয়েও অর্ডার করেননি', bn(st.never30), 'গত ৩০ দিনে — এদের অনেকেই ফেক / অন্যের নম্বর')}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>চেকআউটে কাস্টমার মোবাইল নম্বর লিখলে নিচে একটা ঘর আর <b>"OTP পাঠান"</b> বাটন আসে। চাপলে ঐ নম্বরে SMS-এ ৪ অঙ্কের কোড যায় (${bn(CO.CODE_MIN)} মিনিট কাজ করে)।</li>
  <li>কোডটা লিখলেই নিজে থেকে যাচাই হয়ে সবুজ <b>"✅ নম্বর যাচাই হয়েছে"</b> দেখায়, তারপর অর্ডার কনফার্ম হয়। কোড ছাড়া অর্ডার যায় না — তাই অন্যের নম্বর দিয়ে ফেক অর্ডার করা যায় না।</li>
  <li>কাস্টমার না বুঝে সরাসরি "অর্ডার কনফার্ম করুন" চাপলেও কোড নিজে থেকে চলে যায়; কোড লিখলেই অর্ডার চলে যায় — আবার বাটন চাপতে হয় না।</li>
  <li>কাস্টমার হারাবেন না: একবার যাচাই করা নম্বরে ঐ ব্রাউজারে আর কোড লাগে না (নিচে দিন ঠিক করুন), লগইন করা কাস্টমারের নিজের নম্বরে লাগে না, ৬০ সেকেন্ড পর "আবার পাঠান" করা যায়, SMS না এলে আপনার ফোন নম্বর দেখায়।</li>
  <li>SMS কোম্পানির সমস্যা / ব্যালান্স শেষ / দৈনিক সীমা পার হলে — নিচের সুইচ চালু থাকলে অর্ডার তবুও নেওয়া হয়, অর্ডারে <b>"⚠️ OTP ছাড়া"</b> লেখা থাকে যাতে আগে কল করে নেন।</li>
  <li>অপব্যবহার রোধ (প্রতিটা কোড = ১টা SMS খরচ): এক নম্বরে ১০ মিনিটে ৩টা ও দিনে ৬টা কোড, এক সংযোগ থেকে ঘণ্টায় ৮টা, একটা কোডে ৫ বারের বেশি ভুল নয়, ব্লক লিস্টের নম্বরে কোড যায় না।</li>
  <li>প্রতিটা অর্ডারে দেখবেন কীভাবে নম্বর যাচাই হয়েছে: ✅ OTP যাচাই / ✅ আগে যাচাই / ✅ লগইন / ⚠️ OTP ছাড়া।</li>
</ol>`)}
<section class="panel">
  <form method="post" action="${BASE}" class="form">
    ${!smsOk ? html`<p class="flash flash-error">SMS চালু নেই — OTP চালু করার আগে <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> পেজে SMS কোম্পানি (যেমন BulkSMSBD) সেটআপ করুন ও টেস্ট SMS পাঠিয়ে দেখুন।</p>` : ''}
    ${ui.switchRow('co_otp_on', on, 'চেকআউটে OTP চালু', 'চালু করলে মোবাইল নম্বর OTP দিয়ে যাচাই না করে ওয়েবসাইট থেকে অর্ডার করা যাবে না। বন্ধ করলে আগের মতো সরাসরি অর্ডার হবে।')}
    ${ui.switchRow('co_otp_failopen', s.co_otp_failopen !== '0', 'SMS না গেলেও অর্ডার নিন (সাজেস্টেড)', 'SMS কোম্পানির সমস্যা, ব্যালান্স শেষ বা দৈনিক সীমা পার হলে কাস্টমার কোড ছাড়াই অর্ডার করতে পারবেন — অর্ডারে "⚠️ OTP ছাড়া" লেখা থাকবে। বন্ধ করলে তখন কাস্টমারকে কল করে অর্ডার দিতে বলা হবে (কাস্টমার হারানোর ঝুঁকি)।')}
    ${ui.field('একবার যাচাই হলে আর কতদিন কোড লাগবে না (ঐ ব্রাউজারে)', ui.select('co_otp_remember_days', [['0', 'প্রতিবার কোড লাগবে'], ['7', '৭ দিন'], ['30', '৩০ দিন (সাজেস্টেড)'], ['90', '৯০ দিন'], ['180', '১৮০ দিন']], s.co_otp_remember_days || '30'),
      'একই কাস্টমার বারবার অর্ডার করলে প্রতিবার SMS খরচ হবে না, কাস্টমারেরও ঝামেলা কম। অন্য ফোন / ব্রাউজার থেকে করলে আবার কোড লাগবে।')}
    ${ui.field('দিনে সর্বোচ্চ কতটা কোড যাবে (পুরো দোকানে)', ui.input('co_otp_daily_cap', s.co_otp_daily_cap || '500', { type: 'number', min: 0, max: 100000 }),
      'কেউ ইচ্ছা করে অনেক নম্বরে কোড চাইলে আপনার SMS ব্যালান্স শেষ হবে না। সীমা পার হলে উপরের সুইচ অনুযায়ী চলবে। ০ = কোনো সীমা নেই।')}
    ${ui.field('কোডের SMS', ui.textarea('co_otp_sms', tpl, { rows: 2, maxlength: 200 }),
      html`<code>{shop}</code> দোকানের নাম, <code>{code}</code> কোড (অবশ্যই রাখুন), <code>{min}</code> কত মিনিট কাজ করবে। উদাহরণ: "${sample}" — ${bn(sample.length)} অক্ষর ≈ ${bn(SMS.parts(sample))}টি SMS। বাংলা SMS ৭০ অক্ষরে ১টা; ছোট রাখলে খরচ কম।`)}
    ${ui.switchRow('co_otp_webotp', s.co_otp_webotp === '1', 'অ্যান্ড্রয়েডে কোড নিজে থেকে বসবে', 'SMS-এর শেষে "@আপনার-ডোমেইন #কোড" লাইন যোগ হয় — Android-এর Chrome তখন কোডটা নিজেই ঘরে বসিয়ে দেয়। শুধু আসল ডোমেইনে (shobmilbe.com) কাজ করে; SMS একটু লম্বা হয়ে ২টা SMS হতে পারে।')}
    <button class="btn">সেভ করুন</button>
  </form>
</section>
<section class="panel table-wrap"><h2>সর্বশেষ কোড</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>মোবাইল</th><th>অবস্থা</th><th class="num">ভুল চেষ্টা</th><th>সময়</th></tr></thead><tbody>
  ${recent.map((r) => html`<tr><td class="mono small"><a href="/admin/customers?q=${r.phone}">${r.phone}</a></td>
    <td>${r.verified_at ? html`<span class="pill pill-ok">✅ সঠিক কোড দিয়েছেন</span>` : !r.sent_ok ? html`<span class="pill pill-warn">⚠️ SMS যায়নি</span>` : html`<span class="pill">⏳ কোড দেননি</span>`}</td>
    <td class="num">${bn(r.tries)}</td><td class="small">${fmtDate(r.created_at)}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কোনো কোড পাঠানো হয়নি।</p>`}
  <p class="small muted">প্রতিটা SMS-এর বিস্তারিত (কোম্পানির উত্তর) দেখতে: <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> → SMS লগ।</p>
</section>`;
  return ctx.page('চেকআউট OTP', body, 'checkout-otp');
}

module.exports = { routes: [{ method: '*', path: BASE, perm: 'settings', handler: page }] };

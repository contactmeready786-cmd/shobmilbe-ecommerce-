'use strict';
// Admin → অর্ডার ও কাস্টমার → 👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন): switch customer login on/off, the SMS text,
// and who logged in lately. Customers log in with their mobile number and a 6-digit SMS code (no password).
const { html, str, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');

const BASE = '/admin/customer-accounts';

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const SMS = require('../services/sms');
    if (b.acct_on && !SMS.ready(s).ok) return ctx.fail(BASE, `আগে SMS চালু করুন (মার্কেটিং → কাস্টমারকে SMS) — লগইনের কোড SMS-এ যায়। এখন: ${SMS.ready(s).why}।`);
    await db.setMany({ acct_on: b.acct_on ? '1' : '0', nav_account: b.nav_account ? '1' : '0', acct_otp_sms: str(b.acct_otp_sms, 200) });
    await ctx.log('settings', 'settings', null, `কাস্টমার অ্যাকাউন্ট: ${b.acct_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const [stats, recent] = await Promise.all([
    db.one(`SELECT count(*) FILTER (WHERE last_login IS NOT NULL)::int AS users, count(*) FILTER (WHERE last_login > now() - interval '30 days')::int AS active30,
      (SELECT count(*)::int FROM customer_addresses) AS addresses, (SELECT count(*)::int FROM customer_otps WHERE created_at > now() - interval '1 day') AS codes24 FROM customers`),
    db.q(`SELECT id, name, phone, last_login, (SELECT count(*)::int FROM orders o WHERE o.phone=c.phone) AS orders FROM customers c WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 30`),
  ]);
  const smsOk = require('../services/sms').ready(s).ok;
  const def = '{shop}: আপনার লগইন কোড {code}। {min} মিনিট কাজ করবে। কাউকে বলবেন না।';
  const body = html`<h1>👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন)</h1>${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', s.acct_on === '1' ? '✅ চালু' : '⚪ বন্ধ', s.acct_on === '1' ? 'দোকানের উপরে 👤 বাটন আছে' : '')}
  ${ui.kpi('লগইন করেছেন', bn(stats.users), `গত ৩০ দিনে ${bn(stats.active30)} জন`)}
  ${ui.kpi('সেভ করা ঠিকানা', bn(stats.addresses), '')}
  ${ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(stats.codes24), 'প্রতিটা কোড = ১টা SMS')}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>কাস্টমার দোকানের উপরের 👤 বাটনে চাপ দিয়ে মোবাইল নম্বর দেন — SMS-এ ৬ অঙ্কের কোড যায় (৫ মিনিট কাজ করে)। পাসওয়ার্ড লাগে না।</li>
  <li>লগইন করলে: নিজের সব অর্ডার, "🔁 আবার অর্ডার", সেভ করা ঠিকানা (চেকআউটে নিজে থেকে বসে), রিটার্ন আবেদন, রেফারেল কোড আর গিফট কার্ড।</li>
  <li>লগইন ছাড়াও আগের মতো অর্ডার করা যায় — কাউকে বাধ্য করা হয় না।</li>
  <li>নিরাপত্তা: এক নম্বরে ১০ মিনিটে ৩টা আর দিনে ৮টার বেশি কোড যায় না, ভুল কোড ৫ বারের বেশি দেওয়া যায় না, ব্লক লিস্টের নম্বরে লগইন হয় না।</li>
</ol>`)}
<section class="panel">
  <form method="post" action="${BASE}" class="form">
    ${!smsOk ? html`<p class="flash flash-error">SMS চালু নেই — অ্যাকাউন্ট চালু করার আগে <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> পেজে SMS কোম্পানি সেটআপ করুন।</p>` : ''}
    ${ui.switchRow('acct_on', s.acct_on === '1', 'কাস্টমার অ্যাকাউন্ট চালু', 'বন্ধ করলে লগইন, "আমার অ্যাকাউন্ট" পেজ আর উপরের 👤 বাটন থাকবে না। আগের সেভ করা ঠিকানা মুছবে না।')}
    ${ui.switchRow('nav_account', s.nav_account !== '0', 'হেডারে 👤 অ্যাকাউন্ট বাটন', 'বন্ধ করলে বাটনটা উপরে দেখাবে না (মোবাইলের মেনু আর ফুটারে লিংক থাকবে)।')}
    ${ui.field('লগইন কোডের SMS', ui.textarea('acct_otp_sms', s.acct_otp_sms || def, { rows: 2, maxlength: 200 }), html`<code>{shop}</code> দোকানের নাম, <code>{code}</code> কোড (অবশ্যই রাখুন), <code>{min}</code> কত মিনিট কাজ করবে।`)}
    <button class="btn">সেভ করুন</button>
  </form>
</section>
<section class="panel table-wrap"><h2>সম্প্রতি লগইন করেছেন</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>কাস্টমার</th><th>মোবাইল</th><th class="num">অর্ডার</th><th>শেষ লগইন</th></tr></thead><tbody>
  ${recent.map((c) => html`<tr><td><a href="/admin/customers/${c.id}">${c.name || '(নাম দেননি)'}</a></td><td class="mono small">${c.phone}</td><td class="num">${bn(c.orders)}</td><td class="small">${fmtDate(c.last_login)}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কেউ লগইন করেননি।</p>`}
</section>`;
  return ctx.page('কাস্টমার অ্যাকাউন্ট', body, 'cust-accounts');
}

module.exports = { routes: [{ method: '*', path: BASE, perm: 'settings', handler: page }] };

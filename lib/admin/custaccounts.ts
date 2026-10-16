// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → অর্ডার ও কাস্টমার → 👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন): switch customer login on/off, the SMS text,
// and who logged in lately. Customers open an account with 📧 e-mail (code by the shop's Gmail, free) or
// 📱 mobile (code by SMS) — once; logged in, they order without any more codes.
import { html, str, bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as $services_sms from '../services/sms';
import * as $services_notify from '../services/notify';

const BASE = '/admin/customer-accounts';

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.mail_form) return ctx.back(BASE); // the separate Gmail form is gone: the shop's one Gmail is set on আমার নোটিফিকেশন
    const SMS = $services_sms;
    const mailOk = $services_notify.acctEmailConfig(s).ready;
    if (b.acct_on && !SMS.ready(s).ok && !mailOk) return ctx.fail(BASE, `আগে অন্তত একটা চালু করুন: ইমেইল (নোটিফিকেশন পেজে Gmail App Password) অথবা SMS (মার্কেটিং → কাস্টমারকে SMS)। এখন SMS: ${SMS.ready(s).why}।`);
    await db.setMany({ acct_on: b.acct_on ? '1' : '0', nav_account: b.nav_account ? '1' : '0', acct_otp_sms: str(b.acct_otp_sms, 200) });
    await ctx.log('settings', 'settings', null, `কাস্টমার অ্যাকাউন্ট: ${b.acct_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const [stats, recent] = await Promise.all([
    db.one(`SELECT count(*) FILTER (WHERE last_login IS NOT NULL)::int AS users, count(*) FILTER (WHERE last_login > now() - interval '30 days')::int AS active30,
      count(*) FILTER (WHERE email_verified AND phone IS NULL)::int AS email_users,
      (SELECT count(*)::int FROM customer_addresses) AS addresses, (SELECT count(*)::int FROM customer_otps WHERE created_at > now() - interval '1 day') AS codes24,
      (SELECT count(*)::int FROM customer_email_otps WHERE created_at > now() - interval '1 day') AS ecodes24 FROM customers`),
    db.q(`SELECT id, name, phone, email, email_verified, contact_phone, last_login,
      (SELECT count(*)::int FROM orders o WHERE (o.phone=c.phone AND c.phone IS NOT NULL) OR o.account_id=c.id) AS orders FROM customers c WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 30`),
  ]);
  const smsOk = $services_sms.ready(s).ok;
  const N = $services_notify;
  const mc = N.acctEmailConfig(s);
  const mailOk = mc.ready;
  const def = '{shop}: আপনার লগইন কোড {code}। {min} মিনিট কাজ করবে। কাউকে বলবেন না।';
  const body = html`<h1>👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন)</h1>${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', s.acct_on === '1' ? '✅ চালু' : '⚪ বন্ধ', s.acct_on === '1' ? 'দোকানের উপরে 👤 বাটন আছে' : '')}
  ${ui.kpi('লগইন করেছেন', bn(stats.users), `গত ৩০ দিনে ${bn(stats.active30)} জন · ইমেইলে ${bn(stats.email_users)} জন`)}
  ${ui.kpi('সেভ করা ঠিকানা', bn(stats.addresses), '')}
  ${ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(stats.codes24 + stats.ecodes24), `📱 SMS ${bn(stats.codes24)} · 📧 ইমেইল ${bn(stats.ecodes24)} (ফ্রি)`)}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>কাস্টমার 👤 বাটনে চাপ দিলে উপরে দুইটা ট্যাব: <b>📧 ইমেইল</b> আর <b>📱 মোবাইল নম্বর</b>।</li>
  <li><b>📧 ইমেইল:</b> নতুন অ্যাকাউন্টে ইমেইল + পাসওয়ার্ড দেয় → ইমেইলে ৬ অঙ্কের কোড যায় (শুধু একবার) → কোড মিললেই অ্যাকাউন্ট তৈরি। পরে যেকোনো ফোন/কম্পিউটার থেকে ইমেইল আর পাসওয়ার্ড দিয়ে ঢোকে, কোড লাগে না। পাসওয়ার্ড ভুলে গেলে "পাসওয়ার্ড ভুলে গেছেন?" চাপলে ইমেইলে কোড যায়।</li>
  <li><b>📱 মোবাইল:</b> নম্বর দেয় → SMS-এ কোড → ঢুকে যায়। পাসওয়ার্ড লাগে না, ওই ফোনে লগইন থেকে যায়।</li>
  <li>নতুন অ্যাকাউন্ট আগে নাম দেয় (ইমেইল অ্যাকাউন্ট ডেলিভারির মোবাইল নম্বরও), তারপর অর্ডার করতে পারে।</li>
  <li><b>কোড শুধু একবার:</b> লগইন করা কাস্টমারের অর্ডারে চেকআউট OTP আর লাগে না। লগইন ছাড়া (গেস্ট) অর্ডারে প্রতিবার চেকআউট OTP লাগে (চেকআউট OTP চালু থাকলে)।</li>
  <li>ইমেইলের কোড যায় আপনার Gmail থেকে — ফ্রি (দিনে সর্বোচ্চ ৪০০টা)। মোবাইলের কোড যায় SMS-এ।</li>
  <li>অর্ডারে লেবেল দেখবেন: "✅ লগইন" (মোবাইল যাচাই করা), "📧 ইমেইল অ্যাকাউন্ট" (মোবাইল নম্বর SMS দিয়ে যাচাই হয়নি — সন্দেহ হলে কল দিয়ে নিশ্চিত হন)।</li>
  <li>নিরাপত্তা: এক নম্বর/ইমেইলে ১০ মিনিটে ৩টা আর দিনে ৮টার বেশি কোড যায় না, ভুল কোড ৫ বারের বেশি দেওয়া যায় না।</li>
</ol>`)}
<section class="panel">
  <form method="post" action="${BASE}" class="form">
    <p class="small">📧 ইমেইল ট্যাব: ${mailOk ? html`✅ চালু (কোড যাচ্ছে দোকানের Gmail ${N.maskEmail(mc.user)} থেকে)` : html`⚪ বন্ধ — <a href="/admin/notify">আমার নোটিফিকেশন</a> পেজে দোকানের Gmail সেটআপ করুন`}
      · 📱 মোবাইল ট্যাব: ${smsOk ? '✅ চালু (SMS কাজ করছে)' : html`⚪ বন্ধ — <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> সেটআপ করলে চালু হবে`}</p>
    ${!smsOk && !mailOk ? html`<p class="flash flash-error">ইমেইল বা SMS — অন্তত একটা সেটআপ না করলে অ্যাকাউন্ট খোলা যাবে না।</p>` : ''}
    ${ui.switchRow('acct_on', s.acct_on === '1', 'কাস্টমার অ্যাকাউন্ট চালু', 'বন্ধ করলে লগইন, "আমার অ্যাকাউন্ট" পেজ আর উপরের 👤 বাটন থাকবে না। আগের সেভ করা ঠিকানা মুছবে না।')}
    ${ui.switchRow('nav_account', s.nav_account !== '0', 'হেডারে 👤 অ্যাকাউন্ট বাটন', 'বন্ধ করলে বাটনটা উপরে দেখাবে না (মোবাইলের মেনু আর ফুটারে লিংক থাকবে)।')}
    ${ui.field('লগইন কোডের SMS', ui.textarea('acct_otp_sms', s.acct_otp_sms || def, { rows: 2, maxlength: 200 }), html`<code>{shop}</code> দোকানের নাম, <code>{code}</code> কোড (অবশ্যই রাখুন), <code>{min}</code> কত মিনিট কাজ করবে।`)}
    <button class="btn">সেভ করুন</button>
  </form>
</section>
<section class="panel">
  <h2>📧 কাস্টমারের কোড যে Gmail থেকে যায় ${mailOk ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('সেটআপ বাকি', 'pill-pending')}</h2>
  <p class="small">দোকানের একটাই Gmail — অর্ডারের খবর, কাস্টমারের সাইন-আপ কোড আর মোছার কোড, তিনটাই ওটা থেকে যায়। Gmail আর Google-এর ১৬ অক্ষরের কোড বসানো বা বদলানো হয় শুধু এক জায়গায়: <a href="/admin/notify"><b>সেটিংস → আমার নোটিফিকেশন</b></a>।</p>
</section>
<section class="panel table-wrap"><h2>সম্প্রতি লগইন করেছেন</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>কাস্টমার</th><th>মোবাইল</th><th class="num">অর্ডার</th><th>শেষ লগইন</th></tr></thead><tbody>
  ${recent.map((c) => html`<tr><td><a href="/admin/customers/${c.id}">${c.name || '(নাম দেননি)'}</a>${c.email_verified && !c.phone ? html`<br><span class="small muted">📧 ${c.email}</span>` : ''}</td><td class="mono small">${c.phone || c.contact_phone || '—'}</td><td class="num">${bn(c.orders)}</td><td class="small">${fmtDate(c.last_login)}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কেউ লগইন করেননি।</p>`}
</section>`;
  return ctx.page('কাস্টমার অ্যাকাউন্ট', body, 'cust-accounts');
}

export const routes = [{ method: '*', path: BASE, perm: 'settings', handler: page }];

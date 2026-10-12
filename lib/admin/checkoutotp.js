'use strict';
// Admin → অর্ডার ও কাস্টমার → 🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ): switch it on/off, the SMS text, how long a checked number is
// remembered, what happens when SMS can't go, the daily limit — and what happened lately (codes, orders by how they were checked).
const { html, raw, str, int, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const CO = require('../models/checkoutotp');

const BASE = '/admin/checkout-otp';

// the "firebaseConfig = { apiKey: "…", … }" block copied from Firebase → Project settings → Your apps
function parseFbConfig(text) {
  const t = String(text || '');
  const get = (k) => { const m = new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']{1,200})["']`).exec(t); return m ? m[1].trim() : ''; };
  return { apiKey: get('apiKey'), authDomain: get('authDomain'), projectId: get('projectId'), appId: get('appId') };
}
const clean = (v) => str(v, 200).trim().replace(/[^\w.:\-]/g, '');

async function page(ctx) {
  const s = ctx.settings;
  const SMS = require('../services/sms');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    let tpl = str(b.co_otp_sms, 200).trim();
    if (tpl && !tpl.includes('{code}')) return ctx.fail(BASE, 'SMS-এর লেখায় {code} অবশ্যই রাখুন — ওখানেই কোডটা বসে।');
    if (tpl === CO.DEF_SMS) tpl = '';
    const pasted = parseFbConfig(b.fb_paste);
    const fb = {
      fb_api_key: clean(pasted.apiKey || b.fb_api_key), fb_auth_domain: clean(pasted.authDomain || b.fb_auth_domain),
      fb_project_id: clean(pasted.projectId || b.fb_project_id), fb_app_id: clean(pasted.appId || b.fb_app_id),
    };
    if (String(b.fb_paste || '').trim() && !pasted.apiKey) return ctx.fail(BASE, 'পেস্ট করা লেখায় apiKey পাওয়া যায়নি — Firebase থেকে পুরো firebaseConfig অংশটা কপি করুন।');
    const viaFb = b.co_otp_via === 'firebase';
    if (viaFb && b.co_otp_on && !CO.fbReady(fb).ok) return ctx.fail(BASE, `Firebase দিয়ে OTP চালু করতে আগে Firebase-এর তথ্য দিন (${CO.fbReady(fb).why})।`);
    await db.setMany({
      ...fb, co_otp_via: viaFb ? 'firebase' : 'sms',
      co_otp_on: b.co_otp_on ? '1' : '0', co_otp_sms: tpl,
      co_otp_remember_days: String(Math.max(0, Math.min(365, int(b.co_otp_remember_days)))),
      co_otp_daily_cap: String(Math.max(0, Math.min(100000, int(b.co_otp_daily_cap)))),
      co_otp_webotp: b.co_otp_webotp ? '1' : '0',
    });
    await ctx.log('settings', 'settings', null, `চেকআউট OTP: ${b.co_otp_on ? 'চালু' : 'বন্ধ'} · কোড পাঠাবে: ${viaFb ? 'Firebase' : 'দোকানের SMS'}`);
    return ctx.back(BASE, 'saved');
  }
  const [st, recent] = await Promise.all([CO.stats(), CO.recent(30)]);
  const fbVia = CO.via(s) === 'firebase';
  const ready = CO.sendReady(s);
  const smsOk = ready.ok;
  const on = s.co_otp_on === '1';
  const fc = CO.fbConfig(s);
  const o30 = st.orders30 || {};
  const checked30 = (o30.otp || 0) + (o30.remembered || 0) + (o30.account || 0);
  const tpl = s.co_otp_sms || CO.DEF_SMS;
  const sample = tpl.replace(/\{shop\}/g, s.store_name || '').replace(/\{code\}/g, '4827').replace(/\{min\}/g, bn(CO.CODE_MIN));
  const body = html`<h1>🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ)</h1>${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', on ? '✅ চালু' : '⚪ বন্ধ', on ? 'OTP ছাড়া অর্ডার হচ্ছে না' : 'আগের মতো সরাসরি অর্ডার হচ্ছে')}
  ${ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(st.sent24), `সঠিক দিয়েছেন ${bn(st.ok24)} জন${st.fail24 ? ` · SMS যায়নি ${bn(st.fail24)}` : ''}`)}
  ${ui.kpi('৩০ দিনে যাচাই হওয়া অর্ডার', bn(checked30), '')}
  ${ui.kpi('কোড নিয়েও অর্ডার করেননি', bn(st.never30), 'গত ৩০ দিনে — এদের অনেকেই ফেক / অন্যের নম্বর')}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>চেকআউটে কাস্টমার মোবাইল নম্বর লিখলে নিচে একটা ঘর আর <b>"OTP পাঠান"</b> বাটন আসে। চাপলে ঐ নম্বরে SMS-এ ৪ অঙ্কের কোড যায় (${bn(CO.CODE_MIN)} মিনিট কাজ করে)।</li>
  <li>কোডটা লিখলেই নিজে থেকে যাচাই হয়ে সবুজ <b>"✅ নম্বর যাচাই হয়েছে"</b> দেখায়, তারপর অর্ডার কনফার্ম হয়। কোড ছাড়া অর্ডার যায় না — তাই অন্যের নম্বর দিয়ে ফেক অর্ডার করা যায় না।</li>
  <li>কাস্টমার না বুঝে সরাসরি "অর্ডার কনফার্ম করুন" চাপলেও কোড নিজে থেকে চলে যায়; কোড লিখলেই অর্ডার চলে যায় — আবার বাটন চাপতে হয় না।</li>
  <li>একটাই সুইচ: <b>বন্ধ</b> থাকলে চেকআউটে OTP-র ঘর আসেই না, আগের মতো অর্ডার হয়। <b>চালু</b> থাকলে OTP ছাড়া কোনোভাবেই অর্ডার হয় না — SMS-এ সমস্যা থাকলেও না।</li>
  <li>কাস্টমারের সুবিধা: একবার যাচাই করা নম্বরে ঐ ব্রাউজারে আর কোড লাগে না (নিচে দিন ঠিক করুন), লগইন করা কাস্টমারের নিজের নম্বরে লাগে না, ৬০ সেকেন্ড পর "আবার পাঠান" করা যায়, SMS না এলে আপনার ফোন নম্বর দেখায় যাতে কল করে অর্ডার দিতে পারেন।</li>
  <li>⚠️ চালু থাকা অবস্থায় SMS কোম্পানির সমস্যা হলে, ব্যালান্স শেষ হলে বা দৈনিক সীমা পার হলে কাস্টমার কোড পাবেন না — তখন ওয়েবসাইট থেকে অর্ডারও হবে না। এমন হলে SMS ঠিক না হওয়া পর্যন্ত সুইচটা বন্ধ করে দিন।</li>
  <li>অপব্যবহার রোধ (প্রতিটা কোড = ১টা SMS খরচ): এক নম্বরে ১০ মিনিটে ৩টা ও দিনে ৬টা কোড, এক সংযোগ থেকে ঘণ্টায় ৮টা, একটা কোডে ৫ বারের বেশি ভুল নয়, ব্লক লিস্টের নম্বরে কোড যায় না।</li>
  <li>প্রতিটা অর্ডারে দেখবেন কীভাবে নম্বর যাচাই হয়েছে: ✅ OTP যাচাই / ✅ আগে যাচাই / ✅ লগইন।</li>
</ol>`)}
<section class="panel">
  <form method="post" action="${BASE}" class="form">
    ${!smsOk ? html`<p class="flash flash-error">${on ? html`<b>⚠️ জরুরি: OTP চালু, কিন্তু কোড পাঠানো যাচ্ছে না (${ready.why}) — এই মুহূর্তে কাস্টমাররা ওয়েবসাইট থেকে অর্ডার করতে পারছেন না!</b> ${fbVia ? 'নিচে Firebase-এর তথ্য ঠিক করুন' : html`<a href="/admin/marketing/sms">কাস্টমারকে SMS</a> পেজে SMS ঠিক করুন`}, অথবা নিচের সুইচ বন্ধ করে সেভ করুন।` : fbVia ? html`Firebase-এর তথ্য এখনো দেওয়া হয়নি (${ready.why}) — নিচের "Firebase সেটআপ" অংশ পূরণ করুন, তারপর OTP চালু করুন।` : html`SMS চালু নেই — OTP চালু করার আগে <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> পেজে SMS কোম্পানি (যেমন BulkSMSBD) সেটআপ করুন ও টেস্ট SMS পাঠিয়ে দেখুন, অথবা নিচে "কোড কে পাঠাবে" থেকে Firebase বাছুন। না হলে চালু করলে কেউ অর্ডার করতে পারবেন না।`}</p>` : ''}
    ${ui.field('কোড কে পাঠাবে', ui.select('co_otp_via', [['sms', '📱 দোকানের SMS সেটআপ (কাস্টমারকে SMS পেজ)'], ['firebase', '🔥 Firebase (Google) — নিচে সেটআপ দিন']], fbVia ? 'firebase' : 'sms'),
      'Firebase বাছলে Google নিজে কাস্টমারকে ৬ অঙ্কের কোড পাঠায় ও যাচাই করে; ওয়েবসাইট শুধু Google-এর সই করা উত্তরটা মিলিয়ে দেখে। তখন নিচের "কোডের SMS" লেখা আর "অ্যান্ড্রয়েডে কোড নিজে থেকে বসবে" কাজ করে না — SMS-এর লেখা Firebase ঠিক করে।')}
    ${ui.switchRow('co_otp_on', on, 'চেকআউটে OTP চালু', 'চালু: মোবাইল নম্বর OTP দিয়ে যাচাই না করে ওয়েবসাইট থেকে অর্ডার হবে না (SMS-এ সমস্যা থাকলেও না)। বন্ধ: OTP-র ঘর আসবে না, আগের মতো সরাসরি অর্ডার হবে।')}
    ${ui.field('একবার যাচাই হলে আর কতদিন কোড লাগবে না (ঐ ব্রাউজারে)', ui.select('co_otp_remember_days', [['0', 'প্রতিবার কোড লাগবে'], ['7', '৭ দিন'], ['30', '৩০ দিন (সাজেস্টেড)'], ['90', '৯০ দিন'], ['180', '১৮০ দিন']], s.co_otp_remember_days || '30'),
      'একই কাস্টমার বারবার অর্ডার করলে প্রতিবার SMS খরচ হবে না, কাস্টমারেরও ঝামেলা কম। অন্য ফোন / ব্রাউজার থেকে করলে আবার কোড লাগবে।')}
    ${ui.field('দিনে সর্বোচ্চ কতটা কোড যাবে (পুরো দোকানে)', ui.input('co_otp_daily_cap', s.co_otp_daily_cap || '500', { type: 'number', min: 0, max: 100000 }),
      'কেউ ইচ্ছা করে অনেক নম্বরে কোড চাইলে আপনার SMS ব্যালান্স শেষ হবে না। সীমা পার হলে সেদিন আর কোড যাবে না (কাস্টমারকে কল করতে বলা হবে) — তাই বিক্রি বাড়লে সীমাটা বাড়িয়ে দিন। ০ = কোনো সীমা নেই।')}
    ${ui.field('কোডের SMS', ui.textarea('co_otp_sms', tpl, { rows: 2, maxlength: 200 }),
      html`<code>{shop}</code> দোকানের নাম, <code>{code}</code> কোড (অবশ্যই রাখুন), <code>{min}</code> কত মিনিট কাজ করবে। উদাহরণ: "${sample}" — ${bn(sample.length)} অক্ষর ≈ ${bn(SMS.parts(sample))}টি SMS। বাংলা SMS ৭০ অক্ষরে ১টা; ছোট রাখলে খরচ কম।`)}
    ${ui.switchRow('co_otp_webotp', s.co_otp_webotp === '1', 'অ্যান্ড্রয়েডে কোড নিজে থেকে বসবে', 'SMS-এর শেষে "@আপনার-ডোমেইন #কোড" লাইন যোগ হয় — Android-এর Chrome তখন কোডটা নিজেই ঘরে বসিয়ে দেয়। শুধু আসল ডোমেইনে (shobmilbe.com) কাজ করে; SMS একটু লম্বা হয়ে ২টা SMS হতে পারে।')}
    <details class="panel-sub" ${fbVia && !CO.fbReady(s).ok ? raw('open') : ''}><summary><b>🔥 Firebase সেটআপ</b> ${CO.fbReady(s).ok ? html`<span class="pill pill-ok">✅ তথ্য দেওয়া আছে (${fc.projectId})</span>` : html`<span class="pill">তথ্য দেওয়া নেই</span>`}</summary>
      <ol class="steps small">
        <li><a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console</a>-এ আপনার প্রজেক্ট খুলুন → <b>Build → Authentication → Sign-in method</b> → <b>Phone</b> চালু (Enable) করে সেভ।</li>
        <li>Authentication → <b>Settings → Authorized domains</b> → <b>Add domain</b> → <code>shobmilbe.com</code> (আর <code>www.shobmilbe.com</code> ব্যবহার করলে সেটাও)।</li>
        <li>Authentication → Settings → <b>SMS region policy</b> → <b>Allow</b> বেছে <b>Bangladesh</b> যোগ করুন (নতুন প্রজেক্টে কোনো দেশেই SMS যায় না যতক্ষণ না এটা করা হয়)।</li>
        <li>⚠️ আসল নম্বরে SMS পাঠাতে Firebase-এ <b>Blaze প্ল্যান</b> (কার্ড যোগ করা) লাগে, প্রতিটা SMS-এর খরচ Google কার্ড থেকে কাটে। ফ্রি Spark প্ল্যানে শুধু টেস্ট নম্বর কাজ করে — Authentication → Sign-in method → Phone → <b>Phone numbers for testing</b>-এ একটা নম্বর আর কোড দিয়ে আগে টেস্ট করে নিতে পারেন।</li>
        <li>⚙️ Project settings → <b>Your apps</b> → Web app (<code>&lt;/&gt;</code>) না থাকলে একটা বানান → <b>firebaseConfig</b> অংশটা পুরোটা কপি করে নিচের বড় ঘরে পেস্ট করুন → সেভ। (এই তথ্য গোপন নয় — ওয়েবসাইটে সবাই দেখতে পায়, সমস্যা নেই।)</li>
        <li>উপরে "কোড কে পাঠাবে" → Firebase, "চেকআউটে OTP চালু" টিক দিয়ে সেভ। তারপর নিজের ফোন থেকে একটা টেস্ট অর্ডার করে দেখুন।</li>
      </ol>
      ${ui.field('firebaseConfig পেস্ট করুন (সহজ উপায়)', ui.textarea('fb_paste', '', { rows: 5, placeholder: 'const firebaseConfig = {\n  apiKey: "AIza…",\n  authDomain: "….firebaseapp.com",\n  projectId: "…",\n  appId: "1:…:web:…"\n};' }), 'পেস্ট করলে নিচের ঘরগুলো নিজে থেকে পূরণ হবে। খালি রাখলে নিচের ঘরগুলোর লেখাই থাকবে।')}
      <div class="field-row">
        ${ui.field('API Key', ui.input('fb_api_key', fc.apiKey, { placeholder: 'AIza…' }), '')}
        ${ui.field('Auth Domain', ui.input('fb_auth_domain', fc.authDomain, { placeholder: 'প্রজেক্ট.firebaseapp.com' }), '')}
      </div>
      <div class="field-row">
        ${ui.field('Project ID', ui.input('fb_project_id', fc.projectId, {}), '')}
        ${ui.field('App ID', ui.input('fb_app_id', fc.appId, { placeholder: '1:…:web:…' }), '')}
      </div>
    </details>
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

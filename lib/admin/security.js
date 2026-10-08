'use strict';
// Admin: security status page (owner only) — what protects the site, what still needs a step, and recent blocked attempts.
const crypto = require('crypto');
const { html, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const security = require('../security');
const lock = require('../models/loginlock');

function row(ok, title, desc) {
  return html`<li class="sec-row ${ok === true ? 'ok' : ok === false ? 'todo' : 'info'}">
    <span class="sec-ic" aria-hidden="true">${ok === true ? '✅' : ok === false ? '⚠️' : 'ℹ️'}</span>
    <span><b>${title}</b><br><span class="small muted">${desc}</span></span></li>`;
}

async function page(ctx) {
  const s = ctx.settings;
  const https = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https');
  const hasKey = security.hasKey();
  const fpStored = s.enc_key_fp || '';
  const keyChanged = hasKey && fpStored && fpStored !== security.keyFingerprint();
  const locked = Number(s.__secrets_locked || 0);
  const lockOn = lock.isOn(s);
  const recLeft = await require('./recovery').available();
  const [blocked, staff] = await Promise.all([
    db.q(`SELECT detail, created_at FROM activity_log WHERE action='blocked' ORDER BY id DESC LIMIT 15`).catch(() => []),
    db.q(`SELECT name, username, role, active, last_login FROM staff ORDER BY role='owner' DESC, id`).catch(() => []),
  ]);
  const suggested = crypto.randomBytes(32).toString('base64url');

  const body = html`<h1>🛡️ নিরাপত্তা</h1>${ui.flash(ctx.flash)}
${keyChanged || (locked && hasKey) ? html`<p class="flash flash-error">⚠️ Vercel-এর <b>ENCRYPTION_KEY</b> বদলে গেছে, তাই আগের ${locked ? ui.bn(locked) + 'টি ' : ''}সেভ করা পাসওয়ার্ড/API কী পড়া যাচ্ছে না। আগের কী আবার বসান, অথবা পেমেন্ট ও কুরিয়ারের পাসওয়ার্ডগুলো আবার দিন।</p>` : ''}
${locked && !hasKey ? html`<p class="flash flash-error">⚠️ Vercel থেকে <b>ENCRYPTION_KEY</b> মুছে গেছে। ${ui.bn(locked)}টি সেভ করা পাসওয়ার্ড/API কী এখন পড়া যাচ্ছে না — আগের কী-টা আবার বসিয়ে Redeploy দিন।</p>` : ''}

<section class="panel">
  <h2>সাইট যেভাবে সুরক্ষিত আছে</h2>
  <ul class="sec-list">
    ${row(https, 'HTTPS (তালা চিহ্ন) — সব তথ্য এনক্রিপ্ট হয়ে যায়', https ? 'ক্রেতার ব্রাউজার থেকে সাইট পর্যন্ত সব তথ্য এনক্রিপ্টেড। মাঝপথে কেউ পড়তে পারবে না। ব্রাউজারকে সবসময় HTTPS ব্যবহার করতে বলা আছে (HSTS)।' : 'এখন HTTPS ছাড়া খোলা হয়েছে। Vercel-এ সাইট নিজে থেকেই HTTPS এ চলে।')}
    ${row(true, 'ডাটাবেসের সংযোগ এনক্রিপ্টেড', 'সাইট আর ডাটাবেসের (Neon) মধ্যে সব তথ্য TLS দিয়ে এনক্রিপ্ট হয়ে যায়, সার্টিফিকেটও যাচাই করা হয়। Neon নিজেও ডিস্কে সব তথ্য এনক্রিপ্ট করে রাখে।')}
    ${row(hasKey, 'পেমেন্ট ও কুরিয়ারের পাসওয়ার্ড/API কী এনক্রিপ্ট করে রাখা', hasKey ? 'বিকাশ, SSLCommerz, Pathao, Steadfast ইত্যাদির গোপন তথ্য AES-256 দিয়ে তালাবদ্ধ। কেউ ডাটাবেসের কপি পেলেও এগুলো পড়তে পারবে না।' : 'এখনো চালু হয়নি — নিচের "এক ধাপ বাকি" অংশ দেখুন।')}
    ${row(require('../services/notify').emailConfig(s).ready, 'নিরাপত্তা সতর্কতা ও ইমেইলে পাসওয়ার্ড রিসেট', require('../services/notify').emailConfig(s).ready ? html`কেউ পাসওয়ার্ড রিসেট করলে, বারবার ভুল পাসওয়ার্ড দিলে বা মালিক হিসেবে লগইন করলে আপনাকে ইমেইল/WhatsApp এ জানানো হয়। <a href="/admin/notify">বদলান →</a>` : html`এখনো বন্ধ। Gmail App Password বসালে চালু হবে, তখন পাসওয়ার্ড ভুলে গেলে ইমেইলেই রিসেট লিংক পাবেন। <a href="/admin/notify">চালু করুন →</a>`)}
    ${row(recLeft > 0 || String(process.env.ADMIN_RESET_CODE || '').trim().length >= 12, 'জরুরি রিকভারি কোড (ফোন হারালে / ক্যামেরা নষ্ট হলে)', recLeft > 0 ? html`কাগজে লেখা ${ui.bn(recLeft)}টি কোড বাকি আছে। ফোন হারালেও "পাসওয়ার্ড ভুলে গেছেন?" থেকে এগুলো দিয়ে ঢুকতে পারবেন। <a href="/admin/security/recovery">দেখুন →</a>` : html`এখনো বানানো হয়নি! ফোন হারালে বা ক্যামেরা নষ্ট হলে আটকে যেতে পারেন। <a href="/admin/security/recovery">এখনই বানান →</a>`)}
    ${row(lockOn, 'মালিকের লগইনে আঙুলের ছাপ / মুখ যাচাই', lockOn ? html`চালু: ${lock.MODE_NAMES[lock.mode(s)]}। পাসওয়ার্ড চুরি হলেও আপনার ফোন/মুখ ছাড়া কেউ মালিক হিসেবে ঢুকতে পারবে না। <a href="/admin/security/login">বদলান →</a>` : html`এখনো বন্ধ। চালু করলে পাসওয়ার্ডের পরেও আঙুলের ছাপ বা মুখ লাগবে। <a href="/admin/security/login">চালু করুন →</a>`)}
    ${row(true, 'অ্যাডমিন পাসওয়ার্ড নিরাপদে রাখা', 'পাসওয়ার্ড কোথাও সরাসরি লেখা থাকে না, scrypt দিয়ে এমনভাবে বদলে রাখা হয় যে উল্টো করে বের করা যায় না।')}
    ${row(true, 'পাসওয়ার্ড অনুমান করে ঢোকা বন্ধ', 'একই জায়গা থেকে ৮ বার ভুল পাসওয়ার্ড দিলে ১৫ মিনিট, আর একই ইউজারনেমে ১৫ বার ভুল হলে ১ ঘণ্টা লগইন বন্ধ থাকে।')}
    ${row(true, 'অন্য ওয়েবসাইট থেকে অ্যাডমিনের ফর্ম পাঠানো বন্ধ', 'অ্যাডমিনের যেকোনো সেভ/মুছে ফেলা শুধু এই সাইট থেকেই করা যায়। লগইন কুকি জাভাস্ক্রিপ্ট দিয়ে পড়া যায় না।')}
    ${row(true, 'ভাইরাস বা ভুয়া ফাইল আপলোড বন্ধ', 'আপলোডের সময় ফাইলের ভেতরের আসল গঠন পরীক্ষা হয় — শুধু সত্যিকারের JPG, PNG, WebP, GIF ছবি নেওয়া হয়। নাম বদলানো ভাইরাস বা স্ক্রিপ্ট ঢুকতে পারবে না।')}
    ${row(true, 'ডাটাবেসে বাইরে থেকে কমান্ড ঢোকানো (SQL Injection) বন্ধ', 'ক্রেতা বা কেউ যা-ই লিখুক, সেটা শুধু লেখা হিসেবে সেভ হয় — ডাটাবেসের কমান্ড হিসেবে কখনো চলে না।')}
    ${row(true, 'সাইটে ক্ষতিকর স্ক্রিপ্ট ঢোকানো (XSS) বন্ধ', 'নাম, ঠিকানা, রিভিউ, সার্চ — সব লেখা দেখানোর আগে নিরাপদ করা হয়। মেনু/ব্যানারের লিংকে "javascript:" জাতীয় কৌশল কাজ করে না। অ্যাডমিন প্যানেলে বাইরের কোনো স্ক্রিপ্ট চলতে পারে না।')}
    ${row(true, 'কোড বসানোর ঘর শুধু মালিকের', 'পিক্সেলের বাড়তি কোড, চ্যাট স্ক্রিপ্ট, স্কোর উইজেট — এসব শুধু মালিক বদলাতে পারবেন, কোনো স্টাফ না।')}
    ${row(true, 'ভুয়া অর্ডার আর স্প্যাম আটকানো', 'একই সংযোগ থেকে ঘণ্টায় ১০টার বেশি অর্ডার, ১০ মিনিটে ৩০ বারের বেশি কুপন চেষ্টা বা ৬০টার বেশি অর্ডার পেজ খোলা যায় না।')}
    ${row(true, 'ক্রেতার তথ্য গোপন', 'অর্ডার নম্বর জানলেও অন্য কেউ ক্রেতার ঠিকানা বা পুরো মোবাইল নম্বর দেখতে পারবে না — যে ব্রাউজার থেকে অর্ডার হয়েছে, অথবা মোবাইল নম্বর যাচাই করলে তবেই দেখা যায়।')}
    ${row(true, 'পেমেন্ট জাল করা অসম্ভব', 'বিকাশ/কার্ডের পেমেন্ট সবসময় সরাসরি বিকাশ বা SSLCommerz-এর সার্ভার থেকে যাচাই করা হয়, টাকার পরিমাণও মেলানো হয়।')}
    ${row(true, 'কুরিয়ারের আপডেট যাচাই', 'Pathao/Steadfast থেকে আসা আপডেট গোপন টোকেন মিলিয়ে তবেই নেওয়া হয়।')}
    ${row(null, 'সার্ভার ডাউন করার আক্রমণ (DDoS)', 'সাইট Vercel-এ চলে, যার নিজস্ব DDoS সুরক্ষা সবসময় চালু থাকে। খুব বড় আক্রমণ হলে Vercel-এ এক ক্লিকে "Attack Challenge Mode" চালু করা যায় (নিচে দেখুন)।')}
  </ul>
</section>

${hasKey ? '' : html`<section class="panel sec-step">
  <h2>⚠️ এক ধাপ বাকি: গোপন তথ্য এনক্রিপশন চালু করুন (৫ মিনিট)</h2>
  <p>এটা আপনাকে নিজে Vercel-এ একবার করতে হবে, কারণ চাবিটা ডাটাবেসের বাইরে রাখতে হয় — তাহলেই ডাটাবেস চুরি হলেও পাসওয়ার্ড পড়া যাবে না।</p>
  <ol>
    <li>নিচের চাবিটা কপি করুন, আর কোথাও নিরাপদে লিখে রাখুন (যেমন খাতায়):<br><code class="sec-key">${suggested}</code></li>
    <li><b>vercel.com</b> এ ঢুকে আপনার প্রজেক্ট খুলুন → <b>Settings</b> → <b>Environment Variables</b>।</li>
    <li><b>Key</b> ঘরে লিখুন: <code>ENCRYPTION_KEY</code> — <b>Value</b> ঘরে কপি করা চাবিটা পেস্ট করুন → <b>Save</b>।</li>
    <li><b>Deployments</b> এ গিয়ে সবচেয়ে উপরেরটার পাশে <b>⋯</b> → <b>Redeploy</b>।</li>
    <li>২ মিনিট পর এই পেজটা আবার খুলুন — উপরে সবুজ ✅ দেখাবে, আর আগের সব পাসওয়ার্ড নিজে থেকেই এনক্রিপ্ট হয়ে যাবে।</li>
  </ol>
  <p class="small muted">⚠️ চাবিটা একবার বসানোর পর আর বদলাবেন না বা মুছবেন না। বদলালে সেভ করা পেমেন্ট/কুরিয়ারের পাসওয়ার্ডগুলো আবার দিতে হবে। (প্রতিবার পেজ খুললে নতুন একটা চাবি দেখায় — যেকোনো একটা ব্যবহার করলেই হবে।)</p>
</section>`}

<section class="panel">
  <h2>আপনার করণীয় (ভালো অভ্যাস)</h2>
  <ul class="sec-list">
    ${row(null, 'শক্ত পাসওয়ার্ড দিন', 'কমপক্ষে ১২ অক্ষর, অক্ষর-সংখ্যা মিশিয়ে। মোবাইল নম্বর বা নাম দিয়ে পাসওয়ার্ড দেবেন না। প্রতিটা স্টাফের আলাদা অ্যাকাউন্ট দিন, কারো সাথে পাসওয়ার্ড শেয়ার করবেন না।')}
    ${row(null, 'স্টাফকে শুধু দরকারি অনুমতি দিন', 'কেউ চাকরি ছেড়ে দিলে সাথে সাথে "স্টাফ" মেনু থেকে তার অ্যাকাউন্ট বন্ধ করুন।')}
    ${row(null, 'Vercel আর GitHub অ্যাকাউন্টে টু-ফ্যাক্টর (2FA) চালু করুন', 'সাইটের আসল চাবি এই দুই অ্যাকাউন্টে। দুটোর Settings → Security থেকে 2FA চালু রাখলে পাসওয়ার্ড চুরি হলেও কেউ ঢুকতে পারবে না।')}
    ${row(null, 'বড় আক্রমণ হলে: Vercel Attack Challenge Mode', 'Vercel → প্রজেক্ট → Firewall → "Attack Challenge Mode" চালু করলে সন্দেহজনক ভিজিটরদের আগে যাচাই করা হয়। সাধারণ সময়ে বন্ধ রাখুন।')}
    ${row(null, 'ডাটাবেসের ব্যাকআপ', 'Neon নিজে থেকেই কয়েকদিনের ব্যাকআপ রাখে (ভুল হলে আগের অবস্থায় ফেরানো যায়)। মাঝে মাঝে রিপোর্ট থেকে অর্ডারের CSV ডাউনলোড করে রাখা ভালো।')}
  </ul>
</section>

<div class="two-col">
<section class="panel">
  <h2>সাম্প্রতিক আটকানো চেষ্টা</h2>
  ${blocked.length ? html`<ul class="sec-log">${blocked.map((b) => html`<li><span class="small muted">${fmtDate(b.created_at)}</span><br>${b.detail}</li>`)}</ul>`
    : html`<p class="muted">কোনো সন্দেহজনক চেষ্টা ধরা পড়েনি। 👍</p>`}
</section>
<section class="panel">
  <h2>যারা অ্যাডমিনে ঢুকতে পারে</h2>
  <ul class="sec-log">${staff.map((u) => html`<li><b>${u.name}</b> (${u.username}) ${u.role === 'owner' ? ui.pill('মালিক', 'pill-delivered') : u.active ? ui.pill('স্টাফ', 'pill-confirmed') : ui.pill('বন্ধ', 'pill-cancelled')}
    <br><span class="small muted">শেষ লগইন: ${u.last_login ? fmtDate(u.last_login) : 'কখনো না'}</span></li>`)}</ul>
  <p class="small"><a href="/admin/staff">স্টাফ পরিচালনা →</a></p>
</section>
</div>`;
  return ctx.page('নিরাপত্তা', body, 'security');
}

module.exports = { routes: [{ method: 'GET', path: '/admin/security', perm: 'owner', handler: page }] };

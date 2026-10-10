'use strict';
const dns = require('dns').promises;
const { html, raw, fmtDate, int, str, fetchJson, randomCode } = require('../util');
const db = require('../db');
const courier = require('../services/courier');
const payments = require('../services/payments');
const finance = require('../models/finance');
const ui = require('./ui');
const { saveKeys, secretInput } = require('./marketing');

function siteBase(ctx) {
  if (ctx.settings.site_url) return ctx.settings.site_url.replace(/\/+$/, '');
  const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '';
  return `${String(ctx.req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${host}`;
}
const status = (ok) => (ok ? ui.pill('সেটআপ করা আছে', 'pill-delivered') : ui.pill('সেটআপ বাকি', 'pill-pending'));

// ---------------------------------------------------------------- courier
async function courierPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.steadfast_base_url) b.steadfast_base_url = String(b.steadfast_base_url).trim().replace(/\/+$/, '');
    if (!s.steadfast_webhook_token) b.steadfast_webhook_token = randomCode(24);
    if (!s.pathao_webhook_secret) b.pathao_webhook_secret = randomCode(24);
    await saveKeys(ctx, ['courier_default', 'courier_auto_send', 'steadfast_api_key', 'steadfast_secret_key', 'steadfast_base_url', 'steadfast_webhook_token',
      'pathao_client_id', 'pathao_client_secret', 'pathao_username', 'pathao_password', 'pathao_store_id', 'pathao_sandbox', 'pathao_webhook_secret',
      'redx_token', 'redx_sandbox', 'redx_pickup_store_id'], b,
    { secrets: ['steadfast_secret_key', 'pathao_client_secret', 'pathao_password', 'redx_token'], checkboxes: ['courier_auto_send', 'pathao_sandbox', 'redx_sandbox'] });
    await db.setMany({ pathao_token: '', pathao_token_expires: '' });
    await ctx.log('settings', 'courier', null, 'কুরিয়ার সেটিংস');
    return ctx.back('/admin/integrations/courier', 'saved');
  }
  const base = siteBase(ctx);
  const logs = await db.q(`SELECT * FROM integration_logs WHERE service IN ('steadfast','pathao','redx') ORDER BY created_at DESC LIMIT 15`);
  const body = html`<h1>কুরিয়ার ইন্টিগ্রেশন</h1>${ui.flash(ctx.flash)}
${ui.helpBox('কীভাবে কাজ করে', html`কুরিয়ার কোম্পানির <b>মার্চেন্ট প্যানেল</b> থেকে API তথ্য এনে নিচে বসান। এরপর প্রতিটা অর্ডারের পেজে "কুরিয়ারে পাঠান" চাপলেই কুরিয়ারের সিস্টেমে পার্সেল তৈরি হবে — আলাদা করে তাদের অ্যাপে কিছু লিখতে হবে না। তারা পিকআপে চলে আসবে।
  "অটো পাঠান" চালু করলে অর্ডার কনফার্ম করার সাথে সাথেই পার্সেল তৈরি হবে। পার্সেল ডেলিভারি বা ফেরত হলে অর্ডারের অবস্থা নিজে থেকে বদলে যাবে (ওয়েবহুক দিলে সাথে সাথে, নাহলে "স্ট্যাটাস আপডেট আনুন" চাপলে)।<br><br>
  <b>Gmail/ফোন দিয়ে লগইন প্রসঙ্গে:</b> Pathao নিজেই তাদের API তে মার্চেন্ট অ্যাকাউন্টের <b>ইমেইল আর পাসওয়ার্ড</b> দিয়ে সংযোগ করতে দেয় — নিচে সেটাই চাওয়া হয়েছে। Steadfast আর RedX পাসওয়ার্ডের বদলে প্যানেল থেকে দেওয়া API Key দিয়ে সংযোগ করে (এটাই তাদের অনুমোদিত ও নিরাপদ উপায়)।`)}
<form method="post" action="/admin/integrations/courier" class="form">
  <section class="panel">
    <h2>সাধারণ</h2>
    <div class="field-row">
      ${ui.field('ডিফল্ট কুরিয়ার', ui.select('courier_default', [['', 'বাছাই করুন'], ...Object.entries(courier.PROVIDERS).map(([k, v]) => [k, v.label])], s.courier_default))}
    </div>
    ${ui.check('courier_auto_send', s.courier_auto_send === '1', 'অর্ডার "কনফার্ম" করলে নিজে থেকেই ডিফল্ট কুরিয়ারে পাঠিয়ে দাও')}
  </section>
  <section class="panel">
    <div class="title-row"><h2>Steadfast</h2>${status(courier.configured(s, 'steadfast'))}</div>
    <p class="muted small">steadfast.com.bd মার্চেন্ট প্যানেল → <b>API</b> মেনু → API Key ও Secret Key কপি করুন।</p>
    <div class="field-row">
      ${ui.field('API Key', ui.input('steadfast_api_key', s.steadfast_api_key, { autocomplete: 'off' }))}
      ${ui.field('Secret Key', secretInput('steadfast_secret_key', s.steadfast_secret_key))}
    </div>
    ${ui.field('API ঠিকানা', ui.input('steadfast_base_url', s.steadfast_base_url), 'সাধারণত বদলাতে হবে না')}
    ${s.steadfast_webhook_token ? html`<p class="small">ওয়েবহুক (Steadfast প্যানেল → API → Webhook এ দিন):<br>Callback URL: <code class="copy">${base}/webhook/steadfast</code><br>Auth Token (Bearer): <code class="copy">${s.steadfast_webhook_token}</code></p>` : ''}
  </section>
  <section class="panel">
    <div class="title-row"><h2>Pathao</h2>${status(courier.configured(s, 'pathao'))}</div>
    <p class="muted small">merchant.pathao.com → <b>Developer's API</b> থেকে Client ID ও Client Secret নিন। ইমেইল/পাসওয়ার্ড = যেটা দিয়ে Pathao মার্চেন্ট প্যানেলে লগইন করেন। Store ID পাবেন প্যানেলের Stores থেকে (বা সেভ করে "সংযোগ পরীক্ষা" চাপলে দেখাবে)।</p>
    <div class="field-row">
      ${ui.field('Client ID', ui.input('pathao_client_id', s.pathao_client_id, { autocomplete: 'off' }))}
      ${ui.field('Client Secret', secretInput('pathao_client_secret', s.pathao_client_secret))}
    </div>
    <div class="field-row">
      ${ui.field('মার্চেন্ট ইমেইল', ui.input('pathao_username', s.pathao_username, { type: 'email', autocomplete: 'off' }))}
      ${ui.field('মার্চেন্ট পাসওয়ার্ড', secretInput('pathao_password', s.pathao_password))}
      ${ui.field('Store ID', ui.input('pathao_store_id', s.pathao_store_id, { inputmode: 'numeric' }))}
    </div>
    ${ui.check('pathao_sandbox', s.pathao_sandbox === '1', 'টেস্ট মোড (Sandbox) — আসল অর্ডারের আগে বন্ধ করুন')}
    ${s.pathao_webhook_secret ? html`<p class="small">ওয়েবহুক (Pathao প্যানেল → Developer's API → Webhook):<br>Callback URL: <code class="copy">${base}/webhook/pathao</code><br>Secret: <code class="copy">${s.pathao_webhook_secret}</code></p>` : ''}
  </section>
  <section class="panel">
    <div class="title-row"><h2>RedX</h2>${status(courier.configured(s, 'redx'))}</div>
    <p class="muted small">RedX মার্চেন্ট প্যানেল → Developer API থেকে Access Token নিন।</p>
    <div class="field-row">
      ${ui.field('API Access Token', secretInput('redx_token', s.redx_token))}
      ${ui.field('Pickup Store ID (ঐচ্ছিক)', ui.input('redx_pickup_store_id', s.redx_pickup_store_id, { inputmode: 'numeric' }))}
    </div>
    ${ui.check('redx_sandbox', s.redx_sandbox === '1', 'টেস্ট মোড (Sandbox)')}
  </section>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>
<section class="panel">
  <h2>সংযোগ পরীক্ষা</h2>
  <div class="row-actions">${Object.entries(courier.PROVIDERS).map(([k, v]) => html`<form method="post" action="/admin/integrations/courier/test"><input type="hidden" name="courier" value="${k}"><button class="btn btn-ghost btn-sm" ${courier.configured(s, k) ? '' : raw('disabled')}>${v.label}</button></form>`)}
  <form method="post" action="/admin/orders/sync"><button class="btn btn-ghost btn-sm">🔄 কুরিয়ারে থাকা সব অর্ডারের স্ট্যাটাস আনুন</button></form></div>
</section>
${logLines(logs)}`;
  return ctx.page('কুরিয়ার', body, 'courier');
}
function logLines(logs) {
  if (!logs.length) return '';
  return html`<section class="panel"><h2>সাম্প্রতিক লগ</h2><ul class="log">${logs.map((l) => html`<li class="${l.ok ? 'ok' : 'bad'}">${l.ok ? '✅' : '❌'} ${fmtDate(l.created_at)} · ${l.service} · ${l.action}${l.ref ? ` · ${l.ref}` : ''}<br><span class="small">${l.message}</span></li>`)}</ul></section>`;
}
async function courierTest(ctx) {
  const b = await ctx.body();
  const r = await courier.test(b.courier, ctx.settings);
  await db.logIntegration(b.courier, 'test', r.ok, r.message);
  return r.ok ? ctx.redirect(ctx.res, '/admin/integrations/courier?msg=saved&info=' + encodeURIComponent(r.message)) : ctx.fail('/admin/integrations/courier', r.message);
}

// ---------------------------------------------------------------- payments
async function paymentsPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    await saveKeys(ctx, ['pay_cod', 'pay_cod_note', 'pay_bkash', 'bkash_sandbox', 'bkash_app_key', 'bkash_app_secret', 'bkash_username', 'bkash_password', 'bkash_account_id',
      'pay_ssl', 'ssl_sandbox', 'ssl_store_id', 'ssl_store_password', 'ssl_account_id',
      'pay_manual', 'manual_bkash', 'manual_nagad', 'manual_rocket', 'manual_upay', 'manual_type', 'manual_note'], b,
    { secrets: ['bkash_app_secret', 'bkash_password', 'ssl_store_password'], checkboxes: ['pay_cod', 'pay_bkash', 'bkash_sandbox', 'pay_ssl', 'ssl_sandbox', 'pay_manual'] });
    await ctx.log('settings', 'payments', null, 'পেমেন্ট সেটিংস');
    return ctx.back('/admin/integrations/payments', 'saved');
  }
  const accounts = (await finance.listAccounts()).filter((a) => a.active).map((a) => [a.id, a.name]);
  const base = siteBase(ctx);
  const logs = await db.q(`SELECT * FROM integration_logs WHERE service IN ('bkash','sslcommerz') ORDER BY created_at DESC LIMIT 15`);
  const live = payments.methods(s);
  const body = html`<h1>পেমেন্ট মেথড</h1>${ui.flash(ctx.flash)}
<p>চেকআউটে এখন যা দেখাচ্ছে: ${live.map((m) => ui.pill(m.label, 'pill-confirmed'))}</p>
${!s.site_url ? html`<p class="flash flash-error">অনলাইন পেমেন্টের জন্য আগে <a href="/admin/marketing/seo">SEO পেজে</a> ওয়েবসাইটের ঠিকানা (যেমন https://shobmilbe.com) দিন। এখন ব্যবহার হবে: ${base}</p>` : ''}
<form method="post" action="/admin/integrations/payments" class="form">
  <section class="panel">
    <h2>💵 ক্যাশ অন ডেলিভারি</h2>
    ${ui.check('pay_cod', s.pay_cod === '1', 'চালু')}
    ${ui.field('কাস্টমারকে যা দেখাবে', ui.input('pay_cod_note', s.pay_cod_note, { maxlength: 120 }))}
  </section>
  <section class="panel">
    <div class="title-row"><h2>বিকাশ পেমেন্ট গেটওয়ে (অটোমেটিক)</h2>${status(s.bkash_app_key && s.bkash_app_secret && s.bkash_username && s.bkash_password)}</div>
    <p class="muted small">বিকাশ মার্চেন্ট অ্যাকাউন্টে <b>Tokenized Checkout / PGW</b> চালু করার আবেদন করুন (bKash এর মার্চেন্ট টিম বা আপনার ব্যাংক থেকে)। তারা App Key, App Secret, Username, Password দেবে। টাকা আসলে অর্ডার নিজে থেকে "পেইড" হবে।</p>
    ${ui.check('pay_bkash', s.pay_bkash === '1', 'চালু')}
    <div class="field-row">${ui.field('App Key', ui.input('bkash_app_key', s.bkash_app_key, { autocomplete: 'off' }))}${ui.field('App Secret', secretInput('bkash_app_secret', s.bkash_app_secret))}</div>
    <div class="field-row">${ui.field('Username', ui.input('bkash_username', s.bkash_username, { autocomplete: 'off' }))}${ui.field('Password', secretInput('bkash_password', s.bkash_password))}</div>
    ${ui.field('টাকা কোন হিসাবে যোগ হবে', ui.select('bkash_account_id', [['', 'বাছাই করুন'], ...accounts], s.bkash_account_id))}
    ${ui.check('bkash_sandbox', s.bkash_sandbox === '1', 'টেস্ট মোড (Sandbox) — আসল টাকা নেওয়ার আগে বন্ধ করুন')}
  </section>
  <section class="panel">
    <div class="title-row"><h2>SSLCommerz (কার্ড, নগদ, রকেট, উপায়, ব্যাংক)</h2>${status(s.ssl_store_id && s.ssl_store_password)}</div>
    <p class="muted small">sslcommerz.com এ মার্চেন্ট অ্যাকাউন্ট খুলুন (ট্রেড লাইসেন্স লাগে)। একটা সংযোগেই Visa, Mastercard, Amex, নগদ, রকেট, উপায়, বিকাশ, ইন্টারনেট ব্যাংকিং সব চলে আসে। টেস্টের জন্য developer.sslcommerz.com থেকে ফ্রি Sandbox Store ID নিতে পারেন।</p>
    ${ui.check('pay_ssl', s.pay_ssl === '1', 'চালু')}
    <div class="field-row">${ui.field('Store ID', ui.input('ssl_store_id', s.ssl_store_id, { autocomplete: 'off' }))}${ui.field('Store Password', secretInput('ssl_store_password', s.ssl_store_password))}</div>
    ${ui.field('টাকা কোন হিসাবে যোগ হবে', ui.select('ssl_account_id', [['', 'বাছাই করুন'], ...accounts], s.ssl_account_id))}
    ${ui.check('ssl_sandbox', s.ssl_sandbox === '1', 'টেস্ট মোড (Sandbox)')}
    <p class="small">IPN URL (SSLCommerz প্যানেলে দিন): <code class="copy">${base}/pay/ssl/ipn</code></p>
  </section>
  <section class="panel">
    <h2>📱 Send Money (ম্যানুয়াল বিকাশ/নগদ/রকেট)</h2>
    <p class="muted small">গেটওয়ে ছাড়াই শুরু করার সহজ উপায়: কাস্টমার আপনার নম্বরে টাকা পাঠিয়ে Transaction ID দেবেন, আপনি অ্যাপে মিলিয়ে অর্ডারে "টাকা পেয়েছি" চাপবেন। অগ্রিম ডেলিভারি চার্জ নেওয়ার জন্যও কাজে লাগে।</p>
    ${ui.check('pay_manual', s.pay_manual === '1', 'চালু')}
    <div class="field-row">
      ${ui.field('বিকাশ নম্বর', ui.input('manual_bkash', s.manual_bkash, { inputmode: 'tel' }))}
      ${ui.field('নগদ নম্বর', ui.input('manual_nagad', s.manual_nagad, { inputmode: 'tel' }))}
      ${ui.field('রকেট নম্বর', ui.input('manual_rocket', s.manual_rocket, { inputmode: 'tel' }))}
      ${ui.field('উপায় নম্বর', ui.input('manual_upay', s.manual_upay, { inputmode: 'tel' }))}
    </div>
    <div class="field-row">
      ${ui.field('নম্বরের ধরন', ui.select('manual_type', [['Personal', 'Personal (Send Money)'], ['Agent', 'Agent (Cash Out)'], ['Merchant', 'Merchant (Payment)']], s.manual_type))}
      ${ui.field('কাস্টমারকে নির্দেশনা', ui.input('manual_note', s.manual_note, { maxlength: 200 }))}
    </div>
  </section>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>
<section class="panel"><h2>সংযোগ পরীক্ষা</h2>
  <form method="post" action="/admin/integrations/payments/test"><button class="btn btn-ghost btn-sm">বিকাশ সংযোগ পরীক্ষা</button></form></section>
${logLines(logs)}`;
  return ctx.page('পেমেন্ট', body, 'payments');
}
async function paymentsTest(ctx) {
  const r = await payments.bkashTest(ctx.settings);
  await db.logIntegration('bkash', 'test', r.ok, r.message);
  return r.ok ? ctx.redirect(ctx.res, '/admin/integrations/payments?msg=saved&info=' + encodeURIComponent(r.message)) : ctx.fail('/admin/integrations/payments', r.message);
}

// ---------------------------------------------------------------- domain
async function domainPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const domain = String(b.custom_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return ctx.fail('/admin/integrations/domain', 'ডোমেইন ঠিক নেই, যেমন: shobmilbe.com');
    await saveKeys(ctx, ['custom_domain', 'vercel_token', 'vercel_project'], { ...b, custom_domain: domain }, { secrets: ['vercel_token'] });
    if (b.set_site_url && domain) await db.setSetting('site_url', `https://${domain}`);
    await ctx.log('settings', 'domain', null, domain);
    return ctx.back('/admin/integrations/domain', 'saved');
  }
  const domain = s.custom_domain;
  let check = null;
  if (domain) {
    check = { apex: [], www: [] };
    try { check.apex = await dns.resolve4(domain); } catch (_) { /* none */ }
    try { check.www = await dns.resolveCname('www.' + domain); } catch (_) { try { check.www = await dns.resolve4('www.' + domain); } catch (__) { /* none */ } }
  }
  let vercel = null;
  if (domain && s.vercel_token) {
    const r = await fetchJson(`https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config`, { headers: { Authorization: `Bearer ${s.vercel_token}` } });
    vercel = r.ok ? r.data : { error: (r.data && r.data.error && r.data.error.message) || r.text };
  }
  const apexOk = check && check.apex.length > 0 && vercel && vercel.misconfigured === false;
  const recA = (vercel && Array.isArray(vercel.recommendedIPv4) && vercel.recommendedIPv4[0] && vercel.recommendedIPv4[0].value && vercel.recommendedIPv4[0].value[0]) || '76.76.21.21';
  const recC = (vercel && Array.isArray(vercel.recommendedCNAME) && vercel.recommendedCNAME[0] && vercel.recommendedCNAME[0].value) || 'cname.vercel-dns.com';
  const body = html`<h1>ডোমেইন সেটআপ (Namecheap → Vercel)</h1>${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel">
    <h2>ধাপ ১: ডোমেইনের নাম দিন</h2>
    <form method="post" action="/admin/integrations/domain" class="form">
      ${ui.field('আপনার ডোমেইন', ui.input('custom_domain', domain, { placeholder: 'shobmilbe.com' }))}
      ${ui.check('set_site_url', !s.site_url || s.site_url.includes(domain || '§'), 'এটাকেই ওয়েবসাইটের মূল ঠিকানা হিসেবে সেট করুন')}
      <details ${s.vercel_token ? raw('open') : ''}><summary class="link-btn">Vercel API দিয়ে অটো-চেক (ঐচ্ছিক)</summary>
        <p class="muted small">vercel.com → Account Settings → Tokens → Create। Project: আপনার প্রজেক্টের নাম (Vercel এ যেটা দেখায়)।</p>
        ${ui.field('Vercel Token', secretInput('vercel_token', s.vercel_token))}
        ${ui.field('Vercel Project নাম', ui.input('vercel_project', s.vercel_project, { placeholder: 'shobmilbe-ecommerce' }))}
      </details>
      <button class="btn">সেভ করুন</button>
    </form>
    ${domain && s.vercel_token && s.vercel_project ? html`<form method="post" action="/admin/integrations/domain/add" class="mt"><button class="btn btn-amber">Vercel প্রজেক্টে ${domain} আর www.${domain} যোগ করুন</button></form>` : ''}
    <h2 class="mt">ধাপ ২: Vercel এ ডোমেইন যোগ করুন</h2>
    <ol class="steps-list">
      <li>vercel.com এ লগইন → আপনার প্রজেক্ট → <b>Settings → Domains</b></li>
      <li><b>Add Domain</b> চেপে <code>${domain || 'shobmilbe.com'}</code> লিখুন। www যোগ করতে বললে "Add www redirect" রাখুন।</li>
      <li>Vercel কিছু DNS রেকর্ড দেখাবে — সেগুলো পরের ধাপে Namecheap এ বসাবেন।</li>
    </ol>
    <p class="muted small">(উপরে Vercel Token দিলে এই ধাপটা বাটন চেপেই করা যাবে।)</p>
  </section>
  <section class="panel">
    <p class="flash">🛰️ DNS রেকর্ড এখান থেকেই দেখতে, যোগ করতে আর বদলাতে চাইলে — আর Cloudflare-এর ফ্রি নিরাপত্তা পেতে — <a href="/admin/integrations/dns"><b>DNS রেকর্ড ও Cloudflare</b></a> পেজ দেখুন।</p>
    <h2>ধাপ ৩: Namecheap এ DNS বসান</h2>
    <ol class="steps-list">
      <li>namecheap.com → <b>Domain List</b> → ডোমেইনের পাশে <b>Manage</b></li>
      <li><b>Nameservers</b> যেন "Namecheap BasicDNS" থাকে।</li>
      <li><b>Advanced DNS</b> ট্যাবে যান। আগে থেকে থাকা <b>URL Redirect</b> আর <b>Parking</b> রেকর্ড (CNAME www → parkingpage…) মুছে দিন।</li>
      <li>এই দুটো রেকর্ড যোগ করুন (<b>Add New Record</b>):</li>
    </ol>
    <table class="table compact dns"><thead><tr><th>Type</th><th>Host</th><th>Value</th><th>TTL</th></tr></thead><tbody>
      <tr><td>A Record</td><td><code>@</code></td><td><code class="copy">${recA}</code></td><td>Automatic</td></tr>
      <tr><td>CNAME Record</td><td><code>www</code></td><td><code class="copy">${recC}</code></td><td>Automatic</td></tr>
    </tbody></table>
    <p class="muted small">Vercel এর Domains পেজে যদি অন্য মান দেখায় (যেমন প্রজেক্টের নিজস্ব CNAME), তাহলে সেটাই বসাবেন — Vercel যা বলে সেটাই সঠিক। ইমেইলের MX রেকর্ড থাকলে সেগুলো মুছবেন না।</p>
    <h2>ধাপ ৪: অপেক্ষা ও চেক</h2>
    <p>DNS ছড়াতে ৫ মিনিট থেকে কয়েক ঘণ্টা লাগে। এরপর Vercel নিজে থেকে ফ্রি SSL (https) দিয়ে দেবে।</p>
    ${domain ? html`<div class="dns-check">
      <p>${check.apex.length ? '✅' : '⏳'} <b>${domain}</b> → ${check.apex.length ? check.apex.join(', ') : 'এখনো কোথাও যাচ্ছে না'}</p>
      <p>${check.www.length ? '✅' : '⏳'} <b>www.${domain}</b> → ${check.www.length ? check.www.join(', ') : 'এখনো কোথাও যাচ্ছে না'}</p>
      ${vercel ? (vercel.error ? html`<p class="warn small">Vercel: ${vercel.error}</p>` : html`<p>${apexOk ? '✅ Vercel বলছে কনফিগারেশন ঠিক আছে!' : '⏳ Vercel এখনো সঠিক কনফিগারেশন দেখছে না।'}</p>`) : ''}
      <a class="btn btn-ghost btn-sm" href="/admin/integrations/domain">🔄 আবার চেক করুন</a>
    </div>` : ''}
    <h2>ধাপ ৫: শেষ কাজ</h2>
    <ul class="checklist"><li>Facebook/TikTok/Google ভেরিফিকেশন নতুন ডোমেইনে করুন (<a href="/admin/marketing/tracking">ট্র্যাকিং</a>)</li>
      <li>Google Search Console এ <code>https://${domain || 'আপনার-ডোমেইন'}/sitemap.xml</code> জমা দিন</li>
      <li>কুরিয়ার/পেমেন্টের ওয়েবহুক ঠিকানা নতুন ডোমেইনে আপডেট করুন</li></ul>
  </section>
</div>`;
  return ctx.page('ডোমেইন', body, 'domain');
}
async function domainAdd(ctx) {
  const s = ctx.settings;
  if (!s.custom_domain || !s.vercel_token || !s.vercel_project) return ctx.fail('/admin/integrations/domain', 'ডোমেইন, Vercel Token আর প্রজেক্টের নাম দিন।');
  const msgs = [];
  for (const name of [s.custom_domain, 'www.' + s.custom_domain]) {
    const body = name.startsWith('www.') ? { name, redirect: s.custom_domain, redirectStatusCode: 308 } : { name };
    const r = await fetchJson(`https://api.vercel.com/v10/projects/${encodeURIComponent(s.vercel_project)}/domains`,
      { method: 'POST', headers: { Authorization: `Bearer ${s.vercel_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ok = r.ok || (r.data && r.data.error && /already/i.test(r.data.error.message || ''));
    msgs.push(`${name}: ${ok ? 'যোগ হয়েছে' : (r.data && r.data.error && r.data.error.message) || r.text}`);
    await db.logIntegration('vercel', 'add_domain', ok, msgs[msgs.length - 1]);
  }
  return ctx.redirect(ctx.res, '/admin/integrations/domain?msg=saved&info=' + encodeURIComponent(msgs.join(' · ')));
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/integrations/courier', perm: 'settings', handler: courierPage },
    { method: 'POST', path: '/admin/integrations/courier/test', perm: 'settings', handler: courierTest },
    { method: '*', path: '/admin/integrations/payments', perm: 'settings', handler: paymentsPage },
    { method: 'POST', path: '/admin/integrations/payments/test', perm: 'settings', handler: paymentsTest },
    { method: '*', path: '/admin/integrations/domain', perm: 'settings', handler: domainPage },
    { method: 'POST', path: '/admin/integrations/domain/add', perm: 'settings', handler: domainAdd },
  ],
};
void str; void int;

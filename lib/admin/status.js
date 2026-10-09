'use strict';
// Admin → সংযোগের অবস্থা: one page that shows whether every outside connection is set up and working —
// Google / Facebook / TikTok tracking, product feeds, couriers, payments, notifications, backups —
// plus the SEO checker (products that Google may show badly).
const { html, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');

const OK = 'ok'; const WARN = 'warn'; const OFF = 'off'; const BAD = 'bad';
const ICON = { ok: '✅', warn: '⚠️', off: '⚪', bad: '❌' };
function row(state, title, detail, link) {
  return html`<li class="sec-row ${state === OK ? 'ok' : state === OFF ? 'info' : 'todo'}"><span class="sec-ic" aria-hidden="true">${ICON[state]}</span>
    <span><b>${title}</b><br><span class="small muted">${detail}</span>${link ? html` <a class="small" href="${link[0]}">${link[1]} →</a>` : ''}</span></li>`;
}

// latest success / failure per service from the integration log
async function lastLogs() {
  const rows = await db.q(`SELECT DISTINCT ON (service, ok) service, ok, action, message, created_at FROM integration_logs
    WHERE created_at > now() - interval '30 days' ORDER BY service, ok, created_at DESC`);
  const m = {};
  rows.forEach((r) => { (m[r.service] = m[r.service] || {})[r.ok ? 'good' : 'fail'] = r; });
  return m;
}
// ✅ when the last thing that happened worked, ❌ when the last thing failed
function fromLog(L, service, setUp) {
  const x = L[service] || {};
  if (!setUp) return { state: OFF, note: 'সেটআপ করা নেই' };
  if (x.fail && (!x.good || new Date(x.fail.created_at) > new Date(x.good.created_at))) return { state: BAD, note: `শেষ চেষ্টা ব্যর্থ (${fmtDate(x.fail.created_at)}): ${String(x.fail.message || '').slice(0, 160)}` };
  if (x.good) return { state: OK, note: `শেষবার ঠিকমতো কাজ করেছে: ${fmtDate(x.good.created_at)}` };
  return { state: WARN, note: 'সেটআপ করা আছে, কিন্তু গত ৩০ দিনে এখনো কোনো কাজ হয়নি' };
}

async function statusPage(ctx) {
  const s = ctx.settings;
  const L = await lastLogs();
  const courier = require('../services/courier');
  const notify = require('../services/notify');
  const payments = require('../services/payments');
  const site = s.site_url || '';
  const methods = payments.methods(s).map((m) => m.label);
  const [lastBackup, feedReport] = await Promise.all([
    db.one(`SELECT * FROM backups WHERE ok ORDER BY created_at DESC LIMIT 1`).catch(() => null),
    require('../services/feeds').build('google', s, site || 'https://example.com').then((r) => r.report).catch(() => null),
  ]);
  const ageDays = lastBackup ? (Date.now() - new Date(lastBackup.created_at).getTime()) / 864e5 : null;
  const feedSeen = (ch) => { const x = (L[ch + '-feed'] || {}).good; return x ? `শেষবার ${x.message || 'কেউ'} পড়েছে: ${fmtDate(x.created_at)}` : 'এখনো কেউ ফিডটা পড়েনি (Merchant Center / Commerce Manager-এ লিংক দেওয়া হয়েছে কি না দেখুন)'; };

  const body = html`<h1>🔌 সংযোগের অবস্থা</h1>${ui.flash(ctx.flash)}
<p class="muted">বাইরের প্রতিটা সার্ভিস ঠিকমতো জোড়া আছে কি না, আর শেষবার কাজ করেছে কি না — এক জায়গায়। ❌ দেখলে পাশের লিংকে গিয়ে ঠিক করুন।</p>
<section class="panel"><h2>ওয়েবসাইট</h2><ul class="sec-list">
  ${row(site ? OK : BAD, 'ওয়েবসাইটের ঠিকানা (site URL)', site ? site : 'দেওয়া নেই — Google-এর canonical লিংক, sitemap, শেয়ার ছবি আর পেমেন্ট ফেরার লিংক ঠিক হবে না।', ['/admin/marketing/seo', 'SEO'])}
  ${row(s.custom_domain ? OK : WARN, 'নিজের ডোমেইন', s.custom_domain || 'এখনো vercel.app ঠিকানায় চলছে', ['/admin/integrations/domain', 'ডোমেইন'])}
  ${row(require('../security').hasKey() ? OK : WARN, 'গোপন তথ্য এনক্রিপশন (ENCRYPTION_KEY)', require('../security').hasKey() ? 'চালু' : 'বন্ধ — পেমেন্ট/কুরিয়ারের পাসওয়ার্ড সাধারণ লেখায় সেভ হচ্ছে', ['/admin/security', 'নিরাপত্তা'])}
  ${ctx.user.role === 'owner' ? row(ageDays === null ? BAD : ageDays > 8 ? WARN : OK, 'ব্যাকআপ', ageDays === null ? 'এখনো কোনো ব্যাকআপ নেওয়া হয়নি!' : `শেষ ব্যাকআপ: ${fmtDate(lastBackup.created_at)} (${lastBackup.kind === 'auto' ? 'নিজে থেকে' : 'হাতে'})`, ['/admin/backup', 'ব্যাকআপ']) : ''}
</ul></section>
<section class="panel"><h2>মার্কেটিং ও ট্র্যাকিং</h2><ul class="sec-list">
  ${row(s.fb_pixel_id ? OK : OFF, 'Facebook Pixel', s.fb_pixel_id ? `Pixel ID ${s.fb_pixel_id}` : 'সেটআপ করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'])}
  ${(() => { const r = fromLog(L, 'facebook', !!(s.fb_pixel_id && s.fb_capi_token)); return row(r.state, 'Facebook Conversions API (সার্ভার থেকে Purchase)', r.state === OK && !(L.facebook || {}).good ? r.note : r.note, ['/admin/marketing/tracking', 'পিক্সেল']); })()}
  ${row(s.fb_domain_verification ? OK : WARN, 'Facebook ডোমেইন ভেরিফিকেশন', s.fb_domain_verification ? 'মেটা ট্যাগ বসানো আছে' : 'দেওয়া নেই — বিজ্ঞাপনের ইভেন্ট ঠিক রাখতে দরকার', ['/admin/marketing/tracking', 'পিক্সেল'])}
  ${row(s.tiktok_pixel_id ? OK : OFF, 'TikTok Pixel', s.tiktok_pixel_id ? `Pixel ID ${s.tiktok_pixel_id}` : 'সেটআপ করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'])}
  ${(() => { const r = fromLog(L, 'tiktok', !!(s.tiktok_pixel_id && s.tiktok_events_token)); return row(r.state, 'TikTok Events API', r.note, ['/admin/marketing/tracking', 'পিক্সেল']); })()}
  ${row(s.ga4_id || s.gtm_id ? OK : OFF, 'Google Analytics / Tag Manager', [s.ga4_id && `GA4 ${s.ga4_id}`, s.gtm_id && `GTM ${s.gtm_id}`].filter(Boolean).join(' · ') || 'সেটআপ করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'])}
  ${row(s.google_site_verification ? OK : WARN, 'Google Search Console', s.google_site_verification ? 'ভেরিফিকেশন ট্যাগ বসানো আছে — sitemap জমা দিয়েছেন কি না দেখুন' : 'ভেরিফাই করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'])}
  ${row(s.feed_google_token ? OK : OFF, 'Google Merchant Center ফিড', s.feed_google_token ? `${feedReport ? `${bn(feedReport.included)}টি পণ্য যাচ্ছে${feedReport.excluded.length ? `, ${bn(feedReport.excluded.length)}টি বাদ (ছবি/দাম নেই)` : ''}। ` : ''}${feedSeen('google')}` : 'ফিড লিংক বানানো হয়নি', ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড'])}
  ${row(s.feed_facebook_token ? OK : OFF, 'Facebook / Meta ক্যাটালগ ফিড', s.feed_facebook_token ? feedSeen('facebook') : 'ফিড লিংক বানানো হয়নি', ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড'])}
</ul></section>
<section class="panel"><h2>পেমেন্ট ও কুরিয়ার</h2><ul class="sec-list">
  ${row(OK, 'চেকআউটে যে পেমেন্ট দেখাচ্ছে', methods.join(' · '), ['/admin/integrations/payments', 'পেমেন্ট'])}
  ${(() => { const r = fromLog(L, 'bkash', s.pay_bkash === '1'); return row(r.state, 'বিকাশ অনলাইন পেমেন্ট', r.state === OFF ? 'বন্ধ' : (s.bkash_sandbox === '1' ? '🧪 টেস্ট মোড (sandbox) — আসল টাকা নেওয়া হবে না। ' : '') + r.note, ['/admin/integrations/payments', 'পেমেন্ট']); })()}
  ${(() => { const r = fromLog(L, 'sslcommerz', s.pay_ssl === '1'); return row(r.state, 'SSLCommerz (কার্ড/নগদ/রকেট)', r.state === OFF ? 'বন্ধ' : (s.ssl_sandbox === '1' ? '🧪 টেস্ট মোড — ' : '') + r.note, ['/admin/integrations/payments', 'পেমেন্ট']); })()}
  ${Object.keys(courier.PROVIDERS).map((c) => { const r = fromLog(L, c, courier.configured(s, c)); return row(r.state, courier.label(c), r.note, ['/admin/integrations/courier', 'কুরিয়ার']); })}
  ${row(s.courier_auto_send === '1' ? OK : OFF, 'কনফার্ম হলে নিজে থেকে কুরিয়ারে পাঠানো', s.courier_auto_send === '1' ? `চালু (${courier.label(s.courier_default)})` : 'বন্ধ', ['/admin/integrations/courier', 'কুরিয়ার'])}
</ul></section>
<section class="panel"><h2>নোটিফিকেশন</h2><ul class="sec-list">
  ${(() => { const r = fromLog(L, 'notify-email', notify.emailConfig(s).ready); return row(r.state, 'ইমেইল (Gmail)', r.note, ['/admin/notify', 'নোটিফিকেশন']); })()}
  ${(() => { const r = fromLog(L, 'notify-whatsapp', notify.waConfig(s).ready); return row(r.state, 'WhatsApp (CallMeBot)', r.note, ['/admin/notify', 'নোটিফিকেশন']); })()}
  ${(() => { const r = fromLog(L, 'notify-push', true); return row(r.state === WARN ? OFF : r.state, 'ফোনে নোটিফিকেশন (push)', r.state === WARN ? 'এখনো কোনো ফোনে চালু হয়নি বা কিছু পাঠানো হয়নি' : r.note, ['/admin/notify', 'নোটিফিকেশন']); })()}
</ul></section>
<p class="small muted">API কী আর পাসওয়ার্ড সার্ভারে এনক্রিপ্ট করে রাখা হয়, ব্রাউজার বা কাস্টমার কখনো দেখে না। <a href="/admin/marketing/seo?tab=check">SEO চেকার →</a></p>`;
  return ctx.page('সংযোগের অবস্থা', body, 'status');
}

// ---------------------------------------------------------------- SEO checker
async function seoProblems() {
  const rows = await db.q(`SELECT p.id, p.name, p.sku, p.seo_title, p.seo_description, p.short_description, p.description, p.image_id, p.category_id, p.noindex,
      (SELECT count(*) FROM products x WHERE x.active AND lower(x.name)=lower(p.name) AND x.id<>p.id)::int AS same_name
    FROM products p WHERE p.active ORDER BY p.id`);
  const out = [];
  for (const p of rows) {
    const why = [];
    const title = p.seo_title || p.name;
    if (!p.image_id) why.push(['bad', 'ছবি নেই']);
    if (!String(p.description || '').trim() && !String(p.short_description || '').trim()) why.push(['bad', 'কোনো বিবরণ নেই']);
    if (title.length > 65) why.push(['warn', `টাইটেল লম্বা (${title.length} অক্ষর) — গুগলে কেটে যাবে`]);
    if (title.length < 15) why.push(['warn', 'টাইটেল খুব ছোট']);
    if (!p.seo_description && String(p.short_description || '').trim().length < 50) why.push(['warn', 'SEO বিবরণ নেই, ছোট বিবরণও খুব ছোট']);
    if (!p.category_id) why.push(['warn', 'ক্যাটাগরি নেই']);
    if (p.same_name) why.push(['warn', 'একই নামের আরেকটা পণ্য আছে']);
    if (p.noindex) why.push(['info', 'noindex — গুগলে দেখাবে না']);
    if (why.length) out.push({ ...p, why });
  }
  return { total: rows.length, list: out };
}

module.exports = {
  routes: [{ method: 'GET', path: '/admin/integrations/status', perm: 'settings', handler: statusPage }],
  seoProblems,
};

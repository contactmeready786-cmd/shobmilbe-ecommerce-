// Admin → সংযোগের অবস্থা: one page that shows whether every outside connection is set up and working —
// Google / Facebook / TikTok tracking, product feeds, couriers, payments, notifications, backups —
// plus the SEO checker (products that Google may show badly).
import { Val, attrValue } from '../react/html';
import { bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as $setupmarks from './setupmarks';
import * as $services_courier from '../services/courier';
import * as $services_notify from '../services/notify';
import * as $services_payments from '../services/payments';
import * as $services_feeds from '../services/feeds';
import * as $security from '../security';
import type { AdminCtx, Loose } from '../types';

const OK = 'ok'; const WARN = 'warn'; const OFF = 'off'; const BAD = 'bad';
const ICON: Record<string, string> = { ok: '✅', warn: '⚠️', off: '⚪', bad: '❌' };
// one line of the list. key = for the owner's ✓ করা আছে / ✕ দরকার নেই marks (setupmarks.js); setUp = the site sees it set up
function row(state?: Loose, title?: Loose, detail?: Loose, link?: Loose, key?: Loose, setUp?: Loose) {
  return { state, title, detail, link, key, setUp: setUp === undefined ? state === OK : setUp };
}
function line(r?: Loose, buttons?: Loose) {
  return <li className={`sec-row ${r.state === OK ? 'ok' : r.state === OFF ? 'info' : 'todo'}`}><span className="sec-ic" aria-hidden="true"><Val v={ICON[r.state]} /></span>{' '}<span><b><Val v={r.title} /></b><br /><span className="small muted"><Val v={r.detail} /></span>{(r.link ? <>{' '}<a className="small" href={attrValue(r.link[0])}><Val v={r.link[1]} />{' '}→</a></> : null)}{(buttons ? <><br /><Val v={buttons} /></> : null)}</span></li>;
}
// a section: what needs looking at stays in view; ⚪ not set up (optional) and "দরকার নেই" go into a closed box
function section(ctx: AdminCtx, title?: Loose, rows?: Loose) {
  const M = $setupmarks;
  const owner = ctx.user.role === 'owner';
  const back = '/admin/integrations/status';
  const shown: Loose[] = []; const quiet = [];
  for (const r of rows.filter(Boolean)) {
    const mark = r.key ? M.markOf(ctx.settings, r.key, r.setUp) : '';
    if (mark === 'done' && r.state !== OK) { shown.push(line({ ...r, state: OK, detail: 'আপনি জানিয়েছেন অন্যভাবে করা আছে (সাইট নিজে দেখতে পায় না)।' }, owner ? M.buttons(r.key, 'done', back) : '')); continue; }
    if (mark === 'skip' && r.state !== OK) { quiet.push(line({ ...r, state: OFF, detail: 'দরকার নেই — এখন ব্যবহার করছেন না।' }, owner ? M.buttons(r.key, 'skip', back) : '')); continue; }
    if (r.state === OFF) { quiet.push(line(r, owner && r.key ? M.buttons(r.key, '', back) : '')); continue; }
    shown.push(line(r, owner && r.key && r.state !== OK ? M.buttons(r.key, '', back) : ''));
  }
  if (!shown.length && !quiet.length) return '';
  return <section className="panel"><h2><Val v={title} /></h2>{(shown.length ? <ul className="sec-list"><Val v={shown} /></ul> : <p className="muted small">সব ঠিক আছে — দেখার মতো কিছু নেই।</p>)}{' '}{(quiet.length ? <details className="sec-quiet"><summary className="small muted">⚪ চালু করা নেই / দরকার নেই ({bn(quiet.length)}টি) — দেখতে চাপুন</summary><ul className="sec-list"><Val v={quiet} /></ul></details> : null)}</section>;
}

// latest success / failure per service from the integration log
async function lastLogs() {
  const rows = await db.q(`SELECT DISTINCT ON (service, ok) service, ok, action, message, created_at FROM integration_logs
    WHERE created_at > now() - interval '30 days' ORDER BY service, ok, created_at DESC`);
  const m: Record<string, string> = {};
  rows.forEach((r) => { (m[r.service] = m[r.service] || {} as Loose)[r.ok ? 'good' : 'fail'] = r; });
  return m;
}
// ✅ when the last thing that happened worked, ❌ when the last thing failed
function fromLog(L?: Loose, service?: Loose, setUp?: Loose) {
  const x = L[service] || {};
  if (!setUp) return { state: OFF, note: 'সেটআপ করা নেই' };
  if (x.fail && (!x.good || new Date(x.fail.created_at) > new Date(x.good.created_at))) return { state: BAD, note: `শেষ চেষ্টা ব্যর্থ (${fmtDate(x.fail.created_at)}): ${String(x.fail.message || '').slice(0, 160)}` };
  if (x.good) return { state: OK, note: `শেষবার ঠিকমতো কাজ করেছে: ${fmtDate(x.good.created_at)}` };
  return { state: WARN, note: 'সেটআপ করা আছে, কিন্তু গত ৩০ দিনে এখনো কোনো কাজ হয়নি' };
}

async function statusPage(ctx: AdminCtx) {
  const s = ctx.settings;
  const L: Loose = await lastLogs();
  const courier = $services_courier;
  const notify = $services_notify;
  const payments = $services_payments;
  const site = s.site_url || '';
  const methods = payments.methods(s).map((m) => m.label);
  const [lastBackup, feedReport] = await Promise.all([
    db.one(`SELECT * FROM backups WHERE ok ORDER BY created_at DESC LIMIT 1`).catch(() => null),
    $services_feeds.build('google', s, site || 'https://example.com').then((r) => r.report).catch(() => null),
  ]);
  const ownDomain = /^https?:\/\//.test(site) && !/vercel\.app/.test(site) ? site.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '';
  const fbPage = !!(s.autopost_page_token && s.autopost_page_id);
  const ageDays = lastBackup ? (Date.now() - new Date(lastBackup.created_at).getTime()) / 864e5 : null;
  const feedSeen = (ch?: Loose) => { const x = (L[ch + '-feed'] || {}).good; return x ? `শেষবার ${x.message || 'কেউ'} পড়েছে: ${fmtDate(x.created_at)}` : 'এখনো কেউ ফিডটা পড়েনি (Merchant Center / Commerce Manager-এ লিংক দেওয়া হয়েছে কি না দেখুন)'; };

  const body = <><h1>🔌 সংযোগের অবস্থা</h1>{ui.flash(ctx.flash)}<p className="muted">বাইরের প্রতিটা সার্ভিস ঠিকমতো জোড়া আছে কি না, আর শেষবার কাজ করেছে কি না — এক জায়গায়। ❌ দেখলে পাশের লিংকে গিয়ে ঠিক করুন। অন্যভাবে করা থাকলে "✓ করা আছে", ব্যবহার না করলে "✕ দরকার নেই" চাপুন — তালিকা থেকে সরে যাবে।</p>{(ctx.user.role === 'owner' ? <p><a className="btn btn-ghost btn-sm" href="/admin/health">🩺 সার্ভার, ডাটাবেস ও ছবির জায়গা দেখুন →</a></p> : null)}{' '}{section(ctx, 'ওয়েবসাইট', [
  row(site ? OK : BAD, 'ওয়েবসাইটের ঠিকানা (site URL)', site ? site : 'দেওয়া নেই — Google-এর canonical লিংক, sitemap, শেয়ার ছবি আর পেমেন্ট ফেরার লিংক ঠিক হবে না।', ['/admin/marketing/seo', 'SEO']),
  // the domain may be added straight in Vercel (no token saved here): a site address that is not *.vercel.app counts too
  row(s.custom_domain || ownDomain ? OK : WARN, 'নিজের ডোমেইন', s.custom_domain || ownDomain || 'এখনো vercel.app ঠিকানায় চলছে', ['/admin/integrations/domain', 'ডোমেইন'], 'domain'),
  row($security.hasKey() ? OK : WARN, 'গোপন তথ্য এনক্রিপশন (ENCRYPTION_KEY)', $security.hasKey() ? 'চালু' : 'বন্ধ — পেমেন্ট/কুরিয়ারের পাসওয়ার্ড সাধারণ লেখায় সেভ হচ্ছে', ['/admin/security', 'নিরাপত্তা']),
  ctx.user.role === 'owner' ? row(ageDays === null ? BAD : ageDays > 8 ? WARN : OK, 'ব্যাকআপ', ageDays === null ? 'এখনো কোনো ব্যাকআপ নেওয়া হয়নি!' : `শেষ ব্যাকআপ: ${fmtDate(lastBackup!.created_at)} (${lastBackup!.kind === 'auto' ? 'নিজে থেকে' : 'হাতে'})`, ['/admin/backup', 'ব্যাকআপ']) : null,
])}{' '}{section(ctx, 'Google', [
  row(s.google_site_verification ? OK : WARN, 'Google Search Console', s.google_site_verification ? 'ভেরিফিকেশন ট্যাগ বসানো আছে — sitemap জমা দিয়েছেন কি না দেখুন' : 'সাইটে ভেরিফিকেশন ট্যাগ নেই। DNS দিয়ে ভেরিফাই করে থাকলে "✓ করা আছে" চাপুন।', ['/admin/marketing/tracking', 'পিক্সেল'], 'gsc'),
  row(s.feed_google_token ? OK : WARN, 'Google Merchant Center ফিড', s.feed_google_token ? `${feedReport ? `${bn(feedReport.included)}টি পণ্য যাচ্ছে${feedReport.excluded.length ? `, ${bn(feedReport.excluded.length)}টি বাদ (ছবি/দাম নেই)` : ''}। ` : ''}${feedSeen('google')}` : 'ফিড লিংক বানানো হয়নি', ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড'], 'gmc_feed'),
  row(s.ga4_id || s.gtm_id ? OK : OFF, 'Google Analytics / Tag Manager (ফ্রি)', [s.ga4_id && `GA4 ${s.ga4_id}`, s.gtm_id && `GTM ${s.gtm_id}`].filter(Boolean).join(' · ') || 'সেটআপ করা নেই — দোকানের নিজের "ভিজিটর অ্যানালিটিক্স" আছে, তাই জরুরি না', ['/admin/marketing/tracking', 'পিক্সেল'], 'ga4'),
])}{' '}{section(ctx, 'Facebook', [
  row(fbPage ? OK : WARN, 'Facebook পেজ (অটো পোস্ট)', fbPage ? `${s.autopost_page_name || 'পেজ যুক্ত'}${s.autopost_on === '1' ? ' · প্রতিদিন পোস্ট চালু' : ' · অটো পোস্ট বন্ধ'}${s.autopost_ig_name ? ` · Instagram @${s.autopost_ig_name}` : ''}` : 'পেজ যুক্ত করা নেই', ['/admin/marketing/auto', 'অটো মার্কেটিং'], 'fb_page'),
  row(s.feed_facebook_token ? OK : OFF, 'Facebook / Meta ক্যাটালগ ফিড (ফ্রি)', s.feed_facebook_token ? feedSeen('facebook') : 'ফিড লিংক বানানো হয়নি — Facebook শপ বা ক্যাটালগ চালালে লাগবে', ['/admin/marketing/feeds', 'প্রোডাক্ট ফিড'], 'fb_feed'),
])}{' '}{section(ctx, '💰 পেইড বিজ্ঞাপনের ট্র্যাকিং (বিজ্ঞাপন চালালে লাগবে)', [
  row(s.fb_pixel_id ? OK : OFF, 'Facebook Pixel', s.fb_pixel_id ? `Pixel ID ${s.fb_pixel_id}` : 'সেটআপ করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'], 'fb_pixel', !!s.fb_pixel_id),
  (() => { const r = fromLog(L, 'facebook', !!(s.fb_pixel_id && s.fb_capi_token)); return row(r.state, 'Facebook Conversions API (সার্ভার থেকে Purchase)', r.note, ['/admin/marketing/tracking', 'পিক্সেল'], 'fb_capi', !!(s.fb_pixel_id && s.fb_capi_token)); })(),
  // only matters for ads: without a pixel it is not a problem
  row(s.fb_domain_verification ? OK : s.fb_pixel_id ? WARN : OFF, 'Facebook ডোমেইন ভেরিফিকেশন', s.fb_domain_verification ? 'মেটা ট্যাগ বসানো আছে' : 'দেওয়া নেই — বিজ্ঞাপন চালালে লাগবে', ['/admin/marketing/tracking', 'পিক্সেল'], 'fb_domain', !!s.fb_domain_verification),
  row(s.tiktok_pixel_id ? OK : OFF, 'TikTok Pixel', s.tiktok_pixel_id ? `Pixel ID ${s.tiktok_pixel_id}` : 'সেটআপ করা নেই', ['/admin/marketing/tracking', 'পিক্সেল'], 'tiktok_pixel', !!s.tiktok_pixel_id),
  (() => { const r = fromLog(L, 'tiktok', !!(s.tiktok_pixel_id && s.tiktok_events_token)); return row(r.state, 'TikTok Events API', r.note, ['/admin/marketing/tracking', 'পিক্সেল'], 'tiktok_events', !!(s.tiktok_pixel_id && s.tiktok_events_token)); })(),
])}{' '}{section(ctx, 'পেমেন্ট ও কুরিয়ার', [
  row(OK, 'চেকআউটে যে পেমেন্ট দেখাচ্ছে', methods.join(' · '), ['/admin/integrations/payments', 'পেমেন্ট']),
  (() => { const r = fromLog(L, 'bkash', s.pay_bkash === '1'); return row(r.state, 'বিকাশ অনলাইন পেমেন্ট', r.state === OFF ? 'বন্ধ' : (s.bkash_sandbox === '1' ? '🧪 টেস্ট মোড (sandbox) — আসল টাকা নেওয়া হবে না। ' : '') + r.note, ['/admin/integrations/payments', 'পেমেন্ট'], 'bkash'); })(),
  (() => { const r = fromLog(L, 'sslcommerz', s.pay_ssl === '1'); return row(r.state, 'SSLCommerz (কার্ড/নগদ/রকেট)', r.state === OFF ? 'বন্ধ' : (s.ssl_sandbox === '1' ? '🧪 টেস্ট মোড — ' : '') + r.note, ['/admin/integrations/payments', 'পেমেন্ট'], 'ssl'); })(),
  ...Object.keys(courier.PROVIDERS).map((c) => { const r = fromLog(L, c, courier.configured(s, c)); return row(r.state, courier.label(c), r.note, ['/admin/integrations/courier', 'কুরিয়ার'], 'courier_' + c); }),
  row(s.courier_auto_send === '1' ? OK : OFF, 'কনফার্ম হলে নিজে থেকে কুরিয়ারে পাঠানো', s.courier_auto_send === '1' ? `চালু (${courier.label(s.courier_default)})` : 'বন্ধ', ['/admin/integrations/courier', 'কুরিয়ার']),
])}{' '}{section(ctx, 'নোটিফিকেশন', [
  (() => { const r = fromLog(L, 'notify-email', notify.emailConfig(s).ready); return row(r.state, 'ইমেইল (Gmail)', r.note, ['/admin/notify', 'নোটিফিকেশন'], 'notify_email'); })(),
  (() => { const r = fromLog(L, 'notify-whatsapp', notify.waConfig(s).ready); return row(r.state, 'WhatsApp (CallMeBot)', r.note, ['/admin/notify', 'নোটিফিকেশন'], 'notify_wa'); })(),
  (() => { const r = fromLog(L, 'notify-push', true); return row(r.state === WARN ? OFF : r.state, 'ফোনে নোটিফিকেশন (push)', r.state === WARN ? 'এখনো কোনো ফোনে চালু হয়নি বা কিছু পাঠানো হয়নি' : r.note, ['/admin/notify', 'নোটিফিকেশন'], 'notify_push'); })(),
])}<p className="small muted">API কী আর পাসওয়ার্ড সার্ভারে এনক্রিপ্ট করে রাখা হয়, ব্রাউজার বা কাস্টমার কখনো দেখে না।{' '}<a href="/admin/marketing/seo?tab=check">SEO চেকার →</a></p></>;
  return ctx.page('সংযোগের অবস্থা', body, 'status');
}

// ---------------------------------------------------------------- SEO checker
// 🩺 SEO checker (Admin → মার্কেটিং → SEO → SEO চেকার): every product's problems and a score out of 100.
// The score adds up what Google uses to rank a product page: a picture (and more than one), real text in the
// shop's own words, the model / part number people type ("PAM8403"), specifications, a category, a brand, reviews.
// "bad" problems cost the most; "info" lines cost nothing (just good to know).
export const routes = [{ method: 'GET', path: '/admin/integrations/status', perm: 'settings', handler: statusPage }];
export { seoProblems, seoScore, SEO_WEIGHTS } from '../services/seoscore';

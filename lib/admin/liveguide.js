'use strict';
// 🧭 "এখন কী করবেন" — a live guideline panel for the owner (shown on গ্রোথ গাইড and কাস্টমারের কাছে পৌঁছান).
// Every tip is worked out fresh from: the time right now in Dhaka, the day of the week, the season and
// upcoming Bangladeshi occasions, and the shop's own live numbers (visitors, carts, incomplete orders,
// stock, trending products). The panel refreshes itself every minute while the page is open.
const { html, bn } = require('../util');
const db = require('../db');

const DAY = 864e5;
const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

// Occasions that move sales in Bangladesh. [month (1-12), day, name, what to do]  — same date every year
const FIXED_DAYS = [
  [2, 14, 'ভালোবাসা দিবস', 'গিফট আইটেম, LED লাইট, ট্রিমার/গ্রুমিং সেট — "উপহার" অফার আর গিফট বান্ডেল দিন।'],
  [2, 21, 'শহীদ দিবস (২১ ফেব্রুয়ারি)', 'শ্রদ্ধা জানিয়ে পোস্ট দিন; ছুটির দিনে মানুষ অনলাইনে বেশি থাকে।'],
  [3, 26, 'স্বাধীনতা দিবস', 'লাল-সবুজ থিমের পোস্ট আর ছোট ছুটির অফার।'],
  [4, 14, 'পহেলা বৈশাখ', 'বৈশাখী অফার, ফ্যাশন আইটেম, ঘর সাজানোর লাইট — ১ সপ্তাহ আগে থেকে প্রচার শুরু করুন।'],
  [11, 11, '১১.১১ অনলাইন সেল', 'বাংলাদেশে অনেক অনলাইন দোকান এদিন বড় সেল দেয় — ফ্ল্যাশ সেল আর কুপন তৈরি রাখুন।'],
  [12, 16, 'বিজয় দিবস', '"বিজয় অফার" — ছোট ছাড় বা ফ্রি ডেলিভারি কুপন।'],
  [12, 31, 'বছর শেষ / নতুন বছর', 'বছর শেষের ক্লিয়ারেন্স সেল — পুরনো স্টক বের করার ভালো সময়।'],
];
// Lunar dates move every year (by the moon sighting) — these are close estimates and are labelled so.
const MOON_DAYS = [
  ['2027-02-08', 'রমজান শুরু (আনুমানিক)', 'রাতে (ইফতারের পর থেকে সেহরি পর্যন্ত) মানুষ বেশি অনলাইনে থাকে — পোস্ট আর বিজ্ঞাপন রাত ৯টা–১টায় দিন।'],
  ['2027-03-10', 'ঈদুল ফিতর (আনুমানিক)', 'ঈদের ১০-১৪ দিন আগে থেকে ঈদ অফার। কুরিয়ার ঈদের ৩-৪ দিন আগে বন্ধ হয় — "ঈদের আগে পেতে অর্ডার করুন অমুক তারিখের মধ্যে" লিখুন।'],
  ['2027-05-17', 'ঈদুল আজহা (আনুমানিক)', 'ফ্রিজ/ইলেকট্রিক্যাল পার্টস আর চাপাতি-ছুরি শার্পনারের চাহিদা বাড়ে। কুরিয়ারের ছুটির আগে শেষ অর্ডারের তারিখ জানিয়ে দিন।'],
  ['2028-01-28', 'রমজান শুরু (আনুমানিক)', 'রাতে মানুষ বেশি অনলাইনে থাকে — পোস্ট আর বিজ্ঞাপন রাত ৯টা–১টায় দিন।'],
  ['2028-02-27', 'ঈদুল ফিতর (আনুমানিক)', 'ঈদের ১০-১৪ দিন আগে থেকে ঈদ অফার; কুরিয়ারের শেষ তারিখ জানিয়ে দিন।'],
];
// What sells by season (by month)
function seasonTip(month) {
  if ([11, 12, 1].includes(month)) return ['❄️', 'শীতের মৌসুম', 'রুম হিটার/গিজারের পার্টস, হিটার কয়েল, ট্রিমার, পাওয়ার ব্যাংক, লাইট — এগুলো সামনে রাখুন। দিন ছোট, সন্ধ্যা ৭-১১টায় সবচেয়ে বেশি কেনাকাটা।'];
  if ([2].includes(month)) return ['🌸', 'বসন্ত ও বিয়ের মৌসুম', 'গিফট আইটেম, ডেকোরেশন লাইট, ফ্যাশন — উপহারের বান্ডেল বানিয়ে দিন।'];
  if ([3, 4, 5].includes(month)) return ['☀️', 'গরমের মৌসুম', 'এসি রিমোট, ফ্যানের ক্যাপাসিটর/মোটর, রিচার্জেবল ফ্যান, কুলিং পার্টস — এখন চাহিদা সবচেয়ে বেশি। স্টক আগে থেকে বাড়ান।'];
  if ([6, 7, 8, 9].includes(month)) return ['🌧️', 'বর্ষা ও লোডশেডিংয়ের সময়', 'IPS/ব্যাটারি পার্টস, রিচার্জেবল লাইট-ফ্যান, ওয়াটারপ্রুফ জিনিস, স্ট্যাবিলাইজার — এগুলোর বিজ্ঞাপন দিন।'];
  return ['🍂', 'হেমন্ত — শীতের প্রস্তুতি', 'শীতের পণ্য (হিটার পার্টস, গিজার) এখনই স্টকে আনুন আর ছবি-ভিডিও রেডি রাখুন; নভেম্বরে চাহিদা হঠাৎ বাড়ে।'];
}

function dhakaNow() {
  const d = new Date(Date.now() + 6 * 3600e3); // Asia/Dhaka is UTC+6 all year (no daylight saving)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes(), ts: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) };
}
const bnTime = (h, m) => `${bn(((h + 11) % 12) + 1)}:${bn(String(m).padStart(2, '0'))} ${h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 19 ? 'বিকেল' : 'রাত'}`;

function timeTip(t) {
  const { h, wd } = t;
  const weekend = wd === 5 || wd === 6; // Friday, Saturday
  if (h >= 0 && h < 7) return ['🌙', 'এখন গভীর রাত', 'নতুন পোস্ট না দিয়ে কাল সকালের পোস্ট শিডিউল করে রাখুন (সকাল ৯-১০টা)। রাতে আসা অর্ডারগুলো সকালেই কনফার্ম করবেন।'];
  if (h < 11) return ['🌅', 'সকাল — অর্ডার কনফার্মের সময়', 'রাতের অর্ডারগুলো এখন ফোন করে কনফার্ম করুন আর কুরিয়ারে দিন — দুপুরের আগে দিলে পরের দিন ঢাকায় পৌঁছায়।'];
  if (h < 15) return ['🍱', 'দুপুর — দ্বিতীয় ব্যস্ত সময় (১-৩টা)', 'লাঞ্চ ব্রেকে মানুষ ফোন দেখে। একটা ছোট ভিডিও বা অফার পোস্ট দেওয়ার ভালো সময়।'];
  if (h < 19) return ['📦', 'বিকেল — কুরিয়ার ও স্টক', 'আজকের সব অর্ডার কুরিয়ারে গেছে কি না দেখুন, কাল কী মাল লাগবে তার তালিকা করুন।'];
  return ['🔥', weekend ? 'রাত — সপ্তাহের সবচেয়ে ব্যস্ত সময়' : 'রাত ৮-১১টা — সবচেয়ে বেশি কেনাকাটার সময়', 'Facebook/TikTok-এ এখনই পোস্ট দিন বা বুস্ট চালান, মেসেজের দ্রুত উত্তর দিন — এই সময়ের মেসেজ সবচেয়ে বেশি অর্ডারে বদলায়।'];
}

async function liveNumbers() {
  const one = async (sql) => { try { return (await db.q(sql))[0] || {}; } catch (_) { return {}; } };
  const many = async (sql) => { try { return await db.q(sql); } catch (_) { return []; } };
  const [now, carts, drafts, pending, trend, emptyHot] = await Promise.all([
    one(`SELECT (SELECT count(*) FROM visit_sessions WHERE last_seen > now() - interval '5 minutes')::int AS online,
      (SELECT count(DISTINCT visitor_id) FROM page_views WHERE created_at > now() - interval '24 hours')::int AS visitors24,
      (SELECT count(*) FROM orders WHERE created_at > now() - interval '24 hours')::int AS orders24`),
    one(`SELECT count(DISTINCT e.visitor_id)::int AS n FROM visit_events e WHERE e.event IN ('add_to_cart','begin_checkout') AND e.created_at > now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM visit_events p WHERE p.visitor_id=e.visitor_id AND p.event='purchase' AND p.created_at > e.created_at)`),
    one(`SELECT count(*)::int AS n FROM checkout_drafts WHERE status='open' AND updated_at > now() - interval '3 days'`),
    one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE created_at < now() - interval '1 hour')::int AS late FROM orders WHERE status='pending'`),
    many(`SELECT p.id, p.name, count(DISTINCT v.visitor_id) FILTER (WHERE v.created_at > now() - interval '2 days')::int AS recent,
        count(DISTINCT v.visitor_id) FILTER (WHERE v.created_at <= now() - interval '2 days')::int AS before
      FROM page_views v JOIN products p ON p.id=v.product_id
      WHERE v.created_at > now() - interval '14 days' AND p.active GROUP BY p.id, p.name
      HAVING count(DISTINCT v.visitor_id) FILTER (WHERE v.created_at > now() - interval '2 days') >= 3
      ORDER BY count(DISTINCT v.visitor_id) FILTER (WHERE v.created_at > now() - interval '2 days') DESC LIMIT 3`),
    many(`SELECT p.id, p.name, count(DISTINCT v.visitor_id)::int AS n FROM page_views v JOIN products p ON p.id=v.product_id
      WHERE v.created_at > now() - interval '7 days' AND p.active AND p.stock <= 0 AND p.product_type='single'
      GROUP BY p.id, p.name HAVING count(DISTINCT v.visitor_id) >= 3 ORDER BY 3 DESC LIMIT 3`),
  ]);
  return { now, carts, drafts, pending, trend, emptyHot };
}

async function tips() {
  const t = dhakaNow();
  const n = await liveNumbers();
  const list = [];
  // 1. urgent work from the shop's own numbers
  if (n.pending.late) list.push({ ic: '⏰', lv: 'hot', t: `${bn(n.pending.late)}টি অর্ডার ১ ঘণ্টার বেশি কনফার্ম ছাড়া পড়ে আছে`, d: 'এখনই ফোন করুন — দেরি হলে কাস্টমার অন্য দোকান থেকে কিনে ফেলে।', link: '/admin/orders?status=pending' });
  if (n.drafts.n) list.push({ ic: '📞', lv: 'hot', t: `${bn(n.drafts.n)} জন ফোন নম্বর দিয়েও অর্ডার শেষ করেনি`, d: 'অসম্পূর্ণ অর্ডারের তালিকা থেকে ফোন করুন — প্রায় অর্ধেক কাস্টমার একটা ফোনেই অর্ডার করে ফেলে।', link: '/admin/orders/incomplete' });
  if (n.carts.n) list.push({ ic: '🛒', lv: 'warm', t: `গত ২৪ ঘণ্টায় ${bn(n.carts.n)} জন কার্টে রেখে চলে গেছে`, d: 'Facebook-এ "কার্টে-রেখেছে" অডিয়েন্সে ছোট ছাড় বা ফ্রি ডেলিভারির বিজ্ঞাপন চালু রাখুন।', link: '/admin/reach' });
  for (const p of n.emptyHot) list.push({ ic: '📦', lv: 'warm', t: `"${p.name}" — স্টক নেই, অথচ ৭ দিনে ${bn(p.n)} জন দেখেছে`, d: 'চাহিদা আছে! দ্রুত মাল আনুন (পারচেজ), নইলে বিক্রি হারাচ্ছেন।', link: '/admin/purchases/new' });
  for (const p of n.trend) {
    if (p.recent > p.before) list.push({ ic: '📈', lv: 'good', t: `"${p.name}" এখন বেশি দেখা হচ্ছে (২ দিনে ${bn(p.recent)} জন)`, d: 'এই পণ্যের একটা পোস্ট/ভিডিও দিন বা ছোট বুস্ট করুন — গরম থাকতে থাকতে।', link: `/admin/products/${p.id}` });
  }
  if (n.now.visitors24 >= 30) {
    const rate = (n.now.orders24 * 100) / n.now.visitors24;
    if (rate < 1) list.push({ ic: '🔍', lv: 'warm', t: `২৪ ঘণ্টায় ${bn(n.now.visitors24)} জন এসেছে, অর্ডার মাত্র ${bn(n.now.orders24)}টি`, d: 'মানুষ আসছে কিন্তু কিনছে না — দাম, ডেলিভারি চার্জ, ছবি আর বিবরণ দেখুন; WhatsApp বাটন চালু রাখুন।', link: '/admin/marketing/visitors' });
  }
  // 2. the clock right now
  const [ic, tt, td] = timeTip(t);
  list.push({ ic, lv: 'time', t: `${tt} · এখন ${bnTime(t.h, t.min)}`, d: td });
  if (t.wd === 4) list.push({ ic: '📅', lv: 'time', t: 'আজ বৃহস্পতিবার', d: 'কাল-পরশু ছুটি — আজ সন্ধ্যা থেকে বিজ্ঞাপনের বাজেট একটু বাড়ান, শুক্র-শনিবার বিক্রি বেশি হয়।' });
  if (t.wd === 5) list.push({ ic: '🕌', lv: 'time', t: 'আজ শুক্রবার', d: 'জুমার পর থেকে রাত পর্যন্ত মানুষ ফোনে বেশি থাকে — বিকেলে একটা বড় পোস্ট দিন। কুরিয়ার আজ সাধারণত পিকআপ নেয় না।' });
  // 3. occasions in the next 3 weeks
  const soon = [];
  for (const [m, d, name, what] of FIXED_DAYS) {
    for (const y of [t.y, t.y + 1]) {
      const days = Math.round((Date.UTC(y, m - 1, d) - t.ts) / DAY);
      if (days >= 0 && days <= 21) soon.push({ days, name, what, date: `${bn(d)} ${BN_MONTHS[m - 1]}` });
    }
  }
  for (const [iso, name, what] of MOON_DAYS) {
    const [y, m, d] = iso.split('-').map(Number);
    const days = Math.round((Date.UTC(y, m - 1, d) - t.ts) / DAY);
    if (days >= 0 && days <= 30) soon.push({ days, name, what, date: `${bn(d)} ${BN_MONTHS[m - 1]}` });
  }
  soon.sort((a, b) => a.days - b.days).slice(0, 2).forEach((o) => list.push({ ic: '🎉', lv: 'event', t: `${o.name} — ${o.days === 0 ? 'আজ' : `আর ${bn(o.days)} দিন`} (${o.date})`, d: o.what, link: '/admin/marketing/flash' }));
  // 4. the season
  const [sic, st, sd] = seasonTip(t.m);
  list.push({ ic: sic, lv: 'season', t: `${st} (${BN_MONTHS[t.m - 1]})`, d: sd, link: '/admin/research' });
  return { list, at: bnTime(t.h, t.min), online: n.now.online || 0 };
}

async function panel() {
  const g = await tips();
  return html`<section class="panel live-guide" data-live-refresh="60">
  <div class="lg-head"><h2>🧭 এখন কী করবেন <small>লাইভ গাইডলাইন — আপনার দোকানের এখনকার তথ্য, সময় আর মৌসুম দেখে</small></h2>
    <span class="lg-stamp"><span class="lg-dot"></span> এখন সাইটে ${bn(g.online)} জন · আপডেট ${g.at}</span></div>
  <ul class="lg-list">${g.list.map((x) => html`<li class="lg-${x.lv}"><span class="lg-ic">${x.ic}</span><div><b>${x.link ? html`<a href="${x.link}">${x.t}</a>` : x.t}</b><small>${x.d}</small></div></li>`)}</ul>
</section>`;
}

module.exports = { panel, tips };

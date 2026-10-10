'use strict';
// Admin → মার্কেটিং → 🎯 কাস্টমারের কাছে পৌঁছান (owner).
// The honest, working version of "ads that follow people": everyone who looked at a product here is
// remembered by the shop's Facebook / TikTok / Google tags, and those platforms then show them that
// same product again while they scroll (retargeting / dynamic product ads). This page shows, live:
//  1. whether everything that makes this work is switched on,
//  2. the groups of people (audiences) the shop already has, with exact steps to use them,
//  3. which products to put money behind — worked out from the shop's own numbers (the "algorithm"),
//  4. what is happening on the site right now.
const { html, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');

const BASE = '/admin/reach';

async function numbers() {
  const q = (sql, p = []) => db.q(sql, p).catch(() => []);
  const one = async (sql, p = []) => (await q(sql, p))[0] || {};
  const [aud, buyers, live, products] = await Promise.all([
    one(`SELECT
      (SELECT count(DISTINCT pv.visitor_id) FROM page_views pv JOIN visitors v ON v.id=pv.visitor_id
         WHERE pv.product_id IS NOT NULL AND pv.created_at > now() - interval '30 days' AND v.orders = 0)::int AS viewed_not_bought,
      (SELECT count(DISTINCT e.visitor_id) FROM visit_events e WHERE e.event IN ('add_to_cart','begin_checkout') AND e.created_at > now() - interval '14 days'
         AND NOT EXISTS (SELECT 1 FROM visit_events p WHERE p.visitor_id=e.visitor_id AND p.event='purchase' AND p.created_at > e.created_at))::int AS cart_left,
      (SELECT count(DISTINCT visitor_id) FROM page_views WHERE created_at > now() - interval '30 days')::int AS visitors_30`),
    one(`SELECT count(*)::int AS buyers, count(*) FILTER (WHERE n > 1)::int AS repeat FROM (SELECT phone, count(*) AS n FROM orders
      WHERE status NOT IN ('cancelled','returned') GROUP BY phone) t`),
    one(`SELECT
      (SELECT count(*) FROM visit_sessions WHERE last_seen > now() - interval '5 minutes')::int AS now_online,
      (SELECT count(*) FROM page_views WHERE created_at > date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS views_today,
      (SELECT count(*) FROM orders WHERE created_at > date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS orders_today`),
    // per product: who looked (30 days, last 7, the 7 before), how many sold (30 days), stock
    q(`WITH v AS (SELECT product_id,
          count(DISTINCT visitor_id) AS v30,
          count(DISTINCT visitor_id) FILTER (WHERE created_at > now() - interval '7 days') AS v7,
          count(DISTINCT visitor_id) FILTER (WHERE created_at <= now() - interval '7 days' AND created_at > now() - interval '14 days') AS vprev
        FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY product_id),
      s AS (SELECT oi.product_id, sum(oi.qty) AS sold, count(DISTINCT o.id) AS orders FROM order_items oi JOIN orders o ON o.id=oi.order_id
        WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','returned') GROUP BY oi.product_id)
      SELECT p.id, p.name, p.sku, p.price, p.stock, p.image_id,
        coalesce(v.v30, 0)::int AS v30, coalesce(v.v7, 0)::int AS v7, coalesce(v.vprev, 0)::int AS vprev,
        coalesce(s.sold, 0)::int AS sold, coalesce(s.orders, 0)::int AS orders
      FROM products p LEFT JOIN v ON v.product_id=p.id LEFT JOIN s ON s.product_id=p.id
      WHERE p.active`),
  ]);
  return { aud, buyers, live, products };
}

// The "algorithm": four ranked lists from the shop's own data.
function rank(products) {
  const inStock = products.filter((p) => p.stock > 0);
  const top = (arr, n = 8) => arr.slice(0, n);
  // 1. many look, few buy → remind them with ads (retargeting)
  const retarget = top(inStock.filter((p) => p.v30 >= 3)
    .map((p) => ({ ...p, why: `${bn(p.v30)} জন দেখেছে, অর্ডার ${bn(p.orders)}টি`, score: p.v30 * (1 - Math.min(1, p.orders / Math.max(1, p.v30))) }))
    .sort((a, b) => b.score - a.score));
  // 2. those who look usually buy → spend to bring new people to these
  const winners = top(inStock.filter((p) => p.v30 >= 5 && p.orders > 0)
    .map((p) => ({ ...p, why: `প্রতি ১০০ জন দেখলে ~${bn(Math.round((p.orders / p.v30) * 100))} জন কেনে`, score: p.orders / p.v30 }))
    .sort((a, b) => b.score - a.score));
  // 3. looked at more this week than the week before
  const trending = top(inStock.filter((p) => p.v7 >= 3 && p.v7 > p.vprev)
    .map((p) => ({ ...p, why: `এ সপ্তাহে ${bn(p.v7)} জন, আগের সপ্তাহে ${bn(p.vprev)} জন`, score: (p.v7 + 1) / (p.vprev + 1) }))
    .sort((a, b) => b.score - a.score));
  // 4. plenty in stock but nobody sees them → a small boost or a post
  const unseen = top(inStock.filter((p) => p.v30 === 0).sort((a, b) => b.stock - a.stock)
    .map((p) => ({ ...p, why: `স্টকে ${bn(p.stock)}টি, ৩০ দিনে কেউ দেখেনি` })));
  return { retarget, winners, trending, unseen };
}

function list(title, help, items, empty) {
  return html`<section class="panel"><h2>${title}</h2><p class="small muted">${help}</p>
  ${items.length ? html`<div class="row-preview">${items.map((p) => html`<a class="rp" href="/admin/products/${p.id}">
    <img src="${p.image_id ? `/media/${p.image_id}/t` : ''}" alt="" loading="lazy"><span>${p.name}</span><b>${ui.money(p.price)}</b><small class="muted">${p.why}</small></a>`)}</div>`
    : html`<p class="muted small">${empty}</p>`}</section>`;
}

async function page(ctx) {
  const s = ctx.settings;
  const n = await numbers();
  const r = rank(n.products);
  const site = (s.site_url || '').replace(/\/+$/, '') || `https://${ctx.req.headers.host}`;
  const ok = (v) => !!String(v || '').trim();
  const checks = [
    [ok(s.fb_pixel_id), 'Facebook Pixel', 'যে পণ্য দেখল, Facebook তাকে মনে রাখে — রিটার্গেটিংয়ের মূল জিনিস', '/admin/marketing/tracking'],
    [ok(s.fb_capi_token), 'Facebook Conversions API', 'ব্রাউজার ব্লক করলেও অর্ডারের খবর Facebook পায় — বিজ্ঞাপন বেশি নিখুঁত হয়', '/admin/marketing/tracking'],
    [ok(s.fb_domain_verification), 'Facebook ডোমেইন ভেরিফিকেশন', 'iPhone ব্যবহারকারীদের ক্ষেত্রেও ঠিকমতো কাজ করার জন্য দরকার', '/admin/marketing/tracking'],
    [ok(s.tiktok_pixel_id), 'TikTok Pixel', 'TikTok-এ একই পণ্য আবার দেখানোর জন্য', '/admin/marketing/tracking'],
    [ok(s.ga4_id) || ok(s.gtm_id), 'Google Analytics / Tag Manager', 'Google-এ (YouTube সহ) রিটার্গেটিং ও মাপজোক', '/admin/marketing/tracking'],
    [ok(s.google_site_verification), 'Google Search Console', 'Google সার্চে দোকান আসার জন্য', '/admin/marketing/seo'],
    [true, 'প্রোডাক্ট ফিড (চালু আছে)', 'Facebook/Google ক্যাটালগে সব পণ্য নিজে থেকে যায় — ডায়নামিক অ্যাড এটাই ব্যবহার করে', '/admin/marketing/feeds'],
    [ok(s.og_image_id), 'শেয়ার ইমেজ', 'লিংক শেয়ার করলে সুন্দর ছবি আসে', '/admin/marketing'],
  ];
  const done = checks.filter((c) => c[0]).length;
  const guide = await require('./liveguide').panel();
  const body = html`<h1>🎯 কাস্টমারের কাছে পৌঁছান</h1>${ui.flash(ctx.flash)}
${guide}
${ui.helpBox('এটা কীভাবে কাজ করে', html`কেউ আপনার সাইটে কোনো পণ্য দেখলে সাইটে বসানো Facebook / TikTok / Google-এর ট্যাগ সেটা মনে রাখে।
  পরে সে যখন Facebook, Instagram, TikTok বা YouTube চালায়, ঠিক সেই পণ্যের বিজ্ঞাপন তার সামনে ঘুরে ঘুরে আসে — একে বলে <b>রিটার্গেটিং</b>।
  মানুষ "মুখে বললে বিজ্ঞাপন আসে" বলে যা মনে করে, বাস্তবে সেটা আসলে এটাই — সার্চ, দেখা আর কার্টে রাখা থেকে।
  (মাইক্রোফোনে শোনা কোনো ওয়েবসাইটের পক্ষে সম্ভব না, আর তা বেআইনি।) নিচের সব সবুজ হলে আপনার দোকান এই সুবিধা পুরোপুরি পাবে।`)}

<section class="panel" data-live>
  <h2>🟢 এই মুহূর্তে</h2>
  <div class="kpis">${ui.kpi('এখন সাইটে আছে', bn(n.live.now_online || 0) + ' জন')}${ui.kpi('আজ পেজ দেখা', bn(n.live.views_today || 0))}${ui.kpi('আজ অর্ডার', bn(n.live.orders_today || 0))}</div>
  <p class="small muted">প্রতি মিনিটে নিজে থেকে নতুন হয়।</p>
</section>

<section class="panel">
  <h2>✅ প্রস্তুতি — ${bn(done)}/${bn(checks.length)} চালু</h2>
  <ul class="sec-list">${checks.map(([on, t, d, link]) => html`<li class="${on ? 'ok' : 'bad'}"><b>${on ? '✅' : '⛔'} ${t}</b> — <span class="small">${d}</span> ${on ? '' : html`<a class="small" href="${link}">চালু করুন →</a>`}</li>`)}</ul>
</section>

<section class="panel">
  <h2>👥 আপনার তৈরি অডিয়েন্স (যাদের কাছে বিজ্ঞাপন যাবে)</h2>
  <div class="kpis">
    ${ui.kpi('দেখেছে কিন্তু কেনেনি (৩০ দিন)', bn(n.aud.viewed_not_bought || 0) + ' জন')}
    ${ui.kpi('কার্টে রেখে চলে গেছে (১৪ দিন)', bn(n.aud.cart_left || 0) + ' জন')}
    ${ui.kpi('মোট ক্রেতা', bn(n.buyers.buyers || 0) + ' জন')}
    ${ui.kpi('বারবার কেনে', bn(n.buyers.repeat || 0) + ' জন')}
  </div>
  <ol class="small steps">
    <li><b>Facebook Ads Manager → Audiences → Create → Custom Audience → Website</b> → আপনার Pixel → "<b>ViewContent</b>, গত ৩০ দিন" আর বাদ দিন "<b>Purchase</b>" → নাম দিন "দেখেছে-কেনেনি"।</li>
    <li>একইভাবে "<b>AddToCart</b>, গত ১৪ দিন" বাদ "<b>Purchase</b>" → "কার্টে-রেখেছে"। এদের বিজ্ঞাপনে ছোট ছাড় বা ফ্রি ডেলিভারির কথা দিন।</li>
    <li><b>Catalog → Data sources → Data feed</b>-এ এই লিংক দিন: <code>${site}/feeds/facebook.xml</code> (প্রতিদিন আপডেট)। তারপর Campaign → <b>Sales → Catalog (Advantage+ catalog ads)</b> — যে যেটা দেখেছে, Facebook নিজে থেকে তাকে ঠিক সেটাই দেখাবে।</li>
    <li>নতুন কাস্টমার আনতে: নিচের "ক্রেতার তালিকা" নামিয়ে <b>Custom Audience → Customer list</b> এ দিন, তারপর <b>Lookalike (Bangladesh, 1%)</b> — আপনার ক্রেতাদের মতো মানুষদের কাছে বিজ্ঞাপন যাবে।</li>
    <li>Google: <b>Merchant Center</b>-এ <code>${site}/feeds/google.xml</code> দিন, তারপর Google Ads → <b>Performance Max</b> — Google সার্চ, YouTube আর Gmail-এ একই রিটার্গেটিং।</li>
  </ol>
  <form method="post" action="${BASE}/buyers.csv"><button class="btn btn-sm">⬇ ক্রেতার তালিকা (Facebook-এর জন্য CSV)</button></form>
  <p class="small muted">তালিকায় শুধু ফোন নম্বর আর নাম থাকে। Facebook নম্বরগুলো গোপন কোড বানিয়ে মেলায়, কাউকে দেখায় না। ফাইলটা অন্য কাউকে দেবেন না।</p>
</section>

${list('💸 বিজ্ঞাপনে দিন — অনেকে দেখছে, কিনছে কম', 'এদের রিটার্গেটিং বিজ্ঞাপনে রাখুন; একটু ছাড় দিলে এরাই সবচেয়ে বেশি বিক্রি আনবে।', r.retarget, 'এখনো যথেষ্ট ভিজিটর ডাটা নেই — সাইট চালু হলে কয়েক দিনের মধ্যে এখানে তালিকা আসবে।')}
${list('🏆 যে দেখে সে-ই কেনে — নতুন মানুষের কাছে নিয়ে যান', 'এগুলোতে টাকা খরচ করলে লাভ সবচেয়ে বেশি; Lookalike অডিয়েন্সে এগুলো দিয়ে বিজ্ঞাপন চালান।', r.winners, 'এখনো ডাটা কম।')}
${list('📈 এ সপ্তাহে চাহিদা বাড়ছে', 'চাহিদা বাড়ছে — স্টক ঠিক রাখুন আর এখনই একটা পোস্ট/রিল দিন।', r.trending, 'এ সপ্তাহে বিশেষ কোনো বাড়তি চাহিদা দেখা যাচ্ছে না।')}
${list('😴 স্টক আছে, কিন্তু কেউ দেখছে না', 'ভালো ছবি, ছোট ভিডিও বা ফ্ল্যাশ সেলে দিন — নইলে টাকা আটকে থাকবে।', r.unseen, 'সব পণ্যই কেউ না কেউ দেখছে। 👍')}

<p class="small muted">হিসাব: আপনার নিজের সাইটের ভিজিটর আর অর্ডারের ডাটা থেকে, প্রতিবার এই পেজ খুললে নতুন করে। শেষ হিসাব: ${fmtDate(new Date())}</p>
<script>
(function () {
  var box = document.querySelector('[data-live]'); if (!box) return;
  setInterval(function () {
    fetch('${BASE}/live', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      var v = box.querySelectorAll('.kpi-value, .kpi b, .kpi strong');
      if (v.length >= 3) { v[0].textContent = j.now; v[1].textContent = j.views; v[2].textContent = j.orders; }
    }).catch(function () {});
  }, 60000);
})();
</script>`;
  return ctx.page('কাস্টমারের কাছে পৌঁছান', body, 'reach');
}

async function live(ctx) {
  const n = await numbers();
  return ctx.json(ctx.res, 200, { now: bn(n.live.now_online || 0) + ' জন', views: bn(n.live.views_today || 0), orders: bn(n.live.orders_today || 0) });
}

// Customer list for Facebook "Custom Audience → Customer list": phone (with country code), first name.
async function buyersCsv(ctx) {
  const rows = await db.q(`SELECT phone, max(customer_name) AS name FROM orders WHERE status NOT IN ('cancelled','returned') GROUP BY phone ORDER BY max(created_at) DESC LIMIT 50000`);
  const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  const phone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('880') ? '+' + d : d.startsWith('0') ? '+88' + d : d ? '+880' + d : ''; };
  const csv = 'phone,fn,country\n' + rows.map((r) => [esc(phone(r.phone)), esc(String(r.name || '').split(/\s+/)[0]), 'BD'].join(',')).join('\n');
  await ctx.log('export', 'customers', null, `Facebook-এর জন্য ক্রেতার তালিকা (${rows.length} জন)`);
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="shobmilbe-buyers.csv"', 'Cache-Control': 'no-store' });
  return ctx.res.end('﻿' + csv);
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'owner', handler: page },
    { method: 'GET', path: `${BASE}/live`, perm: 'owner', handler: live },
    { method: 'POST', path: `${BASE}/buyers.csv`, perm: 'owner', handler: buyersCsv },
  ],
  rank,
};

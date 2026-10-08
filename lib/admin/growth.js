'use strict';
// Admin → গ্রোথ গাইড (owner only): what to set up and what to do every day / week so the shop
// reaches more people on Google and Facebook and sells more — checked against the shop's real state —
// plus the privacy guard that keeps secrets away from robots.
const { html, raw, bn, int } = require('../util');
const db = require('../db');
const ui = require('./ui');

const ok = (b) => (b ? '✅' : '❌');
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${String(Math.ceil(((t - y) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

// Things to do every week (ticks are remembered for this week only, then start fresh).
const WEEKLY = [
  ['fb_posts', 'Facebook পেজে অন্তত ৫টা পোস্ট', 'নতুন পণ্য, অফার, কাস্টমারের রিভিউ বা ছোট ভিডিও। প্রতিটা পোস্টে পণ্যের লিংক দিন।'],
  ['reels', '২-৩টা ছোট ভিডিও (Reels / TikTok / YouTube Shorts)', 'পণ্য কীভাবে কাজ করে দেখান — ইলেকট্রনিক্স পার্টসের "কীভাবে লাগাবেন" ভিডিও খুব শেয়ার হয়। ভিডিওর লিংক পণ্যের পেজেও দিন।'],
  ['new_products', 'নতুন ৫-১০টা পণ্য তোলা', 'মার্কেট রিসার্চের উইনিং প্রোডাক্ট আর "কাস্টমার খুঁজেছে কিন্তু পায়নি" তালিকা থেকে শুরু করুন।'],
  ['blog', '১টা ব্লগ পোস্ট', 'যেমন "PAM8403 দিয়ে কীভাবে স্পিকার বানাবেন"। গুগলে মানুষ এসব খোঁজে, আর ব্লগ থেকে পণ্যে আসে।'],
  ['offer', '১টা অফার বা কুপন', 'সপ্তাহের অফার / ফ্রি ডেলিভারি কুপন — Facebook পোস্টে কুপন কোড দিন।'],
  ['retarget', 'বিজ্ঞাপন দেখে নেওয়া', 'Facebook বিজ্ঞাপনে যারা সাইট দেখে কেনেনি তাদের আবার দেখানো (Retargeting) চালু আছে কি না, খরচ আর বিক্রি মিলিয়ে দেখুন।'],
  ['reviews', 'কাস্টমারের রিভিউ/ছবি সংগ্রহ', 'ডেলিভারির পর ফোন/WhatsApp এ ছোট রিভিউ চান, ছবি পেলে পোস্ট করুন — নতুন কাস্টমার বিশ্বাস পায়।'],
  ['prices', 'বাজারের দামের সাথে মিলিয়ে দেখা', 'মার্কেট রিসার্চে "আপনার দাম বাজারের চেয়ে বেশি" লেখা পণ্যের দাম ঠিক করুন।'],
];

async function page(ctx) {
  const s = ctx.settings;
  const week = isoWeek();
  const weekKey = `growth_week_${week}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'privacy') {
      await db.setMany({ block_seo_spies: b.block_seo_spies ? '1' : '0', block_ai_copy: b.block_ai_copy ? '1' : '0' });
      await ctx.reloadSettings();
      await ctx.log('settings', 'security', null, 'গোপনীয়তার পাহারা বদলানো হলো');
      return ctx.back('/admin/growth', 'saved');
    }
    if (b.form === 'week') {
      const done = [].concat(b.done || []).filter((k) => WEEKLY.some((w) => w[0] === k));
      await db.setSetting(weekKey, JSON.stringify(done));
      return ctx.back('/admin/growth#week', 'saved');
    }
    return ctx.back('/admin/growth');
  }

  // ---- the shop's real state
  const p = await db.one(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE image_id IS NULL)::int AS no_img,
      count(*) FILTER (WHERE (SELECT count(*) FROM media m WHERE m.owner_type='product' AND m.owner_id=products.id) < 3)::int AS few_img,
      count(*) FILTER (WHERE length(coalesce(description,'')) < 150)::int AS short_desc,
      count(*) FILTER (WHERE coalesce(short_description,'') = '')::int AS no_short,
      count(*) FILTER (WHERE coalesce(seo_keywords,'') = '')::int AS no_kw,
      count(*) FILTER (WHERE coalesce(brand,'') = '')::int AS no_brand,
      count(*) FILTER (WHERE category_id IS NULL)::int AS no_cat,
      count(*) FILTER (WHERE stock <= 0 AND product_type='single')::int AS out_stock,
      count(*) FILTER (WHERE coalesce(youtube_url,'') <> '')::int AS with_video,
      count(*) FILTER (WHERE old_price > price)::int AS on_offer
    FROM products WHERE active`);
  const [blog, coupons, pending, banners, pages] = await Promise.all([
    db.one(`SELECT count(*)::int AS n, max(published_at) AS last FROM blog_posts WHERE status='published'`),
    db.one(`SELECT count(*)::int AS n FROM coupons WHERE active AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)`),
    db.one(`SELECT count(*)::int AS n FROM orders WHERE status='pending'`),
    db.one(`SELECT count(*)::int AS n FROM banners WHERE active AND placement='slider'`),
    db.one(`SELECT count(*)::int AS n FROM pages WHERE active`),
  ]);
  let missed = [];
  try { missed = (await require('../services/research').demand(30)).searches.filter((x) => !x.found).slice(0, 8); } catch (_) { missed = []; }
  const blogDays = blog.last ? Math.floor((Date.now() - new Date(blog.last).getTime()) / 864e5) : null;
  const domainOk = s.site_url && !/vercel\.app/.test(s.site_url);

  // ---- set-up checklist: [done, title, why, how, link]
  const groups = [
    ['🔎 Google-এ খুঁজে পাওয়া', [
      [domainOk, 'নিজের ডোমেইন (shobmilbe.com) সাইটে লাগানো', 'গুগল আর কাস্টমার দুজনেই নিজের ডোমেইনকে বেশি বিশ্বাস করে।', 'ডোমেইন সেটআপ পেজে ধাপগুলো অনুসরণ করুন, তারপর SEO পেজে ওয়েবসাইটের ঠিকানা দিন।', '/admin/integrations/domain'],
      [!!s.google_site_verification, 'Google Search Console যুক্ত করা', 'গুগল কোন পণ্য কোন শব্দে দেখাচ্ছে, কোনো সমস্যা আছে কি না — সব জানা যায়। নতুন সাইট দ্রুত গুগলে উঠে।', 'search.google.com/search-console → Add property → HTML tag কোড কপি করে "পিক্সেল ও ট্র্যাকিং" পেজে বসান → Verify। তারপর Sitemaps এ লিখুন: sitemap.xml', '/admin/marketing/tracking'],
      [!!(s.seo_title && s.seo_description), 'হোমপেজের SEO টাইটেল ও বিবরণ', 'গুগলের ফলাফলে আপনার দোকান কেমন দেখাবে।', 'SEO পেজে ৫০-৬০ অক্ষরের টাইটেল আর ১২০-১৬০ অক্ষরের বিবরণ দিন — "ইলেকট্রনিক্স পার্টস", "রিমোট", জায়গার নাম রাখুন।', '/admin/marketing/seo'],
      [!!(s.ga4_id || s.gtm_id), 'Google Analytics 4', 'কোথা থেকে কাস্টমার আসছে, কোন পণ্য দেখছে — বিজ্ঞাপনের টাকা কোথায় খরচ করবেন তা বোঝা যায়।', 'analytics.google.com → নতুন প্রপার্টি → Web stream → Measurement ID (G-…) কপি করে বসান।', '/admin/marketing/tracking'],
      [!!s.feed_google_token, 'Google প্রোডাক্ট ফিড লিংক তৈরি', 'Google Merchant Center এ পণ্যের তালিকা দিলে Google-এর শপিং অংশে পণ্য দেখানোর সুযোগ তৈরি হয়।', 'প্রোডাক্ট ফিড পেজে Google ফিড লিংক তৈরি করে Merchant Center → Products → Feeds এ দিন।', '/admin/marketing/feeds'],
    ]],
    ['📘 Facebook / Instagram / TikTok-এ বিক্রি', [
      [!!s.fb_pixel_id, 'Facebook Pixel', 'কে সাইটে এসে কী দেখেছে, কে কিনেছে — Facebook জানতে পারে, তাই বিজ্ঞাপন ঠিক মানুষকে দেখায় আর খরচ কমে।', 'Meta Events Manager → Data sources → Pixel ID কপি করে বসান।', '/admin/marketing/tracking'],
      [!!s.fb_capi_token, 'Facebook Conversions API টোকেন', 'iPhone আর অ্যাড-ব্লকারওয়ালা কাস্টমারের বিক্রিও ঠিকভাবে গোনা হয় — বিজ্ঞাপন আরও ভালো কাজ করে।', 'Events Manager → Pixel → Settings → Conversions API → Generate access token।', '/admin/marketing/tracking'],
      [!!s.fb_domain_verification, 'Facebook ডোমেইন ভেরিফিকেশন', 'বিজ্ঞাপনে লিংক আর কেনার তথ্য ঠিকমতো কাজ করার জন্য দরকার।', 'Business Settings → Brand safety → Domains → কোড কপি করে বসান।', '/admin/marketing/tracking'],
      [!!s.feed_facebook_token, 'Facebook ক্যাটালগ ফিড', 'Facebook/Instagram শপ আর "ক্যাটালগ বিজ্ঞাপন" — যে পণ্য দেখেছে সেটাই আবার দেখায়, বিক্রি অনেক বাড়ে।', 'প্রোডাক্ট ফিড পেজে Facebook লিংক তৈরি → Commerce Manager → Catalog → Data sources → Data feed → Scheduled feed।', '/admin/marketing/feeds'],
      [!!s.tiktok_pixel_id, 'TikTok Pixel', 'TikTok-এ বিজ্ঞাপন দিলে কে কিনল তা গোনা যায়।', 'TikTok Ads Manager → Assets → Events → Web events → Pixel ID।', '/admin/marketing/tracking'],
      [!!s.social_facebook, 'Facebook পেজের লিংক সাইটে', 'সাইটে এসে মানুষ পেজ দেখে বিশ্বাস পায়, ফলো করে।', 'সোশ্যাল পেজে Facebook পেজের লিংক দিন।', '/admin/marketing/social'],
    ]],
    ['🤝 কাস্টমারের বিশ্বাস', [
      [!!(s.whatsapp && s.chat_whatsapp_button === '1') || !!s.chat_messenger_page, 'WhatsApp / Messenger চ্যাট বাটন', 'বাংলাদেশে বেশিরভাগ কাস্টমার কেনার আগে একবার জিজ্ঞেস করে নেয়।', 'সোশ্যাল ও লাইভ চ্যাট পেজে WhatsApp নম্বর দিয়ে বাটন চালু করুন।', '/admin/marketing/social'],
      [!!s.phone, 'দোকানের ফোন নম্বর', 'ফোন নম্বর দেখলে মানুষ ভরসা পায়।', 'সেটিংসে ফোন নম্বর দিন।', '/admin/settings'],
      [!!s.logo_id, 'লোগো', 'চেনা ব্র্যান্ড মনে থাকে।', 'স্টোর ডিজাইনে লোগো দিন।', '/admin/design'],
      [banners.n > 0, 'হোমপেজের ব্যানার ছবি', 'অফার আর জনপ্রিয় পণ্য বড় করে দেখালে বিক্রি বাড়ে।', 'ব্যানার পেজে ১২০০×৪০০ মাপের ২-৩টা ব্যানার দিন।', '/admin/design/banners'],
      [pages.n >= 3, 'রিটার্ন, প্রাইভেসি, আমাদের সম্পর্কে পেজ', 'Facebook বিজ্ঞাপন আর Google এই পেজগুলো দেখে; কাস্টমারও।', 'পেজ মেনু থেকে লেখাগুলো নিজের মতো করে নিন।', '/admin/design/pages'],
    ]],
  ];
  const all = groups.flatMap((g) => g[1]);
  const doneN = all.filter((x) => x[0]).length;
  const score = pct(doneN, all.length);

  // ---- today's work, from the shop's own numbers
  const today = [
    pending.n ? ['🔥', `${bn(pending.n)}টি অর্ডার কনফার্ম বাকি`, 'অর্ডারের ১ ঘণ্টার মধ্যে ফোন করলে বাতিল অনেক কমে।', '/admin/orders?status=pending'] : null,
    missed.length ? ['🔎', `কাস্টমার খুঁজেছে কিন্তু পায়নি: ${missed.map((m) => `"${m.term}"`).join(', ')}`, 'এগুলো এনে রাখলে প্রায় নিশ্চিত বিক্রি।', '/admin/research?tab=demand'] : null,
    p.no_img ? ['🖼️', `${bn(p.no_img)}টি পণ্যে ছবি নেই`, 'ছবি ছাড়া পণ্য প্রায় বিক্রিই হয় না, আর Facebook/Google ফিডেও বাদ যায়।', '/admin/products'] : null,
    p.few_img ? ['📸', `${bn(p.few_img)}টি পণ্যে ৩টার কম ছবি`, 'কয়েক দিক থেকে ছবি থাকলে কাস্টমার নিশ্চিন্তে কেনে।', '/admin/products'] : null,
    p.short_desc ? ['📝', `${bn(p.short_desc)}টি পণ্যের বিবরণ খুব ছোট`, 'গুগল ছোট বিবরণের পেজ কম দেখায়। কী কাজে লাগে, মাপ, ভোল্টেজ, প্যাকেটে কী আছে — লিখুন।', '/admin/products'] : null,
    p.no_kw ? ['🏷️', `${bn(p.no_kw)}টি পণ্যে SEO কিওয়ার্ড নেই`, 'মানুষ গুগলে যেভাবে লেখে (বাংলা + ইংরেজি) সেই শব্দগুলো দিন।', '/admin/products'] : null,
    p.no_brand ? ['🏢', `${bn(p.no_brand)}টি পণ্যে ব্র্যান্ড নেই`, 'Google/Facebook ফিডে ব্র্যান্ড থাকলে পণ্য বেশি দেখায়।', '/admin/products'] : null,
    p.no_cat ? ['🗂️', `${bn(p.no_cat)}টি পণ্যের ক্যাটাগরি নেই`, '"স্বয়ংক্রিয়ভাবে সাজান" চাপলেই হয়ে যাবে।', '/admin/categories/auto'] : null,
    p.out_stock ? ['📦', `${bn(p.out_stock)}টি পণ্য স্টকে নেই কিন্তু দোকানে দেখাচ্ছে`, 'স্টক আনুন, না আনলে সুইচ বন্ধ করে লুকিয়ে রাখুন — খালি পণ্যে বিজ্ঞাপন টাকা নষ্ট করে।', '/admin/products?low=1'] : null,
    blogDays === null || blogDays > 14 ? ['✍️', blogDays === null ? 'এখনো কোনো ব্লগ পোস্ট নেই' : `${bn(blogDays)} দিন কোনো ব্লগ লেখা হয়নি`, 'নিয়মিত লেখা গুগলে নতুন কাস্টমার আনে।', '/admin/blog/new'] : null,
    !coupons.n && !p.on_offer ? ['🏷️', 'এখন কোনো অফার বা কুপন চালু নেই', 'অফার থাকলে Facebook পোস্টে মানুষ বেশি সাড়া দেয়।', '/admin/marketing/coupons'] : null,
    p.total && pct(p.with_video, p.total) < 10 ? ['🎬', `মাত্র ${bn(p.with_video)}টি পণ্যে ভিডিও আছে`, 'চালু অবস্থার ছোট ভিডিও থাকলে বিক্রি বাড়ে আর ফেরত কমে।', '/admin/products'] : null,
  ].filter(Boolean);

  let weekDone = [];
  try { weekDone = JSON.parse(s[weekKey] || '[]'); } catch (_) { weekDone = []; }
  const spies = s.block_seo_spies !== '0';
  const aiCopy = s.block_ai_copy !== '0';

  const body = html`<h1>🚀 গ্রোথ গাইড <small>বিক্রি বাড়ানোর পথ — শুধু আপনি দেখছেন</small></h1>
${ui.flash(ctx.flash)}
<div class="kpis">
  ${ui.kpi('সেটআপ সম্পূর্ণ', `${bn(score)}%`, `${bn(doneN)} / ${bn(all.length)}টি কাজ শেষ`, score >= 80 ? 'kpi-green' : score >= 50 ? 'kpi-blue' : 'kpi-alert')}
  ${ui.kpi('আজকের কাজ', bn(today.length), today.length ? 'নিচে দেখুন' : 'সব ঠিক আছে 👍', today.length ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('এই সপ্তাহের রুটিন', `${bn(weekDone.length)} / ${bn(WEEKLY.length)}`, `সপ্তাহ ${week}`, weekDone.length === WEEKLY.length ? 'kpi-green' : 'kpi-blue')}
</div>

<section class="panel">
  <h2>📌 আজকের কাজ <small>আপনার দোকানের এখনকার অবস্থা দেখে</small></h2>
  ${today.length ? html`<ul class="gr-today">${today.map(([ic, t, why, link]) => html`<li><span class="gr-ic">${ic}</span><div><a href="${link}"><b>${t}</b></a><small>${why}</small></div></li>`)}</ul>`
    : html`<p class="good">✅ আজকের জন্য জরুরি কিছু নেই। সাপ্তাহিক রুটিন চালিয়ে যান।</p>`}
</section>

<section class="panel">
  <h2>🧩 সেটআপ চেকলিস্ট <small>একবার করলেই হয়</small></h2>
  <div class="gr-bar"><span style="width:${score}%"></span></div>
  ${groups.map(([title, items]) => html`<h3>${title}</h3><ul class="gr-check">${items.map(([done, t, why, how, link]) => html`<li class="${done ? 'is-done' : ''}">
    <span class="gr-ok">${ok(done)}</span><div><b>${t}</b><small>${why}</small>${done ? '' : html`<small class="gr-how">👉 ${how} <a href="${link}">এখানে করুন →</a></small>`}</div></li>`)}</ul>`)}
</section>

<section class="panel" id="week">
  <h2>🗓️ এই সপ্তাহের রুটিন <small>প্রতি সপ্তাহে নতুন করে শুরু হয়</small></h2>
  <form method="post" action="/admin/growth" class="gr-week"><input type="hidden" name="form" value="week">
    ${WEEKLY.map(([k, t, why]) => html`<label class="gr-wk ${weekDone.includes(k) ? 'is-done' : ''}"><input type="checkbox" name="done" value="${k}" ${weekDone.includes(k) ? raw('checked') : ''} data-autosubmit><span><b>${t}</b><small>${why}</small></span></label>`)}
    <noscript><button class="btn btn-sm">সেভ</button></noscript>
  </form>
</section>

<section class="panel">
  <h2>💡 বাংলাদেশে দ্রুত বিক্রি বাড়ানোর পরামর্শ</h2>
  <ol class="gr-tips">
    <li><b>Facebook ক্যাটালগ বিজ্ঞাপন + রিটার্গেটিং:</b> Pixel আর ক্যাটালগ ফিড চালু থাকলে, যে মানুষ আপনার সাইটে কোনো পণ্য দেখেছে তাকে Facebook-এ ঠিক সেই পণ্যটাই আবার দেখানো যায়। অল্প বাজেটে সবচেয়ে বেশি ফল দেয়।</li>
    <li><b>অর্ডার কনফার্ম কল দ্রুত:</b> ক্যাশ অন ডেলিভারিতে দ্রুত ফোন করলে ফেরত আর বাতিল কমে — ফ্রড চেক আর ব্লক লিস্টও ব্যবহার করুন।</li>
    <li><b>"কীভাবে ব্যবহার করবেন" ভিডিও:</b> ইলেকট্রনিক্স পার্টস কেনার আগে মানুষ দেখতে চায় কীভাবে লাগায়। ছোট ভিডিও Reels/TikTok/YouTube Shorts এ দিন, পণ্যের পেজেও দিন।</li>
    <li><b>বান্ডেল / কিট বানান:</b> যেমন "স্পিকার বানানোর কিট" = অ্যামপ্লিফায়ার + ব্লুটুথ মডিউল + ব্যাটারি — এক অর্ডারে বেশি টাকার বিক্রি।</li>
    <li><b>Google Business Profile:</b> দোকানের ঠিকানা থাকলে ফ্রিতে Google Maps-এ দোকান তুলুন — "electronics shop near me" তে দেখাবে।</li>
    <li><b>উৎসবের ক্যাম্পেইন:</b> ঈদ, পহেলা বৈশাখ, ১১.১১, ব্ল্যাক ফ্রাইডে, বছরের শেষ — আগে থেকে অফার আর ব্যানার রেডি রাখুন।</li>
    <li><b>রিভিউ আর আসল ছবি:</b> কাস্টমারের হাতে পণ্যের ছবি/ভিডিও পোস্ট করলে নতুন কাস্টমার ভরসা পায়।</li>
    <li><b>দাম আর স্টক ঠিক রাখা:</b> মার্কেট রিসার্চ নিয়মিত দেখুন — বাজারের চেয়ে বেশি দাম বা খালি স্টকের পণ্যে বিজ্ঞাপন দেবেন না।</li>
  </ol>
</section>

<section class="panel">
  <h2>🛡️ গোপনীয়তার পাহারা <small>গুগল/ফেসবুকের ক্ষতি না করে</small></h2>
  <ul class="gr-check">
    <li class="is-done"><span class="gr-ok">✅</span><div><b>Admin প্যানেল রোবটদের জন্য বন্ধ</b><small>লগইন ছাড়া কিছুই দেখা যায় না; প্রতিটা Admin পেজে "noindex, noarchive" — গুগল/ফেসবুক এগুলো কখনো তালিকায় তুলবে না বা কপি রাখবে না।</small></div></li>
    <li class="is-done"><span class="gr-ok">✅</span><div><b>কেনা দাম, লাভ, মার্কেট রিসার্চ — দোকানের দিকে নেই</b><small>দোকানের পেজ, পেজ সোর্স, ফিড, পিক্সেলে পাঠানো তথ্য — কোথাও কেনা দাম বা লাভ যায় না।</small></div></li>
    <li class="is-done"><span class="gr-ok">✅</span><div><b>কার্ট, চেকআউট, অর্ডার, সার্চের পেজ গুগলে যায় না</b><small>কাস্টমারের তথ্য আর আজেবাজে পেজ গুগলে ওঠে না, দোকানের SEO পরিষ্কার থাকে।</small></div></li>
    <li class="is-done"><span class="gr-ok">✅</span><div><b>অন্য দোকানের তথ্য পড়ার সময় আপনার নাম যায় না</b><small>মার্কেট রিসার্চ সাধারণ ব্রাউজারের মতো পড়ে — অন্য দোকান জানতে পারে না আপনি দেখছেন।</small></div></li>
    <li class="is-done"><span class="gr-ok">✅</span><div><b>Google, Bing, Facebook, TikTok, WhatsApp প্রিভিউ — সবার জন্য খোলা</b><small>পণ্যের পেজ, ক্যাটাগরি, ছবি, sitemap — যা দিয়ে মানুষ আপনাকে খুঁজে পায়, সব খোলা আছে।</small></div></li>
  </ul>
  <form method="post" action="/admin/growth" class="switch-list" data-switch-form><input type="hidden" name="form" value="privacy">
    <label class="switch-row"><span class="switch-text"><b>প্রতিযোগীর SEO-গোয়েন্দা টুল আটকান (প্রস্তাবিত)</b><small>Ahrefs, Semrush, Majestic … দিয়ে অন্য দোকান আপনার কিওয়ার্ড, পেজ আর লিংক কৌশল দেখে নেয়। এরা কোনো কাস্টমার আনে না — আটকালে গুগলে কোনো ক্ষতি নেই।</small></span>
      <span class="switch"><input type="checkbox" name="block_seo_spies" value="1" ${spies ? raw('checked') : ''} data-autosubmit><span class="switch-ui" aria-hidden="true"></span></span><span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>
    <label class="switch-row"><span class="switch-text"><b>AI কোম্পানির কপি-রোবট আটকান</b><small>GPTBot, CCBot, Google-Extended (Gemini ট্রেনিং), Bytespider … আপনার পণ্যের লেখা আর ছবি নিজেদের AI শেখাতে কপি করে। আটকালেও Google সার্চ আর Facebook-এ আপনার সাইট আগের মতোই দেখাবে।</small></span>
      <span class="switch"><input type="checkbox" name="block_ai_copy" value="1" ${aiCopy ? raw('checked') : ''} data-autosubmit><span class="switch-ui" aria-hidden="true"></span></span><span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>
    <noscript><button class="btn btn-sm">সেভ</button></noscript>
  </form>
</section>`;
  return ctx.page('গ্রোথ গাইড', body, 'growth');
}

module.exports = { routes: [{ method: '*', path: '/admin/growth', perm: 'owner', handler: page }], isoWeek };
void int;

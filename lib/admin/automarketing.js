'use strict';
// Admin → মার্কেটিং → 🤖 অটো মার্কেটিং: switches and log for the two things the shop now does by itself —
//  1. a daily post of one product on the Facebook page (and Instagram), at the hours chosen here;
//  2. a "দাম তালিকা" blog article for every main category, refreshed every week.
const { html, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const autopost = require('../services/autopost');
const autoblog = require('../services/autoblog');
const { secretInput } = require('./marketing');

const BASE = '/admin/marketing/auto';

async function save(ctx, obj) {
  for (const [k, v] of Object.entries(obj)) await db.setSetting(k, v);
  await ctx.reloadSettings();
}

async function handle(ctx) {
  if (ctx.method === 'POST') return post(ctx);
  return page(ctx);
}

async function post(ctx) {
  const b = await ctx.body();
  const s = ctx.settings;
  if (b.action === 'connect') {
    const token = String(b.token || '').trim();
    const appId = String(b.app_id || s.autopost_app_id || '').trim();
    const secretIn = String(b.app_secret || '').trim();
    const appSecret = secretIn && !/^•+$/.test(secretIn) ? secretIn : s.autopost_app_secret || '';
    if (!token) return ctx.fail(BASE, 'Facebook থেকে আনা টোকেনটা দিন।');
    let r;
    try { r = await autopost.connect({ token, appId, appSecret, pageId: String(b.page_id || '').trim() }); } catch (e) {
      return ctx.fail(BASE, 'Facebook-এর সাথে যুক্ত হলো না: ' + e.message);
    }
    await save(ctx, {
      autopost_page_token: r.pageToken, autopost_page_id: r.pageId, autopost_page_name: r.pageName || '',
      autopost_ig_id: r.ig ? r.ig.id : '', autopost_ig_name: r.ig ? r.ig.username || '' : '',
      autopost_app_id: appId, autopost_app_secret: appSecret, autopost_long_lived: r.longLived ? '1' : '0',
    });
    await ctx.log('settings', 'marketing', null, `অটো পোস্ট: Facebook পেজ যুক্ত (${r.pageName})`);
    const more = r.others.length > 1 ? ` আপনার আরো পেজ আছে: ${r.others.map((x) => `${x.name} (${x.id})`).join(', ')} — অন্যটা চাইলে "পেজ ID" ঘরে দিয়ে আবার যুক্ত করুন।` : '';
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ যুক্ত হয়েছে: ${r.pageName}${r.ig ? ` + Instagram @${r.ig.username}` : ' (এই পেজের সাথে Instagram বিজনেস অ্যাকাউন্ট যুক্ত নেই)'}।${more}`)}`);
  }
  if (b.action === 'disconnect') {
    await save(ctx, { autopost_page_token: '', autopost_page_id: '', autopost_page_name: '', autopost_ig_id: '', autopost_ig_name: '', autopost_on: '0' });
    await ctx.log('settings', 'marketing', null, 'অটো পোস্ট: Facebook পেজ সরানো হলো');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'settings') {
    const hours = String(b.autopost_hours || '').split(/[,\s]+/).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
    await save(ctx, {
      autopost_on: b.autopost_on ? '1' : '0', autopost_fb: b.autopost_fb ? '1' : '0', autopost_ig: b.autopost_ig ? '1' : '0',
      autopost_hours: [...new Set(hours)].sort((x, y) => x - y).slice(0, 4).join(',') || '11,20',
      autoblog_on: b.autoblog_on ? '1' : '0', autopost_engage: b.autopost_engage ? '1' : '0',
    });
    await ctx.log('settings', 'marketing', null, 'অটো মার্কেটিং সেটিংস');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'now') {
    if (!s.autopost_page_token) return ctx.fail(BASE, 'আগে Facebook পেজ যুক্ত করুন।');
    const r = await autopost.postOne(s, {});
    if (r.error) return ctx.fail(BASE, r.error);
    const parts = [];
    if (r.fb) parts.push('Facebook ✅');
    if (r.fbError) parts.push('Facebook ❌ ' + r.fbError);
    if (r.ig) parts.push('Instagram ✅');
    if (r.igError) parts.push('Instagram ❌ ' + r.igError);
    await ctx.log('create', 'marketing', null, `অটো পোস্ট (এখনই): ${r.product.name}`);
    return ctx.back(`${BASE}?${r.fbError && !r.fb ? 'err' : 'info'}=${encodeURIComponent(`${r.product.name} — ${parts.join(' · ') || 'কোনো চ্যানেল চালু নেই'}`)}`);
  }
  if (b.action === 'engage') {
    if (!s.autopost_page_token) return ctx.fail(BASE, 'আগে Facebook পেজ যুক্ত করুন।');
    const kind = ['tip', 'quiz', 'question', 'answer'].includes(b.kind) ? b.kind : undefined;
    const r = await autopost.postEngagement(s, null, kind);
    if (r.error) return ctx.fail(BASE, r.error);
    await ctx.log('create', 'marketing', null, `এনগেজমেন্ট পোস্ট (এখনই): ${r.engagement}`);
    return ctx.back(`${BASE}?${r.fbError ? 'err' : 'info'}=${encodeURIComponent(r.fbError ? 'Facebook ❌ ' + r.fbError : `${ENGAGE_LABEL[r.engagement] || r.engagement} পোস্ট হয়েছে ✅`)}#engage`);
  }
  if (b.action === 'blog') {
    const r = await autoblog.run(s, { force: true, max: 20 });
    if (r.none) return ctx.fail(BASE, `কোনো ক্যাটাগরিতে অন্তত ৫টা চালু পণ্য নেই, তাই লেখা বানানো গেল না।`);
    await ctx.log('create', 'blog', null, `অটো ব্লগ: ${(r.done || []).length}টা দাম-তালিকা`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`📝 ${bn((r.done || []).length)}টা দাম-তালিকা লেখা তৈরি/আপডেট হয়েছে।`)}#blog`);
  }
  return ctx.back(BASE);
}

const ENGAGE_LABEL = { tip: '💡 টিপস', quiz: '🧠 কুইজ', answer: '✅ কুইজের উত্তর', question: '❓ প্রশ্ন', product: '🛒 পণ্য' };

async function page(ctx) {
  const s = ctx.settings;
  const base = String(s.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
  const connected = !!(s.autopost_page_token && s.autopost_page_id);
  const nextKind = await autopost.nextKind().catch(() => 'tip');
  const [recent, posts, preview, counts, engPreview, engStats] = await Promise.all([
    autopost.recent(30),
    autoblog.list(),
    autopost.pickProduct(autopost.dhakaNow().weekday).catch(() => null),
    db.one(`SELECT count(*) FILTER (WHERE ok AND channel='facebook')::int AS fb, count(*) FILTER (WHERE ok AND channel='instagram')::int AS ig,
      count(*) FILTER (WHERE ok AND created_at > now() - interval '7 days' AND channel IN ('facebook','instagram'))::int AS week FROM social_posts`).catch(() => ({ fb: 0, ig: 0, week: 0 })),
    autopost.buildEngagement(s, nextKind).catch(() => null),
    db.q(`SELECT kind, count(*)::int AS n FROM social_posts WHERE ok AND channel='facebook' AND kind <> 'product' GROUP BY kind`).catch(() => []),
  ]);
  const engN = Object.fromEntries(engStats.map((r) => [r.kind, r.n]));
  const hours = autopost.hoursOf(s);
  const hourLabel = (h) => `${bn(h % 12 || 12)}টা ${h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 19 ? 'বিকাল' : 'রাত'}`;
  const postLink = (r) => (r.channel === 'facebook' && r.post_id ? `https://www.facebook.com/${r.post_id}` : r.channel === 'instagram' && s.autopost_ig_name ? `https://www.instagram.com/${s.autopost_ig_name}/` : '');

  const body = html`<div class="title-row"><h1>🤖 অটো মার্কেটিং</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('Facebook অটো পোস্ট', connected && s.autopost_on === '1' ? '✅ চালু' : connected ? '⏸ বন্ধ' : '⚪ যুক্ত নেই', connected ? s.autopost_page_name || '' : 'নিচে পেজ যুক্ত করুন')}
  ${ui.kpi('প্রতিদিন পোস্ট', bn(hours.length) + 'টা', hours.map(hourLabel).join(', '))}
  ${ui.kpi('গত ৭ দিনে পোস্ট', bn(counts.week || 0), `মোট Facebook ${bn(counts.fb || 0)} · Instagram ${bn(counts.ig || 0)}`, 'kpi-blue')}
  ${ui.kpi('দাম-তালিকা লেখা', bn(posts.length), s.autoblog_on === '1' ? '✅ প্রতি সপ্তাহে আপডেট' : '⏸ বন্ধ')}
</div>
${ui.helpBox('এটা কী করে?', html`<ol class="steps">
  <li><b>প্রতিদিন Facebook পেজে পোস্ট:</b> আপনার বেছে দেওয়া সময়ে দোকান নিজেই একটা পণ্য বেছে নেয় — স্টকে আছে, ছবি আছে, অফার বা বেশি বিক্রি হওয়াগুলো আগে। আসল ছবি, দাম, বাংলা লেখা, ডেলিভারি চার্জ আর অর্ডারের লিংক দিয়ে পেজে পোস্ট করে। একই পণ্য ৪৫ দিনের মধ্যে আবার আসে না, আর সপ্তাহের একেক দিন একেক ক্যাটাগরি।</li>
  <li><b>Instagram:</b> পেজের সাথে Instagram বিজনেস অ্যাকাউন্ট যুক্ত থাকলে একই পোস্ট সেখানেও যায়।</li>
  <li><b>দাম-তালিকা ব্লগ:</b> প্রতিটা বড় ক্যাটাগরির জন্য একটা লেখা ("রিমোট দাম বাংলাদেশে — Price in BD"), সব পণ্যের দাম আর লিংকসহ। প্রতি সপ্তাহে নিজে থেকে নতুন দামে আপডেট হয়। মানুষ Google-এ ঠিক এভাবেই খোঁজে।</li>
  <li>এগুলো Facebook-এর অফিসিয়াল উপায়ে হয় — পেজের কোনো ঝুঁকি নেই, খরচও নেই। লিংকে <code>utm_source=facebook</code> থাকে, তাই ভিজিটর অ্যানালিটিক্সে দেখবেন কতজন পোস্ট থেকে এলো।</li>
</ol>`)}

<section class="panel" id="connect"><h2>১. Facebook পেজ যুক্ত করুন ${connected ? html`<small>✅ ${s.autopost_page_name}${s.autopost_ig_name ? ` + Instagram @${s.autopost_ig_name}` : ''}</small>` : ''}</h2>
  ${connected && s.autopost_long_lived !== '1' ? html`<p class="flash flash-error small">⚠️ টোকেনটা লম্বা মেয়াদের করা যায়নি (App ID আর App Secret দেওয়া হয়নি) — কিছুদিন পর পোস্ট বন্ধ হয়ে যেতে পারে। নিচের ধাপ ৫-৬ করে আবার যুক্ত করুন।</p>` : ''}
  <details class="help" ${connected ? '' : 'open'}><summary>💡 টোকেন কোথা থেকে আনবেন (একবারই, ৫-১০ মিনিট)</summary><div><ol class="steps">
    <li>কম্পিউটারে <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> খুলুন (পেজের অ্যাডমিন অ্যাকাউন্ট দিয়ে লগইন) → <b>Create App</b> → "Other" → "Business" → নাম দিন (যেমন "Shobmilbe Poster") → Create।</li>
    <li>এরপর <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a> খুলুন। ডানে "Meta App"-এ আপনার অ্যাপ বেছে নিন।</li>
    <li>"User or Page" এ <b>User Token</b> রেখে "Permissions"-এ এগুলো যোগ করুন: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>business_management</code>, আর Instagram চাইলে <code>instagram_basic</code>, <code>instagram_content_publish</code>।</li>
    <li><b>Generate Access Token</b> চাপুন → আপনার পেজ (আর Instagram) বেছে অনুমতি দিন → উপরের লম্বা টোকেনটা কপি করে নিচের "টোকেন" ঘরে দিন।</li>
    <li>অ্যাপের <b>App settings → Basic</b> থেকে <b>App ID</b> আর <b>App Secret</b> (Show চেপে) কপি করে নিচে দিন। এতে টোকেন আর কখনো মেয়াদ শেষ হবে না।</li>
    <li>"যুক্ত করুন" চাপুন। সবুজ ✅ লেখা এলেই হয়ে গেল — অ্যাপ "Development" মোডেই থাকতে পারে, নিজের পেজে পোস্টের জন্য রিভিউ লাগে না।</li>
  </ol></div></details>
  <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="connect">
    ${ui.field('টোকেন (Graph API Explorer থেকে)', ui.textarea('token', '', { rows: 3, class: 'mono', required: true, autocomplete: 'off', placeholder: 'EAAG…' }))}
    <div class="field-row">
      ${ui.field('App ID', ui.input('app_id', s.autopost_app_id || '', { inputmode: 'numeric', placeholder: '1234567890' }))}
      ${ui.field('App Secret', secretInput('app_secret', s.autopost_app_secret))}
      ${ui.field('পেজ ID (ঐচ্ছিক)', ui.input('page_id', s.autopost_page_id || '', { inputmode: 'numeric' }), 'একাধিক পেজ থাকলে কোনটায় পোস্ট হবে')}
    </div>
    <button class="btn">🔗 ${connected ? 'আবার যুক্ত করুন' : 'যুক্ত করুন'}</button>
  </form>
  ${connected ? html`<form method="post" action="${BASE}" data-confirm="Facebook পেজ সরিয়ে দেবেন? অটো পোস্ট বন্ধ হয়ে যাবে."><input type="hidden" name="action" value="disconnect"><button class="btn btn-sm btn-ghost">সংযোগ সরিয়ে দিন</button></form>` : ''}
</section>

<section class="panel"><h2>২. কখন, কোথায় পোস্ট হবে</h2>
  <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="settings">
    ${ui.switchRow('autopost_on', s.autopost_on === '1', 'প্রতিদিন নিজে থেকে পোস্ট করো', connected ? 'নিচের সময়গুলোতে একটা করে পণ্য' : 'আগে উপরে Facebook পেজ যুক্ত করুন')}
    ${ui.switchRow('autopost_fb', s.autopost_fb !== '0', 'Facebook পেজে', s.autopost_page_name || '')}
    ${ui.switchRow('autopost_ig', s.autopost_ig === '1', 'Instagram-এ', s.autopost_ig_name ? '@' + s.autopost_ig_name : 'পেজের সাথে Instagram বিজনেস অ্যাকাউন্ট যুক্ত করলে চালু করা যাবে')}
    ${ui.field('পোস্টের সময় (ঘণ্টা, ২৪ ঘণ্টার হিসাবে, কমা দিয়ে — সর্বোচ্চ ৪টা)', ui.input('autopost_hours', hours.join(','), { placeholder: '11,20' }),
    'যেমন 11,20 = সকাল ১১টা আর রাত ৮টা (বাংলাদেশ সময়)। মানুষ সবচেয়ে বেশি ফেসবুকে থাকে দুপুর ১টা-২টা আর রাত ৮টা-১১টা। সময়ের পর প্রথম ঘণ্টার মধ্যে পোস্ট যায়।')}
    <div id="blog"></div>
    ${ui.switchRow('autopost_engage', s.autopost_engage !== '0', '💬 এনগেজমেন্ট পোস্ট (টিপস, কুইজ, প্রশ্ন)', hours.length > 1 ? `প্রতিদিন প্রথম সময়ে (${hourLabel(hours[0])}) পণ্যের বদলে একটা টিপস/কুইজ/প্রশ্ন — ফলোয়ার বাড়ানোর জন্য` : 'একদিন পর পর পণ্যের বদলে একটা টিপস/কুইজ/প্রশ্ন — ফলোয়ার বাড়ানোর জন্য')}
    ${ui.switchRow('autoblog_on', s.autoblog_on === '1', '📝 প্রতি সপ্তাহে দাম-তালিকা ব্লগ লেখো/আপডেট করো', 'প্রতিটা বড় ক্যাটাগরির (অন্তত ৫টা পণ্য) জন্য একটা লেখা')}
    <button class="btn">সেভ করুন</button>
  </form>
</section>

<div class="two-col">
<section class="panel"><h2>৩. পরের পোস্ট দেখতে এমন হবে</h2>
  ${preview ? html`<p class="small muted">আজকের ক্যাটাগরি থেকে বাছাই (প্রতিবার একটু আলাদা হতে পারে)</p>
    <p><a href="${base}/p/${preview.slug}" target="_blank" rel="noopener"><img src="/media/${preview.image_id}/t" alt="" style="max-width:160px;border-radius:8px"></a></p>
    <pre class="small" style="white-space:pre-wrap;background:var(--soft,#f5f7fb);padding:12px;border-radius:8px">${autopost.caption(preview, s, 'facebook')}</pre>` : html`<p class="muted">পোস্ট করার মতো পণ্য নেই (স্টকে আছে, ছবি আছে, দোকানে চালু — এমন পণ্য লাগবে)।</p>`}
  <form method="post" action="${BASE}" data-confirm="এখনই পেজে একটা পণ্য পোস্ট করবেন?"><input type="hidden" name="action" value="now">
    <button class="btn" ${connected ? '' : 'disabled'}>📤 এখনই একটা পোস্ট করুন</button></form>
</section>
<section class="panel" id="engage"><h2>💬 ফলোয়ার বাড়ানোর পোস্ট</h2>
  <p class="small">শুধু পণ্যের বিজ্ঞাপন দেখে মানুষ পেজ ফলো করে না — ফলো করে যেখানে কিছু শেখে বা কথা বলতে পারে। তাই পালা করে যায়:
  <b>💡 টিপস</b> (সাথে দোকানের মিল থাকা পার্টস) → <b>🧠 কুইজ</b> (পার্টসের ছবি, ৩টা উত্তর) → <b>✅ উত্তর</b> (পরের পোস্টে, দাম আর লিংকসহ — মানুষ উত্তর দেখতে ফিরে আসে) → <b>💡 টিপস</b> → <b>❓ প্রশ্ন</b> (কমেন্টে আলাপ)।</p>
  <p class="small muted">এ পর্যন্ত: টিপস ${bn(engN.tip || 0)} · কুইজ ${bn(engN.quiz || 0)} · উত্তর ${bn(engN.answer || 0)} · প্রশ্ন ${bn(engN.question || 0)} — মোট ${bn(require('../data/fbcontent').TIPS.length)}টা টিপস আর ${bn(require('../data/fbcontent').QUESTIONS.length)}টা প্রশ্ন জমা আছে।</p>
  ${engPreview ? html`<p class="small"><b>পরের এনগেজমেন্ট পোস্ট: ${ENGAGE_LABEL[engPreview.kind] || engPreview.kind}</b></p>
    ${engPreview.product && engPreview.product.image_id ? html`<p><img src="/media/${engPreview.product.image_id}/t" alt="" style="max-width:140px;border-radius:8px"></p>` : ''}
    <pre class="small" style="white-space:pre-wrap;background:var(--soft,#f5f7fb);padding:12px;border-radius:8px">${engPreview.text}</pre>` : ''}
  <form method="post" action="${BASE}" class="row-actions" data-confirm="এখনই পেজে পোস্ট করবেন?"><input type="hidden" name="action" value="engage">
    <button class="btn btn-sm" name="kind" value="${nextKind}" ${connected ? '' : 'disabled'}>📤 এই পোস্টটা এখনই দিন</button>
    <button class="btn btn-sm btn-ghost" name="kind" value="tip" ${connected ? '' : 'disabled'}>💡 টিপস</button>
    <button class="btn btn-sm btn-ghost" name="kind" value="quiz" ${connected ? '' : 'disabled'}>🧠 কুইজ</button>
    <button class="btn btn-sm btn-ghost" name="kind" value="question" ${connected ? '' : 'disabled'}>❓ প্রশ্ন</button>
  </form>
  <p class="small muted">টিপ: কমেন্টে কেউ প্রশ্ন করলে ১ ঘণ্টার মধ্যে উত্তর দিন — Facebook তখন পোস্টটা আরও মানুষকে দেখায়।</p>
</section>
<section class="panel"><h2>📝 দাম-তালিকা লেখাগুলো</h2>
  ${posts.length ? html`<ul class="plain-list">${posts.map((p) => html`<li>${p.status === 'published' ? '✅' : '⏸'} <a href="${base}/blog/${p.slug}" target="_blank" rel="noopener">${p.title}</a> <span class="small muted">· আপডেট ${fmtDate(p.updated_at, false)}</span></li>`)}</ul>
    <p class="small muted">কোনোটা না চাইলে ব্লগ থেকে সেটা "খসড়া" করে দিন — তখন আর আপডেট হবে না।</p>` : html`<p class="muted">এখনো কোনো লেখা নেই।</p>`}
  <form method="post" action="${BASE}"><input type="hidden" name="action" value="blog"><button class="btn btn-sm">📝 এখনই সব লেখা বানান / আপডেট করুন</button></form>
</section>
</div>

<section class="panel table-wrap"><h2>আগের পোস্টগুলো</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>কোথায়</th><th>পণ্য</th><th>ফল</th></tr></thead><tbody>
  ${recent.map((r) => html`<tr><td class="small nowrap">${fmtDate(r.created_at)}</td><td>${r.channel === 'instagram' ? '📸 Instagram' : '📘 Facebook'}${r.kind && r.kind !== 'product' ? html`<br><span class="small">${ENGAGE_LABEL[r.kind] || r.kind}</span>` : ''}</td>
    <td>${r.slug ? html`<a href="${base}/p/${r.slug}" target="_blank" rel="noopener">${r.product_name}</a>` : r.product_name || '—'}</td>
    <td>${r.ok ? (postLink(r) ? html`<a href="${postLink(r)}" target="_blank" rel="noopener">✅ পোস্ট দেখুন</a>` : '✅') : html`<span class="small" style="color:#c0392b">❌ ${r.message}</span>`}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কোনো পোস্ট হয়নি।</p>`}
</section>`;
  return ctx.page('অটো মার্কেটিং', body, 'automarketing');
}

module.exports = {
  routes: [{ method: '*', path: BASE, perm: 'marketing', handler: handle }],
};

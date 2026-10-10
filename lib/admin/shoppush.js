'use strict';
// Admin → মার্কেটিং → 🔔 ফোনে অফারের নোটিফিকেশন: customers who said "yes" get a notification on their phone/computer
// (like an app) — the owner writes the offer here and sends it. Free: no SMS cost. Works in Chrome / Edge / Firefox
// on Android and computers, and on iPhone when the shop is added to the home screen.
const { html, int, str, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const push = require('../services/push');

const BASE = '/admin/marketing/push';
const BATCH = 300; // phones per click

async function page(ctx, note = null) {
  const s = ctx.settings;
  await push.publicKey(); // makes the site's key pair once
  const [count, camps, week] = await Promise.all([push.shopCount(), db.q(`SELECT c.*, st.name AS staff_name FROM push_campaigns c LEFT JOIN staff st ON st.id=c.staff_id ORDER BY c.id DESC LIMIT 20`),
    db.one(`SELECT count(*)::int AS n FROM shop_push_subs WHERE created_at > now() - interval '7 days'`)]);
  const base = String(s.site_url || '').replace(/\/+$/, '');
  const body = html`<div class="title-row"><h1>🔔 ফোনে অফারের নোটিফিকেশন</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}${note ? ui.flash(note) : ''}
<div class="kpis kpis-tight">
  ${ui.kpi('অবস্থা', s.shoppush_on === '1' ? '✅ চালু' : '⚪ বন্ধ', '')}
  ${ui.kpi('যারা নোটিফিকেশন নিচ্ছেন', bn(count), `গত ৭ দিনে নতুন ${bn(week.n)} জন`, 'kpi-blue')}
  ${ui.kpi('খরচ', 'ফ্রি', 'SMS-এর মতো টাকা লাগে না')}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>চালু করলে দোকানে দ্বিতীয় পেজ দেখার কিছুক্ষণ পর নিচে ছোট একটা বক্স আসে: "নতুন অফারের খবর ফোনে পেতে চান?" — কাস্টমার "হ্যাঁ" চাপলে এই তালিকায় যোগ হন। ফুটারেও "🔔 অফারের খবর পান" লিংক থাকে।</li>
  <li>এখান থেকে শিরোনাম, লেখা আর লিংক দিয়ে পাঠালে তাদের ফোনে/কম্পিউটারে অ্যাপের মতো নোটিফিকেশন যায়; চাপলে আপনার দেওয়া পেজ খোলে।</li>
  <li>Android ফোন আর কম্পিউটারের Chrome/Edge/Firefox-এ চলে। iPhone-এ চলে শুধু দোকানটা "Add to Home Screen" করা থাকলে।</li>
  <li>📱 যাদের ফোনে <b>সবমিলবে অ্যাপ</b> আছে, তারা আলাদা করে "হ্যাঁ" না চাপলেও এই নোটিফিকেশন পাবেন — অ্যাপ প্রতি ৩০ মিনিটে নতুন অফার আছে কিনা দেখে নেয় (শুধু সর্বশেষটা, পাঠানোর ২ দিনের মধ্যে)।</li>
  <li>বেশি পাঠালে মানুষ বিরক্ত হয়ে বন্ধ করে দেয় — সপ্তাহে ২-৩টার বেশি না পাঠানোই ভালো।</li>
</ol>`)}
<div class="two-col">
  <section class="panel"><h2>📣 নতুন নোটিফিকেশন পাঠান</h2>
    ${s.shoppush_on !== '1' ? html`<p class="muted">আগে পাশের সেটিংস থেকে চালু করুন।</p>` : !count ? html`<p class="muted">এখনো কেউ নোটিফিকেশন নেননি — কাস্টমাররা "হ্যাঁ" চাপলে এখানে পাঠানো যাবে।</p>` : ''}
    <form method="post" action="${BASE}" class="form" data-confirm="সবাইকে নোটিফিকেশন পাঠাবেন?">
      <input type="hidden" name="action" value="send">
      ${ui.field('শিরোনাম', ui.input('title', '', { required: true, maxlength: 60, placeholder: '⚡ আজ রাত ১২টা পর্যন্ত ফ্ল্যাশ সেল!' }))}
      ${ui.field('লেখা', ui.textarea('body', '', { rows: 2, maxlength: 160, placeholder: 'সব সোল্ডারিং আয়রনে ২০% ছাড়। স্টক সীমিত।' }))}
      ${ui.field('চাপলে কোন পেজ খুলবে', ui.input('url', '/products?sort=offer', { maxlength: 300 }), 'যেমন /products?sort=offer, /p/পণ্যের-লিংক, অথবা পুরো ঠিকানা')}
      ${ui.imagePicker('image_id', null, { label: 'বড় ছবি (ঐচ্ছিক — Android-এ নোটিফিকেশনের ভেতরে দেখায়)', wide: true })}
      <button class="btn" ${s.shoppush_on === '1' && count ? '' : 'disabled'}>📨 পাঠান (${bn(Math.min(count, BATCH))} জনকে এখন)</button>
      ${count > BATCH ? html`<p class="small muted">একবারে ${bn(BATCH)} জন — বাকিদের নিচের তালিকা থেকে "বাকিদের পাঠান" চাপুন।</p>` : ''}
    </form></section>
  <section class="panel"><h2>⚙️ সেটিংস</h2>
    <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="settings">
      ${ui.switchRow('shoppush_on', s.shoppush_on === '1', 'অফারের নোটিফিকেশন চালু', 'বন্ধ করলে দোকানে বক্স/লিংক থাকবে না আর পাঠানো যাবে না। আগের তালিকা থেকে যাবে।')}
      ${ui.switchRow('shoppush_prompt', s.shoppush_prompt !== '0', 'নিজে থেকে ছোট বক্স দেখাও', 'বন্ধ থাকলে শুধু ফুটারের লিংক থেকে চালু করা যাবে।')}
      ${ui.field('বক্সের লেখা', ui.input('shoppush_text', s.shoppush_text || 'নতুন অফার আর ফ্ল্যাশ সেলের খবর ফোনে পেতে চান?', { maxlength: 100 }))}
      ${ui.field('কত সেকেন্ড পর বক্স আসবে', ui.input('shoppush_delay', s.shoppush_delay || 25, { type: 'number', min: 5, max: 300, class: 'w-num' }))}
      <button class="btn btn-sm">সেভ করুন</button></form></section>
</div>
<section class="panel table-wrap"><h2>আগে যা পাঠানো হয়েছে</h2>
  ${camps.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>শিরোনাম</th><th class="num">গেছে</th><th class="num">যায়নি</th><th></th></tr></thead><tbody>
  ${camps.map((c) => html`<tr><td class="small nowrap">${fmtDate(c.created_at)}<br><span class="muted">${c.staff_name || ''}</span></td><td><b>${c.title}</b><br><span class="small">${c.body}</span>${c.url ? html`<br><a class="small" href="${c.url.startsWith('/') ? base + c.url : c.url}" target="_blank" rel="noopener">${c.url}</a>` : ''}</td>
    <td class="num">${bn(c.sent)}</td><td class="num">${bn(c.failed)}</td>
    <td>${c.total > c.sent + c.failed ? html`<form method="post" action="${BASE}"><input type="hidden" name="action" value="more"><input type="hidden" name="id" value="${c.id}"><button class="btn btn-sm">বাকিদের পাঠান</button></form>` : ''}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কিছু পাঠানো হয়নি।</p>`}
</section>`;
  return ctx.page('অফারের নোটিফিকেশন', body, 'shoppush');
}

function message(s, c) {
  const base = String(s.site_url || '').replace(/\/+$/, '');
  const url = /^https?:\/\//i.test(c.url) || !base ? (c.url || '/') : base + (c.url.startsWith('/') ? c.url : '/' + c.url);
  return { title: c.title, body: c.body, url: c.url && c.url.startsWith('/') ? c.url : url, tag: 'offer-' + c.id, image: c.image_id ? `${base}/media/${c.image_id}` : undefined, icon: s.favicon_id ? `${base}/media/${s.favicon_id}/t` : undefined };
}

async function post(ctx) {
  const b = await ctx.body();
  const s = ctx.settings;
  if (b.action === 'settings') {
    await db.setMany({ shoppush_on: b.shoppush_on ? '1' : '0', shoppush_prompt: b.shoppush_prompt ? '1' : '0', shoppush_text: str(b.shoppush_text, 100), shoppush_delay: String(Math.max(5, Math.min(300, int(b.shoppush_delay, 25)))) });
    await push.publicKey();
    await ctx.log('settings', 'marketing', null, `অফারের নোটিফিকেশন: ${b.shoppush_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  if (s.shoppush_on !== '1') return ctx.fail(BASE, 'আগে চালু করুন।');
  let c;
  if (b.action === 'send') {
    const title = str(b.title, 60);
    if (!title) return ctx.fail(BASE, 'শিরোনাম দিন।');
    let url = str(b.url, 300);
    if (url && !/^\/(?!\/)/.test(url) && !/^https:\/\//i.test(url)) url = '/' + url.replace(/^\/+/, '');
    const total = await push.shopCount();
    c = await db.one(`INSERT INTO push_campaigns(title, body, url, image_id, total, staff_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, str(b.body, 160), url, int(b.image_id) || null, total, ctx.user.id]);
    if (c.image_id) await db.q(`UPDATE media SET owner_type='push', owner_id=$1 WHERE id=$2 AND owner_type IS NULL`, [c.id, c.image_id]);
  } else if (b.action === 'more') {
    c = await db.one('SELECT * FROM push_campaigns WHERE id=$1', [int(b.id)]);
    if (!c) return ctx.back(BASE);
  } else return ctx.back(BASE);
  const cursor = int(s[`push_cursor_${c.id}`]);
  const r = await push.shopSendBatch(message(s, c), { afterId: cursor, limit: BATCH });
  await db.setSetting(`push_cursor_${c.id}`, String(r.lastId));
  const upd = await db.one('UPDATE push_campaigns SET sent=sent+$1, failed=failed+$2, total=CASE WHEN $3 THEN sent+$1+failed+$2 ELSE total END WHERE id=$4 RETURNING *', [r.sent, r.failed, r.done, c.id]);
  await ctx.log('push_campaign', 'marketing', c.id, `নোটিফিকেশন "${c.title}": ${r.sent} জন`);
  await ctx.reloadSettings();
  return page({ ...ctx, method: 'GET' }, { text: `✅ ${bn(r.sent)} জনকে পাঠানো হয়েছে${r.failed ? `, ${bn(r.failed)}টি যায়নি (বন্ধ করে দিয়েছেন বা ফোন বদলেছেন)` : ''}।${!r.done && upd.total > upd.sent + upd.failed ? ' বাকিদের পাঠাতে নিচের তালিকা থেকে "বাকিদের পাঠান" চাপুন।' : ''}` });
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'marketing', handler: (ctx) => page(ctx) },
    { method: 'POST', path: BASE, perm: 'marketing', handler: post },
  ],
};

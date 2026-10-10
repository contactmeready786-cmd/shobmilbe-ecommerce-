'use strict';
// Admin → মার্কেটিং → রিভিউ ও পছন্দের তালিকা: approve / hide / answer / delete customer reviews,
// the review switches, and which products customers put on their wishlist (♡) most.
const { html, bn, int, str, fmtDate, pageNum } = require('../util');
const db = require('../db');
const ui = require('./ui');
const R = require('../models/reviews');

const BASE = '/admin/reviews';
const PER = 30;
const MSG = { approved: 'রিভিউ এখন দোকানে দেখাচ্ছে।', hidden: 'রিভিউ লুকানো হয়েছে।', replied: 'উত্তর সেভ হয়েছে।', gone: 'রিভিউ মুছে ফেলা হয়েছে।', set: 'সেটিংস সেভ হয়েছে।' };
const stars = (n) => html`<span class="stars" aria-label="${bn(n)} স্টার">${'★'.repeat(n)}<span class="muted">${'★'.repeat(5 - n)}</span></span>`;

async function page(ctx) {
  const status = R.STATUS[ctx.query.get('status')] ? ctx.query.get('status') : '';
  const q = str(ctx.query.get('q'), 60);
  const pg = pageNum(ctx.query);
  const [{ rows, total }, counts, wished] = await Promise.all([
    R.list({ status, q, limit: PER, offset: (pg - 1) * PER }), R.counts(),
    db.q('SELECT id, name, sku, wish_count, rating_avg, rating_count FROM products WHERE wish_count > 0 ORDER BY wish_count DESC, id LIMIT 15'),
  ]);
  const s = ctx.settings;
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const chip = (key, label, n) => html`<a class="chip ${status === key ? 'on' : ''}" href="${BASE}${key ? `?status=${key}` : ''}">${label} <b>${bn(n)}</b></a>`;
  const msg = MSG[ctx.query.get('m')];
  const body = html`<h1>⭐ রিভিউ ও পছন্দের তালিকা</h1>${msg ? ui.flash({ text: msg }) : ui.flash(ctx.flash)}
<div class="chips">${chip('', 'সব', counts.all)}${chip('pending', '⏳ অনুমোদনের অপেক্ষায়', counts.pending)}${chip('approved', '✅ দেখানো হচ্ছে', counts.approved)}${chip('hidden', '🙈 লুকানো', counts.hidden)}</div>
<form class="toolbar" method="get" action="${BASE}">
  ${status ? html`<input type="hidden" name="status" value="${status}">` : ''}
  <input type="search" name="q" value="${q}" placeholder="লেখা, নাম, পণ্য বা SKU দিয়ে খুঁজুন">
  <button class="btn btn-sm">খুঁজুন</button>
</form>
<div class="two-col wide-left">
  <section class="panel">
    ${rows.length ? html`<ul class="review-admin">${rows.map((r) => html`<li class="${r.status === 'pending' ? 'is-pending' : ''}">
      <span class="thumb">${r.image_id ? html`<img src="/media/${r.image_id}/t" alt="" loading="lazy">` : '📦'}</span>
      <div>
        <p>${stars(r.rating)} <b translate="no">${r.name}</b>${r.verified ? html` <span class="pill pill-delivered">✓ যাচাই করা ক্রেতা</span>` : ''}
          ${ui.pill(R.STATUS[r.status], r.status === 'pending' ? 'pill-pending' : '')}
          <span class="small muted">${fmtDate(r.created_at)}${r.phone ? ` · ${r.phone}` : ''}</span></p>
        <p class="small"><a href="/p/${r.product_slug}" target="_blank" rel="noopener">${r.product_name}</a> <span class="muted">SKU ${r.sku || '—'}</span>${r.order_id ? html` · <a href="/admin/orders/${r.order_id}">অর্ডার</a>` : ''}</p>
        <p class="review-body" translate="no">${r.body}</p>
        ${r.photos && r.photos.length ? html`<div class="ret-photos">${r.photos.map((pid) => html`<a href="${BASE}/photo/${pid}" target="_blank" rel="noopener"><img src="${BASE}/photo/${pid}" alt="রিভিউয়ের ছবি" loading="lazy"></a>`)}</div>` : ''}
        ${r.reply ? html`<p class="review-reply"><b>আপনার উত্তর:</b> ${r.reply}</p>` : ''}
        <div class="row-actions">
          ${r.status !== 'approved' ? html`<form method="post" action="${BASE}/${r.id}/status"><input type="hidden" name="status" value="approved"><button class="btn btn-sm">✅ দেখান</button></form>` : ''}
          ${r.status !== 'hidden' ? html`<form method="post" action="${BASE}/${r.id}/status"><input type="hidden" name="status" value="hidden"><button class="btn btn-sm btn-ghost">🙈 লুকান</button></form>` : ''}
          <form method="post" action="${BASE}/${r.id}/delete" data-confirm="এই রিভিউটা একদম মুছে ফেলবেন? মনে রাখুন: আইন (ডিজিটাল কমার্স নির্দেশিকা ২০২১) অনুযায়ী খারাপ রিভিউ মুছে ফেলা যায় না — শুধু স্প্যাম, গালিগালাজ বা ভুয়া রিভিউ মুছুন।"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form>
        </div>
        <details><summary class="small">💬 ${r.reply ? 'উত্তর বদলান' : 'উত্তর দিন'} (দোকানে রিভিউর নিচে দেখাবে)</summary>
          <form method="post" action="${BASE}/${r.id}/reply" class="reply-box">${ui.textarea('reply', r.reply || '', { rows: 2, maxlength: 1000, placeholder: 'যেমন: ধন্যবাদ! আবার আসবেন।' })}<button class="btn btn-sm">সেভ</button></form>
        </details>
      </div>
    </li>`)}</ul>${ui.pager(total, pg, PER, BASE + (qs.toString() ? '?' + qs : ''))}` : html`<p class="muted">${status === 'pending' ? 'অনুমোদনের অপেক্ষায় কোনো রিভিউ নেই।' : 'কোনো রিভিউ পাওয়া যায়নি।'}</p>`}
  </section>
  <div>
    <section class="panel">
      <h2>⚙️ সেটিংস</h2>
      <form method="post" action="${BASE}/settings" class="form">
        ${ui.switchRow('reviews_on', s.reviews_on !== '0', 'কাস্টমার রিভিউ চালু', 'চালু: ডেলিভারি হওয়া অর্ডারের পেজে "রিভিউ দিন" আসে, আর পণ্যের পেজে অনুমোদিত রিভিউ দেখায়। বন্ধ: দুটোই লুকিয়ে যায়।')}
        ${ui.switchRow('reviews_auto_approve', s.reviews_auto_approve === '1', 'অনুমোদন ছাড়াই সাথে সাথে দেখাও', 'বন্ধ রাখাই ভালো — তাহলে স্প্যাম বা ভুয়া রিভিউ দোকানে যাবে না, আপনি আগে দেখে নেবেন।')}
        ${ui.switchRow('review_photos_on', s.review_photos_on !== '0', '📸 রিভিউতে ছবি দেওয়া যাবে', 'কাস্টমার রিভিউয়ের সাথে সর্বোচ্চ ৩টা ছবি দিতে পারবেন। রিভিউ "দেখান" করলে তবেই ছবি দোকানে দেখা যায়।')}
        <p class="small muted">🔒 রিভিউ শুধু তারাই দিতে পারেন যাদের অর্ডার <b>ডেলিভারি হয়েছে</b> — নিজের অর্ডারের পেজ থেকে (অর্ডারটা যে ফোন/কম্পিউটার থেকে করেছেন সেখানে, অথবা "অর্ডার ট্র্যাক" পেজে অর্ডার নম্বর + মোবাইল নম্বর দিয়ে খুলে)। প্রতি অর্ডারের প্রতিটা পণ্যে একটাই রিভিউ। অন্য কেউ রিভিউর অপশনই দেখে না।</p>
        ${ui.switchRow('wishlist_on', s.wishlist_on !== '0', 'পছন্দের তালিকা (♡) চালু', 'পণ্যের ছবির কোণে ♡ বাটন আর "পছন্দের তালিকা" পেজ।')}
        <button class="btn">সেভ করুন</button>
      </form>
      <p class="small muted">রিভিউ অনুমোদন হলে গুগলেও পণ্যের পাশে তারা (★★★★★) দেখানোর তথ্য পাঠানো হয়।</p>
    </section>
    <section class="panel">
      <h2>♡ সবচেয়ে বেশি পছন্দ করা পণ্য</h2>
      <p class="small muted">কাস্টমাররা কোন পণ্য ♡ দিয়ে রেখেছে — এগুলোতে ছোট অফার দিলে বিক্রি হওয়ার সম্ভাবনা বেশি।</p>
      ${wished.length ? html`<table class="table compact"><thead><tr><th>পণ্য</th><th class="num">♡</th><th class="num">রেটিং</th></tr></thead>
      <tbody>${wished.map((p) => html`<tr><td><a href="/admin/products/${p.id}">${p.name}</a><br><span class="small muted">SKU ${p.sku || '—'}</span></td>
        <td class="num"><b>${bn(p.wish_count)}</b></td><td class="num small">${p.rating_count ? html`${bn(Number(p.rating_avg).toFixed(1))}★ (${bn(p.rating_count)})` : '—'}</td></tr>`)}</tbody></table>`
    : html`<p class="muted small">এখনো কেউ ♡ দেয়নি।</p>`}
    </section>
  </div>
</div>`;
  return ctx.page('রিভিউ', body, 'reviews');
}

async function setStatus(ctx, m) {
  const b = await ctx.body();
  const r = await R.setStatus(int(m[1]), String(b.status || ''));
  if (r) await ctx.log('edit', 'product', r.product_id, `রিভিউ #${int(m[1])}: ${R.STATUS[b.status] || ''}`);
  return ctx.redirect(ctx.res, `${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=${b.status === 'approved' ? 'approved' : 'hidden'}`);
}
async function reply(ctx, m) {
  const b = await ctx.body();
  const r = await R.reply(int(m[1]), b.reply);
  if (r) await ctx.log('edit', 'product', r.product_id, `রিভিউ #${int(m[1])}-এ উত্তর`);
  return ctx.redirect(ctx.res, `${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=replied`);
}
async function remove(ctx, m) {
  const r = await R.remove(int(m[1]));
  if (r) await ctx.log('delete', 'product', r.product_id, `রিভিউ #${int(m[1])} মুছা`);
  return ctx.redirect(ctx.res, `${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=gone`);
}
async function saveSettings(ctx) {
  const b = await ctx.body();
  const v = {};
  for (const k of ['reviews_on', 'reviews_auto_approve', 'wishlist_on', 'review_photos_on']) v[k] = b[k] ? '1' : '0';
  await db.setMany(v);
  await ctx.log('settings', 'settings', null, `রিভিউ/পছন্দের তালিকা: ${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', ')}`);
  return ctx.redirect(ctx.res, `${BASE}?m=set`);
}
// back to the same list page (only our own page, never another site)
function back(ctx) {
  try {
    const u = new URL(ctx.req.headers.referer || '');
    if (u.pathname === BASE) return BASE + u.search.replace(/([?&])m=[^&]*/g, '$1').replace(/[?&]+$/, '');
  } catch (_) { /* no referer */ }
  return BASE;
}

// a review's photo (also before the review is shown — only staff)
async function photo(ctx, m) {
  const p = await db.one(`SELECT mime, data, ik_url FROM media WHERE id=$1 AND owner_type IN ('review','review_wait')`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(ctx.res, 404, 'Not found', 'text/plain');
  ctx.res.writeHead(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'reviews', handler: page },
    { method: 'POST', path: `${BASE}/settings`, perm: 'reviews', handler: saveSettings },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/status$/, perm: 'reviews', handler: setStatus },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/reply$/, perm: 'reviews', handler: reply },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/delete$/, perm: 'reviews', handler: remove },
    { method: 'GET', path: /^\/admin\/reviews\/photo\/(\d+)$/, perm: 'reviews', handler: photo },
  ],
};

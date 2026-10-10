'use strict';
// Admin → মার্কেটিং → ❓ প্রশ্ন-উত্তর and 🔔 স্টকে এলে জানাও.
//   প্রশ্ন-উত্তর: customers' questions on products — answer, show on the shop, or hide. An SMS tells the asker (if a number was given).
//   স্টকে এলে জানাও: who is waiting for which out-of-stock product (most wanted first) and the SMS that goes out when it is back.
const { html, int, str, bn, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');
const X = require('../models/extras');

// ---------------------------------------------------------------- questions
async function questionsPage(ctx) {
  const status = X.Q_STATUSES[ctx.query.get('status')] || ctx.query.get('status') === 'all' ? ctx.query.get('status') : 'pending';
  const page = Math.max(1, int(ctx.query.get('page'), 1));
  const [rows, counts] = await Promise.all([X.listQuestions({ status, limit: 50, offset: (page - 1) * 50 }), X.questionCounts()]);
  const tab = (k, l) => html`<a class="chip ${status === k ? 'on' : ''}" href="/admin/questions?status=${k}">${l} <b>${bn(counts[k] || 0)}</b></a>`;
  const body = html`<div class="title-row"><h1>❓ পণ্যে প্রশ্ন-উত্তর</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/questions?status=${status}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<p class="muted small">কাস্টমাররা পণ্যের পেজ থেকে প্রশ্ন করেন। উত্তর লিখে "দোকানে দেখান" চাপলে প্রশ্ন আর উত্তর পণ্যের পেজে সবাই দেখবে — কাস্টমার মোবাইল নম্বর দিয়ে থাকলে SMS-এ জানানো হয় (SMS চালু থাকলে)। পণ্যের পেজে এই অংশ চালু/বন্ধ: স্টোর ডিজাইন → দোকানে কী দেখাবে।</p>
<div class="chips">${tab('pending', 'উত্তর বাকি')}${tab('published', 'দোকানে দেখাচ্ছে')}${tab('hidden', 'লুকানো')}${tab('all', 'সব')}</div>
${rows.length ? html`<div class="qa-admin">${rows.map((q) => html`<section class="panel qa-item">
  <div class="qa-head">
    <span class="thumb">${q.image_id ? html`<img src="/media/${q.image_id}/t" alt="">` : html`<span>${q.emoji || '📦'}</span>`}</span>
    <div><a href="/p/${q.slug}" target="_blank" rel="noopener"><b>${q.product_name}</b></a><br>
      <span class="small muted">${q.name || 'নাম দেননি'}${q.phone ? html` · <a href="tel:${q.phone}">${q.phone}</a>` : ''} · ${fmtDate(q.created_at)}</span></div>
    ${ui.pill(X.Q_STATUSES[q.status] || q.status, q.status === 'pending' ? 'pill-warn' : q.status === 'published' ? 'pill-ok' : '')}
  </div>
  <form method="post" action="/admin/questions/${q.id}" class="form">
    ${ui.field('প্রশ্ন (দরকার হলে বানান ঠিক করুন)', ui.textarea('question', q.question, { rows: 2, maxlength: 500 }))}
    ${ui.field('আপনার উত্তর', ui.textarea('answer', q.answer, { rows: 3, maxlength: 1500, placeholder: 'যেমন: জি, এটা ২২০ ভোল্টে চলে। ১ বছরের ওয়ারেন্টি আছে।' }))}
    ${q.answered_by_name ? html`<p class="small muted">উত্তর দিয়েছেন: ${q.answered_by_name}${q.answered_at ? ` · ${fmtDate(q.answered_at)}` : ''}</p>` : ''}
    <div class="row-actions">
      <button class="btn btn-sm" name="publish" value="1">✅ সেভ করুন ও দোকানে দেখান</button>
      <button class="btn btn-sm btn-ghost" name="publish" value="0">সেভ করুন (লুকানো থাকবে)</button>
    </div>
  </form>
  <form method="post" action="/admin/questions/${q.id}/delete" data-confirm="প্রশ্নটা মুছবেন? রিসাইকেল বিনে থাকবে।" class="qa-del"><button class="link-btn danger small">🗑️ মুছুন</button></form>
</section>`)}</div>
${ui.pager(counts[status] || counts.all || 0, page, 50, `/admin/questions?status=${status}`)}` : ui.empty(status === 'pending' ? '🎉 উত্তর বাকি নেই।' : 'কিছু নেই।')}`;
  return ctx.page('প্রশ্ন-উত্তর', body, 'questions');
}

async function answer(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const back = (ctx.req.headers.referer && new URL(ctx.req.headers.referer).pathname === '/admin/questions') ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : '/admin/questions';
  let q;
  try {
    q = await X.answerQuestion(id, { answer: b.answer, publish: b.publish === '1', question: b.question }, ctx.user.id);
  } catch (e) { return ctx.fail(back, e.message); }
  await ctx.log('question_answer', 'question', id, `${q.status === 'published' ? 'দোকানে দেখানো' : 'সেভ'}: ${str(q.question, 80)}`);
  // the first answer to a question with a mobile number: tell the customer by SMS
  let note = '';
  if (q.firstAnswer && q.phone && q.status === 'published') {
    const SMS = require('../services/sms');
    if (SMS.ready(ctx.settings).ok) {
      const p = await db.one('SELECT slug, name FROM products WHERE id=$1', [q.product_id]);
      const base = String(ctx.settings.site_url || '').replace(/\/+$/, '');
      const r = await SMS.send(ctx.settings, q.phone, `${ctx.settings.store_name}: "${String(p ? p.name : '').slice(0, 40)}" নিয়ে আপনার প্রশ্নের উত্তর দেওয়া হয়েছে। ${base ? `দেখুন: ${base}/p/${encodeURIComponent(p ? p.slug : '')}#qa` : ''}`.trim(), { kind: 'question', staffId: ctx.user.id });
      note = r.ok ? ' কাস্টমারকে SMS-এ জানানো হয়েছে।' : ` (SMS যায়নি: ${r.msg})`;
    }
  }
  return ctx.redirect(ctx.res, back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent('সেভ হয়েছে।' + note));
}
async function removeQuestion(ctx, m) {
  const id = int(m[1]);
  await ctx.trash('question', id);
  await ctx.log('question_delete', 'question', id, 'প্রশ্ন মুছে ফেলা');
  return ctx.back('/admin/questions', 'deleted');
}

// ---------------------------------------------------------------- stock alerts
async function restockPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'tpl') {
      await db.setMany({ restock_sms: str(b.restock_sms, 300) });
      await ctx.log('settings', 'marketing', null, '"স্টকে এলে জানাও" SMS এর লেখা বদল');
      return ctx.back('/admin/marketing/restock', 'saved');
    }
    if (b.action === 'send') {
      const r = await X.restockSweep(ctx.settings, { limit: 60 });
      return ctx.redirect(ctx.res, '/admin/marketing/restock?info=' + encodeURIComponent(r.waiting ? 'SMS চালু নেই — আগে "কাস্টমারকে SMS" পেজে SMS কোম্পানি সেটআপ করুন।' : `${bn(r.sent)} জনকে SMS পাঠানো হয়েছে।`));
    }
    if (b.action === 'delete' && int(b.id)) {
      await db.q('DELETE FROM stock_alerts WHERE id=$1', [int(b.id)]);
      return ctx.back('/admin/marketing/restock', 'removed');
    }
    return ctx.back('/admin/marketing/restock');
  }
  const status = ['waiting', 'sent', 'all'].includes(ctx.query.get('status')) ? ctx.query.get('status') : 'waiting';
  const [top, rows, cnt, ptop, pcnt] = await Promise.all([X.stockAlertTop(15), X.stockAlertList({ status }),
    db.one(`SELECT count(*) FILTER (WHERE notified_at IS NULL)::int AS waiting, count(*) FILTER (WHERE notified_at IS NOT NULL)::int AS sent,
      count(DISTINCT product_id) FILTER (WHERE notified_at IS NULL)::int AS products FROM stock_alerts`),
    X.priceAlertTop(20), db.one(`SELECT count(*) FILTER (WHERE notified_at IS NULL)::int AS waiting, count(*) FILTER (WHERE notified_at IS NOT NULL)::int AS sent FROM price_alerts`)]);
  const smsOk = require('../services/sms').ready(ctx.settings).ok;
  const def = '{shop}: আপনি যে পণ্যটার খবর চেয়েছিলেন "{product}" আবার স্টকে এসেছে। এখনই অর্ডার করুন: {link}';
  const body = html`<div class="title-row"><h1>🔔 স্টকে এলে জানাও</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/marketing/restock?status=${status}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('অপেক্ষায় আছেন', bn(cnt.waiting), `${bn(cnt.products)}টি পণ্যের জন্য`, cnt.waiting ? 'kpi-blue' : '')}
  ${ui.kpi('SMS পাঠানো হয়েছে', bn(cnt.sent), 'পণ্য স্টকে আসার পর')}
  ${ui.kpi('SMS', smsOk ? '✅ চালু' : '⚪ বন্ধ', smsOk ? 'পণ্য এলে নিজে থেকে যাবে' : 'চালু না হলে তালিকা জমা থাকবে', smsOk ? '' : 'kpi-alert', '/admin/marketing/sms')}
</div>
<p class="muted small">স্টক শেষ পণ্যের পেজে কাস্টমার মোবাইল নম্বর রেখে যান। পণ্যটা আবার স্টকে এলে (পারচেজ, স্টক বাড়ানো, ভ্যারিয়েন্ট) কিছুক্ষণের মধ্যেই নিজে থেকে SMS চলে যায়। কোন পণ্য সবচেয়ে বেশি মানুষ চাইছে সেটা দেখে আগে কিনুন।</p>
<div class="two-col">
  <section class="panel table-wrap"><h2>🏆 সবচেয়ে বেশি চাওয়া পণ্য</h2>
    ${top.length ? html`<table class="table compact"><thead><tr><th></th><th>পণ্য</th><th class="num">অপেক্ষায়</th><th class="num">এখন স্টক</th><th></th></tr></thead><tbody>
    ${top.map((p) => html`<tr><td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="">` : html`<span>${p.emoji || '📦'}</span>`}</td><td>${p.name}<br><span class="small muted">SKU ${p.sku}</span></td>
      <td class="num"><b>${bn(p.n)}</b> জন</td><td class="num ${p.stock > 0 ? 'good' : 'warn'}">${bn(p.stock)}</td><td><a class="btn btn-sm btn-ghost" href="/admin/purchases/new?add=${p.id}">🛒 কিনুন</a></td></tr>`)}</tbody></table>`
    : html`<p class="muted">এখনো কেউ অপেক্ষায় নেই।</p>`}
  </section>
  <section class="panel"><h2>✉️ SMS এর লেখা</h2>
    <form method="post" action="/admin/marketing/restock" class="form"><input type="hidden" name="action" value="tpl">
      ${ui.field('লেখা', ui.textarea('restock_sms', ctx.settings.restock_sms || def, { rows: 3, maxlength: 300 }), html`<code>{shop}</code> দোকানের নাম, <code>{product}</code> পণ্যের নাম, <code>{link}</code> পণ্যের লিংক (সেটিংসে সাইটের ঠিকানা দেওয়া থাকলে)।`)}
      <button class="btn btn-sm">সেভ করুন</button></form>
    <form method="post" action="/admin/marketing/restock" class="form mt"><input type="hidden" name="action" value="send">
      <button class="btn btn-sm btn-ghost">📨 যাদের পণ্য এসেছে তাদের এখনই SMS পাঠান</button>
      <p class="small muted">সাধারণত নিজে থেকেই যায় — এই বাটন শুধু সাথে সাথে পাঠাতে চাইলে।</p></form>
  </section>
</div>
<section class="panel table-wrap">
  <div class="chips"><a class="chip ${status === 'waiting' ? 'on' : ''}" href="?status=waiting">অপেক্ষায়</a><a class="chip ${status === 'sent' ? 'on' : ''}" href="?status=sent">SMS গেছে</a><a class="chip ${status === 'all' ? 'on' : ''}" href="?status=all">সব</a></div>
  ${rows.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>মোবাইল</th><th>পণ্য</th><th class="num">স্টক</th><th>ফল</th><th></th></tr></thead><tbody>
  ${rows.map((r) => html`<tr><td class="small nowrap">${fmtDate(r.created_at)}</td><td class="mono small"><a href="tel:${r.phone}">${r.phone}</a></td>
    <td><a href="/admin/products/${r.edit_id}">${r.name}</a></td><td class="num">${bn(r.stock)}</td>
    <td class="small">${r.notified_at ? html`${r.result} <span class="muted">${fmtDate(r.notified_at)}</span>` : 'অপেক্ষায়'}</td>
    <td><form method="post" action="/admin/marketing/restock" data-confirm="এই অনুরোধ মুছবেন?"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${r.id}"><button class="link-btn danger small">মুছুন</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="muted">কিছু নেই।</p>`}
</section>
<section class="panel table-wrap" id="price"><h2>🔔 দাম কমলে জানাও — কারা অপেক্ষায়</h2>
  <p class="muted small">পণ্যের পেজে "দাম কমলে SMS-এ জানাও" ঘরে কাস্টমার নম্বর রেখে যান। আপনি দাম কমালে বা ফ্ল্যাশ সেলে দিলে কয়েক মিনিটের মধ্যে নিজে থেকে একবার SMS যায়। এখন অপেক্ষায়: <b>${bn(pcnt.waiting)}</b> জন · SMS গেছে: ${bn(pcnt.sent)}। বেশি মানুষ যেটা চাইছে, সেটায় ছোট অফার দিলেই বিক্রি হয়।</p>
  ${ptop.length ? html`<table class="table compact"><thead><tr><th>পণ্য</th><th class="num">অপেক্ষায়</th><th class="num">এখনকার দাম</th><th></th></tr></thead><tbody>
  ${ptop.map((p) => html`<tr><td>${p.name}<br><span class="small muted">SKU ${p.sku}</span></td><td class="num"><b>${bn(p.n)}</b> জন</td><td class="num">৳${bn(p.price)}</td>
    <td><a class="btn btn-sm btn-ghost" href="/admin/products/${p.edit_id}">দাম বদলান</a> <a class="btn btn-sm btn-ghost" href="/admin/marketing/flash">⚡ ফ্ল্যাশ সেল</a></td></tr>`)}</tbody></table>`
  : html`<p class="muted">এখনো কেউ অপেক্ষায় নেই।</p>`}
</section>`;
  return ctx.page('স্টকে এলে জানাও', body, 'restock');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/questions', perm: 'reviews', handler: questionsPage },
    { method: 'POST', path: /^\/admin\/questions\/(\d+)$/, perm: 'reviews', handler: answer },
    { method: 'POST', path: /^\/admin\/questions\/(\d+)\/delete$/, perm: 'reviews', handler: removeQuestion },
    { method: '*', path: '/admin/marketing/restock', perm: 'marketing', handler: restockPage },
  ],
};

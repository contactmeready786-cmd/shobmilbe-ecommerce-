'use strict';
// Admin → অর্ডার ও কাস্টমার → অসম্পূর্ণ অর্ডার
// Shoppers who typed their mobile number at checkout but never pressed "অর্ডার কনফার্ম".
// Call them, turn the cart into an order in one tap, or drop it. The whole feature has an on/off switch at the top.
const { html, bn, money, fmtDate, str, int, pageNum } = require('../util');
const db = require('../db');
const D = require('../services/drafts');
const ui = require('./ui');

const BASE = '/admin/orders/incomplete';
const PER_PAGE = 50;

function ago(d) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return bn(Math.floor(s / 86400)) + ' দিন আগে';
}
function waLink(phone) { return 'https://wa.me/88' + String(phone || '').replace(/\D/g, ''); }

function statusPill(d) {
  const st = D.STATUSES[d.status] || ['', d.status];
  const cls = { open: 'pill-amber', called: 'pill-blue', ordered: 'pill-green', closed: 'pill-grey' }[d.status] || '';
  return html`<span class="pill ${cls}">${st[0]} ${st[1]}</span>`;
}
function actButton(id, status, label, cls = 'btn-ghost') {
  return html`<form method="post" action="${BASE}/${id}/status"><input type="hidden" name="status" value="${status}"><button class="btn btn-sm ${cls}">${label}</button></form>`;
}

async function listPage(ctx) {
  const s0 = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!ctx.can('settings') && ctx.user.role !== 'owner') return ctx.back(BASE, 'noperm');
    const tpl = str(b.draft_sms_tpl, 300).trim();
    if (b.draft_sms_on === '1' && !tpl.includes('{link}')) return ctx.fail(BASE, 'SMS-এর লেখায় {link} অবশ্যই রাখুন — ওটা চাপলেই কাস্টমার অর্ডার শেষ করতে পারবে।');
    if (b.draft_sms_on === '1' && !require('../services/sms').ready(s0).ok) return ctx.fail(BASE, `আগে SMS চালু করুন (মার্কেটিং → কাস্টমারকে SMS)। এখন: ${require('../services/sms').ready(s0).why}।`);
    await db.setMany({
      draft_capture_on: b.draft_capture_on === '1' ? '1' : '0',
      draft_sms_on: b.draft_sms_on === '1' ? '1' : '0',
      draft_sms_after: String([30, 60, 120, 180, 360].includes(int(b.draft_sms_after)) ? int(b.draft_sms_after) : 60),
      ...(tpl ? { draft_sms_tpl: tpl } : {}),
    });
    await ctx.log('settings', 'settings', null, `অসম্পূর্ণ অর্ডার ${b.draft_capture_on === '1' ? 'চালু' : 'বন্ধ'}, অটো SMS ${b.draft_sms_on === '1' ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const page = pageNum(ctx.query);
  const status = D.STATUSES[ctx.query.get('status')] || ctx.query.get('status') === 'all' ? ctx.query.get('status') : 'open';
  const f = { status: status === 'all' ? '' : status, q: str(ctx.query.get('q'), 80) };
  const [rows, total, c] = await Promise.all([D.list(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), D.count(f), D.counts()]);
  const s = ctx.settings;
  const on = s.draft_capture_on !== '0';
  const n = (k) => (c[k] ? c[k].n : 0);
  const tabs = [['open', `🆕 নতুন (${bn(n('open'))})`], ['called', `📞 কল করা হয়েছে (${bn(n('called'))})`], ['ordered', `✅ অর্ডার হয়েছে (${bn(n('ordered'))})`],
    ['closed', `🚫 বাদ (${bn(n('closed'))})`], ['all', `সব (${bn(c.all)})`]];
  const recovered = n('ordered');
  const base = `${BASE}?status=${status}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}`;
  const body = html`<div class="title-row"><h1>📝 অসম্পূর্ণ অর্ডার</h1></div>
${ui.flash(ctx.flash)}
<form method="post" action="${BASE}" class="panel form">
  ${ui.switchRow('draft_capture_on', on, 'অসম্পূর্ণ অর্ডার ধরা', 'চালু থাকলে: কেউ চেকআউট পেজে পুরো মোবাইল নম্বর লিখে অর্ডার না দিয়ে চলে গেলে, তার নাম, নম্বর, ঠিকানা আর কার্টের পণ্য এখানে আসবে। ফোন নম্বরের ঘরের নিচে কাস্টমারকে ছোট করে জানানোও থাকবে। বন্ধ করলে নতুন করে আর কিছু জমা হবে না (আগেরগুলো থাকবে)।')}
  ${ui.switchRow('draft_sms_on', s.draft_sms_on === '1', '📩 অটো SMS: অর্ডার শেষ করার কথা মনে করিয়ে দিন', 'চালু থাকলে: কেউ অর্ডার না করে চলে গেলে নিচের সময় পরে তাকে একটা SMS যায় — লিংকে চাপলেই একই পণ্য কার্টে আর নাম-নম্বর বসানো অবস্থায় চেকআউট খোলে। প্রতি অসম্পূর্ণ অর্ডারে একবারই যায়, একই নম্বরে ৩ দিনে একবারের বেশি না, রাত ১০টা থেকে সকাল ৯টা পর্যন্ত যায় না (সকালে যায়), ব্লক লিস্টের নম্বরে যায় না। আপনি আগে কল করে "📞 কল করেছি" দিলে আর SMS যায় না।')}
  <div class="field-row">
    ${ui.field('কতক্ষণ পরে SMS যাবে', ui.select('draft_sms_after', [['30', '৩০ মিনিট পরে'], ['60', '১ ঘণ্টা পরে (সাজেস্টেড)'], ['120', '২ ঘণ্টা পরে'], ['180', '৩ ঘণ্টা পরে'], ['360', '৬ ঘণ্টা পরে']], s.draft_sms_after || '60'), 'খুব তাড়াতাড়ি দিলে বিরক্ত লাগতে পারে; খুব দেরিতে দিলে কাস্টমার অন্য দোকান থেকে কিনে ফেলে।')}
  </div>
  ${ui.field('SMS-এর লেখা', ui.textarea('draft_sms_tpl', s.draft_sms_tpl || '', { rows: 2, maxlength: 300 }), html`<code>{shop}</code> দোকানের নাম, <code>{name}</code> কাস্টমারের নাম, <code>{total}</code> পণ্যের দাম, <code>{link}</code> অর্ডার শেষ করার লিংক (অবশ্যই রাখুন)। লিংকসহ বাংলা SMS সাধারণত ২টা SMS হয়।`)}
  ${s.draft_sms_on === '1' && !require('../services/sms').ready(s).ok ? html`<p class="flash flash-error">⚠️ অটো SMS চালু, কিন্তু SMS কাজ করছে না — <a href="/admin/marketing/sms">কাস্টমারকে SMS</a> পেজ দেখুন।</p>` : ''}
  <button class="btn">সেভ করুন</button>
</form>
${ui.helpBox('এটা কীভাবে কাজে লাগাবেন', html`<ol>
  <li><b>🆕 নতুন</b> তালিকায় যারা আছে, তাদের ফোন করুন (📞 বা WhatsApp বাটন চাপলেই হবে)। অনেকে দাম, ডেলিভারি চার্জ বা পেমেন্ট নিয়ে দ্বিধায় পড়ে চলে যায়, একটা কল পেলেই অর্ডার করে।</li>
  <li>কাস্টমার রাজি হলে <b>🧾 অর্ডার বানান</b> চাপুন — নাম, নম্বর, ঠিকানা আর পণ্য বসানো অবস্থায় নতুন অর্ডারের ফর্ম খুলবে, শুধু সেভ করবেন।</li>
  <li>কল করেও না হলে <b>📞 কল করেছি</b> বা <b>🚫 বাদ দিন</b> চাপুন, যাতে তালিকা পরিষ্কার থাকে।</li>
  <li>কাস্টমার নিজে পরে অর্ডার করলে সেটা নিজে থেকেই <b>✅ অর্ডার হয়েছে</b>-তে চলে যায়।</li>
  <li>“এখনো চেকআউটে আছে” লেখা থাকলে ১০ মিনিট অপেক্ষা করুন — হয়তো এখনই অর্ডার দিচ্ছে।</li>
</ol>`)}
<div class="kpis">
  ${ui.kpi('কল করার বাকি', bn(n('open')), c.open ? `কার্টে মোট ${money(c.open.value)}` : '', 'kpi-amber', `${BASE}?status=open`)}
  ${ui.kpi('কল করা হয়েছে', bn(n('called')), '')}
  ${ui.kpi('পরে অর্ডার করেছে', bn(recovered), c.all ? `${bn(Math.round((100 * recovered) / c.all))}% ফিরে এসেছে` : '', 'kpi-green')}
</div>
<nav class="tabs">${tabs.map(([k, l]) => html`<a class="tab ${status === k ? 'on' : ''}" href="${BASE}?status=${k}">${l}</a>`)}</nav>
<form class="toolbar" method="get" action="${BASE}">
  <input type="hidden" name="status" value="${status}">
  <input type="search" name="q" value="${f.q}" placeholder="নাম, নম্বর, এলাকা বা পণ্য" aria-label="খুঁজুন">
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${rows.length ? html`<div class="table-wrap"><table class="table draft-table"><thead><tr><th>কখন</th><th>কাস্টমার</th><th>ঠিকানা</th><th>কার্টে যা ছিল</th><th>অবস্থা</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((d) => html`<tr>
  <td><b>${ago(d.updated_at)}</b><br><small class="muted">${fmtDate(d.updated_at)}</small>${d.still_here ? html`<br><span class="pill pill-blue small">⏳ এখনো চেকআউটে আছে</span>` : ''}</td>
  <td translate="no"><b>${d.name || '(নাম লেখেনি)'}</b><br><a href="tel:${d.phone}" class="mono">📞 ${d.phone}</a> · <a href="${waLink(d.phone)}" target="_blank" rel="noopener">WhatsApp</a>
    ${d.customer_id ? html`<br><a class="small" href="/admin/customers/${d.customer_id}">পুরনো কাস্টমার · ${bn(d.past_orders)}টি অর্ডার</a>` : html`<br><small class="muted">নতুন কাস্টমার</small>`}</td>
  <td class="small" translate="no">${[d.address, d.thana, d.district].filter(Boolean).join(', ') || html`<span class="muted">লেখেনি</span>`}${d.note ? html`<br><i>“${d.note}”</i>` : ''}</td>
  <td class="small">${(d.items || []).length ? html`${d.items.map((i) => html`<div>${i.name} <span class="muted">× ${bn(i.qty)}</span></div>`)}<b>${money(d.subtotal)}</b>` : html`<span class="muted">—</span>`}</td>
  <td>${statusPill(d)}${d.order_code ? html`<br><a class="small" href="/admin/orders?q=${d.order_code}">অর্ডার ${d.order_code}</a>` : ''}
    ${d.reminded_at ? html`<br><span class="pill ${d.remind_result === 'sent' ? 'pill-blue' : 'pill-warn'} small" title="${d.remind_result === 'sent' ? '' : d.remind_result}">📩 ${d.remind_result === 'sent' ? 'SMS গেছে' : 'SMS যায়নি'} · ${fmtDate(d.reminded_at)}</span>` : ''}
    ${d.caller_name && d.called_at ? html`<br><small class="muted">${d.caller_name} · ${fmtDate(d.called_at)}</small>` : ''}
    ${d.session_id ? html`<br><a class="small" href="/admin/marketing/visitors/s/${d.session_id}">👀 ভিজিট দেখুন</a>` : ''}</td>
  <td class="draft-acts">
    ${d.status !== 'ordered' && ctx.can('orders_edit') ? html`<a class="btn btn-sm btn-primary" href="/admin/orders/new?draft=${d.id}">🧾 অর্ডার বানান</a>` : ''}
    ${d.status === 'open' ? actButton(d.id, 'called', '📞 কল করেছি') : ''}
    ${d.status === 'open' || d.status === 'called' ? actButton(d.id, 'closed', '🚫 বাদ দিন') : ''}
    ${d.status === 'closed' || d.status === 'called' ? actButton(d.id, 'open', '↩️ আবার নতুনে') : ''}
    <form method="post" action="${BASE}/${d.id}/delete" data-confirm="এটা একেবারে মুছে ফেলবেন?"><button class="link-btn danger small">🗑️ মুছুন</button></form>
  </td>
</tr>`)}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, base)}`
    : ui.empty(status === 'open' ? (on ? 'এখন কল করার মতো কেউ নেই। কেউ চেকআউটে নম্বর লিখে চলে গেলে এখানে আসবে।' : 'অসম্পূর্ণ অর্ডার ধরা এখন বন্ধ আছে। উপরের সুইচ চালু করুন।') : 'কিছু পাওয়া যায়নি।')}`;
  return ctx.page('অসম্পূর্ণ অর্ডার', body, 'drafts');
}

async function statusAction(ctx, m) {
  const b = await ctx.body();
  await D.setStatus(m[1], String(b.status || ''), ctx.user.id);
  await ctx.log('draft_status', 'order', null, `${m[1]} → ${str(b.status, 20)}`);
  return ctx.back(BASE + (b.status === 'open' ? '?status=open' : ''), 'status');
}
async function deleteAction(ctx, m) {
  await D.remove(m[1]);
  await ctx.log('draft_delete', 'order', null, m[1]);
  return ctx.back(BASE, 'removed');
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: 'POST', path: /^\/admin\/orders\/incomplete\/([a-f0-9]{20})\/status$/, perm: 'orders', handler: statusAction },
    { method: 'POST', path: /^\/admin\/orders\/incomplete\/([a-f0-9]{20})\/delete$/, perm: 'orders_edit', handler: deleteAction },
  ],
};

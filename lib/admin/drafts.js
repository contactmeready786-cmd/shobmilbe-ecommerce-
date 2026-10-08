'use strict';
// Admin → অর্ডার ও কাস্টমার → অসম্পূর্ণ অর্ডার
// Shoppers who typed their mobile number at checkout but never pressed "অর্ডার কনফার্ম".
// Call them, turn the cart into an order in one tap, or drop it. The whole feature has an on/off switch at the top.
const { html, bn, money, fmtDate, str, pageNum } = require('../util');
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
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!ctx.can('settings') && ctx.user.role !== 'owner') return ctx.back(BASE, 'noperm');
    await db.setSetting('draft_capture_on', b.draft_capture_on === '1' ? '1' : '0');
    await ctx.log('settings', 'settings', null, `অসম্পূর্ণ অর্ডার ${b.draft_capture_on === '1' ? 'চালু' : 'বন্ধ'}`);
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
<form method="post" action="${BASE}" class="panel" data-autosubmit>
  ${ui.switchRow('draft_capture_on', on, 'অসম্পূর্ণ অর্ডার ধরা', 'চালু থাকলে: কেউ চেকআউট পেজে পুরো মোবাইল নম্বর লিখে অর্ডার না দিয়ে চলে গেলে, তার নাম, নম্বর, ঠিকানা আর কার্টের পণ্য এখানে আসবে। ফোন নম্বরের ঘরের নিচে কাস্টমারকে ছোট করে জানানোও থাকবে। বন্ধ করলে নতুন করে আর কিছু জমা হবে না (আগেরগুলো থাকবে)।')}
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

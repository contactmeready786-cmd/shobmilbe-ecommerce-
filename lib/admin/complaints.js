'use strict';
// Admin → অর্ডার ও কাস্টমার → 📮 অভিযোগ (৭২ ঘণ্টা): every complaint with the hours left to solve it (the law asks for
// 72 hours), late ones in red at the top. Open one to see the details and photos, write inside notes or a reply to the
// customer (also by SMS), give it to a staff member, and mark it solved with what was done — all kept as a record.
const { html, bn, fmtDate, int, str, pageNum } = require('../util');
const db = require('../db');
const ui = require('./ui');
const C = require('../models/complaints');

const BASE = '/admin/complaints';
const PER_PAGE = 40;
const PILL = { open: 'pill-new', working: 'pill-processing', solved: 'pill-delivered', closed: 'pill-grey' };

function timePill(c) {
  const t = C.timeLeft(c);
  if (!t) return c.resolved_at ? html`<span class="small muted">${c.resolved_at <= c.due_at ? '✓ সময়মতো' : '⚠️ দেরিতে'} শেষ</span>` : '';
  return html`<span class="pill ${t.late ? 'pill-red' : t.soon ? 'pill-amber' : 'pill-green'}">⏱️ ${t.text}</span>`;
}

async function listPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    await db.setMany({ complaints_on: b.complaints_on ? '1' : '0', complaint_sms_on: b.complaint_sms_on ? '1' : '0',
      complaint_hours: String(Math.max(1, Math.min(72, int(b.complaint_hours, 72)))) });
    await ctx.log('settings', 'settings', null, `অভিযোগ ফর্ম: ${b.complaints_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const page = pageNum(ctx.query);
  const want = ctx.query.get('status');
  const status = ['active', 'late', 'open', 'working', 'solved', 'closed', 'all'].includes(want) ? want : 'active';
  const f = { status: status === 'all' ? '' : status, q: str(ctx.query.get('q'), 80) };
  const [rows, total, c] = await Promise.all([C.list(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), C.count(f), C.counts()]);
  const tabs = [['active', `⏳ চলমান (${bn(c.active)})`], ['late', `🔴 দেরি (${bn(c.late)})`], ['solved', `✅ সমাধান (${bn(c.solved)})`], ['closed', `🚫 বন্ধ (${bn(c.closed)})`], ['all', `সব (${bn(c.total)})`]];
  const base = `${BASE}?status=${status}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}`;
  const body = html`<div class="title-row"><h1>📮 অভিযোগ (${bn(C.hoursOf(s))} ঘণ্টায় সমাধান)</h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="${base}">🔄 রিফ্রেশ</a><a class="btn btn-ghost btn-sm" href="/complaint" target="_blank" rel="noopener">কাস্টমারের ফর্ম দেখুন ↗</a></div></div>
${ui.flash(ctx.flash)}
${c.late ? html`<p class="flash flash-error"><b>🔴 ${bn(c.late)}টি অভিযোগের সময় পার হয়ে গেছে!</b> আইন অনুযায়ী ৭২ ঘণ্টার মধ্যে সমাধান করতে হয় — এখনই দেখুন।</p>` : ''}
<div class="kpis kpis-tight">
  ${ui.kpi('চলমান', bn(c.active), `নতুন ${bn(c.open)} · কাজ চলছে ${bn(c.working)}`, '', `${BASE}?status=active`)}
  ${ui.kpi('২৪ ঘণ্টার মধ্যে শেষ সময়', bn(c.soon), 'আগে এগুলো ধরুন', c.soon ? 'kpi-amber' : '')}
  ${ui.kpi('সময় পার', bn(c.late), '', c.late ? 'kpi-red' : '', `${BASE}?status=late`)}
  ${ui.kpi('৩০ দিনে সময়মতো সমাধান', c.done30 ? `${bn(Math.round((c.ontime30 * 100) / c.done30))}%` : '—', `${bn(c.ontime30)} / ${bn(c.done30)}`)}
</div>
${ui.helpBox('কীভাবে কাজ করে', html`<ol class="steps">
  <li>কাস্টমার দোকানের নিচের <b>"📮 অভিযোগ জানান"</b> লিংক (আর অর্ডারের পেজ) থেকে নাম, নম্বর, অর্ডার নম্বর, বিষয়, লেখা আর ছবি দিয়ে অভিযোগ করেন। সাথে সাথে একটা অভিযোগ নম্বর পান (SMS-এও)।</li>
  <li>আপনার ফোনে নোটিফিকেশন আসে (চালু থাকলে ইমেইল/WhatsApp-ও)। এখানে প্রতিটার পাশে কত ঘণ্টা বাকি দেখায় — সবুজ ঠিক আছে, হলুদ ২৪ ঘণ্টার কম বাকি, লাল সময় পার।</li>
  <li>অভিযোগ খুলে <b>"কাস্টমারকে উত্তর"</b> লিখলে কাস্টমার SMS পান আর অবস্থার পেজে দেখেন। <b>"ভেতরের নোট"</b> শুধু স্টাফরা দেখেন।</li>
  <li>সমাধান হলে <b>"✅ সমাধান হয়েছে"</b> দিন, কী করলেন লিখে — কাস্টমার SMS পান। সব রেকর্ড থাকে (আইন অনুযায়ী অন্তত ৬ বছর রাখতে হয়, তাই মুছে ফেলার অপশন নেই)।</li>
</ol>`)}
<div class="chips">${tabs.map(([k, l]) => html`<a class="chip ${status === k ? 'on' : ''}" href="${BASE}?status=${k}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}">${l}</a>`)}</div>
<form class="toolbar" method="get" action="${BASE}"><input type="hidden" name="status" value="${status}">
  <input type="search" name="q" value="${f.q}" placeholder="অভিযোগ নম্বর, মোবাইল, নাম বা অর্ডার নম্বর"><button class="btn btn-sm">খুঁজুন</button></form>
<section class="panel table-wrap">
${rows.length ? html`<table class="table"><thead><tr><th>অভিযোগ</th><th>কাস্টমার</th><th>বিষয়</th><th>অবস্থা</th><th>সময়</th><th></th></tr></thead><tbody>
${rows.map((r) => html`<tr class="${C.timeLeft(r) && C.timeLeft(r).late ? 'row-late' : ''}">
  <td><a href="${BASE}/${r.id}"><b class="mono">${r.code}</b></a><br><span class="small muted">${fmtDate(r.created_at)}</span></td>
  <td translate="no"><b>${r.name}</b><br><a href="tel:${r.phone}" class="mono small">${r.phone}</a>${r.order_code ? html`<br><a class="small" href="/admin/orders?q=${r.order_code}">🧾 ${r.order_code}</a>` : ''}</td>
  <td class="small">${C.TOPICS[r.topic] || r.topic}${r.item_name ? html`<br><b>${r.item_name}</b>` : ''}${r.photos && r.photos.length ? html` <span title="ছবি আছে">📷${bn(r.photos.length)}</span>` : ''}<br><span class="muted">${String(r.message).slice(0, 80)}${String(r.message).length > 80 ? '…' : ''}</span></td>
  <td>${ui.pill(C.STATUS[r.status].join(' '), PILL[r.status])}${r.staff_name ? html`<br><span class="small muted">👤 ${r.staff_name}</span>` : ''}</td>
  <td>${timePill(r)}</td>
  <td><a class="btn btn-sm" href="${BASE}/${r.id}">খুলুন</a></td></tr>`)}
</tbody></table>${ui.pager(total, page, PER_PAGE, base)}` : html`<p class="muted">${status === 'active' ? 'এখন কোনো চলমান অভিযোগ নেই। 👍' : 'এখানে কিছু নেই।'}</p>`}
</section>
${ctx.can('settings') ? html`<section class="panel"><h2>⚙️ সেটিংস</h2>
<form method="post" action="${BASE}" class="form">
  ${ui.switchRow('complaints_on', s.complaints_on !== '0', 'কাস্টমারের অভিযোগ ফর্ম চালু', 'দোকানের নিচে (ফুটারে) আর অর্ডারের পেজে "📮 অভিযোগ জানান" লিংক থাকে। আইন অনুযায়ী অভিযোগ জানানোর উপায় রাখা বাধ্যতামূলক — বন্ধ না রাখাই ভালো।')}
  ${ui.switchRow('complaint_sms_on', s.complaint_sms_on !== '0', 'কাস্টমারকে SMS', 'অভিযোগ জমা হলে অভিযোগ নম্বর, আর সমাধান হলে জানিয়ে SMS যায় (SMS চালু থাকলে)।')}
  ${ui.field('কত ঘণ্টার মধ্যে সমাধান', ui.input('complaint_hours', s.complaint_hours || '72', { type: 'number', min: 1, max: 72 }), 'আইনে সর্বোচ্চ ৭২ ঘণ্টা। কম দিলে কাস্টমারকেও কম সময়ের কথা বলা হবে। নতুন অভিযোগে কাজ করবে।')}
  <button class="btn">সেভ করুন</button>
</form></section>` : ''}`;
  return ctx.page('অভিযোগ', body, 'complaints');
}

async function detail(ctx, m) {
  const id = int(m[1]);
  const c = await C.get(id);
  if (!c) return ctx.redirect(ctx.res, BASE);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'note' || b.action === 'reply') {
        const r = await C.addNote(id, { staffId: ctx.user.id, body: b.body, toCustomer: b.action === 'reply', settings: ctx.settings });
        await ctx.log('complaint_note', 'complaint', id, `${c.code}: ${b.action === 'reply' ? 'কাস্টমারকে উত্তর' : 'নোট'}`);
        if (b.action === 'reply' && r.smsOk === false) return ctx.fail(back, 'উত্তর সেভ হয়েছে, কিন্তু SMS যায়নি — কাস্টমারকে কল করে জানান।');
        return ctx.back(back, 'saved');
      }
      if (C.STATUS[b.action]) {
        await C.setStatus(id, { status: b.action, resolution: b.resolution, staffId: ctx.user.id, settings: ctx.settings });
        await ctx.log('complaint_status', 'complaint', id, `${c.code}: ${C.STATUS[b.action][1]}`);
        return ctx.back(back, 'status');
      }
      if (b.action === 'assign') {
        await C.assign(id, b.staff_id);
        return ctx.back(back, 'saved');
      }
    } catch (e) {
      if (!(e instanceof C.ComplaintError)) throw e;
      return ctx.fail(back, e.message);
    }
    return ctx.back(back);
  }
  const staff = await db.q('SELECT id, name FROM staff WHERE active ORDER BY name').catch(() => []);
  const open = C.OPEN.includes(c.status);
  const body = html`<p class="crumbs"><a href="${BASE}">← সব অভিযোগ</a></p>
<div class="title-row"><h1>অভিযোগ <span class="mono">${c.code}</span> ${ui.pill(C.STATUS[c.status].join(' '), PILL[c.status])} ${timePill(c)}</h1>
  <div class="row-actions">${c.order_code ? html`<a class="btn btn-ghost btn-sm" href="/admin/orders?q=${c.order_code}">🧾 অর্ডার ${c.order_code}</a>` : ''}<a class="btn btn-ghost btn-sm" href="${back}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <div>
    <section class="panel"><h2>${C.TOPICS[c.topic] || c.topic}</h2>
      <p translate="no"><b>${c.name}</b> · <a href="tel:${c.phone}" class="mono">📞 ${c.phone}</a> · <a href="https://wa.me/88${c.phone}" target="_blank" rel="noopener">WhatsApp</a>${c.email ? html` · ${c.email}` : ''}</p>
      <p class="small muted">জমা: ${fmtDate(c.created_at)} · শেষ সময়: <b>${fmtDate(c.due_at)}</b>${c.first_reply_at ? html` · প্রথম উত্তর: ${fmtDate(c.first_reply_at)}` : ''}</p>
      ${c.topic === 'warranty' || c.item_name ? html`<p class="flash">🛡️ <b>ওয়ারেন্টি দাবি:</b> ${c.product_id ? html`<a href="/admin/products/${c.product_id}">${c.item_name}</a>` : c.item_name}${c.warranty_until ? html` · ওয়ারেন্টি ${fmtDate(c.warranty_until, false)} পর্যন্ত (ঠিক আছে)` : ''}</p>` : ''}
      <p class="pre">${c.message}</p>
      ${c.photos && c.photos.length ? html`<div class="ret-photos">${c.photos.map((pid) => html`<a href="${BASE}/photo/${pid}" target="_blank" rel="noopener"><img src="${BASE}/photo/${pid}" alt="অভিযোগের ছবি" loading="lazy"></a>`)}</div>` : ''}
      ${c.resolution ? html`<p class="flash"><b>সমাধান:</b> ${c.resolution}</p>` : ''}
    </section>
    <section class="panel"><h2>💬 কথোপকথন ও নোট</h2>
      ${c.notes.length ? html`<ul class="timeline">${c.notes.map((n) => html`<li><b>${n.staff_name || 'সিস্টেম'}</b> · ${n.to_customer ? html`<span class="pill pill-blue">কাস্টমারকে উত্তর${n.sms_ok === true ? ' · SMS গেছে' : n.sms_ok === false ? ' · SMS যায়নি' : ''}</span>` : html`<span class="pill pill-grey">ভেতরের নোট</span>`}
        <p class="pre">${n.body}</p><span class="small muted">${fmtDate(n.created_at)}</span></li>`)}</ul>` : html`<p class="muted">এখনো কিছু লেখা হয়নি।</p>`}
      ${ctx.can('orders_edit') ? html`<form method="post" action="${back}" class="form">
        ${ui.field('লিখুন', ui.textarea('body', '', { rows: 3, maxlength: 1000, required: true }), 'কাস্টমারকে উত্তর দিলে তিনি SMS পান আর অভিযোগের অবস্থার পেজে দেখেন।')}
        <div class="row-actions"><button class="btn" name="action" value="reply">📨 কাস্টমারকে উত্তর পাঠান</button><button class="btn btn-ghost" name="action" value="note">📝 ভেতরের নোট (শুধু স্টাফ)</button></div>
      </form>` : ''}
    </section>
  </div>
  <div>
    ${ctx.can('orders_edit') ? html`<section class="panel"><h2>অবস্থা বদলান</h2>
      <form method="post" action="${back}" class="form">
        ${ui.field('কী সমাধান হলো / কেন বন্ধ (সমাধান বা বন্ধ করতে লিখতেই হবে)', ui.textarea('resolution', '', { rows: 2, maxlength: 1000 }), 'যেমন: "নতুন পণ্য পাঠানো হয়েছে", "৳১৫০ বিকাশে ফেরত দেওয়া হয়েছে"। "সমাধান হয়েছে" দিলে কাস্টমার SMS পান।')}
        <div class="row-actions">
          ${c.status !== 'working' && open ? html`<button class="btn btn-sm btn-ghost" name="action" value="working">🔧 কাজ চলছে</button>` : ''}
          ${c.status !== 'solved' ? html`<button class="btn btn-sm" name="action" value="solved">✅ সমাধান হয়েছে</button>` : ''}
          ${c.status !== 'closed' ? html`<button class="btn btn-sm btn-ghost" name="action" value="closed">🚫 বন্ধ করুন</button>` : ''}
          ${!open ? html`<button class="btn btn-sm btn-ghost" name="action" value="open">↩️ আবার খুলুন</button>` : ''}
        </div>
      </form></section>
    <section class="panel"><h2>দায়িত্বে কে</h2>
      <form method="post" action="${back}" class="form"><input type="hidden" name="action" value="assign">
        ${ui.select('staff_id', [['', '— কেউ না —'], ...staff.map((x) => [String(x.id), x.name])], c.assigned_to ? String(c.assigned_to) : '')}
        <button class="btn btn-sm">সেভ করুন</button></form></section>` : ''}
    ${c.history.length ? html`<section class="panel"><h2>এই নম্বরের আগের অভিযোগ</h2><ul>${c.history.map((h) => html`<li><a href="${BASE}/${h.id}" class="mono">${h.code}</a> · ${C.STATUS[h.status][1]} · <span class="small muted">${fmtDate(h.created_at)}</span></li>`)}</ul></section>` : ''}
  </div>
</div>`;
  return ctx.page(`অভিযোগ ${c.code}`, body, 'complaints');
}

// a complaint's photo (private: only logged-in staff)
async function photo(ctx, m) {
  const p = await db.one(`SELECT mime, data FROM media WHERE id=$1 AND owner_type='complaint'`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(ctx.res, 404, 'Not found', 'text/plain');
  ctx.res.writeHead(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: 'GET', path: /^\/admin\/complaints\/photo\/(\d+)$/, perm: 'orders', handler: photo },
    { method: '*', path: /^\/admin\/complaints\/(\d+)$/, perm: (ctx) => (ctx.method === 'GET' ? 'orders' : 'orders_edit'), handler: detail },
  ],
};

'use strict';
const { html, raw, bn, fmtDate, int, list } = require('../util');
const S = require('../models/staff');
const ui = require('./ui');

async function listPage(ctx) {
  const rows = await S.listStaff();
  const body = html`<div class="title-row"><h1>স্টাফ <small>${bn(rows.length)} জন</small></h1>
  <div class="row-actions"><a class="btn" href="/admin/staff/new">+ নতুন স্টাফ</a><a class="btn btn-ghost" href="/admin/reports/staff">স্টাফ রিপোর্ট</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('স্টাফ কীভাবে কাজ করে', html`প্রতিটা কর্মচারীকে আলাদা ইউজারনেম-পাসওয়ার্ড দিন, আর শুধু দরকারি কাজের অনুমতি টিক দিন। যেমন যে শুধু কল করে অর্ডার কনফার্ম করে, তাকে "অর্ডার দেখা" আর "অর্ডার এডিট" দিলেই হবে — সে লাভ-ক্ষতি, কেনা দাম বা সেটিংস দেখতে পারবে না। কে কখন কী করেছে সব রেকর্ড থাকে।`)}
<section class="panel table-wrap"><table class="table"><thead><tr><th>নাম</th><th>ইউজারনেম</th><th>অনুমতি</th><th>শেষ লগইন</th><th>অবস্থা</th></tr></thead>
<tbody>${rows.map((s) => html`<tr class="${s.active ? '' : 'row-off'}">
  <td><a href="/admin/staff/${s.id}"><b>${s.name}</b></a>${s.phone ? html`<br><span class="small muted">${s.phone}</span>` : ''}</td>
  <td class="mono">${s.username}</td>
  <td class="small">${s.role === 'owner' ? ui.pill('মালিক — সব অনুমতি', 'pill-delivered') : (s.permissions || []).map((p) => (S.PERMISSIONS.find((x) => x[0] === p) || [p, p])[1]).join(', ') || '—'}</td>
  <td class="small">${s.last_login ? fmtDate(s.last_login) : 'কখনো না'}</td>
  <td>${s.active ? 'চালু' : 'বন্ধ'}</td></tr>`)}</tbody></table></section>`;
  return ctx.page('স্টাফ', body, 'staff');
}

function form(s, error, isSelf) {
  const isNew = !s.id;
  const owner = s.role === 'owner';
  const perms = s.permissions || [];
  return html`<p class="crumbs"><a href="/admin/staff">← সব স্টাফ</a></p>
<h1>${isNew ? 'নতুন স্টাফ' : s.name}</h1>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/staff/new' : `/admin/staff/${s.id}`}" class="form">
  <div class="two-col">
    <section class="panel">
      <h2>লগইনের তথ্য</h2>
      ${ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 80 }))}
      ${ui.field('ইউজারনেম', ui.input('username', s.username || '', { required: true, maxlength: 40, autocapitalize: 'none', autocomplete: 'off' }), 'ইংরেজি ছোট হাতের অক্ষর/সংখ্যা, যেমন rahim')}
      <div class="field-row">${ui.field('মোবাইল (এটা দিয়েও লগইন করা যাবে)', ui.input('phone', s.phone || '', { inputmode: 'tel', maxlength: 20 }))}${ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>
      ${ui.field(isNew ? 'পাসওয়ার্ড' : 'নতুন পাসওয়ার্ড (বদলাতে চাইলে)', ui.input('password', '', { type: 'password', minlength: 6, required: isNew, autocomplete: 'new-password' }), 'কমপক্ষে ৬ অক্ষর। স্টাফকে জানিয়ে দিন।')}
      ${ui.field('নোট', ui.textarea('note', s.note || '', { rows: 2, maxlength: 500, placeholder: 'যেমন: বেতন, কাজের সময়' }))}
      ${owner ? html`<p class="muted">এটা মালিকের অ্যাকাউন্ট, সবসময় চালু থাকে।</p>` : ui.check('active', isNew ? true : s.active, 'অ্যাকাউন্ট চালু (বন্ধ করলে আর লগইন করতে পারবে না)')}
    </section>
    <section class="panel">
      <h2>কী কী করতে পারবে</h2>
      ${owner ? html`<p>মালিকের সব অনুমতি আছে।</p>` : html`
      <p class="small">দ্রুত বাছুন: ${Object.entries(S.PRESETS).map(([k, p]) => html`<button type="button" class="chip" data-preset="${p.perms.join(',')}">${p.label}</button> `)}</p>
      <div class="perm-list" data-perms>${S.PERMISSIONS.map(([k, label, hint]) => html`<label class="perm"><input type="checkbox" name="permissions[]" value="${k}" ${perms.includes(k) ? raw('checked') : ''}>
        <span><b>${label}</b><small>${hint}</small></span></label>`)}</div>`}
    </section>
  </div>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">${isNew ? 'স্টাফ যোগ করুন' : 'সেভ করুন'}</button></div>
</form>
${!isNew && !owner && !isSelf ? html`<form method="post" action="/admin/staff/${s.id}/delete" class="danger-zone" data-confirm="এই স্টাফকে মুছবেন? (শুধু বন্ধ করতে চাইলে 'অ্যাকাউন্ট চালু' টিক তুলে দিন)"><button class="btn btn-danger btn-sm">স্টাফ মুছুন</button></form>` : ''}`;
}

async function formPage(ctx, m) {
  const id = m && m[1] ? int(m[1]) : null;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      const sid = await S.saveStaff({ ...b, id, permissions: list(b.permissions) });
      await ctx.log(id ? 'staff_edit' : 'staff_add', 'staff', sid, b.name);
      return ctx.back(`/admin/staff/${sid}`, 'saved');
    } catch (e) {
      const cur = id ? await S.getStaff(id) : {};
      return ctx.page('স্টাফ', form({ ...cur, ...b, id, permissions: list(b.permissions) }, e.message, id === ctx.user.id), 'staff', { status: 400 });
    }
  }
  const s = id ? await S.getStaff(id) : { active: true, permissions: [] };
  if (!s) return ctx.redirect(ctx.res, '/admin/staff');
  const activity = id ? await S.activity({ staffId: id, limit: 40 }) : [];
  return ctx.page(id ? s.name : 'নতুন স্টাফ', html`${ui.flash(ctx.flash)}${form(s, null, id === ctx.user.id)}
  ${id ? html`<section class="panel"><h2>সাম্প্রতিক কাজ</h2>${activity.length ? html`<ul class="timeline">${activity.map((a) => html`<li>${a.action}${a.entity ? html` · ${a.entity === 'order' && a.entity_id ? html`<a href="/admin/orders/${a.entity_id}">অর্ডার #${a.entity_id}</a>` : a.entity}` : ''}${a.detail ? ` · ${a.detail}` : ''}<br><span class="small muted">${fmtDate(a.created_at)}</span></li>`)}</ul>` : html`<p class="muted">কিছু নেই।</p>`}</section>` : ''}`, 'staff');
}

async function remove(ctx, m) {
  const id = int(m[1]);
  if (id === ctx.user.id) return ctx.fail('/admin/staff', 'নিজেকে মুছতে পারবেন না।');
  await ctx.trash('staff', id);
  await ctx.log('staff_delete', 'staff', id, '');
  return ctx.back('/admin/staff', 'deleted');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/staff', perm: 'owner', handler: listPage },
    { method: '*', path: '/admin/staff/new', perm: 'owner', handler: (ctx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/staff\/(\d+)$/, perm: 'owner', handler: formPage },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/delete$/, perm: 'owner', handler: remove },
  ],
};

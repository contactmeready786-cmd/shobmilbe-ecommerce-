'use strict';
const { html, raw, bn, fmtDate, int, list } = require('../util');
const S = require('../models/staff');
const sessions = require('../models/sessions');
const db = require('../db');
const ui = require('./ui');
const P = require('./profile');

async function listPage(ctx) {
  const rows = await S.listStaff();
  const body = html`<div class="title-row"><h1>স্টাফ ও প্রোফাইল <small>${bn(rows.length)} জন</small></h1>
  <div class="row-actions"><a class="btn" href="/admin/staff/new">+ নতুন স্টাফ</a><a class="btn btn-ghost" href="/admin/reports/staff">স্টাফ রিপোর্ট</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('স্টাফ কীভাবে কাজ করে', html`প্রতিটা কর্মচারীকে আলাদা ইউজারনেম-পাসওয়ার্ড দিন, আর শুধু দরকারি কাজের অনুমতি টিক দিন। পণ্য, স্টক আর কাস্টমারে আলাদা আলাদা টিক আছে: <b>দেখা</b>, <b>যোগ</b>, <b>এডিট</b>, <b>মুছা</b>। যেমন যে শুধু কল করে অর্ডার কনফার্ম করে, তাকে "অর্ডার দেখা" আর "অর্ডার এডিট" দিলেই হবে — সে লাভ-ক্ষতি, কেনা দাম বা সেটিংস দেখতে পারবে না। কাউকে বাদ দিতে চাইলে মুছে না দিয়ে "লগইন চালু" বন্ধ করুন — তার আগের সব কাজের রেকর্ড থেকে যাবে। কে কখন কী করেছে সব <a href="/admin/security/audit">অডিট লগে</a> থাকে।`)}
<section class="panel table-wrap"><table class="table"><thead><tr><th>নাম</th><th>ইউজারনেম</th><th>অনুমতি</th><th>দুই ধাপ</th><th>শেষ লগইন</th><th>লগইন চালু</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((s) => html`<tr class="${s.active ? '' : 'row-off'}">
  <td><a class="staff-who" href="/admin/staff/${s.id}">${P.avatar(s)}<span><b>${s.name}</b>${s.designation ? html`<br><span class="small">${s.designation}</span>` : ''}${s.phone ? html`<br><span class="small muted">${s.phone}</span>` : ''}</span></a></td>
  <td class="mono">${s.username}</td>
  <td class="small">${s.role === 'owner' ? ui.pill('মালিক — সব অনুমতি', 'pill-delivered') : (s.permissions || []).map((p) => (S.PERMISSIONS.find((x) => x[0] === p) || [p, p])[1]).join(', ') || '—'}</td>
  <td class="small">${s.role === 'owner' ? '—' : s.totp_on ? '✅ চালু' : html`<span class="muted">বন্ধ</span>`}</td>
  <td class="small">${s.last_login ? fmtDate(s.last_login) : 'কখনো না'}</td>
  <td>${s.role === 'owner' || s.id === ctx.user.id ? html`<span class="small">${s.active ? 'চালু' : 'বন্ধ'}</span>` : ui.rowSwitch(`/admin/toggle/staff/${s.id}`, s.active, 'বন্ধ করলে এই স্টাফ আর লগইন করতে পারবে না')}</td>
  ${ui.rowActions({ edit: `/admin/staff/${s.id}`, del: s.role === 'owner' || s.id === ctx.user.id ? '' : `/admin/staff/${s.id}/delete` })}</tr>`)}</tbody></table></section>`;
  return ctx.page('স্টাফ', body, 'staff');
}

function form(s, error, isSelf) {
  const isNew = !s.id;
  const owner = s.role === 'owner';
  const perms = s.permissions || [];
  return html`<p class="crumbs"><a href="/admin/staff">← সব স্টাফ</a></p>
<h1>${isNew ? 'নতুন স্টাফ' : s.name}${!isNew && s.designation ? html` <small>${s.designation}</small>` : ''}</h1>
${!isNew ? P.photoBox(s, `/admin/staff/${s.id}/photo`) : ''}
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/staff/new' : `/admin/staff/${s.id}`}" class="form">
  <div class="two-col">
    <div class="stack">
    <section class="panel">
      <h2>লগইনের তথ্য</h2>
      ${ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 80 }))}
      ${ui.field('ইউজারনেম', ui.input('username', s.username || '', { required: true, maxlength: 40, autocapitalize: 'none', autocomplete: 'off' }), 'ইংরেজি ছোট হাতের অক্ষর/সংখ্যা, যেমন rahim')}
      <div class="field-row">${ui.field('মোবাইল (এটা দিয়েও লগইন করা যাবে)', ui.input('phone', s.phone || '', { inputmode: 'tel', maxlength: 20 }))}${ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>
      ${ui.field(isNew ? 'পাসওয়ার্ড' : 'নতুন পাসওয়ার্ড (বদলাতে চাইলে)', ui.input('password', '', { type: 'password', minlength: 8, required: isNew, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর, অক্ষর আর সংখ্যা মিলিয়ে (যেমন Rahim#2025)। স্টাফকে জানিয়ে দিন, আর প্রথম লগইনের পর নিজের পাসওয়ার্ড বানিয়ে নিতে বলুন।')}
      ${ui.field('মালিকের নোট (শুধু মালিক দেখেন)', ui.textarea('note', s.note || '', { rows: 2, maxlength: 500, placeholder: 'যেমন: বেতন, কাজের সময়' }))}
      ${owner ? html`<p class="muted">এটা মালিকের অ্যাকাউন্ট, সবসময় চালু থাকে।</p>` : ui.check('active', isNew ? true : s.active, 'অ্যাকাউন্ট চালু (বন্ধ করলে আর লগইন করতে পারবে না)')}
    </section>
    <section class="panel">
      <h2>👤 প্রোফাইল</h2>
      ${isNew ? html`<p class="small muted">প্রোফাইল ছবি স্টাফ যোগ করার পরে দেওয়া যাবে (এই পেজেই উপরে)।</p>` : ''}
      ${P.fields(s, { ownerEdit: true })}
    </section>
    </div>
    <section class="panel">
      <h2>কী কী করতে পারবে</h2>
      ${owner ? html`<p>মালিকের সব অনুমতি আছে।</p>` : html`
      <p class="small">দ্রুত বাছুন: ${Object.entries(S.PRESETS).map(([k, p]) => html`<button type="button" class="chip" data-preset="${p.perms.join(',')}">${p.label}</button> `)}</p>
      <div class="perm-list" data-perms>${[...new Set(S.PERMISSIONS.map((p) => p[3]))].map((g) => html`<p class="perm-group">${g}</p>
        ${S.PERMISSIONS.filter((p) => p[3] === g).map(([k, label, hint]) => html`<label class="perm"><input type="checkbox" name="permissions[]" value="${k}" ${perms.includes(k) ? raw('checked') : ''}>
        <span><b>${label}</b><small>${hint}</small></span></label>`)}`)}</div>
      <p class="small muted">কেনা দাম, লাভ-ক্ষতি, স্টাফ, নিরাপত্তা, নোটিফিকেশন আর রিসাইকেল বিন সবসময় শুধু মালিকের — কোনো স্টাফকে দেওয়া যায় না।</p>`}
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
      const clash = await P.contactProblem(id, b.phone, b.email);
      if (clash) throw new Error(clash);
      const sid = await S.saveStaff({ ...b, id, permissions: list(b.permissions) });
      await S.saveProfile(sid, { designation: b.designation, address: b.address, emergency_phone: b.emergency_phone, joined_on: b.joined_on, bio: b.bio });
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
  const devices = id ? await sessions.listFor(id, ctx.settings) : [];
  const logins = id ? await sessions.history({ staffId: id }, { limit: 10 }) : [];
  return ctx.page(id ? s.name : 'নতুন স্টাফ', html`${ui.flash(ctx.flash)}${form(s, null, id === ctx.user.id)}
  ${id ? html`<section class="panel" id="security">
    <h2>🔐 লগইন ও নিরাপত্তা</h2>
    ${s.role === 'owner' ? html`<p class="small">মালিকের দুই ধাপের লগইন: <a href="/admin/security/login">লগইন তালা (আঙুল ও মুখ)</a></p>` : html`
    <p>দুই ধাপের লগইন (অথেনটিকেটর অ্যাপ): <b>${s.totp_on ? '✅ চালু' : 'বন্ধ'}</b>${ctx.settings.staff_2fa_required === '1' ? html` <span class="small muted">(সবার জন্য বাধ্যতামূলক)</span>` : ''}</p>
    ${s.totp_on || s.totp_secret ? html`<form method="post" action="/admin/staff/${s.id}/2fa-reset" data-confirm="${s.name}-এর দুই ধাপের লগইন রিসেট করবেন? (ফোন হারালে বা নতুন ফোন নিলে) পরের লগইনে আবার সেটআপ করতে হবে।"><button class="btn btn-sm btn-ghost">দুই ধাপের লগইন রিসেট করুন</button></form>` : ''}`}
    <div class="title-row"><h3>যেসব ডিভাইসে এখন লগইন আছে <small>${ui.bn(devices.length)}টি</small></h3>
    ${devices.length && s.id !== ctx.user.id ? html`<form method="post" action="/admin/staff/${s.id}/logout-all" data-confirm="${s.name}-কে সব ডিভাইস থেকে লগআউট করবেন?"><button class="btn btn-sm btn-danger">সব ডিভাইস থেকে লগআউট করান</button></form>` : ''}</div>
    ${require('./account').devicesTable(devices, ctx.user.__session, '/admin/security/sessions/logout')}
    <h3>সাম্প্রতিক লগইন</h3>
    ${logins.length ? html`<ul class="timeline">${logins.map((h) => html`<li class="${h.ok ? '' : 'warn'}">${sessions.EVENTS[h.event] || h.event}${h.detail ? ` · ${h.detail}` : ''} · ${h.device}<br><span class="small muted">${fmtDate(h.created_at)} · ${h.place ? h.place + ' · ' : ''}${h.ip}</span></li>`)}</ul>` : html`<p class="muted small">এখনো কিছু নেই।</p>`}
    <p class="small"><a href="/admin/security/logins?staff=${s.id}">পুরো লগইন ইতিহাস →</a> · <a href="/admin/security/audit?staff=${s.id}">এই স্টাফের সব কাজ (অডিট লগ) →</a></p>
  </section>` : ''}
  ${id ? html`<section class="panel"><h2>সাম্প্রতিক কাজ</h2>${activity.length ? html`<ul class="timeline">${activity.map((a) => html`<li>${a.action}${a.entity ? html` · ${a.entity === 'order' && a.entity_id ? html`<a href="/admin/orders/${a.entity_id}">অর্ডার #${a.entity_id}</a>` : a.entity}` : ''}${a.detail ? ` · ${a.detail}` : ''}<br><span class="small muted">${fmtDate(a.created_at)}</span></li>`)}</ul>` : html`<p class="muted">কিছু নেই।</p>`}</section>` : ''}`, 'staff');
}

async function resetTwoFactor(ctx, m) {
  const id = int(m[1]);
  const s = await S.getStaff(id);
  if (!s || s.role === 'owner') return ctx.back('/admin/staff');
  await db.q(`UPDATE staff SET totp_on=false, totp_secret='', totp_last_step=0 WHERE id=$1`, [id]);
  await ctx.log('tfa_reset', 'staff', id, `${s.name}-এর দুই ধাপের লগইন রিসেট`);
  return ctx.redirect(ctx.res, `/admin/staff/${id}?info=${encodeURIComponent('দুই ধাপের লগইন রিসেট হয়েছে।' + (ctx.settings.staff_2fa_required === '1' ? ' পরের লগইনে আবার সেটআপ করতে হবে।' : ''))}#security`);
}
async function logoutAll(ctx, m) {
  const id = int(m[1]);
  const s = await S.getStaff(id);
  if (!s || id === ctx.user.id) return ctx.back('/admin/staff');
  const n = await sessions.revokeAll(id, `মালিক লগআউট করিয়েছেন (${ctx.user.name})`);
  await sessions.record(ctx.req, { staffId: id, login: s.username, event: 'revoked', ok: true, ip: ctx.ip, detail: `মালিক ${n}টি ডিভাইস থেকে লগআউট করিয়েছেন` });
  await ctx.log('staff_logout', 'staff', id, `${s.name}: ${n}টি ডিভাইস থেকে লগআউট`);
  return ctx.redirect(ctx.res, `/admin/staff/${id}?info=${encodeURIComponent(`${s.name} এখন সব ডিভাইস থেকে লগআউট।`)}#security`);
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
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/2fa-reset$/, perm: 'owner', handler: resetTwoFactor },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/logout-all$/, perm: 'owner', handler: logoutAll },
  ],
};

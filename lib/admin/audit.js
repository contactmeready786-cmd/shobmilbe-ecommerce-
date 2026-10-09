'use strict';
// Owner only: the audit log (who changed what, when) and the login history with every logged-in device.
const { html, bn, fmtDate, int, str, csv, dateRange, pageNum, validYmd } = require('../util');
const db = require('../db');
const ui = require('./ui');
const sessions = require('../models/sessions');

// What each kind of record is about, and what each action means — in plain Bangla.
const ENTITIES = {
  product: '📦 পণ্য', order: '🧾 অর্ডার', customer: '👤 কাস্টমার', category: '🗂️ ক্যাটাগরি', brand: '🏷️ ব্র্যান্ড', staff: '🧑‍💼 স্টাফ',
  security: '🛡️ নিরাপত্তা', settings: '⚙️ সেটিংস', marketing: '📣 মার্কেটিং', coupon: '🏷️ কুপন', blog: '📝 ব্লগ', page: '📄 পেজ', banner: '🖼️ ব্যানার',
  design: '🎨 ডিজাইন', supplier: '🚚 সাপ্লায়ার', purchase: '🛒 পারচেজ', transaction: '💰 হিসাব', accounting: '💰 হিসাব', trash: '🗑️ রিসাইকেল বিন',
  translation: '🌐 অনুবাদ', payments: '💳 পেমেন্ট', courier: '🛵 কুরিয়ার', domain: '🌐 ডোমেইন', account: '🏦 অ্যাকাউন্ট',
};
const ACTIONS = {
  login: 'লগইন', login_step: 'পাসওয়ার্ড ঠিক, দ্বিতীয় যাচাই বাকি', password: 'নিজের পাসওয়ার্ড বদল', password_reset: 'পাসওয়ার্ড রিসেট', reset_mail: 'রিসেট লিংক পাঠানো',
  blocked: '⛔ আটকানো', product_add: 'পণ্য যোগ', product_edit: 'পণ্য এডিট', product_delete: 'পণ্য মুছা', product_dup_allow: 'ডুপ্লিকেট হলেও প্রকাশের অনুমতি',
  product_dup_blocked: 'ডুপ্লিকেট বলে সেভ আটকানো', price_change: '💲 দাম বদল', cost_change: '💲 কেনা দাম বদল', stock_adjust: 'স্টক বদল', product_bulk: 'একসাথে অনেক পণ্য বদল',
  order_create: 'অর্ডার তৈরি', order_edit: 'অর্ডার এডিট', order_status: 'অর্ডারের অবস্থা বদল', order_note: 'অর্ডারে নোট', order_payment: 'পেমেন্ট রেকর্ড',
  courier_send: 'কুরিয়ারে পাঠানো', courier_auto: 'কুরিয়ারে নিজে থেকে পাঠানো', courier_sync: 'কুরিয়ার আপডেট', draft_status: 'অসম্পূর্ণ অর্ডার', draft_delete: 'অসম্পূর্ণ অর্ডার মুছা',
  customer_edit: 'কাস্টমার এডিট', block: 'ব্লক', unblock: 'ব্লক তুলে নেওয়া', delete: 'মুছা', export: 'ডাউনলোড (এক্সপোর্ট)',
  category_save: 'ক্যাটাগরি সেভ', category_delete: 'ক্যাটাগরি মুছা', brand_save: 'ব্র্যান্ড সেভ', brand_delete: 'ব্র্যান্ড মুছা',
  staff_add: 'স্টাফ যোগ', staff_edit: 'স্টাফ এডিট', staff_delete: 'স্টাফ মুছা', staff_logout: 'স্টাফকে লগআউট করানো', tfa_on: 'দুই ধাপের লগইন চালু', tfa_off: 'দুই ধাপের লগইন বন্ধ', tfa_reset: 'দুই ধাপের লগইন রিসেট',
  settings: 'সেটিংস বদল', coupon_save: 'কুপন সেভ', coupon_delete: 'কুপন মুছা', post_delete: 'ব্লগ পোস্ট মুছা', blog_category_delete: 'ব্লগ ক্যাটাগরি মুছা',
  page_save: 'পেজ সেভ', page_delete: 'পেজ মুছা', banner_save: 'ব্যানার সেভ', banner_delete: 'ব্যানার মুছা', supplier_save: 'সাপ্লায়ার সেভ', supplier_pay: 'সাপ্লায়ারকে টাকা',
  purchase_add: 'পারচেজ এন্ট্রি', purchase_status: 'পারচেজের অবস্থা', tx_add: 'আয়-ব্যয় এন্ট্রি', tx_delete: 'আয়-ব্যয় মুছা', account_save: 'অ্যাকাউন্ট সেভ',
  purge: 'চিরতরে মুছা', restore: 'রিসাইকেল বিন থেকে ফেরত', add: 'যোগ', edit: 'এডিট', passkey_add: 'পাসকি যোগ', passkey_delete: 'পাসকি মুছা', face_add: 'মুখের ছবি যোগ',
  face_delete: 'মুখের ছবি মুছা', login_code: 'অনুমতি কোড', recovery_codes: 'রিকভারি কোড', damage_move: 'নষ্ট স্টকে সরানো', damage_out: 'নষ্ট মাল বাদ',
};
const actionLabel = (a) => ACTIONS[a] || a;
const entityLabel = (e) => ENTITIES[e] || e || '—';

function link(a) {
  if (!a.entity_id) return '';
  const to = { product: `/admin/products/${a.entity_id}`, order: `/admin/orders/${a.entity_id}`, customer: `/admin/customers/${a.entity_id}`,
    staff: `/admin/staff/${a.entity_id}`, supplier: `/admin/suppliers/${a.entity_id}`, purchase: `/admin/purchases/${a.entity_id}` }[a.entity];
  return to ? html` <a class="small" href="${to}">#${a.entity_id}</a>` : html` <span class="small muted">#${a.entity_id}</span>`;
}

function filters(query) {
  const r = query.get('from') || query.get('to') || query.get('days') ? dateRange(query, 30) : { from: null, to: null };
  return {
    staffId: int(query.get('staff')) || null,
    entity: ENTITIES[query.get('entity')] ? query.get('entity') : '',
    action: ACTIONS[query.get('action')] ? query.get('action') : '',
    q: str(query.get('q'), 80),
    from: validYmd(r.from), to: validYmd(r.to),
  };
}
function where(f, params) {
  const w = [];
  if (f.staffId) { params.push(f.staffId); w.push(`a.staff_id=$${params.length}`); }
  if (f.entity) { params.push(f.entity); w.push(`a.entity=$${params.length}`); }
  if (f.action) { params.push(f.action); w.push(`a.action=$${params.length}`); }
  if (f.q) { params.push(`%${f.q}%`); w.push(`(a.detail ILIKE $${params.length} OR a.action ILIKE $${params.length})`); }
  if (f.from) { params.push(f.from); w.push(`a.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Dhaka'`); }
  if (f.to) { params.push(f.to); w.push(`a.created_at < (($${params.length}::date) + 1)::timestamp AT TIME ZONE 'Asia/Dhaka'`); }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}

const PER = 50;
async function auditPage(ctx) {
  const f = filters(ctx.query);
  const page = pageNum(ctx.query);
  const params = [];
  const w = where(f, params);
  const [rows, total, staff] = await Promise.all([
    db.q(`SELECT a.*, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id ${w}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${PER} OFFSET ${(page - 1) * PER}`, params),
    db.one(`SELECT count(*)::int AS n FROM activity_log a ${w}`, params).then((r) => r.n),
    db.q('SELECT id, name FROM staff ORDER BY role=\'owner\' DESC, name'),
  ]);
  const qs = new URLSearchParams();
  Object.entries({ staff: f.staffId, entity: f.entity, action: f.action, q: f.q, from: f.from, to: f.to }).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const base = '/admin/security/audit' + (qs.toString() ? '?' + qs : '');
  const body = html`<div class="title-row"><h1>📜 অডিট লগ <small>${bn(total)}টি</small></h1>
  <div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/security/audit.csv${qs.toString() ? '?' + qs : ''}">⬇️ CSV / Excel</a></div></div>
${ui.flash(ctx.flash)}
<p class="muted small">অ্যাডমিনে কে, কখন, কী বদলেছে — পণ্যের দাম, স্টক, অর্ডারের অবস্থা, সেটিংস, লগইন সব এখানে। এই তালিকা কেউ বদলাতে বা মুছতে পারে না, শুধু মালিক দেখতে পান।</p>
<form class="toolbar filters" method="get" action="/admin/security/audit">
  ${ui.select('staff', [['', 'সব স্টাফ'], ...staff.map((s) => [s.id, s.name])], f.staffId || '')}
  ${ui.select('entity', [['', 'সব বিষয়'], ...Object.entries(ENTITIES)], f.entity)}
  ${ui.select('action', [['', 'সব কাজ'], ...Object.entries(ACTIONS).sort((a, b) => a[1].localeCompare(b[1]))], f.action)}
  <input type="search" name="q" value="${f.q}" placeholder="লেখা দিয়ে খুঁজুন (যেমন পণ্যের নাম)">
  <label class="small">থেকে <input type="date" name="from" value="${f.from || ''}"></label>
  <label class="small">পর্যন্ত <input type="date" name="to" value="${f.to || ''}"></label>
  <button class="btn btn-sm">খুঁজুন</button>
  ${qs.toString() ? html`<a class="btn btn-sm btn-ghost" href="/admin/security/audit">সব দেখুন</a>` : ''}
</form>
<div class="chips">
  <a class="chip ${f.action === 'price_change' ? 'on' : ''}" href="/admin/security/audit?action=price_change">💲 দাম বদল</a>
  <a class="chip ${f.action === 'cost_change' ? 'on' : ''}" href="/admin/security/audit?action=cost_change">💲 কেনা দাম বদল</a>
  <a class="chip ${f.action === 'stock_adjust' ? 'on' : ''}" href="/admin/security/audit?action=stock_adjust">📦 স্টক বদল</a>
  <a class="chip ${f.action === 'order_status' ? 'on' : ''}" href="/admin/security/audit?action=order_status">🧾 অর্ডারের অবস্থা</a>
  <a class="chip ${f.action === 'settings' ? 'on' : ''}" href="/admin/security/audit?action=settings">⚙️ সেটিংস</a>
  <a class="chip" href="/admin/security/logins">🔑 লগইন ইতিহাস →</a>
</div>
${rows.length ? html`<div class="panel table-wrap"><table class="table compact audit-table">
  <thead><tr><th>সময়</th><th>কে</th><th>বিষয়</th><th>কী করেছে</th><th>বিস্তারিত</th></tr></thead>
  <tbody>${rows.map((a) => html`<tr class="${a.action === 'blocked' ? 'row-warn' : ''}">
    <td class="small nowrap">${fmtDate(a.created_at)}</td>
    <td>${a.staff_name ? html`<a href="/admin/security/audit?staff=${a.staff_id}">${a.staff_name}</a>` : html`<span class="muted">সিস্টেম</span>`}</td>
    <td class="small">${entityLabel(a.entity)}${link(a)}</td>
    <td><b>${actionLabel(a.action)}</b></td>
    <td class="small audit-detail">${a.detail}</td></tr>`)}</tbody></table></div>
  ${ui.pager(total, page, PER, base)}` : ui.empty('এই খোঁজে কিছু পাওয়া যায়নি।')}`;
  return ctx.page('অডিট লগ', body, 'audit');
}

async function auditCsv(ctx) {
  const f = filters(ctx.query);
  const params = [];
  const rows = await db.q(`SELECT a.*, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id ${where(f, params)}
    ORDER BY a.created_at DESC, a.id DESC LIMIT 20000`, params);
  await ctx.log('export', 'security', null, `অডিট লগ ডাউনলোড (${rows.length}টি)`);
  const out = csv([['সময়', 'কে', 'বিষয়', 'আইডি', 'কাজ', 'বিস্তারিত'],
    ...rows.map((a) => [new Date(a.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }), a.staff_name || 'সিস্টেম', entityLabel(a.entity).replace(/^\S+\s/, ''), a.entity_id || '', actionLabel(a.action), a.detail])]);
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-log.csv"', 'Cache-Control': 'no-store' });
  return ctx.res.end(out);
}

// ---------------------------------------------------------------- logins & devices
const EVENT_OPTS = Object.entries(sessions.EVENTS);
async function loginsPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const hours = Math.min(720, Math.max(1, int(b.session_idle_hours, 72)));
    const req2fa = b.staff_2fa_required ? '1' : '0';
    const before = ctx.settings;
    await db.setMany({ session_idle_hours: String(hours), staff_2fa_required: req2fa });
    await ctx.reloadSettings();
    await ctx.log('settings', 'security', null, `লগইন: ${hours} ঘণ্টা ব্যবহার না হলে লগআউট (আগে ${before.session_idle_hours}); স্টাফের দুই ধাপের লগইন ${req2fa === '1' ? 'বাধ্যতামূলক' : 'ঐচ্ছিক'}`);
    return ctx.redirect(ctx.res, '/admin/security/logins?msg=saved#settings');
  }
  const f = {
    staffId: int(ctx.query.get('staff')) || null,
    event: sessions.EVENTS[ctx.query.get('event')] ? ctx.query.get('event') : '',
    failed: ctx.query.get('failed') === '1',
    ip: str(ctx.query.get('ip'), 64),
  };
  const page = pageNum(ctx.query);
  const [active, rows, total, failed, staff] = await Promise.all([
    sessions.listActive(ctx.settings), sessions.history(f, { limit: PER, offset: (page - 1) * PER }), sessions.countHistory(f),
    sessions.failedSummary(), db.q(`SELECT id, name, totp_on, role, active FROM staff ORDER BY role='owner' DESC, name`),
  ]);
  const qs = new URLSearchParams();
  Object.entries({ staff: f.staffId, event: f.event, failed: f.failed ? '1' : '', ip: f.ip }).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const noTfa = staff.filter((s) => s.role !== 'owner' && s.active && !s.totp_on);
  const body = html`<h1>🔑 লগইন ইতিহাস ও ডিভাইস</h1>${ui.flash(ctx.flash)}
<section class="panel">
  <div class="title-row"><h2>এখন যারা লগইন আছে <small>${bn(active.length)}টি ডিভাইস</small></h2>
  ${active.some((a) => a.id !== ctx.user.__session) ? html`<form method="post" action="/admin/security/sessions/logout-all" data-confirm="আপনার এই ডিভাইস ছাড়া সবাইকে (সব স্টাফ আর আপনার অন্য ডিভাইস) এখনই লগআউট করবেন?"><button class="btn btn-sm btn-danger">আমি ছাড়া সবাইকে লগআউট করুন</button></form>` : ''}</div>
  ${active.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>কে</th><th>ডিভাইস</th><th>কোথা থেকে</th><th>লগইন</th><th>শেষ ব্যবহার</th><th></th></tr></thead>
  <tbody>${active.map((s) => html`<tr><td><a href="/admin/staff/${s.staff_id}#security"><b>${s.name}</b></a>${s.role === 'owner' ? html` <span class="pill">মালিক</span>` : ''}</td>
    <td class="small">${s.device}${s.id === ctx.user.__session ? html` <span class="pill pill-delivered">এই ডিভাইস</span>` : ''}</td>
    <td class="small">${s.place}${s.place ? ' · ' : ''}<span class="mono">${s.ip}</span></td><td class="small">${fmtDate(s.created_at)}</td><td class="small">${fmtDate(s.last_seen)}</td>
    <td>${s.id === ctx.user.__session ? '' : html`<form method="post" action="/admin/security/sessions/logout" data-confirm="এই ডিভাইস থেকে লগআউট করাবেন?"><input type="hidden" name="id" value="${s.id}"><button class="btn btn-sm btn-ghost">লগআউট করান</button></form>`}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">কেউ লগইন নেই।</p>`}
</section>

${failed.length ? html`<section class="panel">
  <h2>⚠️ গত ২৪ ঘণ্টায় ভুল লগইনের চেষ্টা</h2>
  <p class="small muted">একই জায়গা থেকে অনেকবার হলে সেটা পাসওয়ার্ড অনুমান করার চেষ্টা হতে পারে। ৮ বার ভুল হলে সেই জায়গা নিজে থেকেই ১৫ মিনিট আটকে যায়; চাইলে <a href="/admin/security/threats">সন্দেহজনক ভিজিটর</a> থেকে পুরো সাইটেই ব্লক করতে পারেন।</p>
  <div class="table-wrap"><table class="table compact"><thead><tr><th>কোথা থেকে (IP)</th><th class="num">কতবার</th><th>যে নামে চেষ্টা</th><th>শেষ চেষ্টা</th></tr></thead>
  <tbody>${failed.map((r) => html`<tr class="${r.n >= 8 ? 'row-warn' : ''}"><td><a class="mono" href="/admin/security/logins?ip=${encodeURIComponent(r.ip)}">${r.ip}</a> <span class="small muted">${r.place || ''}</span></td>
    <td class="num"><b>${bn(r.n)}</b></td><td class="small">${r.logins || '—'}</td><td class="small">${fmtDate(r.last)}</td></tr>`)}</tbody></table></div>
</section>` : ''}

<section class="panel">
  <h2>লগইনের সব ঘটনা <small>${bn(total)}টি</small></h2>
  <form class="toolbar filters" method="get" action="/admin/security/logins">
    ${ui.select('staff', [['', 'সবাই'], ...staff.map((s) => [s.id, s.name])], f.staffId || '')}
    ${ui.select('event', [['', 'সব ঘটনা'], ...EVENT_OPTS], f.event)}
    ${ui.check('failed', f.failed, 'শুধু ব্যর্থ চেষ্টা')}
    ${f.ip ? html`<input type="hidden" name="ip" value="${f.ip}"><span class="chip on">IP: ${f.ip}</span>` : ''}
    <button class="btn btn-sm">দেখুন</button>
    ${qs.toString() ? html`<a class="btn btn-sm btn-ghost" href="/admin/security/logins">সব</a>` : ''}
  </form>
  ${rows.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>কে</th><th>কী হয়েছে</th><th>ডিভাইস</th><th>কোথা থেকে</th></tr></thead>
  <tbody>${rows.map((h) => html`<tr class="${h.ok ? '' : 'row-warn'}"><td class="small nowrap">${fmtDate(h.created_at)}</td>
    <td>${h.staff_name ? html`<a href="/admin/staff/${h.staff_id}#security">${h.staff_name}</a>` : html`<span class="muted">অচেনা</span>`}${h.login && (!h.staff_name || !h.ok) ? html`<br><span class="small muted mono" translate="no">"${h.login}"</span>` : ''}</td>
    <td>${sessions.EVENTS[h.event] || h.event}${h.detail ? html`<br><span class="small muted">${h.detail}</span>` : ''}</td>
    <td class="small">${h.device}</td><td class="small">${h.place}${h.place ? ' · ' : ''}<a class="mono" href="/admin/security/logins?ip=${encodeURIComponent(h.ip)}">${h.ip}</a></td></tr>`)}</tbody></table></div>
  ${ui.pager(total, page, PER, '/admin/security/logins' + (qs.toString() ? '?' + qs : ''))}` : html`<p class="muted">কিছু নেই।</p>`}
</section>

<section class="panel" id="settings">
  <h2>⚙️ লগইনের নিয়ম</h2>
  <form method="post" action="/admin/security/logins" class="form">
    ${ui.field('কত ঘণ্টা ব্যবহার না হলে নিজে থেকে লগআউট', ui.input('session_idle_hours', ctx.settings.session_idle_hours || '72', { type: 'number', min: 1, max: 720, class: 'w-num' }),
    'যেমন ৭২ = ৩ দিন কেউ অ্যাডমিন না খুললে আবার পাসওয়ার্ড দিতে হবে। দোকানের কম্পিউটার অনেকে ব্যবহার করলে ৮–১২ ঘণ্টা দিন। (যেকোনো লগইন সর্বোচ্চ ৩০ দিন চলে।)')}
    ${ui.switchRow('staff_2fa_required', ctx.settings.staff_2fa_required === '1', 'সব স্টাফের জন্য দুই ধাপের লগইন বাধ্যতামূলক',
    'চালু করলে প্রত্যেক স্টাফকে ফোনে Google Authenticator সেটআপ করতে হবে — পাসওয়ার্ড চুরি হলেও ফোন ছাড়া কেউ ঢুকতে পারবে না। সেটআপ না করা পর্যন্ত তারা অ্যাডমিনের অন্য কিছু খুলতে পারবে না।')}
    ${noTfa.length ? html`<p class="small muted">এখনো চালু করেনি: ${noTfa.map((s) => s.name).join(', ')}</p>` : ''}
    <button class="btn">সেভ করুন</button>
  </form>
</section>`;
  return ctx.page('লগইন ইতিহাস ও ডিভাইস', body, 'logins');
}

async function logoutDevice(ctx) {
  const b = await ctx.body();
  if (String(b.id) === ctx.user.__session) return ctx.redirect(ctx.res, '/admin/security/logins');
  const who = await sessions.revokeId(str(b.id, 100), null, `মালিক লগআউট করিয়েছেন (${ctx.user.name})`);
  if (who) {
    const s = await db.one('SELECT name, username FROM staff WHERE id=$1', [who]);
    await sessions.record(ctx.req, { staffId: who, login: s ? s.username : '', event: 'revoked', ok: true, ip: ctx.ip, detail: 'মালিক একটা ডিভাইস লগআউট করিয়েছেন' });
    await ctx.log('staff_logout', 'staff', who, `${s ? s.name : ''}: একটা ডিভাইস থেকে লগআউট`);
  }
  const back = String(ctx.req.headers.referer || '').includes('/admin/staff/') ? `/admin/staff/${who}#security` : '/admin/security/logins';
  return ctx.redirect(ctx.res, back);
}
async function logoutEveryone(ctx) {
  const n = await sessions.revokeEveryone(`মালিক সবাইকে লগআউট করিয়েছেন (${ctx.user.name})`, ctx.user.__token);
  await ctx.log('staff_logout', 'security', null, `সবাইকে লগআউট: ${n}টি ডিভাইস`);
  return ctx.redirect(ctx.res, '/admin/security/logins?info=' + encodeURIComponent(`${bn(n)}টি ডিভাইস থেকে লগআউট করা হয়েছে।`));
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/security/audit', perm: 'owner', handler: auditPage },
    { method: 'GET', path: '/admin/security/audit.csv', perm: 'owner', handler: auditCsv },
    { method: '*', path: '/admin/security/logins', perm: 'owner', handler: loginsPage },
    { method: 'POST', path: '/admin/security/sessions/logout', perm: 'owner', handler: logoutDevice },
    { method: 'POST', path: '/admin/security/sessions/logout-all', perm: 'owner', handler: logoutEveryone },
  ],
  ACTIONS, ENTITIES, actionLabel,
};

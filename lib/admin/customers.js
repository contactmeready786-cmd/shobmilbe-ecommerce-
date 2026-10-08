'use strict';
const { html, money, bn, fmtDate, int, str, pageNum, csv, normalizePhone, validPhone, list } = require('../util');
const C = require('../models/customers');
const O = require('../models/orders');
const ui = require('./ui');
const db = require('../db');

// Deleting customers: only the owner, and only while the switch on the customers page is on.
function canDelete(ctx) { return ctx.user.role === 'owner' && ctx.settings.customer_delete_on === '1'; }
function deleteSwitch(ctx) {
  if (ctx.user.role !== 'owner') return '';
  return html`<form method="post" action="/admin/customers/delete-setting" class="panel switch-list cust-del-sw" data-autosubmit>
    ${ui.switchRow('customer_delete_on', ctx.settings.customer_delete_on === '1', '🗑️ কাস্টমার মুছে ফেলার বাটন দেখান', 'শুধু আপনি (মালিক) দেখবেন। চালু করলে প্রতিটা কাস্টমারের পাশে "মুছুন" বাটন আর একসাথে অনেকগুলো মোছার ব্যবস্থা আসবে। কাজ শেষ হলে বন্ধ করে রাখুন, যাতে ভুল করে কেউ মুছে না ফেলে।')}
  </form>`;
}

const PER_PAGE = 40;

async function listPage(ctx) {
  const q = str(ctx.query.get('q'), 60);
  const sort = ['spent', 'orders', 'name'].includes(ctx.query.get('sort')) ? ctx.query.get('sort') : '';
  const page = pageNum(ctx.query);
  const [rows, total] = await Promise.all([C.listCustomers({ q, sort, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), C.countCustomers({ q })]);
  const body = html`<div class="title-row"><h1>কাস্টমার <small>${bn(total)} জন</small></h1>
  ${ctx.can('reports') ? html`<a class="btn btn-ghost" href="/admin/customers/export.csv">⬇ CSV ডাউনলোড</a>` : ''}</div>
${ui.flash(ctx.flash)}
${deleteSwitch(ctx)}
<form class="toolbar" method="get" action="/admin/customers">
  <input type="search" name="q" value="${q}" placeholder="নাম, ফোন বা ঠিকানা">
  ${ui.select('sort', [['', 'সাম্প্রতিক অর্ডার আগে'], ['spent', 'বেশি কেনাকাটা আগে'], ['orders', 'বেশি অর্ডার আগে'], ['name', 'নাম']], sort)}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${rows.length ? html`${canDelete(ctx) ? html`<form method="post" action="/admin/customers/bulk-delete" id="cust-bulk" class="bulk-bar panel"
  data-confirm="টিক দেওয়া কাস্টমারদের মুছে ফেলবেন? রিসাইকেল বিনে থাকবে, সেখান থেকে ফেরত আনা যাবে।">
  <b>টিক দেওয়াগুলো:</b> ${ui.check('with_orders', true, 'এদের সব অর্ডারও মুছুন (স্টক ফেরত যাবে)')}
  <button class="btn btn-sm btn-danger">🗑️ টিক দেওয়াগুলো মুছুন</button></form>` : ''}
<div class="table-wrap panel"><table class="table">
<thead><tr>${canDelete(ctx) ? html`<th><input type="checkbox" data-check-all aria-label="সব বাছুন"></th>` : ''}<th>কাস্টমার</th><th>ঠিকানা</th><th class="num">অর্ডার</th><th class="num">ডেলিভারি</th><th class="num">বাতিল/ফেরত</th><th class="num">মোট কেনা</th><th>শেষ অর্ডার</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((c) => html`<tr class="${c.blocked ? 'row-blocked' : ''}">
  ${canDelete(ctx) ? html`<td><input type="checkbox" name="ids" value="${c.id}" form="cust-bulk" data-check-row aria-label="বাছুন"></td>` : ''}
  <td><b translate="no">${c.name || '—'}</b>${c.blocked ? html` <span class="pill pill-cancelled">ব্লক</span>` : ''}<br><a class="small" href="tel:${c.phone}">${c.phone}</a></td>
  <td class="small" translate="no">${c.address}${c.thana || c.district ? html`<br><span class="muted">${O.areaLabel(c)}</span>` : ''}</td>
  <td class="num">${bn(c.orders)}</td><td class="num">${bn(c.delivered)}</td>
  <td class="num ${c.cancelled + c.returned > 0 ? 'warn' : ''}">${bn(c.cancelled + c.returned)}</td>
  <td class="num">${money(c.spent)}</td><td class="small">${fmtDate(c.last_order, false)}</td>${ui.rowActions({ edit: `/admin/customers/${c.id}`, editLabel: '✏️ খুলুন / এডিট',
    del: canDelete(ctx) ? `/admin/customers/${c.id}/delete?with_orders=1` : '',
    delConfirm: `"${c.name || c.phone}" আর এর ${c.orders}টি অর্ডার মুছে ফেলবেন? রিসাইকেল বিনে থাকবে, সেখান থেকে ফেরত আনা যাবে।` })}</tr>`)}</tbody></table></div>
${ui.pager(total, page, PER_PAGE, '/admin/customers' + (q || sort ? '?' + new URLSearchParams({ ...(q ? { q } : {}), ...(sort ? { sort } : {}) }) : ''))}`
    : ui.empty('কোনো কাস্টমার পাওয়া যায়নি।')}`;
  return ctx.page('কাস্টমার', body, 'customers');
}

async function detail(ctx, m) {
  const id = int(m[1]);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    await C.updateCustomer(id, b);
    await ctx.log('customer_edit', 'customer', id, '');
    return ctx.back(`/admin/customers/${id}`, 'saved');
  }
  const c = await C.getCustomer(id);
  if (!c) return ctx.redirect(ctx.res, '/admin/customers');
  const orders = await O.listOrders({ phone: c.phone, limit: 100 });
  const risk = C.riskOf({ orders: c.orders, delivered: c.delivered, failed: c.cancelled + c.returned });
  const body = html`<p class="crumbs"><a href="/admin/customers">← সব কাস্টমার</a></p>
<div class="title-row"><h1><span translate="no">${c.name || c.phone}</span> ${c.block ? html`<span class="pill pill-cancelled">ব্লক করা</span>` : ''}</h1>
  ${ctx.can('orders_edit') ? html`<a class="btn" href="/admin/orders/new?phone=${c.phone}">+ এর জন্য অর্ডার</a>` : ''}</div>
${ui.flash(ctx.flash)}
<div class="kpis">
  ${ui.kpi('মোট অর্ডার', bn(c.orders), '')}
  ${ui.kpi('ডেলিভারি হয়েছে', bn(c.delivered), '', 'kpi-green')}
  ${ui.kpi('বাতিল / ফেরত', bn(c.cancelled + c.returned), '', c.cancelled + c.returned ? 'kpi-red' : '')}
  ${ui.kpi('মোট কেনাকাটা', money(c.spent), '')}
</div>
<div class="two-col">
  <section class="panel">
    <h2>অর্ডারগুলো</h2>
    <div class="risk risk-${risk.level}"><b>${risk.label}</b>${risk.ratio !== null ? html`<span>ডেলিভারি সফলতা ${bn(risk.ratio)}%</span>` : ''}</div>
    ${orders.length ? html`<table class="table compact"><tbody>${orders.map((o) => html`<tr><td><a href="/admin/orders/${o.id}"><b>${o.code}</b></a><br><span class="small muted">${fmtDate(o.created_at)}</span></td>
      <td class="small">${o.item_names}</td><td class="num">${money(o.total)}</td><td>${ui.pill(O.STATUSES[o.status], 'pill-' + o.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">কোনো অর্ডার নেই।</p>`}
  </section>
  <div>
    <section class="panel">
      <h2>তথ্য এডিট</h2>
      <form method="post" action="/admin/customers/${c.id}" class="form">
        ${ui.field('নাম', ui.input('name', c.name, { maxlength: 80 }))}
        <p>ফোন: <b>${c.phone}</b> · <a href="tel:${c.phone}">কল</a> · <a href="https://wa.me/${c.phone.replace(/^0/, '880')}" target="_blank" rel="noopener">WhatsApp</a></p>
        ${ui.field('ইমেইল', ui.input('email', c.email, { type: 'email', maxlength: 120 }))}
        ${ui.field('ঠিকানা', ui.textarea('address', c.address, { rows: 2, maxlength: 400 }))}
        <div class="field-row">${ui.field('জেলা', ui.input('district', c.district, { maxlength: 60 }))}${ui.field('থানা', ui.input('thana', c.thana, { maxlength: 60 }))}</div>
        ${ui.field('নোট (শুধু স্টাফ দেখবে)', ui.textarea('note', c.note, { rows: 2, maxlength: 1000 }))}
        <button class="btn">সেভ করুন</button>
      </form>
    </section>
    ${canDelete(ctx) ? html`<section class="panel">
      <h2>🗑️ কাস্টমার মুছে ফেলুন</h2>
      <form method="post" action="/admin/customers/${c.id}/delete" class="form" data-confirm="এই কাস্টমারকে মুছে ফেলবেন? রিসাইকেল বিনে থাকবে, সেখান থেকে ফেরত আনা যাবে।">
        ${ui.check('with_orders', true, `এর সব অর্ডারও মুছুন (${bn(c.orders)}টি — নেওয়া পণ্যের স্টক ফেরত যাবে)`)}
        <button class="btn btn-danger btn-sm">🗑️ মুছে ফেলুন</button>
        <p class="muted small">টেস্ট করার জন্য দেওয়া কাস্টমার/অর্ডার পরিষ্কার করতে এটা ব্যবহার করুন। ভুল হলে <a href="/admin/trash">রিসাইকেল বিন</a> থেকে ফেরত আনতে পারবেন।</p>
      </form>
    </section>` : ''}
    <section class="panel">
      <h2>ব্লক</h2>
      ${c.block ? html`<p>ব্লক করা হয়েছে ${fmtDate(c.block.created_at)}${c.block.reason ? `: ${c.block.reason}` : ''}</p>
        <form method="post" action="/admin/blocklist/${c.block.id}/delete"><input type="hidden" name="back" value="/admin/customers/${c.id}"><button class="btn btn-ghost btn-sm">ব্লক তুলে নিন</button></form>`
    : html`<form method="post" action="/admin/blocklist" class="form">
        <input type="hidden" name="kind" value="phone"><input type="hidden" name="value" value="${c.phone}"><input type="hidden" name="back" value="/admin/customers/${c.id}">
        ${ui.field('কারণ', ui.input('reason', '', { maxlength: 300, placeholder: 'যেমন: বারবার অর্ডার করে পণ্য নেয় না' }))}
        <button class="btn btn-danger btn-sm">⛔ এই নম্বর ব্লক করুন</button>
        <p class="muted small">ব্লক করলে এই নম্বর থেকে ওয়েবসাইটে আর অর্ডার করা যাবে না।</p>
      </form>`}
    </section>
  </div>
</div>`;
  return ctx.page(c.name || c.phone, body, 'customers');
}

async function exportCsv(ctx) {
  const rows = await C.listCustomers({ limit: 100000 });
  const out = [['Name', 'Phone', 'Email', 'Address', 'Thana', 'District', 'Orders', 'Delivered', 'Cancelled', 'Returned', 'Spent', 'Blocked']];
  rows.forEach((c) => out.push([c.name, c.phone, c.email, c.address, c.thana, c.district, c.orders, c.delivered, c.cancelled, c.returned, c.spent, c.blocked ? 'yes' : '']));
  await ctx.log('export', 'customer', null, `${rows.length} জন কাস্টমার CSV`);
  return ctx.send(ctx.res, 200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="customers-${Date.now()}.csv"` });
}

// ---------------------------------------------------------------- delete (owner only, switch on)
async function removeCustomers(ctx, ids, withOrders) {
  let n = 0;
  let orders = 0;
  for (const id of ids) {
    const c = await db.one('SELECT id, name, phone FROM customers WHERE id=$1', [id]);
    if (!c) continue;
    if (withOrders) {
      const list = await db.q('SELECT id FROM orders WHERE customer_id=$1 OR phone=$2', [c.id, c.phone]);
      for (const o of list) { if (await ctx.trash('order', o.id)) orders += 1; }
    }
    if (await ctx.trash('customer', c.id)) {
      n += 1;
      await ctx.log('delete', 'customer', c.id, `${c.name || ''} ${c.phone}${withOrders ? ' (অর্ডার সহ)' : ''}`);
    }
  }
  return { n, orders };
}
async function deleteOne(ctx, m) {
  if (!canDelete(ctx)) return ctx.back('/admin/customers', 'noperm');
  const b = await ctx.body();
  await removeCustomers(ctx, [int(m[1])], b.with_orders === '1' || ctx.query.get('with_orders') === '1');
  return ctx.back('/admin/customers', 'cust_deleted');
}
async function deleteMany(ctx) {
  if (!canDelete(ctx)) return ctx.back('/admin/customers', 'noperm');
  const b = await ctx.body();
  const ids = list(b.ids).map((x) => int(x)).filter(Boolean).slice(0, 500);
  if (!ids.length) return ctx.fail('/admin/customers', 'কোনো কাস্টমারে টিক দেওয়া হয়নি।');
  await removeCustomers(ctx, ids, b.with_orders === '1');
  return ctx.back('/admin/customers', 'cust_deleted');
}
async function deleteSetting(ctx) {
  if (ctx.user.role !== 'owner') return ctx.back('/admin/customers', 'noperm');
  const b = await ctx.body();
  await db.setSetting('customer_delete_on', b.customer_delete_on === '1' ? '1' : '0');
  await ctx.log('settings', 'customer', null, `কাস্টমার মোছার বাটন ${b.customer_delete_on === '1' ? 'চালু' : 'বন্ধ'}`);
  return ctx.back('/admin/customers', 'saved');
}

// ---------------------------------------------------------------- block list
async function blocklistPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const kind = b.kind === 'ip' ? 'ip' : 'phone';
    const back = String(b.back || '').startsWith('/admin/') ? b.back : '/admin/blocklist';
    if (kind === 'phone' && !validPhone(normalizePhone(b.value))) return ctx.fail(back, 'সঠিক মোবাইল নম্বর দিন।');
    if (kind === 'ip' && !str(b.value)) return ctx.fail(back, 'IP ঠিকানা দিন।');
    await C.block(kind, b.value, b.reason, ctx.user.id);
    await ctx.log('block', 'customer', null, `${kind} ${str(b.value, 40)}`);
    return ctx.back(back, 'blocked');
  }
  const rows = await C.listBlocked();
  const body = html`<h1>ব্লক লিস্ট (ফ্রড কাস্টমার) <small>${bn(rows.length)}টি</small></h1>
${ui.flash(ctx.flash)}
${ui.helpBox('ব্লক লিস্ট কীভাবে কাজ করে', html`এখানে যে মোবাইল নম্বর বা IP ঠিকানা রাখবেন, সেখান থেকে ওয়েবসাইটে অর্ডার করতে গেলে অর্ডার নেওয়া হবে না, একটা বার্তা দেখাবে (বার্তাটা <a href="/admin/settings">সেটিংস</a> থেকে বদলাতে পারবেন)। প্রতিটা অর্ডারের পেজে কাস্টমারের আগের রেকর্ড (কতবার পণ্য নেয়নি) দেখায়, সেখান থেকেও এক চাপে ব্লক করতে পারবেন। কেউ সাইটের ক্ষতি করার চেষ্টা করলে তাকে পুরো সাইট থেকে ব্লক করতে <a href="/admin/security/threats">🚨 সন্দেহজনক ভিজিটর</a> পেজে যান।`)}
<div class="two-col">
  <section class="panel table-wrap">
    ${rows.length ? html`<table class="table"><thead><tr><th>নম্বর / IP</th><th>কারণ</th><th>কে, কবে</th><th></th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td><b>${r.value}</b> <span class="pill ${r.kind === 'site' ? 'pill-red' : ''}">${r.kind === 'ip' ? 'IP (অর্ডার)' : r.kind === 'site' ? 'IP (পুরো সাইট)' : 'ফোন'}</span>${r.expires_at ? html`<br><small class="muted">${new Date(r.expires_at) > new Date() ? fmtDate(r.expires_at) + ' পর্যন্ত' : 'মেয়াদ শেষ'}</small>` : ''}${r.customer_id ? html`<br><a class="small" href="/admin/customers/${r.customer_id}">${r.customer_name}</a>` : ''}</td>
      <td class="small">${r.reason || '—'}</td><td class="small">${r.staff_name || '—'}<br>${fmtDate(r.created_at)}</td>
      <td><form method="post" action="/admin/blocklist/${r.id}/delete"><button class="link-btn">ব্লক তুলুন</button></form></td></tr>`)}</tbody></table>`
    : html`<p class="muted">কেউ ব্লক করা নেই।</p>`}
  </section>
  <section class="panel">
    <h2>নতুন ব্লক</h2>
    <form method="post" action="/admin/blocklist" class="form">
      ${ui.field('ধরন', ui.select('kind', [['phone', 'মোবাইল নম্বর'], ['ip', 'IP ঠিকানা']], 'phone'))}
      ${ui.field('নম্বর / IP', ui.input('value', '', { required: true, maxlength: 64 }))}
      ${ui.field('কারণ', ui.input('reason', '', { maxlength: 300 }))}
      <button class="btn btn-danger">ব্লক করুন</button>
    </form>
  </section>
</div>`;
  return ctx.page('ব্লক লিস্ট', body, 'blocklist');
}
async function unblock(ctx, m) {
  const b = await ctx.body();
  await C.unblock(int(m[1]));
  await ctx.log('unblock', 'customer', null, String(m[1]));
  const back = String(b.back || '').startsWith('/admin/') ? b.back : '/admin/blocklist';
  return ctx.back(back, 'unblocked');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/customers', perm: 'customers', handler: listPage },
    { method: 'GET', path: '/admin/customers/export.csv', perm: 'reports', handler: exportCsv },
    { method: 'POST', path: '/admin/customers/delete-setting', perm: 'customers', handler: deleteSetting },
    { method: 'POST', path: '/admin/customers/bulk-delete', perm: 'customers', handler: deleteMany },
    { method: 'POST', path: /^\/admin\/customers\/(\d+)\/delete$/, perm: 'customers', handler: deleteOne },
    { method: '*', path: /^\/admin\/customers\/(\d+)$/, perm: 'customers', handler: detail },
    { method: '*', path: '/admin/blocklist', perm: 'customers', handler: blocklistPage },
    { method: 'POST', path: /^\/admin\/blocklist\/(\d+)\/delete$/, perm: 'customers', handler: unblock },
  ],
};

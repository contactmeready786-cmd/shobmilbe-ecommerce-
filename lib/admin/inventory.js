'use strict';
const { html, raw, money, bn, fmtDate, int, str, list, ymd, pct, pageNum } = require('../util');
const catalog = require('../models/catalog');
const finance = require('../models/finance');
const ui = require('./ui');

// ---------------------------------------------------------------- inventory
const INV_PER_PAGE = 50;
const ADJUST_REASONS = [['adjust', 'হাতে বদল'], ['count', 'গণনা ঠিক করা'], ['damage', 'নষ্ট/ভাঙা → নষ্ট স্টকে'], ['lost', 'হারানো'], ['return', 'কাস্টমার ফেরত (ভালো মাল)'],
  ['damage_out', 'নষ্ট মাল ফেলে দেওয়া'], ['repair', 'মেরামত হয়ে আবার বিক্রিযোগ্য']];
async function inventoryPage(ctx) {
  const low = ctx.query.get('low') === '1';
  const damaged = ctx.query.get('damaged') === '1';
  const supplierId = int(ctx.query.get('supplier')) || null;
  const q = str(ctx.query.get('q'), 60);
  const sort = ['sku', 'sku_desc', 'stock_asc', 'name'].includes(ctx.query.get('sort')) ? ctx.query.get('sort') : 'sku';
  const page = pageNum(ctx.query);
  const seeCost = ctx.can('see_cost');
  const canProducts = ctx.can('products');
  const canDelete = ctx.can('products_delete');
  const canAdjust = ctx.can('inventory');
  const f = { includeInactive: true, type: 'single', lowStock: low, damaged, supplierId, q, items: true };
  const [sum, rows, total, moves, suppliers] = await Promise.all([
    catalog.inventorySummary(),
    catalog.listProducts({ ...f, sort, limit: INV_PER_PAGE, offset: (page - 1) * INV_PER_PAGE }),
    catalog.countProducts(f),
    catalog.stockMovements({ limit: 25 }),
    finance.listSuppliers(),
  ]);
  const reserved = await catalog.reservedFor(rows.map((p) => p.id));
  const supName = new Map(suppliers.map((x) => [x.id, x.name]));
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (low) qs.set('low', '1');
  if (damaged) qs.set('damaged', '1');
  if (supplierId) qs.set('supplier', supplierId);
  if (sort !== 'sku') qs.set('sort', sort);
  const listUrl = '/admin/inventory' + (qs.toString() ? '?' + qs : '');
  const backUrl = (() => { const x = new URLSearchParams(qs); if (page > 1) x.set('page', page); const t = x.toString(); return '/admin/inventory' + (t ? '?' + t : ''); })();
  const body = html`<div class="title-row"><h1>ইনভেন্টরি (স্টক) <small>${bn(total)}টি</small></h1>
  ${canAdjust ? html`<div class="row-actions"><a class="btn" href="/admin/purchases/new">+ মাল কিনেছি (পারচেজ)</a></div>` : ''}</div>
${ui.flash(ctx.flash)}
<div class="kpis">
  ${ui.kpi('মোট পণ্য', bn(sum.products), `${bn(sum.units)} পিস বিক্রির স্টকে`)}
  ${seeCost ? ui.kpi('স্টকের কেনা দাম', money(sum.cost_value), 'এখন দোকানে যত টাকার মাল', 'kpi-blue') : ''}
  ${ui.kpi('স্টকের বিক্রি দাম', money(sum.sale_value), seeCost ? `সম্ভাব্য লাভ ${money(Number(sum.sale_value) - Number(sum.cost_value))}` : '', 'kpi-green')}
  ${ui.kpi('স্টক কম', bn(sum.low), `${bn(sum.out)}টি একদম শেষ`, sum.low ? 'kpi-alert' : '', '/admin/inventory?low=1')}
  ${ui.kpi('নষ্ট স্টক', `${bn(sum.damaged)} পিস`, `${bn(sum.damaged_products)}টি পণ্যে${seeCost && Number(sum.damaged_value) ? ` · ${money(sum.damaged_value)} লোকসান` : ''}`, sum.damaged ? 'kpi-alert' : '', '/admin/inventory?damaged=1')}
</div>
<form class="toolbar" method="get" action="/admin/inventory">
  <input type="search" name="q" value="${q}" placeholder="পণ্যের নাম, SKU, মডেল বা বারকোড" id="inv-q"><button type="button" class="btn btn-sm btn-ghost" data-scan-into="#inv-q" title="ক্যামেরা দিয়ে বারকোড স্ক্যান">📷</button>
  ${suppliers.length ? ui.select('supplier', [['', 'সব সাপ্লায়ার'], ...suppliers.map((x) => [x.id, x.name])], supplierId || '') : ''}
  ${ui.select('sort', [['sku', 'SKU ১, ২, ৩… (ক্রমানুসারে)'], ['sku_desc', 'SKU বড় থেকে ছোট'], ['stock_asc', 'স্টক কম আগে'], ['name', 'নাম (A-Z)']], sort)}
  ${ui.check('low', low, 'শুধু স্টক কম')}
  ${ui.check('damaged', damaged, 'শুধু নষ্ট স্টক আছে')}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${ui.helpBox('স্টকের হিসাব কীভাবে পড়বেন', html`<ul>
  <li><b>বিক্রির স্টক</b> = এখন যতটা কাস্টমার অর্ডার করতে পারবে।</li>
  <li><b>অর্ডারে আটকে</b> = নতুন/কনফার্ম/প্যাকিং/হোল্ড অর্ডারের জন্য রাখা মাল — এখনো তাকেই আছে, কিন্তু অন্য কেউ আর কিনতে পারবে না। কুরিয়ারে দিলে এটা কমে যায়।</li>
  <li><b>তাকে মোট</b> = বিক্রির স্টক + অর্ডারে আটকে। হাতে গুনলে এই সংখ্যাটা মেলার কথা (নষ্ট মাল আলাদা)।</li>
  <li><b>নষ্ট স্টক</b> = ভাঙা/নষ্ট মাল, আলাদা রাখা — বিক্রি হবে না। মেরামত হলে "মেরামত হয়ে আবার বিক্রিযোগ্য", ফেলে দিলে "নষ্ট মাল ফেলে দেওয়া" বেছে সংখ্যা দিন।</li>
</ul>`)}
<form method="post" action="/admin/inventory/adjust" id="inv-adjust" data-inv-form><input type="hidden" name="back" value="${backUrl}"></form>
${rows.length ? html`<div class="panel table-wrap"><p class="inv-scroll-hint small muted" data-inv-hint>↔ টেবিলটা ডানে-বামে টেনে সব ঘর দেখুন — এডিট/মুছুন সবসময় ডান পাশে থাকে</p><table class="table inv-table">
  <thead><tr><th>ছবি</th><th>পণ্য</th><th>SKU</th><th class="num">বিক্রির স্টক</th><th class="num">অর্ডারে আটকে</th><th class="num">তাকে মোট</th><th class="num">নষ্ট</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">স্টকের মূল্য</th>` : ''}${canAdjust ? html`<th>স্টক বাড়ান / কমান</th><th>কারণ</th>` : ''}${canProducts || canDelete ? html`<th class="inv-act-h">দোকানে · এডিট · মুছুন</th>` : ''}</tr></thead>
  <tbody>${rows.map((p) => {
    const held = reserved.get(p.id) || 0;
    return html`<tr class="${p.active ? '' : 'row-off'}">
    <td class="thumb">${p.image_id ? html`<img src="/media/${p.image_id}/t" alt="" loading="lazy">` : html`<span>${p.emoji}</span>`}</td>
    <td class="inv-name"><b class="inv-title" title="${p.name}">${p.name}</b>${p.model ? html` <span class="small muted">${p.model}</span>` : ''}${p.active ? '' : html`<br><span class="small muted">দোকানে লুকানো</span>`}${p.supplier_id && supName.has(p.supplier_id) ? html`<br><a class="small muted" href="/admin/suppliers/${p.supplier_id}">🚚 ${supName.get(p.supplier_id)}</a>` : ''}</td>
    <td class="small">${p.sku || '—'}</td>
    <td class="num ${p.stock <= 0 ? 'bad' : p.stock <= p.low_stock ? 'warn' : ''}"><b>${bn(p.stock)}</b> <span class="small muted">${p.unit}</span>${p.stock <= 0 ? html`<br><span class="small">স্টক আউট</span>` : ''}</td>
    <td class="num">${held ? html`<a href="/admin/orders?q=${encodeURIComponent(p.sku || '')}" title="খোলা অর্ডারে রাখা">${bn(held)}</a>` : html`<span class="muted">০</span>`}</td>
    <td class="num">${bn(p.stock + held)}</td>
    <td class="num ${p.damaged_stock ? 'warn' : ''}">${p.damaged_stock ? bn(p.damaged_stock) : html`<span class="muted">০</span>`}</td>
    ${seeCost ? html`<td class="num">${money(p.cost_price)}</td><td class="num">${money(p.cost_price * p.stock)}</td>` : ''}
    ${canAdjust ? html`<td><div class="stepper">
      <input type="hidden" name="pid[]" value="${p.id}" form="inv-adjust">
      <button type="button" class="step-btn" data-step="-1" aria-label="${p.name} স্টক ১ কমান">−</button>
      <input type="number" name="change[]" class="w-num" placeholder="০" form="inv-adjust" aria-label="${p.name} স্টক বদল" data-step-input>
      <button type="button" class="step-btn" data-step="1" aria-label="${p.name} স্টক ১ বাড়ান">+</button>
    </div></td>
    <td>${raw(String(ui.select('reason[]', ADJUST_REASONS, 'adjust')).replace('<select ', '<select form="inv-adjust" '))}</td>` : ''}
    ${canProducts || canDelete ? html`<td class="inv-act"><div class="inv-act-in">
      ${canProducts ? html`<form method="post" action="/admin/products/${p.id}/active" class="prod-toggle">
        <input type="hidden" name="back" value="${backUrl}">
        <label class="switch switch-sm" title="চালু = দোকানে দেখাবে, বন্ধ = দোকান থেকে লুকিয়ে যাবে">
          <input type="checkbox" name="active" value="1" ${p.active ? raw('checked') : ''} data-prod-toggle aria-label="${p.name} দোকানে দেখাবে">
          <span class="switch-ui" aria-hidden="true"></span></label>
        <span class="small prod-toggle-text" data-prod-toggle-text>${p.active ? 'চালু' : 'বন্ধ'}</span>
        <noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript>
      </form>
      <a class="icon-btn" href="/admin/products/${p.id}" title="এডিট করুন" aria-label="${p.name} এডিট করুন">✏️</a>` : ''}
      ${canDelete ? html`<form method="post" action="/admin/products/${p.id}/delete" data-confirm="'${p.name}' পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু দোকান থেকে সরাতে চাইলে পাশের সুইচ বন্ধ করুন।">
        <input type="hidden" name="back" value="${backUrl}">
        <button class="icon-btn icon-danger" title="মুছুন" aria-label="${p.name} মুছুন">🗑️</button>
      </form>` : ''}
    </div></td>` : ''}
  </tr>`;
  })}</tbody>
</table>
  ${canAdjust ? html`<div class="form-actions inv-save">${raw(String(ui.input('note', '', { placeholder: 'নোট (ঐচ্ছিক)', maxlength: 200 })).replace('<input ', '<input form="inv-adjust" '))}<button class="btn" form="inv-adjust">স্টক আপডেট করুন</button></div>
  <p class="muted small inv-help">যেসব পণ্যের স্টক বদলাতে চান শুধু সেগুলোর ঘরে <b>+</b> / <b>−</b> চাপুন অথবা সংখ্যা লিখুন। যেমন ৫টি বেশি পেলে 5, ২টি হারালে −2। নষ্ট হলে সংখ্যা দিয়ে কারণে "নষ্ট/ভাঙা → নষ্ট স্টকে" বাছুন — বিক্রির স্টক থেকে কমে নষ্ট স্টকে যাবে। তারপর "স্টক আপডেট করুন" চাপুন।</p>` : ''}
</div>
${ui.pager(total, page, INV_PER_PAGE, listUrl)}` : html`<p class="muted panel">কিছু পাওয়া যায়নি।</p>`}
<section class="panel">
  <h2>স্টকের সাম্প্রতিক ইতিহাস</h2>
  ${movesTable(moves)}
  <p class="small"><a href="/admin/security/audit?action=stock_adjust">${ctx.user.role === 'owner' ? 'কে কখন স্টক বদলেছে — অডিট লগ →' : ''}</a></p>
</section>`;
  return ctx.page('ইনভেন্টরি', body, 'inventory');
}
function movesTable(moves) {
  if (!moves.length) return html`<p class="muted">এখনো কোনো বদল নেই।</p>`;
  return html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th class="num">বদল</th><th class="num">পরে স্টক</th><th>কারণ</th><th>কে</th></tr></thead>
  <tbody>${moves.map((m) => html`<tr><td class="small">${fmtDate(m.created_at)}</td><td>${m.product_name || '—'}</td>
    <td class="num ${m.change < 0 ? 'warn' : 'good'}">${m.change ? html`${m.change > 0 ? '+' : ''}${bn(m.change)}` : ''}${m.damaged_change ? html`<br><span class="small warn">নষ্ট ${m.damaged_change > 0 ? '+' : ''}${bn(m.damaged_change)}</span>` : ''}</td><td class="num">${bn(m.balance ?? '')}</td>
    <td class="small">${catalog.STOCK_REASONS[m.reason] || m.reason}${m.ref_type === 'order' && m.ref_id ? html` · <a href="/admin/orders/${m.ref_id}">অর্ডার</a>` : ''}${m.ref_type === 'purchase' && m.ref_id ? html` · <a href="/admin/purchases/${m.ref_id}">পারচেজ</a>` : ''}${m.note ? ` · ${m.note}` : ''}</td>
    <td class="small">${m.staff_name || '—'}</td></tr>`)}</tbody></table></div>`;
}
async function adjust(ctx) {
  const b = await ctx.body();
  const pids = list(b.pid);
  const changes = list(b.change);
  const reasons = list(b.reason);
  const note = str(b.note, 200);
  let n = 0;
  const problems = [];
  const touched = [];
  const { tx } = require('../db');
  await tx(async (t) => {
    for (let i = 0; i < pids.length; i++) {
      const ch = int(changes[i]);
      if (!ch) continue;
      const pid = int(pids[i]);
      const reason = catalog.STOCK_REASONS[reasons[i]] ? reasons[i] : 'adjust';
      const qty = Math.abs(ch);
      let ok = true;
      // damaged goods: kept apart from the stock that can be sold
      if (reason === 'damage') ok = await catalog.changeDamaged(t, pid, { stock: -qty, damaged: qty }, 'damage', 'manual', null, note, ctx.user.id);
      else if (reason === 'damage_out') ok = await catalog.changeDamaged(t, pid, { damaged: -qty }, 'damage_out', 'manual', null, note, ctx.user.id);
      else if (reason === 'repair') ok = await catalog.changeDamaged(t, pid, { stock: qty, damaged: -qty }, 'repair', 'manual', null, note, ctx.user.id);
      else await catalog.moveStock(t, pid, ch, reason, 'manual', null, note, ctx.user.id);
      if (!ok) {
        const p = (await t.query('SELECT name, stock, damaged_stock FROM products WHERE id=$1', [pid])).rows[0];
        problems.push(p ? `"${p.name}": ${reason === 'damage' ? `বিক্রির স্টকে আছে ${bn(p.stock)}টি` : `নষ্ট স্টকে আছে ${bn(p.damaged_stock)}টি`}` : `#${pid}`);
        continue;
      }
      touched.push(pid);
      n++;
    }
  });
  if (n) {
    await ctx.log('stock_adjust', 'product', touched.length === 1 ? touched[0] : null, `${n}টি পণ্যের স্টক বদল${note ? ` (${note})` : ''}`);
    require('../services/stockalert').check(ctx.settings, touched).catch(() => {});
  }
  const back = /^\/admin\/inventory(\?[\w=&%.+-]*)?$/.test(String(b.back || '')) ? b.back : '/admin/inventory';
  if (problems.length) return ctx.fail(back, `${bn(n)}টি বদল হয়েছে। এগুলো হয়নি (যথেষ্ট নেই): ${problems.join('; ')}`);
  return ctx.back(back, 'saved');
}

// ---------------------------------------------------------------- suppliers
async function suppliersPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.name)) return ctx.fail('/admin/suppliers', 'সাপ্লায়ারের নাম দিন।');
    const id = await finance.saveSupplier({ ...b, active: b.id ? b.active : true });
    await ctx.log('supplier_save', 'supplier', id, str(b.name, 60));
    return ctx.back(b.id ? `/admin/suppliers/${id}` : '/admin/suppliers', 'saved');
  }
  const rows = await finance.listSuppliers();
  const seeCost = ctx.can('see_cost');
  const totalDue = rows.reduce((s, r) => s + finance.supplierDue(r), 0);
  const body = html`<div class="title-row"><h1>সাপ্লায়ার <small>${bn(rows.length)} জন</small></h1>
  <div class="row-actions">${seeCost ? html`<a class="btn btn-ghost" href="/admin/suppliers/dues">📒 বাকির খাতা</a>` : ''}<a class="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a></div></div>
${ui.flash(ctx.flash)}
${seeCost ? html`<div class="kpis">${ui.kpi('সাপ্লায়ারদের মোট পাওনা', money(totalDue), 'আপনার কাছে তারা যত টাকা পাবে', totalDue > 0 ? 'kpi-alert' : '')}</div>` : ''}
<div class="two-col">
  <section class="panel table-wrap">
    ${rows.length ? html`<table class="table"><thead><tr><th>নাম</th><th>ফোন</th><th class="num">পারচেজ</th>${seeCost ? html`<th class="num">মোট কেনা</th><th class="num">পরিশোধ</th><th class="num">বাকি</th>` : ''}<th>চালু</th><th>কাজ</th></tr></thead>
    <tbody>${rows.map((s) => html`<tr class="${s.active ? '' : 'row-off'}"><td><b>${s.name}</b>${s.company ? html`<br><span class="small muted">${s.company}</span>` : ''}</td>
      <td class="small">${s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a>` : '—'}</td><td class="num">${bn(s.purchase_count)}</td>
      ${seeCost ? html`<td class="num">${money(s.purchased)}</td><td class="num">${money(s.paid)}</td><td class="num ${finance.supplierDue(s) > 0 ? 'warn' : ''}">${money(finance.supplierDue(s))}</td>` : ''}
      <td>${ui.rowSwitch(`/admin/toggle/supplier/${s.id}`, s.active, 'বন্ধ করলে নতুন পারচেজে এই সাপ্লায়ার আসবে না')}</td>${ui.rowActions({ edit: `/admin/suppliers/${s.id}`, editLabel: '✏️ খুলুন / এডিট' })}</tr>`)}</tbody></table>`
    : html`<p class="muted">এখনো কোনো সাপ্লায়ার নেই। পাশের ফর্ম থেকে যোগ করুন।</p>`}
  </section>
  <section class="panel">
    <h2>নতুন সাপ্লায়ার</h2>
    ${supplierForm({})}
  </section>
</div>`;
  return ctx.page('সাপ্লায়ার', body, 'suppliers');
}
function supplierForm(s) {
  return html`<form method="post" action="/admin/suppliers" class="form">
    ${s.id ? html`<input type="hidden" name="id" value="${s.id}">` : ''}
    ${ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 100 }))}
    ${ui.field('প্রতিষ্ঠান / দোকান', ui.input('company', s.company || '', { maxlength: 120 }))}
    <div class="field-row">${ui.field('ফোন', ui.input('phone', s.phone || '', { maxlength: 30 }))}${ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>
    ${ui.field('ঠিকানা', ui.textarea('address', s.address || '', { rows: 2, maxlength: 400 }))}
    ${ui.field('শুরুতে বাকি ছিল (৳)', ui.input('opening_due', s.opening_due || 0, { type: 'number' }), 'এই সফটওয়্যার শুরুর আগে তার কাছে যত টাকা বাকি ছিল')}
    ${ui.field('নোট', ui.textarea('note', s.note || '', { rows: 2, maxlength: 1000 }))}
    ${s.id ? ui.check('active', s.active, 'চালু আছে') : ''}
    <button class="btn">${s.id ? 'সেভ করুন' : 'যোগ করুন'}</button>
  </form>`;
}
async function supplierDetail(ctx, m) {
  const s = await finance.getSupplier(int(m[1]));
  if (!s) return ctx.redirect(ctx.res, '/admin/suppliers');
  const seeCost = ctx.can('see_cost');
  const accounts = await finance.listAccounts();
  const due = finance.supplierDue(s);
  const body = html`<p class="crumbs"><a href="/admin/suppliers">← সব সাপ্লায়ার</a></p>
<div class="title-row"><h1>${s.name}</h1><div class="row-actions">${seeCost ? html`<a class="btn btn-ghost" href="/admin/suppliers/${s.id}/ledger">📒 খাতা (লেজার)</a>` : ''}<a class="btn" href="/admin/purchases/new?supplier=${s.id}">+ এর কাছ থেকে কিনুন</a></div></div>
${ui.flash(ctx.flash)}
${seeCost ? html`<div class="kpis">
  ${ui.kpi('মোট কেনা', money(s.purchased), `${bn(s.purchase_count)}টি পারচেজ`)}
  ${ui.kpi('পরিশোধ করেছেন', money(s.paid), '')}
  ${ui.kpi('বাকি (তাকে দিতে হবে)', money(due), '', due > 0 ? 'kpi-alert' : 'kpi-green')}
</div>` : ''}
<div class="two-col">
  <div>
    <section class="panel"><h2>কোন পণ্য কত দামে কিনেছেন</h2>
      ${s.products.length ? html`<table class="table compact"><thead><tr><th>পণ্য</th><th class="num">মোট পরিমাণ</th>${seeCost ? html`<th class="num">গড় কেনা দাম</th>` : ''}<th>শেষ কেনা</th></tr></thead>
      <tbody>${s.products.map((p) => html`<tr><td>${p.product_id ? html`<a href="/admin/products/${p.product_id}">${p.name}</a>` : p.name}</td><td class="num">${bn(p.qty)}</td>${seeCost ? html`<td class="num">${money(p.avg_cost)}</td>` : ''}<td class="small">${p.last_date ? fmtDate(p.last_date + 'T06:00:00Z', false) : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">এখনো কিছু কেনা হয়নি।</p>`}
    </section>
    <section class="panel"><h2>পারচেজ</h2>${purchasesTable(s.purchases, seeCost)}</section>
    ${seeCost ? html`<section class="panel"><h2>পেমেন্ট</h2>
      ${s.payments.length ? html`<table class="table compact"><tbody>${s.payments.map((t) => html`<tr><td class="small">${fmtDate(t.tx_date + 'T06:00:00Z', false)}</td><td>${t.account_name || '—'}</td><td class="small">${t.note}</td><td class="num">${money(t.amount)}</td></tr>`)}</tbody></table>` : html`<p class="muted">কোনো পেমেন্ট নেই।</p>`}
    </section>` : ''}
  </div>
  <div>
    ${ctx.can('accounting') || seeCost ? html`<section class="panel" id="pay"><h2>সাপ্লায়ারকে টাকা দিন</h2>
      <form method="post" action="/admin/suppliers/${s.id}/pay" class="form">
        <div class="field-row">${ui.field('টাকা', ui.input('amount', due > 0 ? due : '', { type: 'number', min: 1, required: true }))}${ui.field('তারিখ', ui.input('tx_date', ymd(), { type: 'date' }))}</div>
        ${ui.field('কোন অ্যাকাউন্ট থেকে', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`]), ''))}
        ${ui.field('নোট', ui.input('note', '', { maxlength: 200 }))}
        <button class="btn">পেমেন্ট সেভ করুন</button>
      </form></section>` : ''}
    <section class="panel"><h2>তথ্য এডিট</h2>${supplierForm(s)}</section>
  </div>
</div>`;
  return ctx.page(s.name, body, 'suppliers');
}
async function supplierPay(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  try {
    await finance.addTransaction({ type: 'expense', category: 'সাপ্লায়ার পেমেন্ট', amount: b.amount, account_id: b.account_id, supplier_id: id, tx_date: b.tx_date, note: b.note }, ctx.user.id);
  } catch (e) { return ctx.fail(`/admin/suppliers/${id}`, e.message); }
  await ctx.log('supplier_pay', 'supplier', id, `৳${b.amount}`);
  return ctx.back(`/admin/suppliers/${id}`, 'paid');
}

// ---------------------------------------------------------------- purchases
function purchasesTable(rows, seeCost) {
  if (!rows.length) return html`<p class="muted">কোনো পারচেজ নেই।</p>`;
  return html`<div class="table-wrap"><table class="table compact"><thead><tr><th>নম্বর</th><th>তারিখ</th><th>সাপ্লায়ার</th><th class="num">পরিমাণ</th>${seeCost ? html`<th class="num">মোট</th>` : ''}<th>অবস্থা</th></tr></thead>
  <tbody>${rows.map((p) => html`<tr><td><a href="/admin/purchases/${p.id}"><b>${p.code}</b></a></td><td class="small">${fmtDate(p.purchase_date + 'T06:00:00Z', false)}</td>
    <td>${p.supplier_name || '—'}</td><td class="num">${bn(p.units || 0)}</td>${seeCost ? html`<td class="num">${money(p.total)}</td>` : ''}
    <td>${ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</td></tr>`)}</tbody></table></div>`;
}
async function purchasesPage(ctx) {
  const db = require('../db');
  const seeCost = ctx.can('see_cost');
  const [rows, month, suppliers, restock] = await Promise.all([
    finance.listPurchases({}),
    db.one(`SELECT count(*)::int AS n, coalesce(sum(total),0)::numeric(14,2) AS total,
        coalesce((SELECT sum(i.qty) FROM purchase_items i JOIN purchases p2 ON p2.id=i.purchase_id
          WHERE p2.status<>'cancelled' AND date_trunc('month', p2.purchase_date) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date)),0)::int AS units,
        (SELECT count(*) FROM purchases WHERE status='ordered')::int AS waiting
      FROM purchases WHERE status<>'cancelled' AND date_trunc('month', purchase_date) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date)`),
    finance.listSuppliers(),
    // what to buy next: products that are running out, ranked by how fast they sell (last 30 days)
    db.q(`WITH sold AS (SELECT oi.product_id, sum(oi.qty)::int AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
            WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','returned') GROUP BY oi.product_id),
          seen AS (SELECT product_id, count(DISTINCT visitor_id)::int AS n FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY product_id)
        SELECT p.id, p.name, p.sku, p.stock, p.low_stock, p.cost_price, p.image_id, p.emoji, p.unit, coalesce(sold.n,0) AS sold30, coalesce(seen.n,0) AS seen30
        FROM products p LEFT JOIN sold ON sold.product_id=p.id LEFT JOIN seen ON seen.product_id=p.id
        WHERE p.active AND p.product_type='single' AND p.stock <= greatest(p.low_stock, 0)
        ORDER BY coalesce(sold.n,0) DESC, coalesce(seen.n,0) DESC, p.stock ASC LIMIT 12`).catch(() => []),
  ]);
  const totalDue = suppliers.reduce((sum, x) => sum + Math.max(0, finance.supplierDue(x)), 0);
  const suggest = (r) => Math.max(r.low_stock * 2, r.sold30 * 2 - r.stock, 5);
  const body = html`<div class="title-row"><h1>পারচেজ (মাল কেনা)</h1><div class="row-actions"><a class="btn" href="/admin/purchases/new">+ নতুন পারচেজ</a><a class="btn btn-ghost" href="/admin/suppliers">🚚 সাপ্লায়ার</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${seeCost ? ui.kpi('এই মাসে মাল কেনা', money(month.total), `${bn(month.n)}টি পারচেজ · ${bn(month.units)} পিস`, 'kpi-blue') : ui.kpi('এই মাসে পারচেজ', bn(month.n), `${bn(month.units)} পিস`)}
  ${ui.kpi('মাল আসার অপেক্ষায়', bn(month.waiting), 'অর্ডার দেওয়া, এখনো আসেনি', month.waiting ? 'kpi-alert' : '')}
  ${seeCost ? ui.kpi('সাপ্লায়ারদের বাকি', money(totalDue), 'আপনার কাছে তারা পাবে', totalDue > 0 ? 'kpi-alert' : '', '/admin/suppliers') : ''}
  ${ui.kpi('এখনই কেনা দরকার', bn(restock.length), 'স্টক শেষ বা কম', restock.length ? 'kpi-alert' : 'kpi-green', '#restock')}
</div>
${restock.length ? html`<section class="panel table-wrap" id="restock">
  <h2>🧠 কী কিনবেন — স্টক কম, বিক্রি হচ্ছে <small>গত ৩০ দিনের বিক্রি আর কতজন দেখেছে দেখে সাজানো</small></h2>
  <form method="get" action="/admin/purchases/new">
  <table class="table compact restock-table"><thead><tr><th><input type="checkbox" data-check-all aria-label="সব বাছুন"></th><th>ছবি</th><th>পণ্য</th><th class="num">এখন স্টক</th><th class="num">৩০ দিনে বিক্রি</th><th class="num">দেখেছে</th><th class="num">কত কিনবেন (পরামর্শ)</th>${seeCost ? html`<th class="num">শেষ কেনা দাম</th>` : ''}</tr></thead>
  <tbody>${restock.map((r) => html`<tr>
    <td><input type="checkbox" name="add" value="${r.id}" data-check-row checked aria-label="${r.name}"></td>
    <td class="thumb">${r.image_id ? html`<img src="/media/${r.image_id}/t" alt="" loading="lazy">` : html`<span>${r.emoji || '📦'}</span>`}</td>
    <td><b>${r.name}</b>${r.sku ? html`<br><span class="small muted">SKU ${r.sku}</span>` : ''}</td>
    <td class="num ${r.stock <= 0 ? 'bad' : 'warn'}">${bn(r.stock)}</td><td class="num">${bn(r.sold30)}</td><td class="num">${bn(r.seen30)}</td>
    <td class="num"><b>${bn(suggest(r))}</b> <span class="small muted">${r.unit || 'পিস'}</span></td>
    ${seeCost ? html`<td class="num">${r.cost_price ? money(r.cost_price) : '—'}</td>` : ''}</tr>`)}</tbody></table>
  <div class="form-actions"><button class="btn">🛒 বাছাই করা পণ্য দিয়ে পারচেজ শুরু করুন</button><span class="small muted">পারচেজ ফর্মে পণ্যগুলো আগে থেকেই বসানো থাকবে — শুধু পরিমাণ আর দাম মিলিয়ে নিন।</span></div>
  </form>
</section>` : ''}
${ui.helpBox('পারচেজ কেন দরকার? (ধাপে ধাপে)', html`<ol>
  <li>সাপ্লায়ারের কাছ থেকে মাল কিনলে <b>"+ নতুন পারচেজ"</b> চাপুন, সাপ্লায়ার বাছুন (নতুন হলে আগে "সাপ্লায়ার" পেজে যোগ করুন)।</li>
  <li>পণ্য খুঁজে যোগ করুন, পরিমাণ আর <b>প্রতিটার কেনা দাম</b> দিন। প্যাকেটে কিনলে (যেমন ১০০০ পিস ৳২০০) <b>"📦 প্যাকেট দামে"</b> চাপলে প্রতি পিসের দাম নিজে থেকে বের হবে।</li>
  <li>"মাল বুঝে পেয়েছি" বাছলে <b>স্টক নিজে থেকে বাড়বে</b>, পণ্যের কেনা দাম আপডেট হবে, আর লাভের হিসাব ঠিক থাকবে।</li>
  <li>যত টাকা দিয়েছেন তা লিখুন — বাকি থাকলে সাপ্লায়ারের "বাকি" তে জমা থাকবে, পরে পরিশোধ করলে সাপ্লায়ারের পেজ থেকে লিখুন।</li>
</ol>`)}
<section class="panel">${purchasesTable(rows, seeCost)}</section>`;
  return ctx.page('পারচেজ', body, 'purchases');
}
async function purchaseNew(ctx) {
  const [suppliers, accounts] = await Promise.all([finance.listSuppliers({ includeInactive: false }), finance.listAccounts()]);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const pids = list(b.item_id);
    const qtys = list(b.item_qty);
    const costs = list(b.item_cost);
    try {
      const id = await finance.savePurchase({ ...b, items: pids.map((p, i) => ({ product_id: p, qty: qtys[i], unit_cost: costs[i] })) }, ctx.user.id);
      await ctx.log('purchase_add', 'purchase', id, '');
      return ctx.back(`/admin/purchases/${id}`, 'added');
    } catch (e) {
      return ctx.fail('/admin/purchases/new', e.message);
    }
  }
  // started from "কী কিনবেন": those products are put in the form already
  const addIds = [...new Set(list(ctx.query.getAll ? ctx.query.getAll('add') : ctx.query.get('add')).map((x) => int(x)).filter((x) => x > 0))].slice(0, 40);
  const prefill = [];
  for (const id of addIds) {
    const p = await catalog.getProduct({ id }).catch(() => null);
    if (p && p.product_type !== 'bundle') prefill.push({ id: p.id, name: p.name, sku: p.sku, stock: p.stock, price: p.price, cost: ctx.can('see_cost') ? p.cost_price : '' });
  }
  const body = html`<p class="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p>
<h1>নতুন পারচেজ (মাল কেনা)</h1>${ui.flash(ctx.flash)}
${!suppliers.length ? html`<p class="flash">আগে একজন <a href="/admin/suppliers">সাপ্লায়ার যোগ করুন</a> (না করলেও চলবে)।</p>` : ''}
<form method="post" action="/admin/purchases/new" class="form" data-purchase-form data-prefill="${JSON.stringify(prefill)}">
  <div class="two-col">
    <section class="panel">
      <h2>কী কী কিনলেন</h2>
      <div class="item-picker">
        <input type="search" placeholder="পণ্যের নাম বা SKU খুঁজে যোগ করুন…" data-product-search data-all="1" autocomplete="off">
        <ul class="picker-results" data-product-results hidden></ul>
      </div>
      <table class="table item-rows"><thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">প্রতিটার কেনা দাম (৳)</th><th class="num">মোট</th><th></th></tr></thead>
        <tbody data-item-rows data-purchase></tbody></table>
      <p class="muted small" data-no-items>উপরে খুঁজে পণ্য যোগ করুন। নতুন পণ্য হলে আগে <a href="/admin/products/new" target="_blank">পণ্য তৈরি করুন</a>।</p>
      <div class="field-row">
        ${ui.field('ছাড় পেয়েছেন (৳)', ui.input('discount', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('গাড়ি/কুরিয়ার ভাড়া (৳)', ui.input('shipping', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('অন্য খরচ (৳)', ui.input('other_cost', 0, { type: 'number', min: 0, 'data-pc': true }))}
        ${ui.field('ভ্যাট (৳, ঐচ্ছিক)', ui.input('vat', 0, { type: 'number', min: 0, 'data-pc': true }), 'চালানে ভ্যাট থাকলে')}
      </div>
      <div class="order-total">সর্বমোট: <b data-grand>৳০</b></div>
    </section>
    <section class="panel">
      ${ui.field('সাপ্লায়ার', ui.select('supplier_id', [['', 'বাছাই করুন'], ...suppliers.map((s) => [s.id, s.name])], ctx.query.get('supplier') || ''))}
      ${ui.field('তারিখ', ui.input('purchase_date', ymd(), { type: 'date', required: true }))}
      ${ui.field('অবস্থা', ui.select('status', [['received', 'মাল বুঝে পেয়েছি (স্টকে যোগ হবে)'], ['ordered', 'অর্ডার দিয়েছি, মাল এখনো আসেনি']], 'received'))}
      <h2>এখনই কত টাকা দিলেন</h2>
      <div class="field-row">
        ${ui.field('টাকা', ui.input('paid_now', 0, { type: 'number', min: 0 }), 'বাকি থাকলে ০ রাখুন')}
        ${ui.field('অ্যাকাউন্ট', ui.select('account_id', accounts.filter((a) => a.active).map((a) => [a.id, a.name]), ''))}
      </div>
      ${ui.field('নোট / চালান নম্বর', ui.textarea('note', '', { rows: 2, maxlength: 1000 }))}
      <button class="btn btn-lg btn-block">পারচেজ সেভ করুন</button>
    </section>
  </div>
</form>`;
  return ctx.page('নতুন পারচেজ', body, 'purchases');
}
async function purchaseDetail(ctx, m) {
  const p = await finance.getPurchase(int(m[1]));
  if (!p) return ctx.redirect(ctx.res, '/admin/purchases');
  const seeCost = ctx.can('see_cost');
  const body = html`<p class="crumbs"><a href="/admin/purchases">← সব পারচেজ</a></p>
<div class="title-row"><h1>পারচেজ ${p.code} ${ui.pill(finance.PURCHASE_STATUSES[p.status], 'pur-' + p.status)}</h1></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel">
    <table class="table"><thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th>${seeCost ? html`<th class="num">কেনা দাম</th><th class="num">বিক্রি দাম</th><th class="num">লাভ/পিস</th><th class="num">মোট</th>` : ''}</tr></thead>
    <tbody>${p.items.map((i) => html`<tr><td>${i.product_id ? html`<a href="/admin/products/${i.product_id}">${i.name}</a>` : i.name}${i.sku ? html`<br><span class="small muted">${i.sku}</span>` : ''}</td><td class="num">${bn(i.qty)}</td>
      ${seeCost ? html`<td class="num">${money(i.unit_cost)}</td><td class="num">${money(i.sale_price || 0)}</td>
      <td class="num ${i.sale_price - i.unit_cost < 0 ? 'warn' : 'good'}">${money((i.sale_price || 0) - i.unit_cost)}${i.sale_price ? html`<br><span class="small">${pct(((i.sale_price - i.unit_cost) / i.sale_price) * 100)}</span>` : ''}</td>
      <td class="num">${money(i.unit_cost * i.qty)}</td>` : ''}</tr>`)}</tbody>
    ${seeCost ? html`<tfoot><tr><td colspan="5">পণ্যের দাম</td><td class="num">${money(p.subtotal)}</td></tr>
      ${p.discount ? html`<tr><td colspan="5">ছাড়</td><td class="num">− ${money(p.discount)}</td></tr>` : ''}
      ${p.shipping ? html`<tr><td colspan="5">ভাড়া</td><td class="num">${money(p.shipping)}</td></tr>` : ''}
      ${p.other_cost ? html`<tr><td colspan="5">অন্য খরচ</td><td class="num">${money(p.other_cost)}</td></tr>` : ''}
      ${p.vat ? html`<tr><td colspan="5">ভ্যাট</td><td class="num">${money(p.vat)}</td></tr>` : ''}
      <tr class="total"><td colspan="5"><b>সর্বমোট</b></td><td class="num"><b>${money(p.total)}</b></td></tr>
      <tr><td colspan="5">পরিশোধ</td><td class="num">${money(p.paid)}</td></tr>
      <tr><td colspan="5">বাকি</td><td class="num ${p.total - p.paid > 0 ? 'warn' : ''}">${money(p.total - p.paid)}</td></tr></tfoot>` : ''}
    </table>
  </section>
  <section class="panel">
    <p>সাপ্লায়ার: ${p.supplier_id ? html`<a href="/admin/suppliers/${p.supplier_id}">${p.supplier_name}</a>` : '—'}</p>
    <p>তারিখ: ${fmtDate(p.purchase_date + 'T06:00:00Z', false)} · এন্ট্রি দিয়েছেন: ${p.staff_name || '—'}</p>
    ${p.note ? html`<p class="note">${p.note}</p>` : ''}
    ${p.status === 'ordered' ? html`<form method="post" action="/admin/purchases/${p.id}/status"><input type="hidden" name="status" value="received"><button class="btn">✅ মাল বুঝে পেয়েছি (স্টকে যোগ করুন)</button></form>` : ''}
    ${p.status !== 'cancelled' ? html`<form method="post" action="/admin/purchases/${p.id}/status" class="mt" data-confirm="এই পারচেজ বাতিল করবেন? ${p.status === 'received' ? 'যোগ হওয়া স্টক আবার কমে যাবে।' : ''}"><input type="hidden" name="status" value="cancelled"><button class="link-btn danger">পারচেজ বাতিল করুন</button></form>` : ''}
    ${p.supplier_id && p.total - p.paid > 0 ? html`<p class="mt"><a href="/admin/suppliers/${p.supplier_id}">সাপ্লায়ারকে বাকি টাকা দিন →</a></p>` : ''}
  </section>
</div>`;
  return ctx.page(p.code, body, 'purchases');
}
async function purchaseStatus(ctx, m) {
  const b = await ctx.body();
  await finance.setPurchaseStatus(int(m[1]), b.status, ctx.user.id);
  await ctx.log('purchase_status', 'purchase', int(m[1]), b.status);
  return ctx.back(`/admin/purchases/${int(m[1])}`, 'status');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/inventory', perm: 'inventory', handler: inventoryPage },
    { method: 'POST', path: '/admin/inventory/adjust', perm: 'inventory', handler: adjust },
    { method: '*', path: '/admin/suppliers', perm: 'inventory', handler: suppliersPage },
    { method: 'GET', path: /^\/admin\/suppliers\/(\d+)$/, perm: 'inventory', handler: supplierDetail },
    { method: 'POST', path: /^\/admin\/suppliers\/(\d+)\/pay$/, perm: 'inventory', handler: supplierPay },
    { method: 'GET', path: '/admin/purchases', perm: 'inventory', handler: purchasesPage },
    { method: '*', path: '/admin/purchases/new', perm: 'inventory', handler: purchaseNew },
    { method: 'GET', path: /^\/admin\/purchases\/(\d+)$/, perm: 'inventory', handler: purchaseDetail },
    { method: 'POST', path: /^\/admin\/purchases\/(\d+)\/status$/, perm: 'inventory', handler: purchaseStatus },
  ],
};
void raw;

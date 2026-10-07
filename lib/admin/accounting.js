'use strict';
const { html, money, bn, fmtDate, int, str, ymd, dateRange, validYmd, csv, num } = require('../util');
const db = require('../db');
const F = require('../models/finance');
const ui = require('./ui');
const charts = require('./charts');
const { saveKeys } = require('./marketing');

const dd = (d) => fmtDate(String(d).slice(0, 10) + 'T06:00:00Z', false);

async function home(ctx) {
  const today = ymd();
  const monthStart = today.slice(0, 8) + '01';
  const [accounts, pnl, monthly, receivable, suppliers] = await Promise.all([
    F.listAccounts(), F.profitLoss(monthStart, today), F.monthlySeries(6),
    db.one(`SELECT coalesce(sum(total - paid_amount),0)::numeric(14,2) AS cod, count(*)::int AS n FROM orders WHERE status='shipped'`),
    F.listSuppliers(),
  ]);
  const cash = accounts.filter((a) => a.active).reduce((s, a) => s + Number(a.balance), 0);
  const payable = suppliers.reduce((s, x) => s + Math.max(0, F.supplierDue(x)), 0);
  const body = html`<div class="title-row"><h1>হিসাবের সারাংশ</h1>
  <div class="row-actions"><a class="btn" href="/admin/accounts/transactions?new=expense">+ খরচ লিখুন</a><a class="btn btn-ghost" href="/admin/accounts/transactions?new=income">+ আয় লিখুন</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis">
  ${ui.kpi('হাতে + ব্যাংকে মোট টাকা', money(cash), `${bn(accounts.filter((a) => a.active).length)}টি অ্যাকাউন্ট`, 'kpi-blue', '/admin/accounts/banks')}
  ${ui.kpi('কুরিয়ারের কাছে পাওনা (COD)', money(receivable.cod), `${bn(receivable.n)}টি পার্সেল রাস্তায়`, '', '/admin/orders?status=shipped')}
  ${ui.kpi('সাপ্লায়ারদের দিতে হবে', money(payable), '', payable ? 'kpi-alert' : '', '/admin/suppliers')}
  ${ui.kpi('এই মাসের নিট লাভ', money(pnl.net), `বিক্রি ${money(pnl.sales.revenue)} · খরচ ${money(pnl.expenseTotal)}`, pnl.net >= 0 ? 'kpi-green' : 'kpi-red', '/admin/accounts/pnl')}
</div>
<div class="grid-2">
  <section class="panel"><h2>গত ৬ মাস: বিক্রি ও নিট লাভ</h2>
    ${charts.combo(monthly.map((m) => ({ label: bn(m.month.slice(5)) + '/' + bn(m.month.slice(2, 4)), bar: Number(m.sales), line: Number(m.gross) - Number(m.expenses) })), { barName: 'বিক্রি', lineName: 'নিট লাভ', barMoney: true })}</section>
  <section class="panel"><h2>অ্যাকাউন্ট ব্যালেন্স</h2>
    ${charts.hbars(accounts.filter((a) => a.active).map((a) => ({ label: a.name, value: Number(a.balance) })), { isMoney: true, color: -1 })}
    <p><a href="/admin/accounts/banks">অ্যাকাউন্ট যোগ / ট্রান্সফার →</a></p></section>
</div>
<section class="panel"><h2>এই মাসের খরচ</h2>
  ${charts.hbars(pnl.expenses.map((e) => ({ label: e.category, value: Number(e.amount) })), { isMoney: true, color: 4 })}</section>
${ui.helpBox('হিসাব কীভাবে কাজ করে', html`<ul>
  <li><b>বিক্রি ও কেনা দাম</b> অর্ডার থেকে নিজে থেকেই হিসাব হয় (ডেলিভারি হওয়া অর্ডার)। আলাদা করে লিখতে হবে না।</li>
  <li><b>খরচ</b> (ভাড়া, বেতন, বিজ্ঞাপন, প্যাকেজিং…) "আয়-ব্যয় এন্ট্রি" তে লিখুন — তাহলে আসল লাভ বের হবে।</li>
  <li><b>টাকা কোথায় আছে</b> — ক্যাশ, ব্যাংক, বিকাশ, নগদ আলাদা অ্যাকাউন্ট। অর্ডারের পেমেন্ট, কুরিয়ারের COD টাকা, সাপ্লায়ার পেমেন্ট যে অ্যাকাউন্টে যায় সেটা বাছাই করলে ব্যালেন্স মিলে থাকবে।</li>
  <li><b>ভ্যাট</b> — "ভ্যাট ও ট্যাক্স" পেজে আপনার ব্যবসার ধরন অনুযায়ী সেট করুন। চূড়ান্ত রিটার্ন জমার আগে একজন ভ্যাট পরামর্শক/হিসাবরক্ষককে দেখিয়ে নিন।</li></ul>`)}`;
  return ctx.page('হিসাব', body, 'acc-home');
}

async function transactions(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      await F.addTransaction(b, ctx.user.id);
      await ctx.log('tx_add', 'transaction', null, `${b.type} ৳${b.amount} ${str(b.category, 40)}`);
    } catch (e) { return ctx.fail('/admin/accounts/transactions?new=' + (b.type || 'expense'), e.message); }
    return ctx.back('/admin/accounts/transactions', 'added');
  }
  const { from, to } = dateRange(ctx.query, 30);
  const type = ['income', 'expense', 'transfer'].includes(ctx.query.get('type')) ? ctx.query.get('type') : '';
  const accountId = int(ctx.query.get('account')) || null;
  const [rows, accounts] = await Promise.all([F.listTransactions({ from, to, type, accountId, limit: 1000 }), F.listAccounts()]);
  if (ctx.query.get('csv') === '1') {
    const out = [['Date', 'Type', 'Category', 'Amount', 'Account', 'To account', 'VAT', 'Order', 'Purchase', 'Supplier', 'Note', 'By']];
    rows.forEach((t) => out.push([t.tx_date, t.type, t.category, t.amount, t.account_name, t.to_account_name, t.vat, t.order_code, t.purchase_code, t.supplier_name, t.note, t.staff_name]));
    return ctx.send(ctx.res, 200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="transactions-${from}-${to}.csv"` });
  }
  const inc = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const newType = ['income', 'expense', 'transfer'].includes(ctx.query.get('new')) ? ctx.query.get('new') : 'expense';
  const activeAcc = accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`]);
  const body = html`<div class="title-row"><h1>আয়-ব্যয় এন্ট্রি</h1>
  <a class="btn btn-ghost" href="/admin/accounts/transactions?from=${from}&to=${to}${type ? `&type=${type}` : ''}${accountId ? `&account=${accountId}` : ''}&csv=1">⬇ CSV</a></div>
${ui.flash(ctx.flash)}
<div class="two-col">
  <div>
    ${ui.dateFilter('/admin/accounts/transactions', from, to, `${type ? `<input type="hidden" name="type" value="${type}">` : ''}`)}
    <div class="chips">
      <a class="chip ${!type ? 'on' : ''}" href="/admin/accounts/transactions?from=${from}&to=${to}">সব</a>
      <a class="chip ${type === 'income' ? 'on' : ''}" href="/admin/accounts/transactions?from=${from}&to=${to}&type=income">আয় ${money(inc)}</a>
      <a class="chip ${type === 'expense' ? 'on' : ''}" href="/admin/accounts/transactions?from=${from}&to=${to}&type=expense">খরচ ${money(exp)}</a>
      <a class="chip ${type === 'transfer' ? 'on' : ''}" href="/admin/accounts/transactions?from=${from}&to=${to}&type=transfer">ট্রান্সফার</a>
    </div>
    <section class="panel table-wrap">
      ${rows.length ? html`<table class="table"><thead><tr><th>তারিখ</th><th>বিবরণ</th><th>অ্যাকাউন্ট</th><th class="num">টাকা</th><th></th></tr></thead>
      <tbody>${rows.map((t) => html`<tr>
        <td class="small">${dd(t.tx_date)}</td>
        <td><b>${t.category}</b>${t.note ? html`<br><span class="small muted">${t.note}</span>` : ''}
          ${t.order_code ? html`<br><a class="small" href="/admin/orders/${t.order_id}">${t.order_code}</a>` : ''}${t.purchase_code ? html`<br><a class="small" href="/admin/purchases/${t.purchase_id}">${t.purchase_code}</a>` : ''}${t.supplier_name ? html`<br><span class="small">${t.supplier_name}</span>` : ''}</td>
        <td class="small">${t.account_name || '—'}${t.type === 'transfer' ? html` → ${t.to_account_name}` : ''}</td>
        <td class="num ${t.type === 'income' ? 'good' : t.type === 'expense' ? 'warn' : ''}">${t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}${money(t.amount)}${t.vat ? html`<br><span class="small muted">ভ্যাট ${money(t.vat)}</span>` : ''}</td>
        <td><form method="post" action="/admin/accounts/transactions/${t.id}/delete" data-confirm="এই এন্ট্রি মুছবেন?"><button class="link-btn danger small" aria-label="মুছুন">✕</button></form></td></tr>`)}</tbody></table>`
    : html`<p class="muted">এই সময়ে কোনো এন্ট্রি নেই।</p>`}
    </section>
  </div>
  <section class="panel">
    <div class="tabs">${[['expense', '− খরচ'], ['income', '+ আয়'], ['transfer', '⇄ ট্রান্সফার']].map(([k, l]) => html`<a class="tab ${newType === k ? 'on' : ''}" href="/admin/accounts/transactions?new=${k}">${l}</a>`)}</div>
    <form method="post" action="/admin/accounts/transactions" class="form">
      <input type="hidden" name="type" value="${newType}">
      <div class="field-row">${ui.field('টাকা', ui.input('amount', '', { type: 'number', min: 1, required: true, autofocus: true }))}${ui.field('তারিখ', ui.input('tx_date', ymd(), { type: 'date', required: true }))}</div>
      ${newType === 'transfer' ? html`<div class="field-row">${ui.field('কোথা থেকে', ui.select('account_id', activeAcc, ''))}${ui.field('কোথায়', ui.select('to_account_id', activeAcc, activeAcc[1] ? activeAcc[1][0] : ''))}</div>
        <p class="muted small">যেমন বিকাশ থেকে ব্যাংকে টাকা তোলা, বা কুরিয়ারের টাকা ক্যাশ থেকে ব্যাংকে জমা।</p>`
    : html`${ui.field('খাত', html`<input name="category" list="cats" required maxlength="60" placeholder="বাছুন বা লিখুন"><datalist id="cats">${(newType === 'income' ? F.INCOME_CATEGORIES : [...F.EXPENSE_CATEGORIES, 'সাপ্লায়ার পেমেন্ট', 'মালিকের উত্তোলন', 'ঋণ পরিশোধ']).map((c) => html`<option value="${c}">`)}</datalist>`)}
        ${ui.field(newType === 'income' ? 'কোন অ্যাকাউন্টে এলো' : 'কোন অ্যাকাউন্ট থেকে গেলো', ui.select('account_id', activeAcc, ''))}
        ${newType === 'expense' ? ui.field('এর মধ্যে ভ্যাট (৳, ঐচ্ছিক)', ui.input('vat', '', { type: 'number', min: 0 })) : ''}`}
      ${ui.field('নোট', ui.input('note', '', { maxlength: 300 }))}
      <button class="btn btn-block">সেভ করুন</button>
    </form>
    <p class="muted small">"মালিকের উত্তোলন", "সাপ্লায়ার পেমেন্ট", "ঋণ" — এগুলো লাভ-ক্ষতিতে খরচ হিসেবে ধরা হয় না, শুধু ব্যালেন্সে কমে।</p>
  </section>
</div>`;
  return ctx.page('আয়-ব্যয়', body, 'acc-tx');
}
async function deleteTx(ctx, m) {
  await F.deleteTransaction(int(m[1]));
  await ctx.log('tx_delete', 'transaction', int(m[1]), '');
  return ctx.back('/admin/accounts/transactions', 'deleted');
}

async function banks(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.name)) return ctx.fail('/admin/accounts/banks', 'নাম দিন।');
    await F.saveAccount({ ...b, active: int(b.id) ? b.active : true });
    await ctx.log('account_save', 'account', int(b.id) || null, str(b.name, 60));
    return ctx.back('/admin/accounts/banks', 'saved');
  }
  const accounts = await F.listAccounts();
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + Number(a.balance), 0);
  const body = html`<h1>ব্যাংক ও ক্যাশ ব্যালেন্স</h1>${ui.flash(ctx.flash)}
<div class="kpis">${ui.kpi('মোট', money(total), 'সব চালু অ্যাকাউন্ট মিলিয়ে', 'kpi-blue')}</div>
<div class="acc-grid">
  ${accounts.map((a) => html`<form method="post" action="/admin/accounts/banks" class="panel acc-card ${a.active ? '' : 'row-off'}">
    <input type="hidden" name="id" value="${a.id}">
    <p class="acc-bal">${money(a.balance)}</p>
    <div class="field-row">${ui.field('নাম', ui.input('name', a.name, { required: true, maxlength: 80 }))}${ui.field('ধরন', ui.select('type', Object.entries(F.ACCOUNT_TYPES), a.type))}</div>
    ${ui.field('বিবরণ (ব্যাংকের নাম, শাখা…)', ui.input('details', a.details, { maxlength: 300 }))}
    ${ui.field('শুরুর ব্যালেন্স', ui.input('opening_balance', a.opening_balance, { type: 'number' }))}
    ${ui.check('active', a.active, 'চালু')}
    <div class="row-actions"><button class="btn btn-sm btn-ghost">সেভ</button><a class="small" href="/admin/accounts/transactions?account=${a.id}&days=365">লেনদেন দেখুন</a></div>
  </form>`)}
  <form method="post" action="/admin/accounts/banks" class="panel acc-card">
    <h2>নতুন অ্যাকাউন্ট</h2>
    ${ui.field('নাম', ui.input('name', '', { required: true, maxlength: 80, placeholder: 'যেমন: DBBL চলতি হিসাব' }))}
    ${ui.field('ধরন', ui.select('type', Object.entries(F.ACCOUNT_TYPES), 'bank'))}
    ${ui.field('বিবরণ', ui.input('details', '', { maxlength: 300 }))}
    ${ui.field('এখন কত টাকা আছে', ui.input('opening_balance', 0, { type: 'number' }))}
    <button class="btn">যোগ করুন</button>
  </form>
</div>`;
  return ctx.page('ব্যাংক ও ক্যাশ', body, 'acc-banks');
}

async function pnlPage(ctx) {
  const { from, to } = dateRange(ctx.query, 30);
  const p = await F.profitLoss(from, to);
  const s = p.sales;
  const row = (label, v, cls = '') => html`<tr class="${cls}"><td>${label}</td><td class="num">${money(v)}</td></tr>`;
  const body = html`<h1>লাভ-ক্ষতি</h1>
${ui.dateFilter('/admin/accounts/pnl', from, to)}
<div class="two-col">
  <section class="panel">
    <h2>${dd(from)} থেকে ${dd(to)}</h2>
    <table class="lines pnl"><tbody>
      ${row(`পণ্য বিক্রি (${bn(s.orders)}টি ডেলিভারি হওয়া অর্ডার)`, s.goods)}
      ${row('− ছাড়', -s.discount)}
      ${row('+ ডেলিভারি চার্জ আদায়', s.delivery)}
      ${row('মোট আয়', s.revenue, 'sub')}
      ${row('− বিক্রি হওয়া পণ্যের কেনা দাম', -s.cogs)}
      ${row('মোট লাভ (Gross profit)', p.gross, 'sub')}
      ${p.otherIncome.map((e) => row('+ ' + e.category, e.amount))}
      ${p.expenses.map((e) => row('− ' + e.category, -e.amount))}
      ${row('নিট লাভ (Net profit)', p.net, 'total ' + (p.net >= 0 ? 'good' : 'warn'))}
    </tbody></table>
    ${Number(s.revenue) ? html`<p class="muted small">লাভের হার: ${bn(((p.net / Number(s.revenue)) * 100).toFixed(1))}% · ফেরত আসা অর্ডার: ${bn(p.returns)}টি</p>` : ''}
    <p class="muted small">টীকা: কুরিয়ারের ডেলিভারি চার্জ যদি "কুরিয়ার চার্জ" খাতে খরচ হিসেবে লেখেন, তাহলে এখানে সঠিক লাভ আসবে।</p>
  </section>
  <section class="panel">
    <h2>শুধু টাকার আসা-যাওয়া (লাভ-ক্ষতিতে ধরা হয়নি)</h2>
    <table class="lines"><tbody>
      ${p.movements.income.map((e) => row('+ ' + e.category, e.amount))}
      ${p.movements.expense.map((e) => row('− ' + e.category, -e.amount))}
    </tbody></table>
    ${!p.movements.income.length && !p.movements.expense.length ? html`<p class="muted">নেই।</p>` : ''}
  </section>
</div>`;
  return ctx.page('লাভ-ক্ষতি', body, 'acc-pnl');
}

async function vatPage(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!['none', 'inclusive', 'exclusive', 'margin'].includes(b.vat_mode)) b.vat_mode = 'none';
    b.vat_rate = String(Math.min(100, Math.max(0, num(b.vat_rate, 15))));
    await saveKeys(ctx, ['vat_mode', 'vat_rate', 'vat_bin', 'tin', 'trade_license'], b);
    await ctx.log('settings', 'accounting', null, 'ভ্যাট সেটিংস');
    return ctx.back('/admin/accounts/vat', 'saved');
  }
  const year = int(ctx.query.get('year')) || Number(ymd().slice(0, 4));
  const s = ctx.settings;
  const r = await F.vatReport(s, year);
  const tot = r.months.reduce((a, m) => ({ goods: a.goods + m.goods, output: a.output + m.output, input: a.input + m.input, payable: a.payable + m.payable, paid: a.paid + m.paid }), { goods: 0, output: 0, input: 0, payable: 0, paid: 0 });
  const body = html`<h1>ভ্যাট ও ট্যাক্স</h1>${ui.flash(ctx.flash)}
<div class="two-col">
  <section class="panel">
    <div class="title-row"><h2>${bn(year)} সালের মাসিক ভ্যাট হিসাব</h2>
      <span><a href="?year=${year - 1}">← ${bn(year - 1)}</a> ${year < Number(ymd().slice(0, 4)) ? html`· <a href="?year=${year + 1}">${bn(year + 1)} →</a>` : ''}</span></div>
    ${r.mode === 'none' ? html`<p class="flash">ভ্যাট হিসাব বন্ধ আছে। পাশে আপনার ভ্যাট নিবন্ধনের ধরন বাছাই করুন।</p>` : ''}
    <div class="table-wrap"><table class="table compact"><thead><tr><th>মাস</th><th class="num">অর্ডার</th><th class="num">বিক্রি</th><th class="num">আউটপুট ভ্যাট</th><th class="num">ইনপুট ভ্যাট</th><th class="num">দিতে হবে</th><th class="num">দেওয়া হয়েছে</th></tr></thead>
    <tbody>${r.months.map((m) => html`<tr><td>${bn(m.month)}</td><td class="num">${bn(m.orders)}</td><td class="num">${money(m.goods)}</td><td class="num">${money(m.output)}</td>
      <td class="num">${money(m.input)}</td><td class="num"><b>${money(m.payable)}</b></td><td class="num">${money(m.paid)}</td></tr>`)}</tbody>
    <tfoot><tr class="total"><td>মোট</td><td></td><td class="num">${money(tot.goods)}</td><td class="num">${money(tot.output)}</td><td class="num">${money(tot.input)}</td><td class="num"><b>${money(tot.payable)}</b></td><td class="num">${money(tot.paid)}</td></tr></tfoot></table></div>
    <p class="muted small">বিক্রি = ডেলিভারি হওয়া অর্ডারের পণ্যমূল্য (ছাড় বাদে, ডেলিভারি চার্জ ছাড়া)। ইনপুট ভ্যাট = পারচেজে যে ভ্যাট লিখেছেন। ভ্যাট জমা দিলে "আয়-ব্যয়" এ <b>ভ্যাট/ট্যাক্স পরিশোধ</b> খাতে লিখুন।</p>
  </section>
  <section class="panel">
    <h2>আপনার ভ্যাট সেটিংস</h2>
    <form method="post" action="/admin/accounts/vat" class="form">
      ${ui.field('ভ্যাট কীভাবে হিসাব হবে', ui.select('vat_mode', [
    ['none', 'ভ্যাট হিসাব করব না'], ['inclusive', 'পণ্যের দামের মধ্যেই ভ্যাট ধরা আছে'], ['exclusive', 'পণ্যের দামের উপর আলাদা ভ্যাট'], ['margin', 'শুধু লাভের (মার্জিন) উপর ভ্যাট']], s.vat_mode))}
      ${ui.field('ভ্যাটের হার (%)', ui.input('vat_rate', s.vat_rate, { type: 'number', step: '0.5', min: 0, max: 100 }))}
      ${ui.field('BIN (ভ্যাট নিবন্ধন নম্বর)', ui.input('vat_bin', s.vat_bin, { maxlength: 30 }))}
      ${ui.field('TIN (ই-টিআইএন)', ui.input('tin', s.tin, { maxlength: 30 }))}
      ${ui.field('ট্রেড লাইসেন্স নম্বর', ui.input('trade_license', s.trade_license, { maxlength: 40 }))}
      <button class="btn">সেভ করুন</button>
    </form>
    ${ui.helpBox('বাংলাদেশে ভ্যাট সম্পর্কে সাধারণ তথ্য', html`<ul>
      <li>সাধারণ ভ্যাট হার ১৫%। তবে ব্যবসার ধরন আর বার্ষিক বিক্রি (টার্নওভার) অনুযায়ী টার্নওভার ট্যাক্স বা হ্রাসকৃত হার প্রযোজ্য হতে পারে।</li>
      <li>FY2025-26 বাজেটে অনলাইনে পণ্য বিক্রির কমিশন/মার্জিনের উপর ভ্যাট ৫% থেকে বাড়িয়ে ১৫% করা হয়েছে — তাই অনেক অনলাইন বিক্রেতার জন্য "শুধু লাভের উপর" অপশনটা প্রাসঙ্গিক।</li>
      <li>মাসিক রিটার্ন (মূসক-৯.১) সাধারণত পরের মাসের ১৫ তারিখের মধ্যে জমা দিতে হয়।</li>
      <li>⚠️ নিয়ম প্রায়ই বদলায়। এই হিসাব আপনার সুবিধার জন্য; রিটার্ন জমার আগে একজন ভ্যাট পরামর্শক/হিসাবরক্ষকের সাথে মিলিয়ে নিন।</li></ul>`)}
  </section>
</div>`;
  return ctx.page('ভ্যাট ও ট্যাক্স', body, 'acc-vat');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/accounts', perm: 'accounting', handler: home },
    { method: '*', path: '/admin/accounts/transactions', perm: 'accounting', handler: transactions },
    { method: 'POST', path: /^\/admin\/accounts\/transactions\/(\d+)\/delete$/, perm: 'accounting', handler: deleteTx },
    { method: '*', path: '/admin/accounts/banks', perm: 'accounting', handler: banks },
    { method: 'GET', path: '/admin/accounts/pnl', perm: 'accounting', handler: pnlPage },
    { method: '*', path: '/admin/accounts/vat', perm: 'accounting', handler: vatPage },
  ],
};
void validYmd;

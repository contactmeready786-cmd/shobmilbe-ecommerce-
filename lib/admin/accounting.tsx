import { Val, attrValue, jsxList } from '../react/html';
import { money, bn, fmtDate, int, str, ymd, dateRange, validYmd, csv, num, oneOf } from '../util';
import * as db from '../db';
import * as F from '../models/finance';
import * as ui from './ui';
import * as charts from './charts';
import { saveKeys } from './marketing';
import * as $vat from './vat';
import type { AdminCtx, RouteMatch, Caught } from '../types';
import type { TransactionsRow } from '../data/rows';

const dd = (d: string) => fmtDate(String(d).slice(0, 10) + 'T06:00:00Z', false);

async function home(ctx: AdminCtx) {
  const today = ymd();
  const monthStart = today.slice(0, 8) + '01';
  const [accounts, pnl, monthly, receivable, suppliers] = await Promise.all([
    F.listAccounts(), F.profitLoss(monthStart, today), F.monthlySeries(6),
    db.one<{ cod: number; n: number }>(`SELECT coalesce(sum(total - paid_amount),0)::numeric(14,2) AS cod, count(*)::int AS n FROM orders WHERE status='shipped'`),
    F.listSuppliers(),
  ]);
  const cash = accounts.filter((a) => a.active).reduce((s, a) => s + Number(a.balance), 0);
  const payable = suppliers.reduce((s, x) => s + Math.max(0, F.supplierDue(x)), 0);
  // ---- live checklist: what the books still need, worked out from the shop's own data
  const owner = ctx.can('see_cost');
  const [noCost, monthCats, txCount, unpaidDelivered] = await Promise.all([
    owner ? db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE active AND product_type='single' AND coalesce(cost_price,0)=0`).catch(() => ({ n: 0 })) : { n: 0 },
    db.q<Pick<TransactionsRow, 'category'>>(`SELECT DISTINCT category FROM transactions WHERE type='expense' AND tx_date >= $1`, [monthStart]).catch(() => []),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM transactions`).catch(() => ({ n: 0 })),
    db.one<{ n: number; due: number }>(`SELECT count(*)::int AS n, coalesce(sum(total - paid_amount),0)::numeric(14,2) AS due FROM orders WHERE status='delivered' AND total - paid_amount > 0`).catch(() => ({ n: 0, due: 0 })),
  ]);
  const haveCat = new Set(monthCats.map((r) => r.category));
  const MONTHLY = [['দোকান/অফিস ভাড়া', '🏠'], ['স্টাফ বেতন', '👥'], ['ফেসবুক/গুগল বিজ্ঞাপন', '📣'], ['প্যাকেজিং খরচ', '📦'], ['কুরিয়ার চার্জ', '🛵'], ['ইন্টারনেট ও মোবাইল', '📶'], ['বিদ্যুৎ ও পানি', '💡']];
  /** [icon, what, why, link] */
  type Todo = [string, string, string, string];
  const todo = ([
    !txCount!.n && cash === 0 ? ['🏦', 'শুরুর টাকা লিখুন', 'ক্যাশ, ব্যাংক, বিকাশ, নগদে এখন কত টাকা আছে — "ব্যাংক ও ক্যাশ ব্যালেন্স" পেজে শুরুর ব্যালেন্স দিন। তাহলে সব হিসাব মিলবে।', '/admin/accounts/banks'] : null,
    Number(receivable!.cod) > 0 ? ['🛵', `কুরিয়ারের কাছে ${money(receivable!.cod)} পাওনা`, 'কুরিয়ার টাকা পাঠালে "আয় লিখুন" → খাত "কুরিয়ার থেকে COD টাকা" দিন, যে অ্যাকাউন্টে টাকা এসেছে সেটা বাছুন।', '/admin/accounts/transactions?new=income&cat=' + encodeURIComponent('কুরিয়ার থেকে COD টাকা')] : null,
    unpaidDelivered!.n ? ['🧾', `${bn(unpaidDelivered!.n)}টি ডেলিভারি হওয়া অর্ডারের টাকা এখনো "পেয়েছি" করা হয়নি (${money(unpaidDelivered!.due)})`, 'অর্ডার খুলে "পেমেন্ট রেকর্ড" করুন — তাহলে কোন অর্ডারের টাকা হাতে এসেছে বোঝা যাবে।', '/admin/orders?status=delivered'] : null,
    payable > 0 ? ['🚚', `সাপ্লায়ারদের ${money(payable)} বাকি`, 'পরিশোধ করলে সাপ্লায়ারের পেজ থেকে "পেমেন্ট দিন" — বাকি আর ক্যাশ দুটোই ঠিক থাকবে।', '/admin/suppliers'] : null,
    ctx.settings.vat_mode && ctx.settings.vat_mode !== 'none' && Number(today.slice(8, 10)) <= 15 ? ['🧾', `${ctx.settings.vat_mode === 'turnover' ? 'টার্নওভার ট্যাক্স' : 'মূসক-৯.১ ভ্যাট'} রিটার্ন — শেষ দিন ${bn(15)} তারিখ (আর ${bn(15 - Number(today.slice(8, 10)))} দিন)`, 'গত মাসের হিসাব তৈরি আছে — কোন ঘরে কত বসবে দেখে vat.gov.bd-তে জমা দিন।', '/admin/accounts/vat/return'] : null,
    noCost!.n ? ['⚠️', `${bn(noCost!.n)}টি পণ্যের কেনা দাম দেওয়া নেই`, 'কেনা দাম ছাড়া লাভের হিসাব বেশি দেখাবে। পারচেজ এন্ট্রি দিলে, বা পণ্যের "📒 কেনার ইতিহাস" পেজে কারণসহ কেনা দাম বসালে ঠিক হবে।', '/admin/products'] : null,
  ] as (Todo | null | false | 0)[]).filter((x): x is Todo => !!x);
  const missing = MONTHLY.filter(([c]) => !haveCat.has(c));
  const body = <><div className="title-row"><h1>হিসাবের সারাংশ</h1><div className="row-actions"><a className="btn" href="/admin/accounts/transactions?new=expense">+ খরচ লিখুন</a><a className="btn btn-ghost" href="/admin/accounts/transactions?new=income">+ আয় লিখুন</a></div></div>{ui.flash(ctx.flash)}<div className="kpis">{ui.kpi('হাতে + ব্যাংকে মোট টাকা', money(cash), `${bn(accounts.filter((a) => a.active).length)}টি অ্যাকাউন্ট`, 'kpi-blue', '/admin/accounts/banks')}{' '}{ui.kpi('কুরিয়ারের কাছে পাওনা (COD)', money(receivable!.cod), `${bn(receivable!.n)}টি পার্সেল রাস্তায়`, '', '/admin/orders?status=shipped')}{' '}{ui.kpi('সাপ্লায়ারদের দিতে হবে', money(payable), '', payable ? 'kpi-alert' : '', '/admin/suppliers')}{' '}{(ctx.can('see_cost') ? ui.kpi('এই মাসের নিট লাভ', money(pnl.net), `বিক্রি ${money(pnl.sales!.revenue)} · খরচ ${money(pnl.expenseTotal)}`, pnl.net >= 0 ? 'kpi-green' : 'kpi-red', '/admin/accounts/pnl') : null)}</div><section className="panel acc-todo"><h2>🧾 হিসাবের কাজ{' '}<small>আপনার দোকানের এখনকার তথ্য দেখে — সব শেষ হলে হিসাব ১০০% মিলবে</small></h2>{(todo.length ? <ul className="lg-list">{jsxList(todo.map(([ic, t, d, link]) => <li className="lg-warm"><span className="lg-ic"><Val v={ic} /></span><div><b><a href={attrValue(link)}><Val v={t} /></a></b><small><Val v={d} /></small></div></li>))}</ul> : <p className="good">✅ এখন হিসাবে বাকি কিছু নেই।</p>)}<h3 className="h3">এই মাসের খরচ — এক চাপে লিখুন{' '}{(missing.length ? <small className="muted">({bn(missing.length)}টি খাত এই মাসে এখনো লেখা হয়নি)</small> : <small className="good">✓ নিয়মিত খরচগুলো লেখা হয়েছে</small>)}</h3><div className="chips acc-quick">{jsxList(MONTHLY.map(([c, ic]) => <a className={`chip ${haveCat.has(c) ? 'on' : ''}`} href={`/admin/accounts/transactions?new=expense&cat=${attrValue(encodeURIComponent(c))}`}><Val v={ic} />{' '}<Val v={c} />{(haveCat.has(c) ? " ✓" : null)}</a>))}<a className="chip" href="/admin/accounts/transactions?new=expense">➕ অন্য খরচ</a></div><p className="small muted">বিক্রি, কেনা দাম আর লাভ অর্ডার থেকে নিজে থেকেই হিসাব হয়; পারচেজ দিলে স্টক আর সাপ্লায়ারের বাকি নিজে থেকেই বসে। শুধু খরচ আর টাকা জমা/তোলা আপনাকে লিখতে হবে।</p></section><div className="grid-2">{(ctx.can('see_cost') ? <section className="panel"><h2>গত ৬ মাস: বিক্রি ও নিট লাভ</h2>{charts.combo(monthly.map((m) => ({ label: bn(m.month.slice(5)) + '/' + bn(m.month.slice(2, 4)), bar: Number(m.sales), line: Number(m.gross) - Number(m.expenses) })), { barName: 'বিক্রি', lineName: 'নিট লাভ', barMoney: true })}</section> : null)}<section className="panel"><h2>অ্যাকাউন্ট ব্যালেন্স</h2>{charts.hbars(accounts.filter((a) => a.active).map((a) => ({ label: a.name, value: Number(a.balance) })), { isMoney: true, color: -1 })}<p><a href="/admin/accounts/banks">অ্যাকাউন্ট যোগ / ট্রান্সফার →</a></p></section></div><section className="panel"><h2>এই মাসের খরচ</h2>{charts.hbars(pnl.expenses.map((e) => ({ label: e.category, value: Number(e.amount) })), { isMoney: true, color: 4 })}</section>{ui.helpBox('হিসাব কীভাবে কাজ করে', <ul><li><b>বিক্রি ও কেনা দাম</b>{' '}অর্ডার থেকে নিজে থেকেই হিসাব হয় (ডেলিভারি হওয়া অর্ডার)। আলাদা করে লিখতে হবে না।</li><li><b>খরচ</b>{' '}(ভাড়া, বেতন, বিজ্ঞাপন, প্যাকেজিং…) "আয়-ব্যয় এন্ট্রি" তে লিখুন — তাহলে আসল লাভ বের হবে।</li><li><b>টাকা কোথায় আছে</b>{' '}— ক্যাশ, ব্যাংক, বিকাশ, নগদ আলাদা অ্যাকাউন্ট। অর্ডারের পেমেন্ট, কুরিয়ারের COD টাকা, সাপ্লায়ার পেমেন্ট যে অ্যাকাউন্টে যায় সেটা বাছাই করলে ব্যালেন্স মিলে থাকবে।</li><li><b>ভ্যাট</b>{' '}— "ভ্যাট ও ট্যাক্স" পেজে আপনার ব্যবসার ধরন অনুযায়ী সেট করুন। চূড়ান্ত রিটার্ন জমার আগে একজন ভ্যাট পরামর্শক/হিসাবরক্ষককে দেখিয়ে নিন।</li></ul>)}</>;
  return ctx.page('হিসাব', body, 'acc-home');
}

async function transactions(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      await F.addTransaction(b, ctx.user.id);
      await ctx.log('tx_add', 'transaction', null, `${b.type} ৳${b.amount} ${str(b.category, 40)}`);
    } catch (caught) { const e = caught as Caught; return ctx.fail('/admin/accounts/transactions?new=' + (b.type || 'expense'), e.message); }
    return ctx.back('/admin/accounts/transactions', 'added');
  }
  const { from, to } = dateRange(ctx.query, 30);
  const type = oneOf(['income', 'expense', 'transfer'], ctx.query.get('type'), '');
  const accountId = int(ctx.query.get('account')) || null;
  const [rows, accounts] = await Promise.all([F.listTransactions({ from, to, type, accountId, limit: 1000 }), F.listAccounts()]);
  if (ctx.query.get('csv') === '1') {
    const out: unknown[][] = [['Date', 'Type', 'Category', 'Amount', 'Account', 'To account', 'VAT', 'Order', 'Purchase', 'Supplier', 'Note', 'By']];
    rows.forEach((t) => out.push([t.tx_date, t.type, t.category, t.amount, t.account_name, t.to_account_name, t.vat, t.order_code, t.purchase_code, t.supplier_name, t.note, t.staff_name]));
    return ctx.send(200, csv(out), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="transactions-${from}-${to}.csv"` });
  }
  const inc = rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp = rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const newType = oneOf(['income', 'expense', 'transfer'], ctx.query.get('new'), 'expense');
  const activeAcc = accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`]);
  const body = <><div className="title-row"><h1>আয়-ব্যয় এন্ট্রি</h1><a className="btn btn-ghost" href={`/admin/accounts/transactions?from=${attrValue(from)}&to=${attrValue(to)}${type ? `&type=${type}` : ''}${accountId ? `&account=${accountId}` : ''}&csv=1`}>⬇ CSV</a></div>{ui.flash(ctx.flash)}<div className="two-col"><div>{ui.dateFilter('/admin/accounts/transactions', from, to, `${type ? `<input type="hidden" name="type" value="${type}">` : ''}`)}<div className="chips"><a className={`chip ${!type ? 'on' : ''}`} href={`/admin/accounts/transactions?from=${attrValue(from)}&to=${attrValue(to)}`}>সব</a>{' '}<a className={`chip ${type === 'income' ? 'on' : ''}`} href={`/admin/accounts/transactions?from=${attrValue(from)}&to=${attrValue(to)}&type=income`}>আয়{' '}{money(inc)}</a>{' '}<a className={`chip ${type === 'expense' ? 'on' : ''}`} href={`/admin/accounts/transactions?from=${attrValue(from)}&to=${attrValue(to)}&type=expense`}>খরচ{' '}{money(exp)}</a>{' '}<a className={`chip ${type === 'transfer' ? 'on' : ''}`} href={`/admin/accounts/transactions?from=${attrValue(from)}&to=${attrValue(to)}&type=transfer`}>ট্রান্সফার</a></div><section className="panel table-wrap">{(rows.length ? <table className="table"><thead><tr><th>তারিখ</th><th>বিবরণ</th><th>অ্যাকাউন্ট</th><th className="num">টাকা</th><th>মুছুন</th></tr></thead><tbody>{jsxList(rows.map((t) => <tr><td className="small"><Val v={dd(t.tx_date)} /></td><td><b><Val v={t.category} /></b>{(t.note ? <><br /><span className="small muted"><Val v={t.note} /></span></> : null)}{' '}{(t.order_code ? <><br /><a className="small" href={`/admin/orders/${attrValue(t.order_id)}`}><Val v={t.order_code} /></a></> : null)}{(t.purchase_code ? <><br /><a className="small" href={`/admin/purchases/${attrValue(t.purchase_id)}`}><Val v={t.purchase_code} /></a></> : null)}{(t.supplier_name ? <><br /><span className="small"><Val v={t.supplier_name} /></span></> : null)}</td><td className="small"><Val v={t.account_name || '—'} />{(t.type === 'transfer' ? <>{' '}→{' '}<Val v={t.to_account_name} /></> : null)}</td><td className={`num ${t.type === 'income' ? 'good' : t.type === 'expense' ? 'warn' : ''}`}>{(t.type === 'expense' ? "−" : (t.type === 'income' ? "+" : null))}{money(t.amount)}{(t.vat ? <><br /><span className="small muted">ভ্যাট{' '}{money(t.vat)}</span></> : null)}</td><td className="prod-actions"><form method="post" action={`/admin/accounts/transactions/${attrValue(t.id)}/delete`} data-confirm="এই এন্ট্রি মুছবেন? রিসাইকেল বিনে থাকবে।"><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>))}</tbody></table> : <p className="muted">এই সময়ে কোনো এন্ট্রি নেই।</p>)}</section></div><section className="panel"><div className="tabs">{jsxList([['expense', '− খরচ'], ['income', '+ আয়'], ['transfer', '⇄ ট্রান্সফার']].map(([k, l]) => <a className={`tab ${newType === k ? 'on' : ''}`} href={`/admin/accounts/transactions?new=${attrValue(k)}`}><Val v={l} /></a>))}</div><form method="post" action="/admin/accounts/transactions" className="form"><input type="hidden" name="type" defaultValue={attrValue(newType)} /><div className="field-row">{ui.field('টাকা', ui.input('amount', '', { type: 'number', min: 1, required: true, autofocus: true }))}{ui.field('তারিখ', ui.input('tx_date', ymd(), { type: 'date', required: true }))}</div>{(newType === 'transfer' ? <><div className="field-row">{ui.field('কোথা থেকে', ui.select('account_id', activeAcc, ''))}{ui.field('কোথায়', ui.select('to_account_id', activeAcc, activeAcc[1] ? activeAcc[1][0] : ''))}</div><p className="muted small">যেমন বিকাশ থেকে ব্যাংকে টাকা তোলা, বা কুরিয়ারের টাকা ক্যাশ থেকে ব্যাংকে জমা।</p></> : <>{ui.field('খাত', <><input name="category" list="cats" required maxLength={60} placeholder="বাছুন বা লিখুন" defaultValue={str(ctx.query.get('cat'), 60)} /><datalist id="cats">{jsxList((newType === 'income' ? F.INCOME_CATEGORIES : [...F.EXPENSE_CATEGORIES, 'সাপ্লায়ার পেমেন্ট', 'মালিকের উত্তোলন', 'ঋণ পরিশোধ']).map((c) => <option value={attrValue(c)}></option>))}</datalist></>)}{' '}{ui.field(newType === 'income' ? 'কোন অ্যাকাউন্টে এলো' : 'কোন অ্যাকাউন্ট থেকে গেলো', ui.select('account_id', activeAcc, ''))}{' '}{(newType === 'expense' ? ui.field('এর মধ্যে ভ্যাট (৳, ঐচ্ছিক)', ui.input('vat', '', { type: 'number', min: 0 })) : null)}</>)}{' '}{ui.field('নোট', ui.input('note', '', { maxlength: 300 }))}{' '}<button className="btn btn-block">সেভ করুন</button></form><p className="muted small">"মালিকের উত্তোলন", "সাপ্লায়ার পেমেন্ট", "ঋণ" — এগুলো লাভ-ক্ষতিতে খরচ হিসেবে ধরা হয় না, শুধু ব্যালেন্সে কমে।</p></section></div></>;
  return ctx.page('আয়-ব্যয়', body, 'acc-tx');
}
async function deleteTx(ctx: AdminCtx, m: RouteMatch) {
  await ctx.trash('transaction', int(m[1]));
  await ctx.log('tx_delete', 'transaction', int(m[1]), '');
  return ctx.back('/admin/accounts/transactions', 'deleted');
}

async function banks(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.name)) return ctx.fail('/admin/accounts/banks', 'নাম দিন।');
    await F.saveAccount({ ...b, active: int(b.id) ? b.active : true });
    await ctx.log('account_save', 'account', int(b.id) || null, str(b.name, 60));
    return ctx.back('/admin/accounts/banks', 'saved');
  }
  const accounts = await F.listAccounts();
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + Number(a.balance), 0);
  const body = <><h1>ব্যাংক ও ক্যাশ ব্যালেন্স</h1>{ui.flash(ctx.flash)}<div className="kpis">{ui.kpi('মোট', money(total), 'সব চালু অ্যাকাউন্ট মিলিয়ে', 'kpi-blue')}</div><div className="acc-grid">{jsxList(accounts.map((a) => <form method="post" action="/admin/accounts/banks" className={`panel acc-card ${a.active ? '' : 'row-off'}`}><input type="hidden" name="id" defaultValue={attrValue(a.id)} /><p className="acc-bal">{money(a.balance)}</p><div className="field-row">{ui.field('নাম', ui.input('name', a.name, { required: true, maxlength: 80 }))}{ui.field('ধরন', ui.select('type', Object.entries(F.ACCOUNT_TYPES), a.type))}</div>{ui.field('বিবরণ (ব্যাংকের নাম, শাখা…)', ui.input('details', a.details, { maxlength: 300 }))}{' '}{ui.field('শুরুর ব্যালেন্স', ui.input('opening_balance', a.opening_balance, { type: 'number' }))}{' '}{ui.check('active', a.active, 'চালু')}<div className="row-actions"><button className="btn btn-sm btn-ghost">সেভ</button><a className="small" href={`/admin/accounts/transactions?account=${attrValue(a.id)}&days=365`}>লেনদেন দেখুন</a></div></form>))}<form method="post" action="/admin/accounts/banks" className="panel acc-card"><h2>নতুন অ্যাকাউন্ট</h2>{ui.field('নাম', ui.input('name', '', { required: true, maxlength: 80, placeholder: 'যেমন: DBBL চলতি হিসাব' }))}{' '}{ui.field('ধরন', ui.select('type', Object.entries(F.ACCOUNT_TYPES), 'bank'))}{' '}{ui.field('বিবরণ', ui.input('details', '', { maxlength: 300 }))}{' '}{ui.field('এখন কত টাকা আছে', ui.input('opening_balance', 0, { type: 'number' }))}{' '}<button className="btn">যোগ করুন</button></form></div></>;
  return ctx.page('ব্যাংক ও ক্যাশ', body, 'acc-banks');
}

async function pnlPage(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 30);
  const p = await F.profitLoss(from, to);
  const s = p.sales;
  const row = (label?: unknown, v?: unknown, cls = '') => <tr className={attrValue(cls)}><td><Val v={label} /></td><td className="num">{money(v)}</td></tr>;
  const body = <><h1>লাভ-ক্ষতি</h1>{ui.dateFilter('/admin/accounts/pnl', from, to)}<div className="two-col"><section className="panel"><h2><Val v={dd(from)} />{' '}থেকে{' '}<Val v={dd(to)} /></h2><table className="lines pnl"><tbody>{row(`পণ্য বিক্রি (${bn(s!.orders)}টি ডেলিভারি হওয়া অর্ডার)`, s!.goods)}{' '}{row('− ছাড়', -s!.discount)}{' '}{row('+ ডেলিভারি চার্জ আদায়', s!.delivery)}{' '}{row('মোট আয়', s!.revenue, 'sub')}{' '}{row('− বিক্রি হওয়া পণ্যের কেনা দাম', -s!.cogs)}{' '}{row('মোট লাভ (Gross profit)', p.gross, 'sub')}{' '}<Val v={p.otherIncome.map((e) => row('+ ' + e.category, e.amount))} />{' '}<Val v={p.expenses.map((e) => row('− ' + e.category, -e.amount))} />{' '}{row('নিট লাভ (Net profit)', p.net, 'total ' + (p.net >= 0 ? 'good' : 'warn'))}</tbody></table>{(Number(s!.revenue) ? <p className="muted small">লাভের হার:{' '}{bn(((p.net / Number(s!.revenue)) * 100).toFixed(1))}% · ফেরত আসা অর্ডার:{' '}{bn(p.returns)}টি</p> : null)}<p className="muted small">টীকা: কুরিয়ারের ডেলিভারি চার্জ যদি "কুরিয়ার চার্জ" খাতে খরচ হিসেবে লেখেন, তাহলে এখানে সঠিক লাভ আসবে।</p></section><section className="panel"><h2>শুধু টাকার আসা-যাওয়া (লাভ-ক্ষতিতে ধরা হয়নি)</h2><table className="lines"><tbody><Val v={p.movements.income.map((e) => row('+ ' + e.category, e.amount))} />{' '}<Val v={p.movements.expense.map((e) => row('− ' + e.category, -e.amount))} /></tbody></table>{(!p.movements.income.length && !p.movements.expense.length ? <p className="muted">নেই।</p> : null)}</section></div></>;
  return ctx.page('লাভ-ক্ষতি', body, 'acc-pnl');
}

async function vatPage(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'vat_mode'>();
    if (!['none', 'turnover', 'inclusive', 'exclusive', 'margin'].includes(b.vat_mode ?? '')) b.vat_mode = 'none';
    b.vat_turnover_rate = String(Math.min(100, Math.max(0, num(b.vat_turnover_rate, 4))));
    b.vat_rate = String(Math.min(100, Math.max(0, num(b.vat_rate, 15))));
    await saveKeys(ctx, ['vat_mode', 'vat_rate', 'vat_turnover_rate', 'vat_bin', 'tin', 'trade_license'], b);
    await ctx.log('settings', 'accounting', null, 'ভ্যাট সেটিংস');
    return ctx.back('/admin/accounts/vat', 'saved');
  }
  const year = int(ctx.query.get('year')) || Number(ymd().slice(0, 4));
  const s = ctx.settings;
  const r = await F.vatReport(s, year);
  const tot = r.months.reduce((a, m) => ({ goods: a.goods + m.goods, output: a.output + m.output, input: a.input + m.input, payable: a.payable + m.payable, paid: a.paid + m.paid }), { goods: 0, output: 0, input: 0, payable: 0, paid: 0 });
  const thisMonth = ymd().slice(0, 7);
  const prevMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const body = <><div className="title-row"><h1>ভ্যাট ও ট্যাক্স</h1><div className="row-actions"><a className="btn" href={`/admin/accounts/vat/return?month=${attrValue(prevMonth)}`}>🧾 গত মাসের রিটার্নের হিসাব</a><a className="btn btn-ghost" href={`/admin/accounts/vat/return?month=${attrValue(thisMonth)}&reg=sales#reg`}>📗 বিক্রয় / ক্রয় হিসাব পুস্তক</a></div></div>{ui.flash(ctx.flash)}<div className="vat-docs"><a className="vat-doc" href={`/admin/accounts/vat/return?month=${attrValue(prevMonth)}`}><b>মূসক-৯.১</b><span>মাসিক রিটার্নের হিসাব — কোন ঘরে কত বসবে, শেষ তারিখ</span></a>{' '}<a className="vat-doc" href={`/admin/accounts/vat/return?month=${attrValue(thisMonth)}&reg=sales#reg`}><b>মূসক-৬.২</b><span>বিক্রয় হিসাব পুস্তক (CSV সহ)</span></a>{' '}<a className="vat-doc" href={`/admin/accounts/vat/return?month=${attrValue(thisMonth)}&reg=purchase#reg`}><b>মূসক-৬.১</b><span>ক্রয় হিসাব পুস্তক (CSV সহ)</span></a>{' '}<a className="vat-doc" href="/admin/orders"><b>মূসক-৬.৩</b><span>কর চালানপত্র — যেকোনো অর্ডারের পাতা থেকে প্রিন্ট</span></a></div><div className="two-col"><section className="panel"><div className="title-row"><h2>{bn(year)}{' '}সালের মাসিক ভ্যাট হিসাব</h2><span><a href={`?year=${attrValue(year - 1)}`}>←{' '}{bn(year - 1)}</a>{' '}{(year < Number(ymd().slice(0, 4)) ? <>·{' '}<a href={`?year=${year + 1}`}>{bn(year + 1)}{' '}→</a></> : null)}</span></div>{(r.mode === 'none' ? <p className="flash">ভ্যাট হিসাব বন্ধ আছে। পাশে আপনার ভ্যাট নিবন্ধনের ধরন বাছাই করুন।</p> : null)}<div className="table-wrap"><table className="table compact"><thead><tr><th>মাস</th><th className="num">অর্ডার</th><th className="num">বিক্রি</th><th className="num">আউটপুট ভ্যাট</th><th className="num">ইনপুট ভ্যাট</th><th className="num">দিতে হবে</th><th className="num">দেওয়া হয়েছে</th></tr></thead><tbody>{jsxList(r.months.map((m) => <tr><td>{bn(m.month)}</td><td className="num">{bn(m.orders)}</td><td className="num">{money(m.goods)}</td><td className="num">{money(m.output)}</td><td className="num">{money(m.input)}</td><td className="num"><b>{money(m.payable)}</b></td><td className="num">{money(m.paid)}</td></tr>))}</tbody><tfoot><tr className="total"><td>মোট</td><td></td><td className="num">{money(tot.goods)}</td><td className="num">{money(tot.output)}</td><td className="num">{money(tot.input)}</td><td className="num"><b>{money(tot.payable)}</b></td><td className="num">{money(tot.paid)}</td></tr></tfoot></table></div><p className="muted small">বিক্রি = ডেলিভারি হওয়া অর্ডারের পণ্যমূল্য (ছাড় বাদে, ডেলিভারি চার্জ ছাড়া)। ইনপুট ভ্যাট = পারচেজে যে ভ্যাট লিখেছেন। ভ্যাট জমা দিলে "আয়-ব্যয়" এ{' '}<b>ভ্যাট/ট্যাক্স পরিশোধ</b>{' '}খাতে লিখুন।</p></section><section className="panel"><h2>আপনার ভ্যাট সেটিংস</h2><form method="post" action="/admin/accounts/vat" className="form">{ui.field('আপনার ব্যবসা কোন ধরনের', ui.select('vat_mode', Object.entries($vat.MODES), s.vat_mode || 'none'), 'বছরে বিক্রি কম হলে সাধারণত টার্নওভার ট্যাক্স; বেশি হলে ভ্যাট নিবন্ধন (BIN) বাধ্যতামূলক। সীমাটা প্রতি বাজেটে বদলাতে পারে — হিসাবরক্ষকের কাছ থেকে নিশ্চিত হয়ে বাছুন।')}<div className="field-row">{ui.field('ভ্যাটের হার (%)', ui.input('vat_rate', s.vat_rate, { type: 'number', step: '0.5', min: 0, max: 100 }), 'সাধারণ হার ১৫%। ব্যবসায়ী পর্যায়ে কিছু পণ্যে কম হার আছে।')}{' '}{ui.field('টার্নওভার ট্যাক্সের হার (%)', ui.input('vat_turnover_rate', s.vat_turnover_rate || 4, { type: 'number', step: '0.5', min: 0, max: 100 }), 'শুধু টার্নওভার ট্যাক্স বাছলে লাগে। এখনকার হার NBR/হিসাবরক্ষকের কাছে জেনে বসান।')}</div>{ui.field('BIN (ভ্যাট নিবন্ধন নম্বর)', ui.input('vat_bin', s.vat_bin, { maxlength: 30 }))}{' '}{ui.field('TIN (ই-টিআইএন)', ui.input('tin', s.tin, { maxlength: 30 }))}{' '}{ui.field('ট্রেড লাইসেন্স নম্বর', ui.input('trade_license', s.trade_license, { maxlength: 40 }), 'দিলে দোকানের একদম নিচে (ফুটারে) দেখায় — কাস্টমারের বিশ্বাস বাড়ে। BIN দিলে সেটাও দেখায়।')}{' '}<button className="btn">সেভ করুন</button></form>{ui.helpBox('বাংলাদেশে ভ্যাট — সহজ কথায়', <ul><li><b>কে কী দেবে:</b>{' '}বছরে বিক্রি একটা নির্দিষ্ট সীমার নিচে হলে ভ্যাট লাগে না; তার উপরে একটা সীমা পর্যন্ত{' '}<b>টার্নওভার ট্যাক্স</b>{' '}(মোট বিক্রির উপর কয়েক %, কেনার ভ্যাট বাদ দেওয়া যায় না); তারও বেশি হলে{' '}<b>ভ্যাট নিবন্ধন (BIN)</b>{' '}বাধ্যতামূলক আর সাধারণ হার ১৫%। এই সীমাগুলো প্রায় প্রতি বাজেটে বদলায়, তাই হিসাবরক্ষকের সাথে মিলিয়ে উপরের ধরনটা বাছুন।</li><li><b>মাসিক রিটার্ন (মূসক-৯.১):</b>{' '}পরের মাসের{' '}<b>১৫ তারিখের মধ্যে</b>{' '}vat.gov.bd-তে জমা দিতে হয় — বিক্রি না থাকলেও "শূন্য রিটার্ন"। দেরি হলে জরিমানা আর প্রতি মাসে সুদ লাগে।</li><li><b>মূসক-৬.৩ (কর চালানপত্র):</b>{' '}ভ্যাট নিবন্ধিত বিক্রেতা প্রতিটা বিক্রিতে দেন; কেনার সময় সাপ্লায়ারের কাছ থেকে নিলে সেই ভ্যাট রেয়াত (বাদ) নেওয়া যায়।</li><li><b>মূসক-৬.১ / ৬.২:</b>{' '}কেনা আর বিক্রির খাতা — এখানে অর্ডার আর পারচেজ থেকে নিজে থেকেই তৈরি হয়।</li><li><b>আয়কর:</b>{' '}ভ্যাট ছাড়াও বছরে একবার আয়কর রিটার্ন (e-TIN দিয়ে) — "লাভ-ক্ষতি" পেজের বার্ষিক লাভ হিসাবরক্ষককে দিন।</li><li>⚠️ এই পেজ আপনার সুবিধার জন্য সংখ্যা সাজিয়ে দেয়। চূড়ান্ত রিটার্ন জমার আগে একজন ভ্যাট পরামর্শক/হিসাবরক্ষকের সাথে মিলিয়ে নিন।</li></ul>)}</section></div></>;
  return ctx.page('ভ্যাট ও ট্যাক্স', body, 'acc-vat');
}

export const routes = [
    { method: 'GET', path: '/admin/accounts', perm: 'accounting', handler: home },
    { method: '*', path: '/admin/accounts/transactions', perm: 'accounting', handler: transactions },
    { method: 'POST', path: /^\/admin\/accounts\/transactions\/(\d+)\/delete$/, perm: 'accounting', handler: deleteTx },
    { method: '*', path: '/admin/accounts/banks', perm: 'accounting', handler: banks },
    { method: 'GET', path: '/admin/accounts/pnl', perm: 'see_cost', handler: pnlPage },
    { method: '*', path: '/admin/accounts/vat', perm: 'accounting', handler: vatPage },
  ];
void validYmd;

'use strict';
// Admin → স্টক ও কেনাকাটা → সাপ্লায়ার → 📒 বাকির খাতা (owner only — buying prices are the owner's secret).
//   /admin/suppliers/dues        every supplier you owe money to: how much, how old the debt is (0-30 / 31-60 / 61-90 / 90+ days)
//   /admin/suppliers/:id/ledger  one supplier's statement: opening due, each purchase (+) and payment (−) with the running balance,
//                                for any dates — printable, to match with the supplier's own book.
const { html, int, str, bn, money, fmtDate, ymd, validYmd, round2 } = require('../util');
const db = require('../db');
const ui = require('./ui');
const finance = require('../models/finance');

// All entries of one supplier, oldest first: purchases (we owe more) and payments (we owe less).
async function entries(id) {
  return db.q(`SELECT * FROM (
      SELECT 'p' AS kind, p.id, p.purchase_date AS d, p.code AS ref, p.total AS amount, p.status, p.note, p.created_at AS at,
        (SELECT count(*) FROM purchase_items i WHERE i.purchase_id=p.id)::int AS lines
        FROM purchases p WHERE p.supplier_id=$1 AND p.status<>'cancelled'
      UNION ALL
      SELECT 't', t.id, t.tx_date, coalesce(a.name, ''), t.amount, t.type, t.note, t.created_at, 0
        FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id WHERE t.supplier_id=$1 AND t.type='expense'
    ) x ORDER BY d, at, id`, [int(id)]);
}

// What is still unpaid, oldest purchases first (payments clear the oldest debt first).
function aging(opening, list) {
  const debts = [];
  if (Number(opening) > 0) debts.push({ d: null, left: Number(opening) });
  let credit = 0;
  for (const e of list) {
    if (e.kind === 'p') debts.push({ d: e.d, left: Number(e.amount) });
    else credit += Number(e.amount);
  }
  for (const x of debts) { const take = Math.min(x.left, credit); x.left -= take; credit -= take; }
  const b = { a: 0, b: 0, c: 0, d: 0, oldest: null };
  const today = new Date(ymd() + 'T00:00:00Z').getTime();
  for (const x of debts) {
    if (x.left <= 0.004) continue;
    const days = x.d ? Math.floor((today - new Date(String(x.d).slice(0, 10) + 'T00:00:00Z').getTime()) / 864e5) : 999;
    if (b.oldest === null || days > b.oldest) b.oldest = days;
    if (days <= 30) b.a += x.left; else if (days <= 60) b.b += x.left; else if (days <= 90) b.c += x.left; else b.d += x.left;
  }
  return b;
}

async function duesPage(ctx) {
  const rows = await finance.listSuppliers();
  const out = [];
  for (const s of rows) {
    const due = finance.supplierDue(s);
    if (Math.abs(due) < 0.005 && !Number(s.purchased)) continue;
    const list = await entries(s.id);
    const lastPay = list.filter((e) => e.kind === 't').pop();
    out.push({ ...s, due, ag: aging(s.opening_due, list), last_pay: lastPay ? lastPay.d : null });
  }
  out.sort((a, b) => b.due - a.due);
  const tot = out.reduce((t, s) => ({ due: t.due + Math.max(0, s.due), a: t.a + s.ag.a, b: t.b + s.ag.b, c: t.c + s.ag.c, d: t.d + s.ag.d }), { due: 0, a: 0, b: 0, c: 0, d: 0 });
  const body = html`<p class="crumbs"><a href="/admin/suppliers">← সাপ্লায়ার</a></p>
<div class="title-row"><h1>📒 সাপ্লায়ারের বাকির খাতা</h1><div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ প্রিন্ট</button></div></div>
<div class="kpis kpis-tight">
  ${ui.kpi('মোট বাকি (আপনি দেবেন)', money(tot.due), `${bn(out.filter((s) => s.due > 0.005).length)} জন সাপ্লায়ার`, tot.due > 0 ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('৩০ দিনের ভেতরের', money(tot.a), '')}${ui.kpi('৩১–৬০ দিন', money(tot.b), '')}${ui.kpi('৬১–৯০ দিন', money(tot.c), '', tot.c > 0 ? 'kpi-alert' : '')}${ui.kpi('৯০ দিনের বেশি পুরোনো', money(tot.d), 'আগে এগুলো দিন', tot.d > 0 ? 'kpi-alert' : '')}
</div>
<p class="muted small">পেমেন্ট সবসময় সবচেয়ে পুরোনো কেনার বাকি আগে মেটায় — তাই কোন বাকি কত দিনের পুরোনো সেটা দেখা যায়। সাপ্লায়ারের নামে চাপ দিলে পুরো খাতা (তারিখ ধরে) দেখবেন।</p>
${out.length ? html`<div class="table-wrap panel"><table class="table"><thead><tr><th>সাপ্লায়ার</th><th class="num">মোট কেনা</th><th class="num">দিয়েছেন</th><th class="num">বাকি</th><th class="num">০–৩০</th><th class="num">৩১–৬০</th><th class="num">৬১–৯০</th><th class="num">৯০+</th><th>শেষ পেমেন্ট</th><th></th></tr></thead><tbody>
${out.map((s) => html`<tr><td><a href="/admin/suppliers/${s.id}/ledger"><b>${s.name}</b></a>${s.phone ? html`<br><a class="small" href="tel:${s.phone}">${s.phone}</a>` : ''}</td>
  <td class="num">${money(Number(s.purchased) + Number(s.opening_due || 0))}</td><td class="num">${money(s.paid)}</td><td class="num ${s.due > 0.005 ? 'warn' : 'good'}"><b>${money(s.due)}</b></td>
  <td class="num">${s.ag.a ? money(s.ag.a) : '—'}</td><td class="num">${s.ag.b ? money(s.ag.b) : '—'}</td><td class="num ${s.ag.c ? 'warn' : ''}">${s.ag.c ? money(s.ag.c) : '—'}</td><td class="num ${s.ag.d ? 'warn' : ''}">${s.ag.d ? money(s.ag.d) : '—'}</td>
  <td class="small">${s.last_pay ? fmtDate(String(s.last_pay).slice(0, 10) + 'T06:00:00Z', false) : '—'}</td>
  <td class="row-actions"><a class="btn btn-sm btn-ghost" href="/admin/suppliers/${s.id}/ledger">📒 খাতা</a>${s.due > 0.005 ? html`<a class="btn btn-sm" href="/admin/suppliers/${s.id}#pay">টাকা দিন</a>` : ''}</td></tr>`)}
</tbody></table></div>` : ui.empty('কোনো সাপ্লায়ারের হিসাব নেই।')}`;
  return ctx.page('সাপ্লায়ারের বাকির খাতা', body, 'suppliers');
}

async function ledgerPage(ctx, m) {
  const s = await finance.getSupplier(int(m[1]));
  if (!s) return ctx.redirect(ctx.res, '/admin/suppliers');
  const from = validYmd(ctx.query.get('from')) || '';
  const to = validYmd(ctx.query.get('to')) || '';
  const list = await entries(s.id);
  let bal = Number(s.opening_due || 0);
  let before = bal;
  const rows = [];
  for (const e of list) {
    const d = String(e.d).slice(0, 10);
    const change = e.kind === 'p' ? Number(e.amount) : -Number(e.amount);
    if (from && d < from) { before += change; bal += change; continue; }
    if (to && d > to) continue;
    bal = round2(bal + change);
    rows.push({ ...e, d, change, bal });
  }
  const ag = aging(s.opening_due, list);
  const sumP = rows.filter((r) => r.kind === 'p').reduce((t, r) => t + Number(r.amount), 0);
  const sumT = rows.filter((r) => r.kind === 't').reduce((t, r) => t + Number(r.amount), 0);
  const body = html`<p class="crumbs"><a href="/admin/suppliers/${s.id}">← ${s.name}</a> · <a href="/admin/suppliers/dues">সব বাকি</a></p>
<div class="title-row"><h1>📒 খাতা — ${s.name}</h1><div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ প্রিন্ট</button><a class="btn btn-sm" href="/admin/suppliers/${s.id}#pay">💵 টাকা দিন</a></div></div>
<p class="muted">${s.company ? `${s.company} · ` : ''}${s.phone || ''}${s.address ? ` · ${s.address}` : ''}</p>
<div class="kpis kpis-tight">
  ${ui.kpi('এখন বাকি', money(finance.supplierDue(s)), ag.oldest !== null ? `সবচেয়ে পুরোনো বাকি ${ag.oldest >= 999 ? 'শুরুর আগের' : `${bn(ag.oldest)} দিনের`}` : 'কোনো বাকি নেই', finance.supplierDue(s) > 0.005 ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('এই সময়ে কেনা', money(sumP), `${bn(rows.filter((r) => r.kind === 'p').length)}টি পারচেজ`)}${ui.kpi('এই সময়ে দিয়েছেন', money(sumT), `${bn(rows.filter((r) => r.kind === 't').length)}টি পেমেন্ট`)}
</div>
${ui.dateFilter(`/admin/suppliers/${s.id}/ledger`, from, to)}
<div class="table-wrap panel"><table class="table compact ledger"><thead><tr><th>তারিখ</th><th>বিবরণ</th><th class="num">কেনা (+)</th><th class="num">দিয়েছেন (−)</th><th class="num">বাকি</th></tr></thead><tbody>
  <tr class="muted"><td>${from ? fmtDate(from + 'T06:00:00Z', false) : 'শুরু'}</td><td>${from ? 'আগের বাকি' : 'শুরুতে বাকি ছিল'}</td><td></td><td></td><td class="num"><b>${money(from ? before : s.opening_due || 0)}</b></td></tr>
  ${rows.map((r) => html`<tr><td class="small nowrap">${fmtDate(r.d + 'T06:00:00Z', false)}</td>
    <td>${r.kind === 'p' ? html`🛒 পারচেজ <a href="/admin/purchases/${r.id}" class="mono">${r.ref}</a> <span class="small muted">${bn(r.lines)}টি পণ্য${r.status === 'ordered' ? ' · মাল আসেনি' : ''}</span>` : html`💵 পেমেন্ট${r.ref ? ` — ${r.ref}` : ''}`}${r.note ? html`<br><span class="small muted">${r.note}</span>` : ''}</td>
    <td class="num">${r.kind === 'p' ? money(r.amount) : ''}</td><td class="num">${r.kind === 't' ? money(r.amount) : ''}</td><td class="num ${r.bal > 0.005 ? 'warn' : 'good'}">${money(r.bal)}</td></tr>`)}
</tbody><tfoot><tr><td></td><td><b>মোট</b></td><td class="num"><b>${money(sumP)}</b></td><td class="num"><b>${money(sumT)}</b></td><td class="num"><b>${money(rows.length ? rows[rows.length - 1].bal : (from ? before : s.opening_due || 0))}</b></td></tr></tfoot></table></div>
<p class="small muted">ছাপা তারিখ: ${fmtDate(new Date())} · ${ctx.settings.store_name}</p>`;
  return ctx.page(`খাতা — ${s.name}`, body, 'suppliers');
}

void str;
module.exports = {
  routes: [
    { method: 'GET', path: '/admin/suppliers/dues', perm: 'see_cost', handler: duesPage },
    { method: 'GET', path: /^\/admin\/suppliers\/(\d+)\/ledger$/, perm: 'see_cost', handler: ledgerPage },
  ],
};

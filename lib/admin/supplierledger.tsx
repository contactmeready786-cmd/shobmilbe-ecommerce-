// Admin → স্টক ও কেনাকাটা → সাপ্লায়ার → 📒 বাকির খাতা (owner only — buying prices are the owner's secret).
//   /admin/suppliers/dues        every supplier you owe money to: how much, how old the debt is (0-30 / 31-60 / 61-90 / 90+ days)
//   /admin/suppliers/:id/ledger  one supplier's statement: opening due, each purchase (+) and payment (−) with the running balance,
//                                for any dates — printable, to match with the supplier's own book.

// All entries of one supplier, oldest first: purchases (we owe more) and payments (we owe less).
import { toHtml, Val, attrValue, jsxList } from '../react/html';
import { html, int, str, bn, money, fmtDate, ymd, validYmd, round2 } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as finance from '../models/finance';
import type { AdminCtx, Body, Id, Loose } from '../types';
async function entries(id?: Id) {
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
function aging(opening?: Loose, list?: Loose) {
  const debts: Loose[] = [];
  if (Number(opening) > 0) debts.push({ d: null, left: Number(opening) });
  let credit = 0;
  for (const e of list) {
    if (e.kind === 'p') debts.push({ d: e.d, left: Number(e.amount) });
    else credit += Number(e.amount);
  }
  for (const x of debts) { const take = Math.min(x.left, credit); x.left -= take; credit -= take; }
  const b: { a: number; b: number; c: number; d: number; oldest: number | null } = { a: 0, b: 0, c: 0, d: 0, oldest: null };
  const today = new Date(ymd() + 'T00:00:00Z').getTime();
  for (const x of debts) {
    if (x.left <= 0.004) continue;
    const days = x.d ? Math.floor((today - new Date(String(x.d).slice(0, 10) + 'T00:00:00Z').getTime()) / 864e5) : 999;
    if (b.oldest === null || days > b.oldest) b.oldest = days;
    if (days <= 30) b.a += x.left; else if (days <= 60) b.b += x.left; else if (days <= 90) b.c += x.left; else b.d += x.left;
  }
  return b;
}

async function duesPage(ctx: AdminCtx) {
  const rows = await finance.listSuppliers();
  const out: Loose[] = [];
  for (const s of rows) {
    const due = finance.supplierDue(s);
    if (Math.abs(due) < 0.005 && !Number(s.purchased)) continue;
    const list = await entries(s.id);
    const lastPay = list.filter((e) => e.kind === 't').pop();
    out.push({ ...s, due, ag: aging(s.opening_due, list), last_pay: lastPay ? lastPay.d : null });
  }
  out.sort((a, b) => b.due - a.due);
  const tot = out.reduce((t, s) => ({ due: t.due + Math.max(0, s.due), a: t.a + s.ag.a, b: t.b + s.ag.b, c: t.c + s.ag.c, d: t.d + s.ag.d }), { due: 0, a: 0, b: 0, c: 0, d: 0 });
  const body = toHtml(<><p className="crumbs"><a href="/admin/suppliers">← সাপ্লায়ার</a></p><div className="title-row"><h1>📒 সাপ্লায়ারের বাকির খাতা</h1><div className="row-actions"><button type="button" className="btn btn-ghost btn-sm" data-print="">🖨️ প্রিন্ট</button></div></div><div className="kpis kpis-tight"><Val v={ui.kpi('মোট বাকি (আপনি দেবেন)', money(tot.due), `${bn(out.filter((s) => s.due > 0.005).length)} জন সাপ্লায়ার`, tot.due > 0 ? 'kpi-alert' : 'kpi-green')} />{' '}<Val v={ui.kpi('৩০ দিনের ভেতরের', money(tot.a), '')} /><Val v={ui.kpi('৩১–৬০ দিন', money(tot.b), '')} /><Val v={ui.kpi('৬১–৯০ দিন', money(tot.c), '', tot.c > 0 ? 'kpi-alert' : '')} /><Val v={ui.kpi('৯০ দিনের বেশি পুরোনো', money(tot.d), 'আগে এগুলো দিন', tot.d > 0 ? 'kpi-alert' : '')} /></div><p className="muted small">পেমেন্ট সবসময় সবচেয়ে পুরোনো কেনার বাকি আগে মেটায় — তাই কোন বাকি কত দিনের পুরোনো সেটা দেখা যায়। সাপ্লায়ারের নামে চাপ দিলে পুরো খাতা (তারিখ ধরে) দেখবেন।</p>{(out.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th>সাপ্লায়ার</th><th className="num">মোট কেনা</th><th className="num">দিয়েছেন</th><th className="num">বাকি</th><th className="num">০–৩০</th><th className="num">৩১–৬০</th><th className="num">৬১–৯০</th><th className="num">৯০+</th><th>শেষ পেমেন্ট</th><th></th></tr></thead><tbody>{jsxList(out.map((s) => <tr><td><a href={`/admin/suppliers/${attrValue(s.id)}/ledger`}><b><Val v={s.name} /></b></a>{(s.phone ? <><br /><a className="small" href={`tel:${attrValue(s.phone)}`}><Val v={s.phone} /></a></> : null)}</td><td className="num"><Val v={money(Number(s.purchased) + Number(s.opening_due || 0))} /></td><td className="num"><Val v={money(s.paid)} /></td><td className={`num ${attrValue(s.due > 0.005 ? 'warn' : 'good')}`}><b><Val v={money(s.due)} /></b></td><td className="num">{(s.ag.a ? <Val v={money(s.ag.a)} /> : "—")}</td><td className="num">{(s.ag.b ? <Val v={money(s.ag.b)} /> : "—")}</td><td className={`num ${attrValue(s.ag.c ? 'warn' : '')}`}>{(s.ag.c ? <Val v={money(s.ag.c)} /> : "—")}</td><td className={`num ${attrValue(s.ag.d ? 'warn' : '')}`}>{(s.ag.d ? <Val v={money(s.ag.d)} /> : "—")}</td><td className="small">{(s.last_pay ? <Val v={fmtDate(String(s.last_pay).slice(0, 10) + 'T06:00:00Z', false)} /> : "—")}</td><td className="row-actions"><a className="btn btn-sm btn-ghost" href={`/admin/suppliers/${attrValue(s.id)}/ledger`}>📒 খাতা</a>{(s.due > 0.005 ? <a className="btn btn-sm" href={`/admin/suppliers/${attrValue(s.id)}#pay`}>টাকা দিন</a> : null)}</td></tr>))}</tbody></table></div> : <Val v={ui.empty('কোনো সাপ্লায়ারের হিসাব নেই।')} />)}</>);
  return ctx.page('সাপ্লায়ারের বাকির খাতা', body, 'supplier-dues');
}

async function ledgerPage(ctx: AdminCtx, m?: Loose) {
  const s = await finance.getSupplier(int(m[1]));
  if (!s) return ctx.redirect('/admin/suppliers');
  const from = validYmd(ctx.query.get('from')) || '';
  const to = validYmd(ctx.query.get('to')) || '';
  const list = await entries(s.id);
  let bal = Number(s.opening_due || 0);
  let before = bal;
  const rows: Loose[] = [];
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
  const body = toHtml(<><p className="crumbs"><a href={`/admin/suppliers/${attrValue(s.id)}`}>←{' '}<Val v={s.name} /></a>{' '}·{' '}<a href="/admin/suppliers/dues">সব বাকি</a></p><div className="title-row"><h1>📒 খাতা —{' '}<Val v={s.name} /></h1><div className="row-actions"><button type="button" className="btn btn-ghost btn-sm" data-print="">🖨️ প্রিন্ট</button><a className="btn btn-sm" href={`/admin/suppliers/${attrValue(s.id)}#pay`}>💵 টাকা দিন</a></div></div><p className="muted">{(s.company ? <Val v={`${s.company} · `} /> : null)}<Val v={s.phone || ''} />{(s.address ? <Val v={` · ${s.address}`} /> : null)}</p><div className="kpis kpis-tight"><Val v={ui.kpi('এখন বাকি', money(finance.supplierDue(s)), ag.oldest !== null ? `সবচেয়ে পুরোনো বাকি ${ag.oldest >= 999 ? 'শুরুর আগের' : `${bn(ag.oldest)} দিনের`}` : 'কোনো বাকি নেই', finance.supplierDue(s) > 0.005 ? 'kpi-alert' : 'kpi-green')} />{' '}<Val v={ui.kpi('এই সময়ে কেনা', money(sumP), `${bn(rows.filter((r) => r.kind === 'p').length)}টি পারচেজ`)} /><Val v={ui.kpi('এই সময়ে দিয়েছেন', money(sumT), `${bn(rows.filter((r) => r.kind === 't').length)}টি পেমেন্ট`)} /></div><Val v={ui.dateFilter(`/admin/suppliers/${s.id}/ledger`, from, to)} /><div className="table-wrap panel"><table className="table compact ledger"><thead><tr><th>তারিখ</th><th>বিবরণ</th><th className="num">কেনা (+)</th><th className="num">দিয়েছেন (−)</th><th className="num">বাকি</th></tr></thead><tbody><tr className="muted"><td>{(from ? <Val v={fmtDate(from + 'T06:00:00Z', false)} /> : "শুরু")}</td><td>{(from ? "আগের বাকি" : "শুরুতে বাকি ছিল")}</td><td></td><td></td><td className="num"><b><Val v={money(from ? before : s.opening_due || 0)} /></b></td></tr>{jsxList(rows.map((r) => <tr><td className="small nowrap"><Val v={fmtDate(r.d + 'T06:00:00Z', false)} /></td><td>{(r.kind === 'p' ? <>🛒 পারচেজ{' '}<a href={`/admin/purchases/${attrValue(r.id)}`} className="mono"><Val v={r.ref} /></a>{' '}<span className="small muted"><Val v={bn(r.lines)} />টি পণ্য{(r.status === 'ordered' ? " · মাল আসেনি" : null)}</span></> : <>💵 পেমেন্ট{(r.ref ? <Val v={` — ${r.ref}`} /> : null)}</>)}{(r.note ? <><br /><span className="small muted"><Val v={r.note} /></span></> : null)}</td><td className="num">{(r.kind === 'p' ? <Val v={money(r.amount)} /> : null)}</td><td className="num">{(r.kind === 't' ? <Val v={money(r.amount)} /> : null)}</td><td className={`num ${attrValue(r.bal > 0.005 ? 'warn' : 'good')}`}><Val v={money(r.bal)} /></td></tr>))}</tbody><tfoot><tr><td></td><td><b>মোট</b></td><td className="num"><b><Val v={money(sumP)} /></b></td><td className="num"><b><Val v={money(sumT)} /></b></td><td className="num"><b><Val v={money(rows.length ? rows[rows.length - 1].bal : (from ? before : s.opening_due || 0))} /></b></td></tr></tfoot></table></div><p className="small muted">ছাপা তারিখ:{' '}<Val v={fmtDate(new Date())} />{' '}·{' '}<Val v={ctx.settings.store_name} /></p></>);
  return ctx.page(`খাতা — ${s.name}`, body, 'suppliers');
}

void str;
export const routes = [
    { method: 'GET', path: '/admin/suppliers/dues', perm: 'see_cost', handler: duesPage },
    { method: 'GET', path: /^\/admin\/suppliers\/(\d+)\/ledger$/, perm: 'see_cost', handler: ledgerPage },
  ];

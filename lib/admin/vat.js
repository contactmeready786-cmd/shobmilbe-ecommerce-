'use strict';
// Admin → হিসাব → ভ্যাট ও ট্যাক্স: the Bangladesh VAT paperwork, worked out from the shop's own orders and purchases.
//  • মূসক-৯.১ মাসিক রিটার্নের হিসাব (what goes in each box, due by the 15th of the next month)
//  • মূসক-৬.২ বিক্রয় হিসাব পুস্তক (sales register) and মূসক-৬.১ ক্রয় হিসাব পুস্তক (purchase register), with CSV
//  • মূসক-৬.৩ কর চালানপত্র (tax invoice) for any order, ready to print
// The return itself is filed by the owner (or their VAT consultant) on vat.gov.bd — this page prepares the numbers.
const { html, raw, money, bn, fmtDate, int, ymd, csv, num, str } = require('../util');
const db = require('../db');
const ui = require('./ui');

const MODES = {
  none: 'ভ্যাট হিসাব করব না',
  turnover: 'টার্নওভার ট্যাক্স (মোট বিক্রির উপর নির্দিষ্ট %)',
  inclusive: 'ভ্যাট নিবন্ধিত — দামের মধ্যেই ভ্যাট ধরা',
  exclusive: 'ভ্যাট নিবন্ধিত — দামের উপর আলাদা ভ্যাট',
  margin: 'শুধু লাভের (মার্জিন) উপর ভ্যাট',
};
const BN_MONTH = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const monthName = (ym) => `${BN_MONTH[Number(ym.slice(5, 7)) - 1]} ${bn(ym.slice(0, 4))}`;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// VAT inside / on top of an amount for one mode
function split(amount, s, cost = 0) {
  const rate = num(s.vat_rate, 15);
  const a = Number(amount || 0);
  switch (s.vat_mode) {
    case 'inclusive': { const vat = r2((a * rate) / (100 + rate)); return { value: r2(a - vat), vat, rate }; }
    case 'exclusive': return { value: a, vat: r2((a * rate) / 100), rate };
    case 'margin': return { value: a, vat: r2((Math.max(0, a - cost) * rate) / 100), rate, margin: true };
    case 'turnover': return { value: a, vat: r2((a * num(s.vat_turnover_rate, 4)) / 100), rate: num(s.vat_turnover_rate, 4), turnover: true };
    default: return { value: a, vat: 0, rate: 0 };
  }
}
function validMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : ymd().slice(0, 7); }
function nextMonth15(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 15));
}

async function salesRows(month) {
  return db.q(`SELECT o.id, o.code, o.customer_name, o.phone, o.address, coalesce(o.delivered_at, o.updated_at) AS at,
      (o.subtotal - o.discount - coalesce(o.points_discount,0))::numeric(14,2) AS goods, o.cost_total, o.delivery, o.total
    FROM orders o WHERE o.status='delivered' AND to_char(coalesce(o.delivered_at, o.updated_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') = $1
    ORDER BY at, o.id`, [month]);
}
async function purchaseRows(month) {
  return db.q(`SELECT p.id, p.code, p.purchase_date, coalesce(s.name, '—') AS supplier, coalesce(s.company, '') AS company, p.note,
      (p.subtotal - p.discount)::numeric(14,2) AS value, p.vat, p.total
    FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.status='received' AND to_char(p.purchase_date, 'YYYY-MM') = $1 ORDER BY p.purchase_date, p.id`, [month]);
}

// ---------------------------------------------------------------- মূসক-৯.১ (monthly return helper) + registers
async function returnPage(ctx) {
  const s = ctx.settings;
  const month = validMonth(ctx.query.get('month'));
  const kind = ['sales', 'purchase'].includes(ctx.query.get('reg')) ? ctx.query.get('reg') : '';
  const [sales, buys, paid] = await Promise.all([salesRows(month), purchaseRows(month),
    db.one(`SELECT coalesce(sum(amount),0)::numeric(14,2) AS n FROM transactions WHERE type='expense' AND category='ভ্যাট/ট্যাক্স পরিশোধ' AND to_char(tx_date,'YYYY-MM')=$1`, [month])]);
  const saleLines = sales.map((o) => ({ ...o, ...split(o.goods, s, Number(o.cost_total)) }));
  const out = saleLines.reduce((a, o) => ({ value: a.value + Number(o.value), vat: a.vat + o.vat }), { value: 0, vat: 0 });
  const inn = buys.reduce((a, p) => ({ value: a.value + Number(p.value), vat: a.vat + Number(p.vat) }), { value: 0, vat: 0 });
  const turnover = s.vat_mode === 'turnover';
  const inputCredit = turnover ? 0 : inn.vat;
  const net = Math.max(0, r2(out.vat - inputCredit));
  const carry = Math.max(0, r2(inputCredit - out.vat));
  const due = nextMonth15(month);
  const daysLeft = Math.ceil((due.getTime() - Date.now()) / 864e5);

  if (ctx.query.get('csv') === '1' && kind) {
    const rows = kind === 'sales'
      ? [['Date', 'Invoice (Order)', 'Buyer', 'Phone', 'Value (excl. VAT)', 'VAT', 'Total'], ...saleLines.map((o) => [String(o.at).slice(0, 10), o.code, o.customer_name, o.phone, r2(o.value), o.vat, r2(Number(o.value) + (s.vat_mode === 'exclusive' ? o.vat : s.vat_mode === 'inclusive' ? o.vat : 0))])]
      : [['Date', 'Purchase No', 'Supplier', 'Note / Challan', 'Value', 'VAT', 'Total'], ...buys.map((p) => [String(p.purchase_date).slice(0, 10), p.code, p.supplier, p.note || '', p.value, p.vat, p.total])];
    return ctx.send(ctx.res, 200, csv(rows), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="mushak-${kind === 'sales' ? '6.2-sales' : '6.1-purchase'}-${month}.csv"` });
  }
  const months = [];
  for (let i = 0; i < 12; i++) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const box = (no, label, value, note) => html`<tr><td class="small muted">${no}</td><td>${label}${note ? html`<br><span class="small muted">${note}</span>` : ''}</td><td class="num"><b>${money(value)}</b></td></tr>`;

  const body = html`<p class="crumbs"><a href="/admin/accounts/vat">← ভ্যাট ও ট্যাক্স</a></p>
<div class="title-row"><h1>🧾 ${turnover ? 'টার্নওভার ট্যাক্সের হিসাব' : 'মূসক-৯.১ মাসিক রিটার্নের হিসাব'} <small>${monthName(month)}</small></h1>
  <form method="get" class="row-actions">${ui.select('month', months.map((m) => [m, monthName(m)]), month, { onchange: 'this.form.submit()' })}<noscript><button class="btn btn-sm">দেখুন</button></noscript></form></div>
${ui.flash(ctx.flash)}
${s.vat_mode === 'none' || !s.vat_mode ? html`<p class="flash flash-error">⚠️ ভ্যাট হিসাব এখন বন্ধ। আগে <a href="/admin/accounts/vat">ভ্যাট ও ট্যাক্স</a> পেজে আপনার ধরন বাছুন — নিচের সংখ্যাগুলো তখনই ঠিক হবে।</p>` : ''}
<div class="kpis kpis-tight">
  ${ui.kpi('জমার শেষ দিন', fmtDate(due.toISOString(), false), daysLeft > 0 ? `আর ${bn(daysLeft)} দিন` : daysLeft === 0 ? 'আজই!' : 'সময় পার হয়ে গেছে', daysLeft <= 5 ? 'kpi-alert' : 'kpi-blue')}
  ${ui.kpi(turnover ? 'টার্নওভার ট্যাক্স' : 'দিতে হবে (নিট)', money(net), turnover ? `বিক্রির ${bn(num(s.vat_turnover_rate, 4))}%` : 'আউটপুট − ইনপুট', net ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('জমা দেওয়া হয়েছে', money(paid.n), '"ভ্যাট/ট্যাক্স পরিশোধ" খরচ থেকে', Number(paid.n) >= net ? 'kpi-green' : '')}
  ${ui.kpi('এই মাসে বিক্রি', bn(sales.length) + 'টি', money(out.value))}
</div>
<div class="two-col">
  <section class="panel">
    <h2>রিটার্নের ঘরগুলোতে যা বসবে</h2>
    <table class="table compact vat-return"><tbody>
      ${box('অংশ ১', turnover ? 'মোট বিক্রি (টার্নওভার)' : 'বিক্রির মূল্য (ভ্যাট বাদে)', out.value, `${bn(sales.length)}টি ডেলিভারি হওয়া অর্ডার · ডেলিভারি চার্জ বাদে`)}
      ${box('', turnover ? `টার্নওভার ট্যাক্স (${bn(num(s.vat_turnover_rate, 4))}%)` : `আউটপুট ট্যাক্স${s.vat_mode === 'margin' ? ' (মার্জিনের উপর)' : ` (${bn(num(s.vat_rate, 15))}%)`}`, out.vat)}
      ${turnover ? '' : html`${box('অংশ ২', 'কেনার মূল্য (রেয়াতযোগ্য)', inn.value, `${bn(buys.length)}টি পারচেজ — মূসক-৬.৩ চালান থাকলে তবেই রেয়াত`)}
      ${box('', 'ইনপুট ট্যাক্স (রেয়াত)', inn.vat, 'পারচেজে যে ভ্যাট লিখেছেন')}`}
      ${box('অংশ ৩', 'নিট প্রদেয়', net)}
      ${carry ? box('', 'পরের মাসে নেওয়া যাবে (রেয়াত বেশি)', carry) : ''}
    </tbody></table>
    <ol class="small steps-list">
      <li><a href="https://vat.gov.bd" target="_blank" rel="noopener">vat.gov.bd</a>-এ আপনার BIN দিয়ে লগইন করুন → Return → ${turnover ? 'টার্নওভার ট্যাক্স রিটার্ন' : 'Mushak 9.1'}।</li>
      <li>উপরের সংখ্যাগুলো সংশ্লিষ্ট ঘরে বসান, বিক্রয় ও ক্রয়ের তালিকা নিচ থেকে CSV নামিয়ে মিলিয়ে নিন।</li>
      <li>টাকা জমা দিন (A-চালান / অনলাইন পেমেন্ট), তারপর এখানে <a href="/admin/accounts/transactions?new=expense&cat=${encodeURIComponent('ভ্যাট/ট্যাক্স পরিশোধ')}">"ভ্যাট/ট্যাক্স পরিশোধ" খরচ</a> লিখুন।</li>
      <li>কিছু বিক্রি না থাকলেও প্রতি মাসে "শূন্য" রিটার্ন জমা দিতে হয়; দেরিতে দিলে জরিমানা আর সুদ লাগে।</li>
    </ol>
  </section>
  <section class="panel">
    <h2>হিসাব পুস্তক (রেজিস্টার)</h2>
    <p class="small muted">এনবিআর-এর নিয়মে প্রতিদিনের বিক্রি আর কেনার হিসাব রাখতে হয়। এখানে সব নিজে থেকেই তৈরি হয়।</p>
    <div class="chips">
      <a class="chip ${kind === 'sales' ? 'on' : ''}" href="?month=${month}&reg=sales#reg">📗 মূসক-৬.২ বিক্রয় হিসাব (${bn(sales.length)})</a>
      <a class="chip ${kind === 'purchase' ? 'on' : ''}" href="?month=${month}&reg=purchase#reg">📘 মূসক-৬.১ ক্রয় হিসাব (${bn(buys.length)})</a>
    </div>
    <p class="small"><a href="?month=${month}&reg=sales&csv=1">⬇ বিক্রয় CSV</a> · <a href="?month=${month}&reg=purchase&csv=1">⬇ ক্রয় CSV</a></p>
    <p class="small muted">প্রতিটা অর্ডারের <b>মূসক-৬.৩ কর চালানপত্র</b> অর্ডারের পাতার "🧾 মূসক-৬.৩" বাটন থেকে প্রিন্ট করা যায়${turnover ? ' (টার্নওভার ট্যাক্সে সাধারণত লাগে না)' : ''}।</p>
  </section>
</div>
${kind ? html`<section class="panel table-wrap" id="reg">
  <h2>${kind === 'sales' ? '📗 মূসক-৬.২ বিক্রয় হিসাব পুস্তক' : '📘 মূসক-৬.১ ক্রয় হিসাব পুস্তক'} — ${monthName(month)}</h2>
  ${kind === 'sales' ? (saleLines.length ? html`<table class="table compact"><thead><tr><th>তারিখ</th><th>চালান (অর্ডার)</th><th>ক্রেতা</th><th class="num">মূল্য</th><th class="num">ভ্যাট</th><th></th></tr></thead>
    <tbody>${saleLines.map((o) => html`<tr><td class="small">${fmtDate(o.at, false)}</td><td><a href="/admin/orders/${o.id}">${o.code}</a></td><td>${o.customer_name}<br><span class="small muted">${o.phone}</span></td>
      <td class="num">${money(o.value)}</td><td class="num">${money(o.vat)}</td><td><a class="small" href="/admin/orders/${o.id}/mushak" target="_blank">🧾 ৬.৩</a></td></tr>`)}</tbody>
    <tfoot><tr class="total"><td colspan="3">মোট</td><td class="num">${money(out.value)}</td><td class="num">${money(out.vat)}</td><td></td></tr></tfoot></table>` : html`<p class="muted">এই মাসে ডেলিভারি হওয়া কোনো অর্ডার নেই।</p>`)
    : (buys.length ? html`<table class="table compact"><thead><tr><th>তারিখ</th><th>পারচেজ</th><th>সরবরাহকারী</th><th class="num">মূল্য</th><th class="num">ভ্যাট</th></tr></thead>
    <tbody>${buys.map((p) => html`<tr><td class="small">${fmtDate(String(p.purchase_date).slice(0, 10) + 'T06:00:00Z', false)}</td><td><a href="/admin/purchases/${p.id}">${p.code}</a>${p.note ? html`<br><span class="small muted">${str(p.note, 60)}</span>` : ''}</td><td>${p.supplier}</td>
      <td class="num">${money(p.value)}</td><td class="num">${money(p.vat)}</td></tr>`)}</tbody>
    <tfoot><tr class="total"><td colspan="3">মোট</td><td class="num">${money(inn.value)}</td><td class="num">${money(inn.vat)}</td></tr></tfoot></table>` : html`<p class="muted">এই মাসে কোনো পারচেজ (মাল বুঝে পাওয়া) নেই।</p>`)}
</section>` : ''}`;
  return ctx.page('ভ্যাট রিটার্ন', body, 'acc-vat');
}

// ---------------------------------------------------------------- মূসক-৬.৩ কর চালানপত্র (printable)
async function mushak63(ctx, m) {
  const s = ctx.settings;
  const o = await require('../models/orders').getOrder({ id: int(m[1]) });
  if (!o) return ctx.redirect(ctx.res, '/admin/orders');
  const rate = num(s.vat_rate, 15);
  const mode = s.vat_mode || 'none';
  const lines = (o.items || []).map((it, i) => {
    const total = Number(it.price) * Number(it.qty);
    const sp = split(total, s, Number(it.cost || 0) * Number(it.qty));
    const unitEx = mode === 'inclusive' ? r2(Number(it.price) * 100 / (100 + rate)) : Number(it.price);
    return { i: i + 1, name: it.name, qty: it.qty, unit: it.unit || 'পিস', unitEx, value: sp.value, vat: sp.vat, gross: mode === 'exclusive' ? r2(sp.value + sp.vat) : total };
  });
  const disc = Number(o.discount || 0) + Number(o.points_discount || 0);
  const tot = lines.reduce((a, l) => ({ value: a.value + l.value, vat: a.vat + l.vat, gross: a.gross + l.gross }), { value: 0, vat: 0, gross: 0 });
  const discSplit = split(disc, s);
  const page = '<!doctype html>' + html`<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>মূসক-৬.৩ ${o.code}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;color:#111;margin:0;background:#EEF2F7;font-size:13px}
.bar{display:flex;gap:10px;justify-content:center;padding:10px;background:#14213D}.bar button,.bar a{font:600 14px 'Noto Sans Bengali';padding:7px 14px;border-radius:8px;border:0;background:#F5A524;color:#111;text-decoration:none;cursor:pointer}
.m{background:#fff;max-width:900px;margin:14px auto;padding:24px 28px;border-radius:6px}
.c{text-align:center}.h{margin:0;font-size:15px}.f{float:right;border:1px solid #111;padding:2px 8px;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #333;padding:5px 6px;vertical-align:top}th{background:#f3f4f6;font-weight:600;font-size:12px}
.n{text-align:right;white-space:nowrap}.meta td{border:0;padding:2px 0}.sig{display:flex;justify-content:space-between;margin-top:40px}.sig div{border-top:1px solid #333;padding-top:4px;min-width:220px;text-align:center}
.note{font-size:11.5px;color:#444;margin-top:12px}.warn{background:#fff7ed;border:1px solid #fdba74;padding:8px 10px;border-radius:6px;margin-bottom:10px}
@media print{.bar,.warn{display:none}body{background:#fff}.m{margin:0;max-width:none;border-radius:0;padding:10mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨️ প্রিন্ট / PDF</button><a href="/admin/orders/${o.id}">← অর্ডারে ফিরুন</a></div>
<div class="m">
  ${mode === 'none' || mode === 'turnover' ? html`<p class="warn">⚠️ আপনার ভ্যাট সেটিং এখন "${MODES[mode] || MODES.none}"। মূসক-৬.৩ কর চালানপত্র সাধারণত ভ্যাট নিবন্ধিত (BIN আছে) ব্যবসার জন্য। দরকার হলে <a href="/admin/accounts/vat">ভ্যাট সেটিং</a> বদলান।</p>` : ''}
  ${!s.vat_bin ? html`<p class="warn">⚠️ BIN দেওয়া নেই — <a href="/admin/accounts/vat">ভ্যাট সেটিংস</a>-এ BIN দিন, তাহলে চালানে বসবে।</p>` : ''}
  <span class="f">মূসক-৬.৩</span>
  <p class="c h">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার<br>জাতীয় রাজস্ব বোর্ড</p>
  <p class="c" style="font-size:16px;font-weight:700;margin:6px 0">কর চালানপত্র</p>
  <p class="c" style="margin:0">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) ও দফা (চ) দ্রষ্টব্য]</p>
  <table class="meta" style="margin-top:12px"><tr>
    <td style="width:60%">নিবন্ধিত ব্যক্তির নাম: <b>${s.store_name}</b><br>নিবন্ধিত ব্যক্তির বিআইএন: <b>${s.vat_bin || '—'}</b><br>চালানপত্র ইস্যুর ঠিকানা: ${s.address || '—'}</td>
    <td>চালানপত্র নম্বর: <b>${o.code}</b><br>ইস্যুর তারিখ: ${fmtDate(new Date().toISOString(), false)}<br>ইস্যুর সময়: ${new Date(Date.now() + 6 * 3600e3).toISOString().slice(11, 16)}</td>
  </tr><tr>
    <td>ক্রেতার নাম: <b translate="no">${o.customer_name}</b> (${o.phone})<br>ক্রেতার বিআইএন: —<br>সরবরাহের গন্তব্যস্থল: ${o.address}${o.thana ? `, ${o.thana}` : ''}${o.district ? `, ${o.district}` : ''}</td>
    <td>যানবাহনের প্রকৃতি ও নম্বর: ${o.courier ? `${o.courier}${o.consignment_id ? ' · ' + o.consignment_id : ''}` : '—'}<br>অর্ডারের তারিখ: ${fmtDate(o.created_at, false)}</td>
  </tr></table>
  <table><thead><tr><th>ক্রমিক</th><th>পণ্য বা সেবার বর্ণনা (প্রযোজ্য ক্ষেত্রে ব্র্যান্ড নামসহ)</th><th>সরবরাহের একক</th><th class="n">পরিমাণ</th><th class="n">একক মূল্য¹ (টাকায়)</th><th class="n">মোট মূল্য¹ (টাকায়)</th><th class="n">সম্পূরক শুল্কের হার</th><th class="n">মূল্য সংযোজন করের হার</th><th class="n">মূল্য সংযোজন করের পরিমাণ</th><th class="n">সকল প্রকার শুল্ক ও করসহ মূল্য</th></tr></thead>
  <tbody>${lines.map((l) => html`<tr><td class="c">${bn(l.i)}</td><td>${l.name}</td><td>${l.unit}</td><td class="n">${bn(l.qty)}</td><td class="n">${money(l.unitEx)}</td><td class="n">${money(l.value)}</td><td class="n">০%</td><td class="n">${mode === 'margin' ? 'মার্জিনে ' : ''}${bn(rate)}%</td><td class="n">${money(l.vat)}</td><td class="n">${money(l.gross)}</td></tr>`)}
  ${disc ? html`<tr><td></td><td colspan="4">ছাড়${o.coupon_code ? ` (${o.coupon_code})` : ''}</td><td class="n">− ${money(discSplit.value)}</td><td></td><td></td><td class="n">− ${money(discSplit.vat)}</td><td class="n">− ${money(disc)}</td></tr>` : ''}
  <tr><td></td><td colspan="4"><b>সর্বমোট</b></td><td class="n"><b>${money(tot.value - discSplit.value)}</b></td><td></td><td></td><td class="n"><b>${money(tot.vat - discSplit.vat)}</b></td><td class="n"><b>${money(tot.gross - disc)}</b></td></tr></tbody></table>
  <p class="note">ডেলিভারি চার্জ (${money(o.delivery)}) এই চালানের বাইরে। ¹ মূল্য সংযোজন কর ব্যতীত মূল্য। ${mode === 'margin' ? 'মার্জিন পদ্ধতিতে কর হিসাব করা হয়েছে।' : ''}</p>
  <div class="sig"><div>প্রতিষ্ঠান কর্তৃপক্ষের দায়িত্বপ্রাপ্ত ব্যক্তির নাম, পদবি ও স্বাক্ষর</div><div>সিল</div></div>
  <p class="note">* উৎসে কর্তনযোগ্য সরবরাহের ক্ষেত্রে ফরমটি সমন্বিত কর চালানপত্র ও উৎসে কর কর্তন সনদপত্র হিসেবে বিবেচিত হবে এবং উহা উৎসে কর কর্তনযোগ্য সরবরাহের ক্ষেত্রে প্রযোজ্য হবে।</p>
</div></body></html>`.s;
  await ctx.log('mushak63', 'order', o.id, 'মূসক-৬.৩ চালান দেখা/প্রিন্ট');
  return ctx.send(ctx.res, 200, page);
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/accounts/vat/return', perm: 'accounting', handler: returnPage },
    { method: 'GET', path: /^\/admin\/orders\/(\d+)\/mushak$/, perm: 'orders', handler: mushak63 },
  ],
  MODES, split, nextMonth15,
};
void raw;

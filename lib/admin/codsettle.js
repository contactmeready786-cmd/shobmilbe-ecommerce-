'use strict';
// Admin → হিসাব → 🚚 কুরিয়ারের COD টাকা মিলানো.
// Couriers collect cash-on-delivery money from customers and pay the shop later (minus their charge).
// Here: per courier, which delivered parcels are still unpaid by the courier and how much that is; tick the parcels a
// courier payment covers (or paste their consignment numbers from the courier's payment report), write what came in
// → those parcels are marked settled, and the money (and the courier's charge) can go into the accounts.
const { html, raw, int, str, bn, money, fmtDate, ymd, round2, amount } = require('../util');
const db = require('../db');
const ui = require('./ui');
const courier = require('../services/courier');
const finance = require('../models/finance');

const BASE = '/admin/accounts/cod';
// what the courier collects for an order: the total minus what was paid before delivery (gift card, advance)
const COD_EXPR = `greatest(0, o.total - o.gift_amount - CASE WHEN o.payment IN ('bkash','ssl') OR o.payment LIKE 'manual_%' THEN o.total ELSE 0 END)`;

async function summary() {
  return db.q(`SELECT o.courier, count(*) FILTER (WHERE o.cod_settlement_id IS NULL)::int AS open_n,
      coalesce(sum(${COD_EXPR}) FILTER (WHERE o.cod_settlement_id IS NULL),0)::numeric(14,2) AS open_amount,
      min(coalesce(o.delivered_at, o.updated_at)) FILTER (WHERE o.cod_settlement_id IS NULL) AS oldest,
      count(*) FILTER (WHERE o.cod_settlement_id IS NOT NULL)::int AS done_n
    FROM orders o WHERE o.status='delivered' AND o.courier <> '' AND o.courier <> 'self' AND o.source <> 'pos'
    GROUP BY o.courier ORDER BY open_amount DESC`);
}

async function page(ctx) {
  const list = await summary();
  const cur = str(ctx.query.get('courier'), 30) || (list.find((x) => x.open_n) || list[0] || {}).courier || '';
  const [open, settlements, accounts, month] = await Promise.all([
    cur ? db.q(`SELECT o.id, o.code, o.customer_name, o.consignment_id, o.tracking_code, o.total, o.delivery, o.gift_amount, o.payment, coalesce(o.delivered_at, o.updated_at) AS at, ${COD_EXPR} AS cod
      FROM orders o WHERE o.status='delivered' AND o.courier=$1 AND o.cod_settlement_id IS NULL AND o.source <> 'pos' ORDER BY coalesce(o.delivered_at, o.updated_at) LIMIT 500`, [cur]) : [],
    db.q(`SELECT c.*, s.name AS staff_name, a.name AS account_name FROM cod_settlements c LEFT JOIN staff s ON s.id=c.staff_id LEFT JOIN accounts a ON a.id=c.account_id ORDER BY c.id DESC LIMIT 30`),
    finance.listAccounts(),
    db.one(`SELECT coalesce(sum(received),0)::numeric(14,2) AS received, coalesce(sum(fee),0)::numeric(14,2) AS fee FROM cod_settlements WHERE date_trunc('month', settled_on) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date)`),
  ]);
  const totalOpen = list.reduce((s, x) => s + Number(x.open_amount), 0);
  const days = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
  const body = html`<div class="title-row"><h1>🚚 কুরিয়ারের COD টাকা মিলানো</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${BASE}${cur ? `?courier=${cur}` : ''}">🔄 রিফ্রেশ</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('কুরিয়ারের কাছে পাওনা', money(totalOpen), 'ডেলিভারি হয়েছে, টাকা এখনো আসেনি', totalOpen > 0 ? 'kpi-alert' : 'kpi-green')}
  ${ui.kpi('এই মাসে পেয়েছেন', money(month.received), `কুরিয়ার চার্জ কেটেছে ${money(month.fee)}`, 'kpi-blue')}
</div>
${ui.helpBox('কীভাবে মিলাবেন', html`<ol class="steps">
  <li>কুরিয়ার (Steadfast/Pathao/RedX…) টাকা পাঠালে তাদের প্যানেলের পেমেন্ট রিপোর্ট খুলুন — কোন কোন পার্সেলের টাকা দিয়েছে সেখানে লেখা থাকে।</li>
  <li>নিচের তালিকায় সেই পার্সেলগুলোয় টিক দিন — অথবা রিপোর্ট থেকে কনসাইনমেন্ট/ট্র্যাকিং নম্বরগুলো কপি করে "নম্বর পেস্ট করুন" ঘরে দিন, নিজে থেকে টিক পড়বে।</li>
  <li>কত টাকা হাতে/ব্যাংকে এসেছে লিখুন — কুরিয়ার চার্জ নিজে থেকে হিসাব হবে। অ্যাকাউন্ট বাছলে হিসাবেও লেখা হবে (COD টাকা জমা + কুরিয়ার চার্জ খরচ)।</li>
  <li>অনেক দিন ধরে টাকা না এলে সেই পার্সেল লাল দেখাবে — কুরিয়ারকে জিজ্ঞেস করুন।</li>
</ol>`)}
<div class="chips">${list.map((x) => html`<a class="chip ${x.courier === cur ? 'on' : ''}" href="${BASE}?courier=${encodeURIComponent(x.courier)}">${courier.label(x.courier)} <b>${money(x.open_amount)}</b> <small>(${bn(x.open_n)})</small></a>`)}</div>
${!list.length ? ui.empty('এখনো কোনো কুরিয়ারে পাঠানো ডেলিভারি হওয়া অর্ডার নেই।') : html`
<form method="post" action="${BASE}" class="panel" data-cod-form>
  <input type="hidden" name="courier" value="${cur}">
  <h2>${courier.label(cur)} — টাকা আসেনি এমন পার্সেল <small>${bn(open.length)}টি</small></h2>
  ${open.length ? html`
  <details class="mt"><summary class="btn btn-sm btn-ghost">📋 নম্বর পেস্ট করে বাছাই</summary>
    <textarea rows="3" placeholder="কুরিয়ারের রিপোর্ট থেকে কনসাইনমেন্ট / ট্র্যাকিং / অর্ডার নম্বরগুলো (যেকোনো ফরম্যাটে)" data-cod-paste class="w-full"></textarea>
    <button type="button" class="btn btn-sm" data-cod-pick>এগুলোয় টিক দিন</button> <span class="small" data-cod-pick-msg></span></details>
  <div class="table-wrap"><table class="table compact"><thead><tr><th><input type="checkbox" data-check-all aria-label="সব বাছুন"></th><th>অর্ডার</th><th>কনসাইনমেন্ট</th><th>ডেলিভারি</th><th class="num">COD টাকা</th></tr></thead><tbody>
  ${open.map((o) => html`<tr class="${days(o.at) > 10 ? 'row-warn' : ''}"><td><input type="checkbox" name="ids" value="${o.id}" data-check-row data-cod="${Number(o.cod)}" data-keys="${[o.code, o.consignment_id, o.tracking_code].filter(Boolean).join(' ').toUpperCase()}" aria-label="${o.code}"></td>
    <td><a href="/admin/orders/${o.id}" class="mono">${o.code}</a><br><span class="small muted">${o.customer_name}</span></td><td class="mono small">${o.consignment_id || o.tracking_code || '—'}</td>
    <td class="small">${fmtDate(o.at, false)}<br><span class="${days(o.at) > 10 ? 'warn' : 'muted'}">${bn(days(o.at))} দিন</span></td><td class="num">${money(o.cod)}</td></tr>`)}
  </tbody></table></div>
  <div class="cod-pay">
    <p>বাছাই: <b data-cod-n>০</b>টি পার্সেল · COD মোট <b data-cod-sum>৳০</b></p>
    <div class="field-row">
      ${ui.field('কত টাকা পেয়েছেন (৳)', ui.input('received', '', { type: 'number', step: '0.01', min: 0, required: true, 'data-cod-received': true }))}
      ${ui.field('কুরিয়ার চার্জ (৳)', ui.input('fee', '', { type: 'number', step: '0.01', min: 0, 'data-cod-fee': true }), 'খালি = COD মোট − যা পেয়েছেন')}
      ${ui.field('তারিখ', ui.input('settled_on', ymd(), { type: 'date' }))}
    </div>
    <div class="field-row">
      ${ui.field('কুরিয়ারের পেমেন্ট/ইনভয়েস নম্বর', ui.input('ref', '', { maxlength: 80 }))}
      ${ctx.can('accounting') ? ui.field('টাকা কোন অ্যাকাউন্টে এসেছে', ui.select('account_id', [['', '— হিসাবে লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`])], '')) : ''}
    </div>
    ${ui.field('নোট', ui.input('note', '', { maxlength: 200 }))}
    <button class="btn">✅ বাছাই করা পার্সেলের টাকা পেয়েছি</button>
  </div>` : html`<p class="muted">🎉 এই কুরিয়ারের সব ডেলিভারির টাকা এসে গেছে।</p>`}
</form>`}
<section class="panel table-wrap"><h2>আগের পেমেন্টগুলো</h2>
  ${settlements.length ? html`<table class="table compact"><thead><tr><th>তারিখ</th><th>কুরিয়ার</th><th>নম্বর</th><th class="num">পার্সেল</th><th class="num">COD</th><th class="num">চার্জ</th><th class="num">পেয়েছেন</th><th>অ্যাকাউন্ট</th><th></th></tr></thead><tbody>
  ${settlements.map((c) => html`<tr><td class="small">${String(c.settled_on).slice(0, 10)}</td><td>${courier.label(c.courier)}</td><td class="small mono">${c.ref || '—'}</td><td class="num">${bn(c.order_count)}</td>
    <td class="num">${money(c.collected)}</td><td class="num">${money(c.fee)}</td><td class="num"><b>${money(c.received)}</b></td><td class="small">${c.account_name || '—'}<br><span class="muted">${c.staff_name || ''}</span></td>
    <td><form method="post" action="${BASE}/undo" data-confirm="এই পেমেন্ট মুছে পার্সেলগুলো আবার “টাকা আসেনি” তালিকায় ফেরত নেবেন? (হিসাবে লেখা এন্ট্রি থাকলে সেগুলোও মুছবে)"><input type="hidden" name="id" value="${c.id}"><button class="link-btn danger small">ফেরত নিন</button></form></td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কিছু নেই।</p>`}
</section>
<script>${raw(`(function(){var f=document.querySelector('[data-cod-form]');if(!f)return;var n=f.querySelector('[data-cod-n]'),s=f.querySelector('[data-cod-sum]'),rc=f.querySelector('[data-cod-received]'),fe=f.querySelector('[data-cod-fee]');
function bn(x){return String(x).replace(/\\d/g,function(d){return '০১২৩৪৫৬৭৮৯'[d];});}
function sum(){var t=0,c=0;f.querySelectorAll('[data-check-row]:checked').forEach(function(x){t+=Number(x.getAttribute('data-cod'))||0;c++;});n.textContent=bn(c);s.textContent='৳'+bn(Math.round(t*100)/100);if(fe&&rc&&rc.value!=='')fe.placeholder=bn(Math.max(0,Math.round((t-Number(rc.value))*100)/100));return t;}
f.addEventListener('change',sum);if(rc)rc.addEventListener('input',sum);
var pk=f.querySelector('[data-cod-pick]');if(pk)pk.addEventListener('click',function(){var words=(f.querySelector('[data-cod-paste]').value.toUpperCase().match(/[A-Z0-9-]{4,}/g)||[]);var hit=0;f.querySelectorAll('[data-check-row]').forEach(function(x){var k=' '+x.getAttribute('data-keys')+' ';if(words.some(function(w){return k.indexOf(' '+w+' ')>-1;})){x.checked=true;hit++;}});f.querySelector('[data-cod-pick-msg]').textContent=bn(hit)+'টি মিলেছে';sum();});sum();})();`)}</script>`;
  return ctx.page('কুরিয়ারের COD মিলানো', body, 'acc-cod');
}

async function save(ctx) {
  const b = await ctx.body();
  const ids = [].concat(b.ids || []).map((x) => int(x)).filter(Boolean).slice(0, 1000);
  const back = `${BASE}?courier=${encodeURIComponent(str(b.courier, 30))}`;
  if (!ids.length) return ctx.fail(back, 'যে পার্সেলগুলোর টাকা পেয়েছেন সেগুলোয় টিক দিন।');
  const received = round2(amount(b.received));
  const res = await db.tx(async (t) => {
    const rows = (await t.query(`SELECT o.id, ${COD_EXPR} AS cod FROM orders o WHERE o.id = ANY($1::int[]) AND o.status='delivered' AND o.courier=$2 AND o.cod_settlement_id IS NULL FOR UPDATE`, [ids, str(b.courier, 30)])).rows;
    if (!rows.length) throw new Error('বাছাই করা পার্সেলগুলো আগেই মিলানো হয়েছে।');
    const collected = round2(rows.reduce((s, r) => s + Number(r.cod), 0));
    const fee = b.fee !== undefined && b.fee !== '' ? round2(amount(b.fee)) : round2(Math.max(0, collected - received));
    const c = (await t.query(`INSERT INTO cod_settlements(courier, ref, settled_on, collected, fee, received, account_id, order_count, note, staff_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [str(b.courier, 30), str(b.ref, 80), /^\d{4}-\d{2}-\d{2}$/.test(b.settled_on || '') ? b.settled_on : ymd(),
      collected, fee, received, int(b.account_id) || null, rows.length, str(b.note, 200), ctx.user.id])).rows[0];
    // the courier's charge, shared over the parcels (for each order's own profit)
    for (const r of rows) await t.query('UPDATE orders SET cod_settlement_id=$1, courier_fee=$2 WHERE id=$3', [c.id, collected ? round2(fee * (Number(r.cod) / collected)) : 0, r.id]);
    return { id: c.id, n: rows.length, collected, fee };
  }).catch((e) => ({ error: e.message }));
  if (res.error) return ctx.fail(back, res.error);
  if (int(b.account_id) && ctx.can('accounting')) {
    const note = `${courier.label(b.courier)} COD${b.ref ? ` #${str(b.ref, 60)}` : ''} (${res.n}টি পার্সেল)`;
    const tx1 = await finance.addTransaction({ type: 'income', category: 'কুরিয়ার থেকে COD টাকা', amount: res.collected, account_id: b.account_id, tx_date: b.settled_on, note }, ctx.user.id).catch(() => null);
    const tx2 = res.fee > 0 ? await finance.addTransaction({ type: 'expense', category: 'কুরিয়ার চার্জ', amount: res.fee, account_id: b.account_id, tx_date: b.settled_on, note }, ctx.user.id).catch(() => null) : null;
    await db.q('UPDATE cod_settlements SET note = left(note || $1, 300) WHERE id=$2', [` [tx:${[tx1, tx2].filter(Boolean).map((x) => x.id || x).join(',')}]`, res.id]);
  }
  await ctx.log('cod_settle', 'settings', res.id, `${courier.label(b.courier)}: ${res.n}টি পার্সেল, পেয়েছেন ৳${received}`);
  return ctx.redirect(ctx.res, back + '&info=' + encodeURIComponent(`✅ ${bn(res.n)}টি পার্সেল মিলানো হয়েছে — COD ${money(res.collected)}, চার্জ ${money(res.fee)}, পেয়েছেন ${money(received)}।`));
}

async function undo(ctx) {
  const b = await ctx.body();
  const c = await db.one('SELECT * FROM cod_settlements WHERE id=$1', [int(b.id)]);
  if (!c) return ctx.back(BASE);
  await db.tx(async (t) => {
    await t.query('UPDATE orders SET cod_settlement_id=NULL, courier_fee=0 WHERE cod_settlement_id=$1', [c.id]);
    const m = String(c.note || '').match(/\[tx:([\d,]+)\]/);
    if (m) await t.query('DELETE FROM transactions WHERE id = ANY($1::int[]) AND category IN (\'কুরিয়ার থেকে COD টাকা\', \'কুরিয়ার চার্জ\')', [m[1].split(',').map(Number)]);
    await t.query('DELETE FROM cod_settlements WHERE id=$1', [c.id]);
  });
  await ctx.log('cod_undo', 'settings', c.id, `${courier.label(c.courier)} COD মিলানো ফেরত নেওয়া (${c.order_count}টি পার্সেল)`);
  return ctx.back(`${BASE}?courier=${encodeURIComponent(c.courier)}`, 'saved');
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'accounting', handler: page },
    { method: 'POST', path: BASE, perm: 'accounting', handler: save },
    { method: 'POST', path: `${BASE}/undo`, perm: 'accounting', handler: undo },
  ],
};

// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → পণ্য → (a product) → 📒 কেনা-বেচার হিসাব (owner only, 2026-10-14).
// One page per product: every buy (date, supplier, how many, price per piece), every stock change, what the sales
// earned and the profit — all worked out from purchases, orders and stock entries, nothing typed by hand.
// The stock and the buying price can't be typed over on the product form any more; the only hand change here is a
// "কেনা দাম সংশোধন" (a wrong price put right) and it needs a reason, which is kept in the price history.
import { html, money, bn, int, str, fmtDate, pct } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as catalog from '../models/catalog';

const dateOf = (b) => (b.purchase_date ? fmtDate(b.purchase_date + 'T06:00:00Z', false) : fmtDate(b.created_at, false));

async function page(ctx, m) {
  const id = int(m[1]);
  const p = await db.one(`SELECT id, name, sku, price, cost_price, stock, damaged_stock, unit, product_type, parent_id, variant_label, variant_count
    FROM products WHERE id=$1`, [id]);
  if (!p) return ctx.redirect(ctx.res, '/admin/products');
  const self = `/admin/products/${id}/ledger`;
  if (p.variant_count > 0) return ctx.fail(`/admin/products/${id}/variants`, 'এই পণ্যের হিসাব প্রতিটা ভ্যারিয়েন্টে আলাদা — ভ্যারিয়েন্টের পাশে "📒 হিসাব" চাপুন।');

  if (ctx.method === 'POST') {
    if (ctx.readOnly) return ctx.back(self, 'noperm');
    const b = await ctx.body();
    try {
      const changed = await catalog.correctCost(id, b.cost, b.reason, ctx.user.id);
      if (changed) await ctx.log('cost_fix', 'product', id, `${p.name}: কেনা দাম সংশোধন → ${money(b.cost)} (${str(b.reason, 150)})`);
    } catch (e) {
      return ctx.fail(self, e.message);
    }
    return ctx.back(self, 'saved');
  }

  const [L, prices] = await Promise.all([catalog.productLedger(id, { limit: 300 }), catalog.priceHistory(id, { withCost: true, limit: 50 })]);
  const s = L.sales;
  const editUrl = p.parent_id ? `/admin/products/${p.parent_id}/variants` : `/admin/products/${id}`;
  const perPiece = Number(p.price) - Number(p.cost_price || 0);
  const bundle = p.product_type === 'bundle';

  const body = html`<p class="crumbs"><a href="${editUrl}">← ${p.parent_id ? 'ভ্যারিয়েন্ট' : 'পণ্যে ফিরে যান'}</a></p>
<div class="title-row"><h1>📒 কেনা-বেচার হিসাব <small>${p.name}${p.sku ? ` · SKU ${p.sku}` : ''}</small></h1>
  ${bundle ? '' : html`<div class="row-actions"><a class="btn" href="/admin/purchases/new?add=${id}">➕ মাল কিনেছি (পারচেজ)</a><a class="btn btn-ghost" href="/admin/inventory?q=${encodeURIComponent(p.sku || p.name)}">🔧 স্টক ঠিক করুন</a></div>`}</div>
${ui.flash(ctx.flash)}
${ui.helpBox('এই হিসাব কীভাবে চলে', html`<ol class="steps">
  <li><b>মাল কিনলে</b> "➕ মাল কিনেছি" দিয়ে পারচেজ এন্ট্রি দিন — তারিখ, সাপ্লায়ার, কয়টি আর প্রতি পিসের দাম। স্টক নিজে থেকে বাড়ে, আর এখানে কেনার ইতিহাসে ওঠে।</li>
  <li><b>কেনা দাম</b> = এখন হাতে থাকা মালের গড় দাম। নতুন দামে কিনলে নিজে থেকে গড় হয় (যেমন ১০টি ৳১০০ + ১০টি ৳১২০ → ৳১১০)। গাড়িভাড়া/অন্য খরচ পারচেজে দিলে সেটাও দামের সাথে ভাগ হয়ে যোগ হয়।</li>
  <li><b>বিক্রি হলে</b> সেই মুহূর্তের কেনা দাম অর্ডারের সাথে সেভ হয়ে যায় — পরে কেনা দাম বদলালেও আগের বিক্রির লাভ বদলায় না। অর্ডার বাতিল/ফেরত হলে স্টক ফেরত আসে আর লাভ থেকে বাদ যায়।</li>
  <li><b>লাভ</b> = বিক্রির দাম − কেনা দাম, নিজে থেকে হিসাব হয়। খরচ (ভাড়া, প্যাকেট, ডেলিভারি) বাদ দিয়ে আসল লাভ দেখতে: <a href="/admin/accounts/pnl">লাভ-ক্ষতি</a>।</li>
  <li><b>স্টক</b> হাতে বসানো যায় না। নষ্ট, হারানো বা গুনে কম-বেশি পেলে ইনভেন্টরিতে কারণসহ "ঠিক করুন" — সব নিচের খাতায় লেখা থাকে।</li>
</ol>`)}

<div class="kpis">
  ${ui.kpi('এখন স্টক', `${bn(p.stock)} ${p.unit || 'টি'}`, Number(p.damaged_stock) ? `নষ্ট আলাদা: ${bn(p.damaged_stock)}টি` : '')}
  ${ui.kpi('কেনা দাম (গড়)', Number(p.cost_price) > 0 ? money(p.cost_price) : 'দেওয়া নেই', L.avgBuy !== null ? `সব কেনার গড়: ${money(Math.round(L.avgBuy * 100) / 100)}` : '', Number(p.cost_price) > 0 ? '' : 'kpi-alert')}
  ${ui.kpi('বিক্রির দাম', money(p.price), Number(p.cost_price) > 0 ? `প্রতি পিসে লাভ ${money(perPiece)}${Number(p.price) > 0 ? ` (${pct((perPiece / Number(p.price)) * 100)})` : ''}` : '')}
  ${ui.kpi('হাতের মালের দাম', money(Math.max(0, p.stock) * Number(p.cost_price || 0)), 'স্টক × কেনা দাম')}
  ${ui.kpi('মোট লাভ এই পণ্যে', money(s.profit), `${bn(s.qty)}টি বিক্রি থেকে`, s.profit >= 0 ? 'kpi-green' : 'kpi-red')}
</div>

<section class="panel">
  <h2>💰 বিক্রি ও লাভ <small>বাতিল/ফেরত অর্ডার বাদে, সব সময়ের</small></h2>
  <table class="table compact ledger-sum"><tbody>
    <tr><td>বিক্রি হয়েছে</td><td class="num">${bn(s.qty)}টি · ${bn(s.orders)}টি অর্ডারে${s.delivered_qty !== s.qty ? ` (ডেলিভারি হয়েছে ${bn(s.delivered_qty)}টি)` : ''}</td></tr>
    <tr><td>বিক্রি থেকে টাকা</td><td class="num">${money(s.revenue)}</td></tr>
    <tr><td>− বিক্রি হওয়া মালের কেনা দাম</td><td class="num">${money(s.cost)}</td></tr>
    <tr class="total"><td>= লাভ</td><td class="num ${s.profit < 0 ? 'warn' : 'good'}"><b>${money(s.profit)}</b>${Number(s.revenue) > 0 ? html` <span class="small">(${pct((s.profit / Number(s.revenue)) * 100)})</span>` : ''}</td></tr>
  </tbody></table>
  ${s.no_cost_qty ? html`<p class="small warn">⚠️ ${bn(s.no_cost_qty)}টি বিক্রির সময় কেনা দাম দেওয়া ছিল না, তাই সেগুলোর পুরো টাকাই লাভ ধরা হয়েছে।</p>` : ''}
  <p class="small muted">অর্ডারের ছাড় (কুপন) আর ডেলিভারি খরচ এখানে ধরা নেই — সেগুলোসহ দোকানের মোট হিসাব: <a href="/admin/reports?tab=profit">রিপোর্ট → লাভ ও মার্জিন</a>।</p>
</section>

<section class="panel">
  <h2>🧾 কেনার ইতিহাস <small>কবে, কার কাছ থেকে, কয়টি, কত দামে</small></h2>
  ${L.buys.length ? html`<div class="table-wrap"><table class="table compact">
    <thead><tr><th>তারিখ</th><th>কোথা থেকে</th><th class="num">কয়টি</th><th class="num">প্রতি পিস</th><th class="num">মোট</th><th>এন্ট্রি</th></tr></thead>
    <tbody>${L.buys.map((b) => html`<tr class="${b.purchase_status === 'cancelled' ? 'row-cancelled' : ''}">
      <td class="small">${dateOf(b)}</td>
      <td>${b.reason === 'opening' ? html`<span class="muted">শুরুর স্টক</span>` : b.supplier_id ? html`<a href="/admin/suppliers/${b.supplier_id}">${b.supplier_name}</a>` : html`<span class="muted">—</span>`}</td>
      <td class="num">${bn(b.change)}</td>
      <td class="num">${b.unit_cost !== null ? money(b.unit_cost) : html`<span class="muted">—</span>`}</td>
      <td class="num">${b.unit_cost !== null ? money(b.change * Number(b.unit_cost)) : '—'}</td>
      <td class="small">${b.ref_type === 'purchase' && b.ref_id ? html`<a href="/admin/purchases/${b.ref_id}">${b.purchase_code || 'পারচেজ'}</a>${b.purchase_status === 'cancelled' ? ' (বাতিল)' : ''}` : ''}${b.staff_name ? html`<br><span class="muted">${b.staff_name}</span>` : ''}</td></tr>`)}</tbody>
    <tfoot><tr class="total"><td colspan="2">মোট কেনা (বাতিল বাদে)</td><td class="num">${bn(L.boughtQty)}</td><td class="num">${L.avgBuy !== null ? money(Math.round(L.avgBuy * 100) / 100) : ''}</td><td class="num">${money(L.spent)}</td><td></td></tr></tfoot>
  </table></div>
  ${L.pricedQty < L.boughtQty ? html`<p class="small muted">"—" = পুরোনো এন্ট্রি, তখন দাম আলাদা রাখা হতো না।</p>` : ''}`
    : html`<p class="muted">এখনো কোনো কেনার এন্ট্রি নেই। ${bundle ? '' : html`<a href="/admin/purchases/new?add=${id}">প্রথম পারচেজ দিন →</a>`}</p>`}
</section>

${bundle ? '' : html`<section class="panel">
  <h2>✏️ কেনা দাম সংশোধন <small>শুধু ভুল ঠিক করতে</small></h2>
  <p class="small muted">নতুন মাল কিনলে এখানে নয় — "➕ মাল কিনেছি" দিয়ে পারচেজ দিন। শুধু ভুল দাম বসানো থাকলে বা কখনো দাম দেওয়া না হলে এখানে ঠিক করুন। কে, কবে, কেন বদলালো নিচের দামের ইতিহাসে থাকবে, আর আগের বিক্রির লাভ বদলাবে না।</p>
  <form method="post" action="${self}" class="form" data-confirm="কেনা দাম বদলাবেন? এরপর থেকে বিক্রিতে নতুন দাম ধরা হবে।">
    <div class="field-row">
      ${ui.field('সঠিক কেনা দাম (৳, প্রতি পিস)', ui.input('cost', p.cost_price ?? '', { type: 'number', min: 0, step: '0.01', required: true }))}
      ${ui.field('কেন বদলাচ্ছেন', ui.input('reason', '', { maxlength: 150, required: true, placeholder: 'যেমন: ভুল দাম বসানো ছিল' }))}
    </div>
    ${ctx.readOnly ? '' : html`<button class="btn btn-sm">সংশোধন সেভ করুন</button>`}
  </form>
</section>`}

<section class="panel">
  <h2>📦 স্টকের খাতা <small>প্রতিটা আসা-যাওয়া</small></h2>
  ${L.moves.length ? html`<div class="table-wrap"><table class="table compact">
    <thead><tr><th>কখন</th><th>কী হলো</th><th class="num">বদল</th><th class="num">পরে স্টক</th><th>কে</th></tr></thead>
    <tbody>${L.moves.map((mv) => html`<tr>
      <td class="small">${fmtDate(mv.created_at)}</td>
      <td class="small">${catalog.STOCK_REASONS[mv.reason] || mv.reason}${mv.ref_type === 'order' && mv.ref_id ? html` · <a href="/admin/orders/${mv.ref_id}">অর্ডার</a>` : ''}${mv.ref_type === 'purchase' && mv.ref_id ? html` · <a href="/admin/purchases/${mv.ref_id}">পারচেজ</a>` : ''}${mv.unit_cost !== null && mv.unit_cost !== undefined ? ` · ${money(mv.unit_cost)}/পিস` : ''}${mv.note ? ` · ${mv.note}` : ''}</td>
      <td class="num ${mv.change < 0 ? 'warn' : 'good'}">${mv.change > 0 ? '+' : ''}${bn(mv.change)}</td>
      <td class="num">${mv.balance !== null ? bn(mv.balance) : '—'}</td>
      <td class="small muted">${mv.staff_name || (mv.ref_type === 'order' ? 'কাস্টমার অর্ডার' : 'সিস্টেম')}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কোনো আসা-যাওয়া নেই।</p>`}
</section>

${prices.length ? html`<section class="panel">
  <h2>🏷️ দামের ইতিহাস</h2>
  <ul class="timeline">${prices.map((h) => html`<li>${h.action === 'cost_change' ? '🔒 ' : ''}${h.detail.replace(/^[^:]*:\s*/, '')}<br><span class="small muted">${fmtDate(h.created_at)} · ${h.staff_name || 'সিস্টেম'}</span></li>`)}</ul>
</section>` : ''}`;
  return ctx.page(`হিসাব — ${p.name}`, body, 'products');
}

export const routes = [
    { method: '*', path: /^\/admin\/products\/(\d+)\/ledger$/, perm: 'see_cost', handler: page },
  ];

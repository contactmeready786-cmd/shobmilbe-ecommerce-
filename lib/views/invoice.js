'use strict';
// Printable invoice, used by admin (single + bulk) and by customers.
const { html, raw, money, bn, fmtDate, esc } = require('../util');
const ordersModel = require('../models/orders');

function invoiceBody(order, settings) {
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  return html`<section class="inv">
  <header class="inv-head">
    <div>
      ${settings.logo_id ? html`<img class="inv-logo" src="/media/${settings.logo_id}" alt="${settings.store_name}">` : html`<p class="inv-name">${settings.store_name}</p>`}
      <p class="inv-small">${settings.address || ''}${settings.phone ? html`<br>📞 ${settings.phone}` : ''}${settings.email ? html`<br>✉ ${settings.email}` : ''}${settings.site_url ? html`<br>${settings.site_url.replace(/^https?:\/\//, '')}` : ''}</p>
    </div>
    <div class="inv-meta">
      <h1>ইনভয়েস</h1>
      <p>নম্বর: <b>${order.code}</b><br>তারিখ: ${fmtDate(order.created_at)}<br>
      পেমেন্ট: ${ordersModel.PAYMENT_METHODS[order.payment] || order.payment} (${ordersModel.PAYMENT_STATUSES[order.payment_status] || ''})
      ${order.consignment_id ? html`<br>কুরিয়ার: ${order.courier} · ${order.consignment_id}` : ''}</p>
    </div>
  </header>
  <div class="inv-to">
    <p class="inv-small">যাকে পাঠানো হবে</p>
    <p><b>${order.customer_name}</b> · ${order.phone}<br>${order.address}${area ? html`<br>${area}` : ''}</p>
    ${order.note ? html`<p class="inv-small">নোট: ${order.note}</p>` : ''}
  </div>
  <table class="inv-table">
    <thead><tr><th>#</th><th>পণ্য</th><th>SKU</th><th class="num">দাম</th><th class="num">পরিমাণ</th><th class="num">মোট</th></tr></thead>
    <tbody>${order.items.map((it, i) => html`<tr><td>${bn(i + 1)}</td><td>${it.name}</td><td>${it.sku || '—'}</td><td class="num">${money(it.price)}</td><td class="num">${bn(it.qty)}</td><td class="num">${money(it.price * it.qty)}</td></tr>`)}</tbody>
    <tfoot>
      <tr><td colspan="5">পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      ${order.discount ? html`<tr><td colspan="5">ছাড়${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
      <tr><td colspan="5">ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
      <tr class="inv-total"><td colspan="5">সর্বমোট</td><td class="num">${money(order.total)}</td></tr>
      ${order.paid_amount ? html`<tr><td colspan="5">পরিশোধিত</td><td class="num">${money(order.paid_amount)}</td></tr>` : ''}
      <tr class="inv-due"><td colspan="5">ডেলিভারির সময় নিতে হবে (COD)</td><td class="num">${money(due)}</td></tr>
    </tfoot>
  </table>
  <p class="inv-small inv-thanks">আমাদের থেকে কেনার জন্য ধন্যবাদ! কোনো সমস্যা হলে ${settings.phone ? esc(settings.phone) + ' নম্বরে' : 'আমাদের'} যোগাযোগ করুন।</p>
</section>`;
}

function invoicePage(orders, settings) {
  return '<!doctype html>' + html`<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ইনভয়েস ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;color:#14213D;margin:0;background:#EEF2F7}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#14213D}.bar button,.bar a{font:600 15px 'Noto Sans Bengali';padding:8px 16px;border-radius:8px;border:0;background:#F5A524;color:#14213D;cursor:pointer;text-decoration:none}
.inv{background:#fff;max-width:800px;margin:16px auto;padding:28px;border-radius:8px;page-break-after:always}
.inv-head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #14213D;padding-bottom:12px}
.inv-logo{max-height:56px;max-width:220px}.inv-name{font-size:26px;font-weight:700;margin:0;color:#0866D6}
.inv-meta{text-align:right}.inv-meta h1{margin:0 0 4px;font-size:22px}.inv-meta p{margin:0;font-size:14px}
.inv-small{font-size:13px;color:#5B6B85;margin:4px 0}.inv-to{padding:12px 0}.inv-to p{margin:2px 0}
.inv-table{width:100%;border-collapse:collapse;font-size:14px}.inv-table th{text-align:left;background:#F3F6FA;padding:8px}.inv-table td{padding:8px;border-bottom:1px solid #E6ECF4}
.num{text-align:right;white-space:nowrap}.inv-table tfoot td{border:0;padding:4px 8px}.inv-total td{font-weight:700;font-size:16px;border-top:2px solid #14213D!important}
.inv-due td{font-weight:700;background:#FFF8E8}.inv-thanks{margin-top:18px;text-align:center}
@media print{body{background:#fff}.bar{display:none}.inv{margin:0;border-radius:0;max-width:none;padding:10mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨️ প্রিন্ট করুন</button><a href="javascript:history.back()">← ফিরে যান</a></div>
${orders.map((o) => invoiceBody(o, settings))}
</body></html>`.s;
}

module.exports = { invoicePage, invoiceBody };
void raw;

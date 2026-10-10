'use strict';
// Printable invoice — only for the shop's admin and staff (Admin → অর্ডার → ইনভয়েস), single or many at once.
const { html, raw, money, bn, fmtDate, esc, roundOff } = require('../util');
const ordersModel = require('../models/orders');

// The same product on two lines (e.g. added twice while editing) is shown once with the quantities added up,
// so each product's picture appears only once.
function mergedItems(items) {
  const out = [];
  const seen = new Map();
  for (const it of items || []) {
    const key = it.product_id ? `${it.product_id}:${it.price}` : null;
    if (key && seen.has(key)) { seen.get(key).qty += it.qty; continue; }
    const row = { ...it };
    out.push(row);
    if (key) seen.set(key, row);
  }
  return out;
}

// The shop's mark for the top of the invoice: the uploaded logo, or the two-colour "সবমিলবে" wordmark
function brandMark(settings) {
  if (settings.logo_id) return html`<img class="iv-logo-img" src="/media/${settings.logo_id}" alt="${settings.store_name}">`;
  const name = settings.store_name || 'সবমিলবে';
  return html`<img class="iv-mark-img" src="/brand/favicon-192.png" alt="" aria-hidden="true"><span class="iv-word">${name === 'সবমিলবে' ? html`<b class="a">সব</b><b class="b">মিলবে</b>` : html`<b class="a">${name}</b>`}</span>`;
}
const WARRANTY_NOTE = 'ওয়ারেন্টি ডেলিভারির দিন থেকে গোনা হবে। ওয়ারেন্টি দাবি করতে এই ইনভয়েস আর পণ্যের বক্স রেখে দিন। পানি, আগুন, ভুল সংযোগ/ভোল্টেজ বা ভাঙার কারণে নষ্ট হলে ওয়ারেন্টি প্রযোজ্য নয়।';

function invoiceBody(order, settings) {
  const items = mergedItems(order.items);
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const wt = (it) => require('../models/catalog').warrantyText(it);
  const anyWarranty = items.some((it) => wt(it));
  const site = String(settings.site_url || '').replace(/\/+$/, '');
  const qr = site ? require('../services/qr').svg(`${site}/track?code=${order.code}`, { px: 84, label: 'অর্ডার ট্র্যাক' }) : '';
  const units = items.reduce((n, it) => n + Number(it.qty || 0), 0);
  return html`<section class="iv">
  <div class="iv-strip"></div>
  <header class="iv-head">
    <div class="iv-brand">
      <div class="iv-logo">${brandMark(settings)}</div>
      ${settings.tagline ? html`<p class="iv-tag">${settings.tagline}</p>` : ''}
      <p class="iv-contact">${settings.phone ? html`📞 ${settings.phone}` : ''}${settings.whatsapp ? html` · WhatsApp ${settings.whatsapp}` : ''}${site ? html` · 🌐 ${site.replace(/^https?:\/\//, '')}` : ''}${settings.address ? html`<br>📍 ${settings.address}` : ''}</p>
    </div>
    <div class="iv-title">
      <h1>ইনভয়েস</h1>
      <p class="iv-no"># <b>${order.code}</b></p>
      <p class="iv-date">${fmtDate(order.created_at)}</p>
    </div>
  </header>

  <div class="iv-cards">
    <div class="iv-card iv-to">
      <p class="iv-label">📦 প্রাপক</p>
      <p translate="no"><b class="iv-cname">${order.customer_name}</b><br><b>${order.phone}</b><br>${order.address}${area ? html`<br>${area}` : ''}</p>
      ${order.note ? html`<p class="iv-note">নোট: <span translate="no">${order.note}</span></p>` : ''}
    </div>
    <div class="iv-card">
      <p class="iv-label">🧾 অর্ডারের তথ্য</p>
      <p>পেমেন্ট: <b>${ordersModel.PAYMENT_METHODS[order.payment] || order.payment}</b> · ${ordersModel.PAYMENT_STATUSES[order.payment_status] || ''}<br>
      পণ্য: <b>${bn(items.length)}</b> ধরনের, মোট <b>${bn(units)}</b>টি${order.courier ? html`<br>কুরিয়ার: <b>${order.courier}</b>${order.consignment_id ? html` · ${order.consignment_id}` : ''}` : ''}</p>
    </div>
    ${qr ? html`<div class="iv-qr">${raw(qr)}<span>স্ক্যান করে<br>অর্ডার ট্র্যাক</span></div>` : ''}
  </div>

  <table class="iv-table">
    <thead><tr><th class="c">#</th><th>ছবি</th><th>পণ্যের নাম</th><th class="num">দাম</th><th class="num">পরিমাণ</th><th class="num">মোট</th></tr></thead>
    <tbody>${items.map((it, i) => html`<tr>
      <td class="c iv-sl">${bn(i + 1)}</td>
      <td class="iv-pic">${it.image_id ? html`<img src="/media/${it.image_id}/t" alt="">` : html`<span>${it.emoji || '📦'}</span>`}</td>
      <td><b class="iv-pname">${it.name}</b>
        <span class="iv-sub">${it.sku ? html`SKU ${it.sku}` : ''}${it.note ? html` · ${it.note}` : ''}</span>
        ${wt(it) ? html`<span class="iv-war">🛡️ ${wt(it)}</span>` : ''}</td>
      <td class="num">${money(it.price)}</td><td class="num"><b>${bn(it.qty)}</b></td><td class="num"><b>${money(it.price * it.qty)}</b></td></tr>`)}</tbody>
  </table>

  <div class="iv-bottom">
    <div class="iv-left">
      ${anyWarranty ? html`<div class="iv-box iv-wbox"><p class="iv-label">🛡️ ওয়ারেন্টির শর্ত</p><p>${settings.invoice_warranty_note || WARRANTY_NOTE}</p></div>` : ''}
      <div class="iv-box"><p class="iv-label">✅ পণ্য হাতে পেয়ে</p><p>${settings.invoice_note || 'ডেলিভারিম্যানের সামনে প্যাকেট খুলে পণ্য মিলিয়ে নিন। কোনো সমস্যা হলে ২৪ ঘণ্টার মধ্যে আমাদের জানান।'}</p></div>
    </div>
    <table class="iv-sum">
      <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      ${order.discount ? html`<tr><td>ছাড়${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
      ${Number(order.points_discount) ? html`<tr><td>পয়েন্ট ছাড়</td><td class="num">− ${money(order.points_discount)}</td></tr>` : ''}
      <tr><td>ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
      ${roundOff(order) ? html`<tr><td>রাউন্ড ফিগার</td><td class="num">${roundOff(order) > 0 ? '+ ' : '− '}${money(Math.abs(roundOff(order)))}</td></tr>` : ''}
      <tr class="iv-total"><td>সর্বমোট</td><td class="num">${money(order.total)}</td></tr>
      ${order.paid_amount ? html`<tr><td>আগে পরিশোধিত</td><td class="num">− ${money(order.paid_amount)}</td></tr>` : ''}
      <tr class="${due ? 'iv-due' : 'iv-paid'}"><td>${due ? 'ডেলিভারির সময় দিতে হবে' : 'পুরো টাকা পরিশোধিত'}</td><td class="num">${due ? money(due) : '✅'}</td></tr>
    </table>
  </div>

  <footer class="iv-foot">
    <p class="iv-thanks">${settings.store_name || 'সবমিলবে'} থেকে কেনার জন্য ধন্যবাদ! 💙</p>
    <p>আবার কিনতে বা জানতে: ${settings.phone ? html`<b>${settings.phone}</b>` : ''}${site ? html` · <b>${site.replace(/^https?:\/\//, '')}</b>` : ''}</p>
  </footer>
</section>`;
}

function invoicePage(orders, settings) {
  return '<!doctype html>' + html`<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ইনভয়েস ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;color:#14213D;margin:0;background:#E9EEF5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#14213D}.bar button,.bar a{font:600 15px 'Noto Sans Bengali';padding:8px 16px;border-radius:8px;border:0;background:#F5A524;color:#14213D;cursor:pointer;text-decoration:none}
.iv{background:#fff;max-width:820px;margin:18px auto;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(20,33,61,.10);page-break-after:always;position:relative}
.iv-strip{height:8px;background:linear-gradient(90deg,#0866D6 0 62%,#F5A524 62% 100%)}
.iv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:22px 28px 14px}
.iv-logo{display:flex;align-items:center;gap:12px}
.iv-mark{width:58px;height:58px;border-radius:16px;background:#0866D6;color:#fff;display:grid;place-items:center;font-weight:800;font-size:26px;box-shadow:inset 0 -6px 0 #F5A524}
.iv-word{font-weight:800;font-size:38px;line-height:1;letter-spacing:-.5px}.iv-word .a{color:#0866D6}.iv-word .b{color:#F5A524}
.iv-mark-img{width:60px;height:60px;border-radius:16px;box-shadow:0 4px 12px rgba(8,102,214,.25)}
.iv-logo-img{max-height:70px;max-width:260px;object-fit:contain}
.iv-tag{margin:8px 0 0;font-size:13px;color:#5B6B85;font-weight:600}
.iv-contact{margin:6px 0 0;font-size:12.5px;color:#5B6B85;line-height:1.6}
.iv-title{text-align:right}.iv-title h1{margin:0;font-size:30px;letter-spacing:.5px;color:#14213D}
.iv-no{margin:2px 0 0;font-size:15px}.iv-no b{color:#0866D6;font-size:17px}.iv-date{margin:2px 0 0;font-size:12.5px;color:#5B6B85}
.iv-cards{display:grid;grid-template-columns:1.3fr 1fr auto;gap:12px;padding:4px 28px 14px}
.iv-card{border:1px solid #E3E9F2;border-radius:12px;padding:10px 14px;background:#F8FAFD}.iv-card p{margin:0;font-size:13.5px;line-height:1.6}
.iv-to{border-left:4px solid #0866D6;background:#F3F8FF}.iv-cname{font-size:16px}
.iv-label{font-size:11.5px!important;font-weight:700;color:#5B6B85;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px!important}
.iv-note{margin-top:4px!important;font-size:12.5px!important;color:#9a5b00}
.iv-qr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:1px solid #E3E9F2;border-radius:12px;padding:6px 8px;font-size:10.5px;color:#5B6B85;text-align:center;line-height:1.25}
.iv-table{width:calc(100% - 56px);margin:0 28px;border-collapse:separate;border-spacing:0;font-size:13.5px}
.iv-table th{background:#14213D;color:#fff;font-weight:600;font-size:12.5px;padding:9px 10px;text-align:left}.iv-table th:first-child{border-radius:10px 0 0 0}.iv-table th:last-child{border-radius:0 10px 0 0}
.iv-table td{padding:9px 10px;border-bottom:1px solid #E6ECF4;vertical-align:middle}.iv-table tbody tr:nth-child(even) td{background:#FAFBFD}
.c{text-align:center}.num{text-align:right;white-space:nowrap}.iv-sl{color:#8A97AD;font-weight:600}
.iv-pic{width:70px}.iv-pic img,.iv-pic span{display:flex;align-items:center;justify-content:center;width:58px;height:58px;object-fit:contain;border:1px solid #E3E9F2;border-radius:10px;background:#fff;font-size:26px}
.iv-pname{display:block;font-weight:700;line-height:1.35}.iv-sub{display:block;font-size:11.5px;color:#8A97AD;margin-top:1px}
.iv-war{display:inline-block;margin-top:4px;font-size:11.5px;font-weight:700;color:#047857;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:999px;padding:1px 9px}
.iv-bottom{display:grid;grid-template-columns:1fr 300px;gap:18px;padding:16px 28px 6px;align-items:start}
.iv-left{display:grid;gap:10px}.iv-box{border:1px dashed #CBD5E1;border-radius:12px;padding:9px 12px}.iv-box p{margin:0;font-size:12.5px;line-height:1.55;color:#334155}.iv-wbox{border-color:#A7F3D0;background:#F6FEF9}
.iv-sum{width:100%;border-collapse:collapse;font-size:14px}.iv-sum td{padding:5px 4px}.iv-sum td:first-child{color:#5B6B85}
.iv-total td{font-weight:800;font-size:17px;color:#14213D!important;border-top:2px solid #14213D;padding-top:8px}
.iv-due td,.iv-paid td{font-weight:800;font-size:16px;padding:10px 12px;color:#14213D!important}.iv-due td{background:#FFF4D6}.iv-paid td{background:#ECFDF5}
.iv-due td:first-child,.iv-paid td:first-child{border-radius:10px 0 0 10px}.iv-due td:last-child,.iv-paid td:last-child{border-radius:0 10px 10px 0;font-size:20px}
.iv-foot{text-align:center;padding:14px 28px 20px;border-top:1px solid #EEF2F7;margin-top:12px}.iv-foot p{margin:2px 0;font-size:12.5px;color:#5B6B85}.iv-thanks{font-size:15px!important;font-weight:700;color:#0866D6!important}
@media (max-width:640px){.iv{margin:8px;border-radius:10px}.iv-head{flex-direction:column;padding:16px}.iv-title{text-align:left}.iv-cards{grid-template-columns:1fr;padding:4px 16px 12px}.iv-qr{flex-direction:row}
.iv-table{width:calc(100% - 32px);margin:0 16px;font-size:12px}.iv-table th,.iv-table td{padding:6px 5px}.iv-pic{width:48px}.iv-pic img,.iv-pic span{width:42px;height:42px}.iv-bottom{grid-template-columns:1fr;padding:12px 16px}.iv-word{font-size:30px}.iv-mark-img{width:46px;height:46px}}
@media print{@page{size:A4;margin:8mm}body{background:#fff}.bar{display:none}.iv{margin:0;border-radius:0;box-shadow:none;max-width:none}tr{page-break-inside:avoid}}
</style></head><body>
<div class="bar"><button onclick="window.print()">🖨️ প্রিন্ট করুন</button><a href="javascript:history.back()">← ফিরে যান</a></div>
${orders.map((o) => invoiceBody(o, settings))}
</body></html>`.s;
}

module.exports = { invoicePage, invoiceBody };
void raw;

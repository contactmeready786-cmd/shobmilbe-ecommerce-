'use strict';
// The two printed papers of an order — only for the shop's admin and staff, one or many orders at once.
//   🏷️ ইনভয়েস  (invoicePage)   — stuck on the parcel: barcode, receiver, cash to collect. No product list.
//   📋 চেকলিস্ট (checklistPage) — inside the box for the customer: pictures, names, warranty, prices.
// Every part follows Admin → স্টোর ডিজাইন → ইনভয়েস ও চেকলিস্ট (lib/services/docs.js).
const { html, raw, money, bn, fmtDate, roundOff } = require('../util');
const ordersModel = require('../models/orders');
const docs = require('../services/docs');
const BC = require('../services/barcode');

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
const courierName = (c) => ((require('../services/courier').PROVIDERS || {})[c] || {}).label || c;
const siteOf = (s) => String(s.site_url || '').replace(/\/+$/, '');
const bare = (u) => u.replace(/^https?:\/\//, '');
// The shop's mark: the uploaded logo, or the "সব" tile + two-colour "সবমিলবে" wordmark
function brandMark(s, cls = '') {
  if (s.logo_id) return html`<img class="dc-logo-img ${cls}" src="/media/${s.logo_id}" alt="${s.store_name}">`;
  const name = s.store_name || 'সবমিলবে';
  return html`<img class="dc-mark ${cls}" src="/brand/favicon-192.png" alt="" aria-hidden="true"><span class="dc-word">${name === 'সবমিলবে' ? html`<b class="a">সব</b><b class="b">মিলবে</b>` : html`<b class="a">${name}</b>`}</span>`;
}
function qrSvg(s, order, px) {
  const site = siteOf(s);
  return site ? require('../services/qr').svg(`${site}/track?code=${order.code}`, { px, label: 'অর্ডার ট্র্যাক' }) : '';
}
const shell = (title, css, bodyHtml, { embed } = {}) => '<!doctype html>' + html`<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${raw(css)}</style></head><body class="${embed ? 'embed' : ''}">
${embed ? '' : raw('<div class="bar"><button onclick="window.print()">🖨️ প্রিন্ট করুন</button><a href="javascript:history.back()">← ফিরে যান</a></div>')}
${bodyHtml}
</body></html>`.s;
const BASE_CSS = `*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;color:#14213D;margin:0;background:#E9EEF5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body.embed{background:transparent}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#14213D}.bar button,.bar a{font:600 15px 'Noto Sans Bengali';padding:8px 16px;border-radius:8px;border:0;background:#F5A524;color:#14213D;cursor:pointer;text-decoration:none}
.dc-mark{width:60px;height:60px;border-radius:16px;box-shadow:0 4px 12px rgba(8,102,214,.25)}
.dc-word{font-weight:800;font-size:38px;line-height:1;letter-spacing:-.5px}.dc-word .a{color:var(--p)}.dc-word .b{color:var(--a)}
.dc-logo-img{max-height:70px;max-width:260px;object-fit:contain}
.num{text-align:right;white-space:nowrap}.c{text-align:center}
.bc{display:block;max-width:100%;height:auto}`;

// ================================================================ 📋 চেকলিস্ট (inside the box)
function checklistBody(order, s, c) {
  const on = c.show;
  const items = mergedItems(order.items);
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const wt = (it) => require('../models/catalog').warrantyText(it);
  const anyWarranty = on.warranty_terms && items.some((it) => wt(it));
  const site = siteOf(s);
  const units = items.reduce((n, it) => n + Number(it.qty || 0), 0);
  const tag = c.tagline || s.tagline;
  return html`<section class="iv">
  <div class="iv-strip"></div>
  <header class="iv-head">
    <div class="iv-brand">
      ${on.logo ? html`<div class="iv-logo">${brandMark(s)}</div>` : html`<p class="iv-shop">${s.store_name}</p>`}
      ${on.tagline && tag ? html`<p class="iv-tag">${tag}</p>` : ''}
      ${on.contact || on.address ? html`<p class="iv-contact">${on.contact ? html`${s.phone ? html`📞 ${s.phone}` : ''}${s.whatsapp ? html` · WhatsApp ${s.whatsapp}` : ''}${site ? html` · 🌐 ${bare(site)}` : ''}` : ''}${on.address && s.address ? html`${on.contact ? raw('<br>') : ''}📍 ${s.address}` : ''}</p>` : ''}
    </div>
    <div class="iv-title">
      <h1>${c.title}</h1>
      <p class="iv-no"># <b>${order.code}</b></p>
      <p class="iv-date">${fmtDate(order.created_at)}</p>
      ${on.barcode ? html`<div class="iv-bc">${raw(BC.svg(order.code, { height: 34, module: 1.6, fontSize: 0.1, showText: false }))}</div>` : ''}
    </div>
  </header>

  ${on.receiver || on.order_info || on.qr ? html`<div class="iv-cards">
    ${on.receiver ? html`<div class="iv-card iv-to">
      <p class="iv-label">📦 প্রাপক</p>
      <p translate="no"><b class="iv-cname">${order.customer_name}</b><br><b>${order.phone}</b><br>${order.address}${area ? html`<br>${area}` : ''}</p>
      ${order.note ? html`<p class="iv-note">নোট: <span translate="no">${order.note}</span></p>` : ''}
    </div>` : ''}
    ${on.order_info ? html`<div class="iv-card">
      <p class="iv-label">🧾 অর্ডারের তথ্য</p>
      <p>পেমেন্ট: <b>${ordersModel.PAYMENT_METHODS[order.payment] || order.payment}</b> · ${ordersModel.PAYMENT_STATUSES[order.payment_status] || ''}<br>
      পণ্য: <b>${bn(items.length)}</b> ধরনের, মোট <b>${bn(units)}</b>টি${order.courier ? html`<br>কুরিয়ার: <b>${courierName(order.courier)}</b>${order.consignment_id ? html` · ${order.consignment_id}` : ''}` : ''}</p>
    </div>` : ''}
    ${on.qr && qrSvg(s, order, 84) ? html`<div class="iv-qr">${raw(qrSvg(s, order, 84))}<span>স্ক্যান করে<br>অর্ডার ট্র্যাক</span></div>` : ''}
  </div>` : ''}

  <table class="iv-table">
    <thead><tr><th class="c">#</th>${on.pictures ? html`<th>ছবি</th>` : ''}<th>পণ্যের নাম</th>${on.prices ? html`<th class="num">দাম</th>` : ''}<th class="num">পরিমাণ</th>${on.prices ? html`<th class="num">মোট</th>` : ''}<th class="c iv-tick">✓</th></tr></thead>
    <tbody>${items.map((it, i) => html`<tr>
      <td class="c iv-sl">${bn(i + 1)}</td>
      ${on.pictures ? html`<td class="iv-pic">${it.image_id ? html`<img src="/media/${it.image_id}/t" alt="">` : html`<span>${it.emoji || '📦'}</span>`}</td>` : ''}
      <td><b class="iv-pname">${it.name}</b>
        ${(on.sku && it.sku) || it.note ? html`<span class="iv-sub">${on.sku && it.sku ? html`SKU ${it.sku}` : ''}${it.note ? html` · ${it.note}` : ''}</span>` : ''}
        ${on.warranty && wt(it) ? html`<span class="iv-war">🛡️ ${wt(it)}</span>` : ''}</td>
      ${on.prices ? html`<td class="num">${money(it.price)}</td>` : ''}<td class="num"><b>${bn(it.qty)}</b></td>${on.prices ? html`<td class="num"><b>${money(it.price * it.qty)}</b></td>` : ''}
      <td class="c iv-tick"><span class="iv-box-tick"></span></td></tr>`)}</tbody>
  </table>

  ${anyWarranty || on.note_box || on.totals ? html`<div class="iv-bottom ${on.totals ? '' : 'no-sum'}">
    <div class="iv-left">
      ${anyWarranty ? html`<div class="iv-box iv-wbox"><p class="iv-label">${c.warranty_title}</p><p>${docs.fill(c.warranty_text, s)}</p></div>` : ''}
      ${on.note_box ? html`<div class="iv-box"><p class="iv-label">${c.note_title}</p><p>${docs.fill(c.note_text, s)}</p></div>` : ''}
    </div>
    ${on.totals ? html`<table class="iv-sum">
      <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      ${order.discount ? html`<tr><td>ছাড়${order.coupon_code ? ` (${order.coupon_code})` : ''}</td><td class="num">− ${money(order.discount)}</td></tr>` : ''}
      ${Number(order.points_discount) ? html`<tr><td>পয়েন্ট ছাড়</td><td class="num">− ${money(order.points_discount)}</td></tr>` : ''}
      <tr><td>ডেলিভারি চার্জ</td><td class="num">${order.delivery ? money(order.delivery) : 'ফ্রি'}</td></tr>
      ${roundOff(order) ? html`<tr><td>রাউন্ড ফিগার</td><td class="num">${roundOff(order) > 0 ? '+ ' : '− '}${money(Math.abs(roundOff(order)))}</td></tr>` : ''}
      <tr class="iv-total"><td>সর্বমোট</td><td class="num">${money(order.total)}</td></tr>
      ${order.paid_amount ? html`<tr><td>আগে পরিশোধিত</td><td class="num">− ${money(order.paid_amount)}</td></tr>` : ''}
      ${on.cod_box ? html`<tr class="${due ? 'iv-due' : 'iv-paid'}"><td>${due ? 'ডেলিভারির সময় দিতে হবে' : 'পুরো টাকা পরিশোধিত'}</td><td class="num">${due ? money(due) : '✅'}</td></tr>` : ''}
    </table>` : ''}
  </div>` : ''}

  ${on.thanks || on.footer ? html`<footer class="iv-foot">
    ${on.thanks ? html`<p class="iv-thanks">${docs.fill(c.thanks_text, s)}</p>` : ''}
    ${on.footer && docs.fill(c.footer_text, s) ? html`<p>${docs.fill(c.footer_text, s)}</p>` : ''}
  </footer>` : ''}
</section>`;
}
function checklistCss(c) {
  return `${BASE_CSS}
:root{--p:${c.primary};--a:${c.accent}}
.iv{background:#fff;max-width:${c.paper === 'A5' ? '600px' : '820px'};margin:18px auto;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(20,33,61,.10);page-break-after:always;position:relative}
.embed .iv{margin:0 auto 12px}
.iv-strip{height:8px;background:linear-gradient(90deg,var(--p) 0 62%,var(--a) 62% 100%)}
.iv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:22px 28px 14px}
.iv-logo{display:flex;align-items:center;gap:12px}.iv-shop{margin:0;font-size:26px;font-weight:800;color:var(--p)}
.iv-tag{margin:8px 0 0;font-size:13px;color:#5B6B85;font-weight:600}
.iv-contact{margin:6px 0 0;font-size:12.5px;color:#5B6B85;line-height:1.6}
.iv-title{text-align:right}.iv-title h1{margin:0;font-size:30px;letter-spacing:.5px;color:#14213D}
.iv-no{margin:2px 0 0;font-size:15px}.iv-no b{color:var(--p);font-size:17px}.iv-date{margin:2px 0 0;font-size:12.5px;color:#5B6B85}
.iv-bc{margin-top:6px;display:flex;justify-content:flex-end}.iv-bc svg{width:190px;height:34px}
.iv-cards{display:flex;gap:12px;padding:4px 28px 14px}.iv-cards>*{flex:1}.iv-cards>.iv-to{flex:1.3}.iv-cards>.iv-qr{flex:0 0 auto}
.iv-card{border:1px solid #E3E9F2;border-radius:12px;padding:10px 14px;background:#F8FAFD}.iv-card p{margin:0;font-size:13.5px;line-height:1.6}
.iv-to{border-left:4px solid var(--p);background:#F3F8FF}.iv-cname{font-size:16px}
.iv-label{font-size:11.5px!important;font-weight:700;color:#5B6B85;letter-spacing:.4px;margin-bottom:3px!important}
.iv-note{margin-top:4px!important;font-size:12.5px!important;color:#9a5b00}
.iv-qr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:1px solid #E3E9F2;border-radius:12px;padding:6px 8px;font-size:10.5px;color:#5B6B85;text-align:center;line-height:1.25}
.iv-table{width:calc(100% - 56px);margin:0 28px;border-collapse:separate;border-spacing:0;font-size:13.5px}
.iv-table th{background:#14213D;color:#fff;font-weight:600;font-size:12.5px;padding:9px 10px;text-align:left}.iv-table th:first-child{border-radius:10px 0 0 0}.iv-table th:last-child{border-radius:0 10px 0 0}
.iv-table td{padding:9px 10px;border-bottom:1px solid #E6ECF4;vertical-align:middle}.iv-table tbody tr:nth-child(even) td{background:#FAFBFD}
.iv-sl{color:#8A97AD;font-weight:600}.iv-tick{width:34px}.iv-box-tick{display:inline-block;width:16px;height:16px;border:2px solid #94A3B8;border-radius:4px}
.iv-pic{width:70px}.iv-pic img,.iv-pic span{display:flex;align-items:center;justify-content:center;width:58px;height:58px;object-fit:contain;border:1px solid #E3E9F2;border-radius:10px;background:#fff;font-size:26px}
.iv-pname{display:block;font-weight:700;line-height:1.35}.iv-sub{display:block;font-size:11.5px;color:#8A97AD;margin-top:1px}
.iv-war{display:inline-block;margin-top:4px;font-size:11.5px;font-weight:700;color:#047857;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:999px;padding:1px 9px}
.iv-bottom{display:grid;grid-template-columns:1fr 300px;gap:18px;padding:16px 28px 6px;align-items:start}.iv-bottom.no-sum{grid-template-columns:1fr}
.iv-left{display:grid;gap:10px}.iv-box{border:1px dashed #CBD5E1;border-radius:12px;padding:9px 12px}.iv-box p{margin:0;font-size:12.5px;line-height:1.55;color:#334155}.iv-wbox{border-color:#A7F3D0;background:#F6FEF9}
.iv-sum{width:100%;border-collapse:collapse;font-size:14px}.iv-sum td{padding:5px 4px}.iv-sum td:first-child{color:#5B6B85}
.iv-total td{font-weight:800;font-size:17px;color:#14213D!important;border-top:2px solid #14213D;padding-top:8px}
.iv-due td,.iv-paid td{font-weight:800;font-size:16px;padding:10px 12px;color:#14213D!important}.iv-due td{background:#FFF4D6}.iv-paid td{background:#ECFDF5}
.iv-due td:first-child,.iv-paid td:first-child{border-radius:10px 0 0 10px}.iv-due td:last-child,.iv-paid td:last-child{border-radius:0 10px 10px 0;font-size:20px}
.iv-foot{text-align:center;padding:14px 28px 20px;border-top:1px solid #EEF2F7;margin-top:12px}.iv-foot p{margin:2px 0;font-size:12.5px;color:#5B6B85}.iv-thanks{font-size:15px!important;font-weight:700;color:var(--p)!important}
@media (max-width:640px){.iv{margin:8px;border-radius:10px}.iv-head{flex-direction:column;padding:16px}.iv-title{text-align:left}.iv-bc{justify-content:flex-start}.iv-cards{flex-direction:column;padding:4px 16px 12px}.iv-qr{flex-direction:row!important}
.iv-table{width:calc(100% - 32px);margin:0 16px;font-size:12px}.iv-table th,.iv-table td{padding:6px 5px}.iv-pic{width:48px}.iv-pic img,.iv-pic span{width:42px;height:42px}.iv-bottom{grid-template-columns:1fr;padding:12px 16px}.dc-word{font-size:30px}.dc-mark{width:46px;height:46px}}
@media print{@page{size:${c.paper};margin:8mm}body{background:#fff}.bar{display:none}.iv{margin:0;border-radius:0;box-shadow:none;max-width:none}tr{page-break-inside:avoid}}`;
}
function checklistPage(orders, s, c = docs.checklist(s), opts = {}) {
  return shell(`${c.title} ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}`, checklistCss(c), html`${orders.map((o) => checklistBody(o, s, c))}`, opts);
}

// ================================================================ 🏷️ ইনভয়েস (on the parcel)
function labelBody(order, s, c) {
  const on = c.show;
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const units = (order.items || []).reduce((n, it) => n + Number(it.qty || 0), 0);
  const weight = (order.items || []).reduce((g, it) => g + Number(it.weight_g || 0) * Number(it.qty || 0), 0) || Number(order.weight_g || 0);
  const site = siteOf(s);
  const z = docs.LABEL_SIZES[c.size] || docs.LABEL_SIZES.a4x6;
  const compact = z.h < 120;
  const qr = on.qr ? qrSvg(s, order, compact ? 58 : 74) : '';
  return html`<section class="lb ${compact ? 'lb-compact' : ''} ${z.h < 80 ? 'lb-mini' : ''} ${on.mono ? 'lb-mono' : ''}">
  <div class="lb-strip"></div>
  <header class="lb-head">
    <div class="lb-brand">${on.logo ? brandMark(s, 'lb-sm') : ''}${on.sender ? html`<p class="lb-from"><span>প্রেরক</span> <b>${s.store_name}</b>${s.phone ? html` · ${s.phone}` : ''}${on.sender_address && s.address ? html`<br>${s.address}` : ''}</p>` : ''}</div>
    <div class="lb-title"><b>${c.title}</b>${on.code_date ? html`<span># ${order.code}</span><small>${fmtDate(order.created_at, false)}</small>` : ''}</div>
  </header>
  ${on.barcode ? html`<div class="lb-bc">${raw(BC.svg(order.code, { height: compact ? 44 : 64, module: 2.4, fontSize: compact ? 15 : 18 }))}</div>` : ''}
  <div class="lb-mid">
  ${on.receiver ? html`<div class="lb-to">
    <p class="lb-k">প্রাপক</p>
    <p class="lb-name" translate="no">${order.customer_name}</p>
    <p class="lb-phone">📞 ${order.phone}</p>
    <p class="lb-addr" translate="no">${order.address}${area ? html`<br><b>${area}</b>` : ''}</p>
  </div>` : ''}
  <div class="lb-row">
    ${on.cod ? html`<div class="lb-cod ${due ? '' : 'paid'}"><span>${due ? 'নিতে হবে (COD)' : 'টাকা পরিশোধিত'}</span><b>${due ? money(due) : '৳০ ✅'}</b>
      ${on.payment ? html`<small>${ordersModel.PAYMENT_METHODS[order.payment] || order.payment} · ${ordersModel.PAYMENT_STATUSES[order.payment_status] || ''}</small>` : ''}</div>` : ''}
    ${qr ? html`<div class="lb-qr">${raw(qr)}</div>` : ''}
  </div>
  </div>
  ${on.courier && order.courier ? html`<div class="lb-courier"><span>🛵 ${courierName(order.courier)}</span>${order.consignment_id ? html`<b>${order.consignment_id}</b>` : ''}
    ${on.consignment_barcode && order.consignment_id ? html`<div class="lb-cbc">${raw(BC.svg(String(order.consignment_id), { height: compact ? 26 : 38, module: 1.7, fontSize: compact ? 10 : 12 }))}</div>` : ''}</div>` : ''}
  ${on.item_count || (on.weight && weight) ? html`<p class="lb-meta">${on.item_count ? html`📦 পণ্য: <b>${bn(units)}</b>টি` : ''}${on.weight && weight ? html`${on.item_count ? ' · ' : ''}⚖️ ওজন: <b>${bn(weight >= 1000 ? (weight / 1000).toFixed(2) + ' কেজি' : weight + ' গ্রাম')}</b>` : ''}</p>` : ''}
  ${on.customer_note && order.note ? html`<p class="lb-note">📝 ${order.note}</p>` : ''}
  ${on.handling && c.handling_text ? html`<p class="lb-handle">${docs.fill(c.handling_text, s)}</p>` : ''}
  ${(on.return_note && c.return_text) || c.footer_text ? html`<footer class="lb-foot">${on.return_note && c.return_text ? html`<p>${docs.fill(c.return_text, s)}${s.address ? html` · ${s.address}` : ''}</p>` : ''}${c.footer_text ? html`<p>${docs.fill(c.footer_text, s)}</p>` : ''}${site ? html`<p class="lb-site">${bare(site)}</p>` : ''}</footer>` : ''}
</section>`;
}
function labelCss(c) {
  const z = docs.LABEL_SIZES[c.size];
  return `${BASE_CSS}
:root{--p:${c.primary};--a:${c.accent}}
.sheet{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;padding:16px}
.embed .sheet{padding:0}
.lb{width:${z.w}mm;height:${z.h}mm;background:#fff;border-radius:8px;box-shadow:0 6px 20px rgba(20,33,61,.12);overflow:hidden;display:flex;flex-direction:column;font-size:${z.w < 105 ? 11.5 : 12.5}px;page-break-inside:avoid}
.lb-strip{height:6px;background:linear-gradient(90deg,var(--p) 0 62%,var(--a) 62% 100%)}
.lb-head{display:flex;justify-content:space-between;gap:8px;padding:8px 10px 4px;align-items:flex-start}
.lb-brand{display:flex;flex-direction:column;gap:4px}.lb-brand .dc-mark{width:30px;height:30px;border-radius:8px;box-shadow:none;vertical-align:middle;margin-right:6px}
.lb-brand .dc-word{font-size:22px;vertical-align:middle}.lb-brand .dc-logo-img{max-height:34px;max-width:150px}
.lb-from{margin:0;font-size:10.5px;color:#475569;line-height:1.4}.lb-from span{display:inline-block;background:#EEF2F7;border-radius:4px;padding:0 5px;font-size:9.5px;font-weight:700}
.lb-title{text-align:right;display:flex;flex-direction:column}.lb-title b{font-size:17px;letter-spacing:.5px}.lb-title span{font-weight:700;color:var(--p);font-size:12.5px}.lb-title small{color:#64748B;font-size:10px}
.lb-bc{padding:2px 10px 4px;display:flex;justify-content:center;border-bottom:2px dashed #CBD5E1}.lb-bc svg{height:17mm;width:auto;max-width:100%}
.lb-to{padding:8px 12px;border-bottom:2px dashed #CBD5E1}.lb-to p{margin:0}.lb-k{font-size:10px;font-weight:700;color:#64748B;letter-spacing:.5px}
.lb-name{font-size:${z.w < 105 ? 17 : 19}px;font-weight:800;line-height:1.25}.lb-phone{font-size:${z.w < 105 ? 16 : 18}px;font-weight:800;margin:2px 0!important;letter-spacing:.5px}
.lb-addr{font-size:${z.w < 105 ? 12.5 : 13.5}px;line-height:1.45}
.lb-row{display:flex;gap:8px;padding:8px 12px;align-items:stretch}
.lb-cod{flex:1;border:2px solid #14213D;border-radius:10px;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;background:#FFF4D6}
.lb-cod.paid{background:#ECFDF5;border-color:#047857}.lb-cod span{font-size:11px;font-weight:700;color:#475569}.lb-cod b{font-size:${z.w < 105 ? 24 : 28}px;font-weight:800;line-height:1.1}.lb-cod small{font-size:10px;color:#475569}
.lb-qr{display:flex;align-items:center}
.lb-courier{margin:0 12px 6px;padding:6px 8px;border:1px solid #E2E8F0;border-radius:8px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px}.lb-courier b{font-size:13px}.lb-cbc{flex-basis:100%;display:flex;justify-content:center}.lb-cbc svg{height:11mm;width:auto;max-width:100%}
.lb-meta{margin:0 12px 4px;font-size:12px}.lb-note{margin:0 12px 4px;font-size:11.5px;color:#9a5b00}
.lb-handle{margin:4px 12px 6px;padding:5px 8px;border-radius:6px;background:#FEF2F2;color:#B91C1C;font-weight:700;font-size:11.5px;text-align:center}
.lb-foot{margin-top:auto;padding:6px 12px 8px;border-top:1px solid #EEF2F7;text-align:center}.lb-foot p{margin:0;font-size:10px;color:#64748B;line-height:1.4}.lb-site{font-weight:700;color:var(--p)!important}
/* small papers (A4 ৬টা, ১০০×৭৫, ৪×৪): receiver beside the cash box, tighter spacing */
.lb-compact{font-size:11px}.lb-compact .lb-head{padding:5px 9px 2px}.lb-compact .lb-brand .dc-mark{width:22px;height:22px;margin-right:4px}.lb-compact .lb-brand .dc-word{font-size:16px}
.lb-compact .lb-brand{flex-direction:row;align-items:center;gap:6px;flex-wrap:wrap}.lb-compact .lb-from{font-size:9.5px}
.lb-compact .lb-title b{font-size:13px}.lb-compact .lb-title span{font-size:11px}.lb-compact .lb-bc{padding:0 9px 2px}.lb-compact .lb-bc svg{height:13mm}
.lb-compact .lb-mid{display:grid;grid-template-columns:1.25fr 1fr;border-bottom:2px dashed #CBD5E1}
.lb-compact .lb-to{border-bottom:0;padding:5px 8px 5px 10px;border-right:1px dashed #CBD5E1}.lb-compact .lb-name{font-size:14.5px}.lb-compact .lb-phone{font-size:14px}.lb-compact .lb-addr{font-size:11px;line-height:1.35}
.lb-compact .lb-row{flex-direction:column;padding:5px 8px;gap:4px}.lb-compact .lb-cod{padding:4px 7px;border-radius:8px}.lb-compact .lb-cod b{font-size:19px}.lb-compact .lb-cod small{font-size:9px}
.lb-compact .lb-qr{justify-content:center}
.lb-compact .lb-courier{margin:3px 9px 1px;padding:2px 6px;font-size:10px;gap:2px 8px}.lb-compact .lb-courier b{font-size:10.5px}.lb-compact .lb-cbc{flex-basis:auto;margin-left:auto}.lb-compact .lb-cbc svg{height:7.5mm}
.lb-compact .lb-meta,.lb-compact .lb-note{margin:1px 10px;font-size:10.5px}.lb-compact .lb-handle{margin:2px 9px 3px;padding:2px 6px;font-size:10px}
.lb-compact .lb-foot{padding:2px 8px 4px}.lb-compact .lb-foot p{font-size:8.5px;line-height:1.3}
.lb-mini .lb-qr,.lb-mini .lb-foot,.lb-mini .lb-meta,.lb-mini .lb-from,.lb-mini .lb-note,.lb-mini .lb-k{display:none}.lb-mini .lb-bc svg{height:11mm}.lb-mini .lb-cod b{font-size:17px}.lb-mini .lb-strip{height:3px}
/* black & white: no coloured fills (thermal sticker printers print only black) */
.lb-mono .lb-strip{background:#000}.lb-mono .lb-cod,.lb-mono .lb-cod.paid{background:#fff;border-color:#000}.lb-mono .lb-handle{background:#fff;color:#000;outline:1.5px solid #000;outline-offset:-1.5px}
.lb-mono .lb-title span,.lb-mono .lb-site,.lb-mono .dc-word .a,.lb-mono .dc-word .b{color:#000!important}.lb-mono .lb-from span{background:#fff;border:1px solid #000}.lb-mono .dc-mark{filter:grayscale(1) contrast(1.4)}
.lb-mono, .lb-mono *{color:#000!important}.lb-mono .lb-bc,.lb-mono .lb-to,.lb-mono .lb-compact .lb-mid,.lb-mono .lb-mid{border-color:#000!important}.lb-mono .lb-courier{border-color:#000}
@media print{@page{size:${z.sheet ? 'A4' : `${z.w}mm ${z.h}mm`};margin:0}body{background:#fff}.bar{display:none}
  .sheet{padding:0;gap:0;justify-content:flex-start}.lb{box-shadow:none;border-radius:0;height:${z.h}mm;${z.sheet ? 'outline:1px dashed #CBD5E1;' : 'page-break-after:always;'}}}`;
}
function invoicePage(orders, s, c = docs.invoice(s), opts = {}) {
  return shell(`${c.title} ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}`, labelCss(c), html`<div class="sheet">${orders.map((o) => labelBody(o, s, c))}</div>`, opts);
}

module.exports = { invoicePage, checklistPage, labelBody, checklistBody, mergedItems };

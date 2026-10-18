// The two printed papers of an order — only for the shop's admin and staff, one or many orders at once.
//   🏷️ ইনভয়েস  (invoicePage)   — stuck on the parcel: barcode, receiver, cash to collect. No product list.
//   📋 চেকলিস্ট (checklistPage) — inside the box for the customer: pictures, names, warranty, prices.
// Every part follows Admin → স্টোর ডিজাইন → ইনভয়েস ও চেকলিস্ট (lib/services/docs.js).

// The same product on two lines (e.g. added twice while editing) is shown once with the quantities added up,
// so each product's picture appears only once.
import { Val, RawHtml, attrValue, jsxList, renderHtml, htmlValue } from '../react/html';
import { ASSET_V as PA_V } from '../admin/layout';
import { raw, money, bn, fmtDate, roundOff, roundOffLabel } from '../util';
import * as ordersModel from '../models/orders';
import * as docs from '../services/docs';
import * as BC from '../services/barcode';
import * as $services_courier from '../services/courier';
import * as $services_qr from '../services/qr';
import * as $models_catalog from '../models/catalog';
import type { Settings } from '../types';
import type { PaperDoc } from '../services/docs';

/** One line of a printed order (a real order's line, or the settings page's made-up sample). */
export type PrintItem = { product_id?: number | null; name: string; price: number; qty: number; sku?: string | null; image_id?: number | null; emoji?: string | null;
  note?: string | null; weight_g?: number | null; warranty?: string | null; warranty_type?: string | null };
/** An order as the two papers read it. */
export type PrintOrder = Pick<ordersModel.Order, 'code' | 'created_at' | 'customer_name' | 'phone' | 'address' | 'payment' | 'payment_status' | 'subtotal' | 'discount' | 'delivery' | 'total'>
  & { id?: number; area?: string; district?: string; thana?: string; note?: string | null; paid_amount?: number | null; points_discount?: number | null; courier?: string | null;
    consignment_id?: string | null; coupon_code?: string | null; weight_g?: number | null; items: PrintItem[] };
function mergedItems(items?: PrintItem[] | null): PrintItem[] {
  const out: PrintItem[] = [];
  const seen = new Map<string, PrintItem>();
  for (const it of items || []) {
    const key = it.product_id ? `${it.product_id}:${it.price}` : null;
    if (key && seen.has(key)) { seen.get(key)!.qty += it.qty; continue; }
    const row = { ...it };
    out.push(row);
    if (key) seen.set(key, row);
  }
  return out;
}
const courierName = (c: string | number) => (($services_courier.PROVIDERS || {})[c] || {}).label || c;
const siteOf = (s: Settings) => String(s.site_url || '').replace(/\/+$/, '');
const bare = (u: string) => u.replace(/^https?:\/\//, '');
// The shop's mark: the uploaded logo, or the "সব" tile + two-colour "সবমিলবে" wordmark
function brandMark(s: Settings, cls = '') {
  if (s.logo_id) return <img className={`dc-logo-img ${attrValue(cls)}`} src={`/media/${attrValue(s.logo_id)}`} alt={attrValue(s.store_name)} />;
  const name = s.store_name || 'সবমিলবে';
  return <><img className={`dc-mark ${attrValue(cls)}`} src="/brand/favicon-192.png" alt="" aria-hidden="true" /><span className="dc-word">{(name === 'সবমিলবে' ? <><b className="a">সব</b><b className="b">মিলবে</b></> : <b className="a"><Val v={name} /></b>)}</span></>;
}
function qrSvg(s: Settings, order: PrintOrder, px?: number) {
  const site = siteOf(s);
  return site ? $services_qr.svg(`${site}/track?code=${order.code}`, { px, label: 'অর্ডার ট্র্যাক' }) : '';
}
type ShellProps = {
  embed?: boolean;
};
const shell = (title?: unknown, css?: unknown, bodyHtml?: unknown, { embed }: ShellProps = {}) => '<!doctype html>' + `<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlValue(title)}</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${(css)}</style></head><body class="${htmlValue(embed ? 'embed' : '')}">
${htmlValue(embed ? '' : raw('<div class="bar"><button type="button" data-print>🖨️ প্রিন্ট করুন</button><a href="/admin/orders" data-back>← ফিরে যান</a></div>'))}
${(renderHtml(bodyHtml))}
${htmlValue(embed ? '' : raw(`<script type="module" src="/js/admin/page-actions.js?v=${PA_V}"></script>`))}
</body></html>`;
const BASE_CSS = `*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;color:#14213D;margin:0;background:#E9EEF5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body.embed{background:transparent}
.bar{display:flex;gap:10px;justify-content:center;padding:12px;background:#14213D}.bar button,.bar a{font:600 15px 'Noto Sans Bengali';padding:8px 16px;border-radius:8px;border:0;background:#F5A524;color:#14213D;cursor:pointer;text-decoration:none}
.dc-mark{width:60px;height:60px;border-radius:16px;box-shadow:0 4px 12px rgba(8,102,214,.25)}
.dc-word{font-weight:800;font-size:38px;line-height:1;letter-spacing:-.5px}.dc-word .a{color:var(--p)}.dc-word .b{color:var(--a)}
.dc-logo-img{max-height:70px;max-width:260px;object-fit:contain}
.num{text-align:right;white-space:nowrap}.c{text-align:center}
.bc{display:block;max-width:100%;height:auto}`;

// ================================================================ 📋 চেকলিস্ট (inside the box)
function checklistBody(order: PrintOrder, s: Settings, c: PaperDoc) {
  const on = c.show;
  const items = mergedItems(order.items);
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const wt = (it: PrintItem) => $models_catalog.warrantyText(it);
  const anyWarranty = on.warranty_terms && items.some((it) => wt(it));
  const site = siteOf(s);
  const units = items.reduce((n, it) => n + Number(it.qty || 0), 0);
  const tag = c.tagline || s.tagline;
  return <section className="iv"><div className="iv-strip"></div><header className="iv-head"><div className="iv-brand">{(on.logo ? <div className="iv-logo">{brandMark(s)}</div> : <p className="iv-shop"><Val v={s.store_name} /></p>)}{' '}{(on.tagline && tag ? <p className="iv-tag"><Val v={tag} /></p> : null)}{' '}{(on.contact || on.address ? <p className="iv-contact">{(on.contact ? <>{(s.phone ? <>📞{' '}<Val v={s.phone} /></> : null)}{(s.whatsapp ? <>{' '}· WhatsApp{' '}<Val v={s.whatsapp} /></> : null)}{(site ? <>{' '}· 🌐{' '}<Val v={bare(site)} /></> : null)}</> : null)}{(on.address && s.address ? <>{(on.contact ? <RawHtml html={'<br>'} /> : null)}📍{' '}<Val v={s.address} /></> : null)}</p> : null)}</div><div className="iv-title"><h1><Val v={c.title} /></h1><p className="iv-no">#{' '}<b><Val v={order.code} /></b></p><p className="iv-date">{fmtDate(order.created_at)}</p>{(on.barcode ? <div className="iv-bc"><RawHtml html={BC.svg(order.code, { height: 34, module: 1.6, fontSize: 0.1, showText: false })} /></div> : null)}</div></header>{(on.receiver || on.order_info || on.qr ? <div className="iv-cards">{(on.receiver ? <div className="iv-card iv-to"><p className="iv-label">📦 প্রাপক</p><p translate="no"><b className="iv-cname"><Val v={order.customer_name} /></b><br /><b><Val v={order.phone} /></b><br /><Val v={order.address} />{(area ? <><br /><Val v={area} /></> : null)}</p>{(order.note ? <p className="iv-note">নোট:{' '}<span translate="no"><Val v={order.note} /></span></p> : null)}</div> : null)}{' '}{(on.order_info ? <div className="iv-card"><p className="iv-label">🧾 অর্ডারের তথ্য</p><p>পেমেন্ট:{' '}<b><Val v={ordersModel.PAYMENT_METHODS[order.payment] || order.payment} /></b>{' '}·{' '}<Val v={ordersModel.PAYMENT_STATUSES[order.payment_status] || ''} /><br />পণ্য:{' '}<b>{bn(items.length)}</b>{' '}ধরনের, মোট{' '}<b>{bn(units)}</b>টি{(order.courier ? <><br />কুরিয়ার:{' '}<b><Val v={courierName(order.courier)} /></b>{(order.consignment_id ? <>{' '}·{' '}<Val v={order.consignment_id} /></> : null)}</> : null)}</p></div> : null)}{' '}{(on.qr && qrSvg(s, order, 84) ? <div className="iv-qr"><RawHtml html={qrSvg(s, order, 84)} /><span>স্ক্যান করে<br />অর্ডার ট্র্যাক</span></div> : null)}</div> : null)}<table className="iv-table"><thead><tr><th className="c">#</th>{(on.pictures ? <th>ছবি</th> : null)}<th>পণ্যের নাম</th>{(on.prices ? <th className="num">দাম</th> : null)}<th className="num">পরিমাণ</th>{(on.prices ? <th className="num">মোট</th> : null)}<th className="c iv-tick">✓</th></tr></thead><tbody>{jsxList(items.map((it, i) => <tr><td className="c iv-sl">{bn(i + 1)}</td>{(on.pictures ? <td className="iv-pic">{(it.image_id ? <img src={`/media/${attrValue(it.image_id)}/t`} alt="" /> : <span><Val v={it.emoji || '📦'} /></span>)}</td> : null)}<td><b className="iv-pname"><Val v={it.name} /></b>{' '}{((on.sku && it.sku) || it.note ? <span className="iv-sub">{(on.sku && it.sku ? <>SKU{' '}<Val v={it.sku} /></> : null)}{(it.note ? <>{' '}·{' '}<Val v={it.note} /></> : null)}</span> : null)}{' '}{(on.warranty && wt(it) ? <span className="iv-war">🛡️{' '}<Val v={wt(it)} /></span> : null)}</td>{(on.prices ? <td className="num">{money(it.price)}</td> : null)}<td className="num"><b>{bn(it.qty)}</b></td>{(on.prices ? <td className="num"><b>{money(it.price * it.qty)}</b></td> : null)}<td className="c iv-tick"><span className="iv-box-tick"></span></td></tr>))}</tbody></table>{(anyWarranty || on.note_box || on.totals ? <div className={`iv-bottom ${on.totals ? '' : 'no-sum'}`}><div className="iv-left">{(anyWarranty ? <div className="iv-box iv-wbox"><p className="iv-label"><Val v={c.warranty_title} /></p><p><Val v={docs.fill(c.warranty_text, s)} /></p></div> : null)}{' '}{(on.note_box ? <div className="iv-box"><p className="iv-label"><Val v={c.note_title} /></p><p><Val v={docs.fill(c.note_text, s)} /></p></div> : null)}</div>{(on.totals ? <table className="iv-sum"><tr><td>পণ্যের দাম</td><td className="num">{money(order.subtotal)}</td></tr>{(order.discount ? <tr><td>ছাড়{(order.coupon_code ? ` (${order.coupon_code})` : null)}</td><td className="num">−{' '}{money(order.discount)}</td></tr> : null)}{' '}{(Number(order.points_discount) ? <tr><td>পয়েন্ট ছাড়</td><td className="num">−{' '}{money(order.points_discount)}</td></tr> : null)}<tr><td>ডেলিভারি চার্জ</td><td className="num">{(order.delivery ? money(order.delivery) : "ফ্রি")}</td></tr>{(roundOff(order) ? <tr><td>{roundOffLabel(roundOff(order))}</td><td className="num">{(roundOff(order) > 0 ? "+ " : "− ")}{money(Math.abs(roundOff(order)))}</td></tr> : null)}<tr className="iv-total"><td>সর্বমোট</td><td className="num">{money(order.total)}</td></tr>{(order.paid_amount ? <tr><td>আগে পরিশোধিত</td><td className="num">−{' '}{money(order.paid_amount)}</td></tr> : null)}{' '}{(on.cod_box ? <tr className={due ? 'iv-due' : 'iv-paid'}><td>{(due ? "ডেলিভারির সময় দিতে হবে" : "পুরো টাকা পরিশোধিত")}</td><td className="num">{(due ? money(due) : "✅")}</td></tr> : null)}</table> : null)}</div> : null)}{' '}{(on.thanks || on.footer ? <footer className="iv-foot">{(on.thanks ? <p className="iv-thanks"><Val v={docs.fill(c.thanks_text, s)} /></p> : null)}{' '}{(on.footer && docs.fill(c.footer_text, s) ? <p><Val v={docs.fill(c.footer_text, s)} /></p> : null)}</footer> : null)}</section>;
}
function checklistCss(c: PaperDoc) {
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
function checklistPage(orders: PrintOrder[], s: Settings, c: PaperDoc = docs.checklist(s), opts: ShellProps = {}) {
  return shell(`${c.title} ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}`, checklistCss(c), <><Val v={orders.map((o) => checklistBody(o, s, c))} /></>, opts);
}

// ================================================================ 🏷️ ইনভয়েস (on the parcel)
function labelBody(order: PrintOrder, s: Settings, c: PaperDoc) {
  const on = c.show;
  const area = ordersModel.areaLabel(order);
  const due = Math.max(0, order.total - (order.paid_amount || 0));
  const units = (order.items || []).reduce((n: number, it) => n + Number(it.qty || 0), 0);
  const weight = (order.items || []).reduce((g: number, it) => g + Number(it.weight_g || 0) * Number(it.qty || 0), 0) || Number(order.weight_g || 0);
  const site = siteOf(s);
  const z = docs.LABEL_SIZES[String(c.size)] || docs.LABEL_SIZES.a4x6;
  const compact = z.h < 120;
  const qr = on.qr ? qrSvg(s, order, compact ? 58 : 74) : '';
  return <section className={`lb ${compact ? 'lb-compact' : ''} ${z.h < 80 ? 'lb-mini' : ''} ${on.mono ? 'lb-mono' : ''}`}><div className="lb-strip"></div><header className="lb-head"><div className="lb-brand">{(on.logo ? brandMark(s, 'lb-sm') : null)}{(on.sender ? <p className="lb-from"><span>প্রেরক</span>{' '}<b><Val v={s.store_name} /></b>{(s.phone ? <>{' '}·{' '}<Val v={s.phone} /></> : null)}{(on.sender_address && s.address ? <><br /><Val v={s.address} /></> : null)}</p> : null)}</div><div className="lb-title"><b><Val v={c.title} /></b>{(on.code_date ? <><span>#{' '}<Val v={order.code} /></span><small>{fmtDate(order.created_at, false)}</small></> : null)}</div></header>{(on.barcode ? <div className="lb-bc"><RawHtml html={BC.svg(order.code, { height: compact ? 44 : 64, module: 2.4, fontSize: compact ? 15 : 18 })} /></div> : null)}<div className="lb-mid">{(on.receiver ? <div className="lb-to"><p className="lb-k">প্রাপক</p><p className="lb-name" translate="no"><Val v={order.customer_name} /></p><p className="lb-phone">📞{' '}<Val v={order.phone} /></p><p className="lb-addr" translate="no"><Val v={order.address} />{(area ? <><br /><b><Val v={area} /></b></> : null)}</p></div> : null)}<div className="lb-row">{(on.cod ? <div className={`lb-cod ${due ? '' : 'paid'}`}><span>{(due ? "নিতে হবে (COD)" : "টাকা পরিশোধিত")}</span><b>{(due ? money(due) : "৳০ ✅")}</b>{' '}{(on.payment ? <small><Val v={ordersModel.PAYMENT_METHODS[order.payment] || order.payment} />{' '}·{' '}<Val v={ordersModel.PAYMENT_STATUSES[order.payment_status] || ''} /></small> : null)}</div> : null)}{' '}{(qr ? <div className="lb-qr"><RawHtml html={qr} /></div> : null)}</div></div>{(on.courier && order.courier ? <div className="lb-courier"><span>🛵{' '}<Val v={courierName(order.courier)} /></span>{(order.consignment_id ? <b><Val v={order.consignment_id} /></b> : null)}{' '}{(on.consignment_barcode && order.consignment_id ? <div className="lb-cbc"><RawHtml html={BC.svg(String(order.consignment_id), { height: compact ? 26 : 38, module: 1.7, fontSize: compact ? 10 : 12 })} /></div> : null)}</div> : null)}{' '}{(on.item_count || (on.weight && weight) ? <p className="lb-meta">{(on.item_count ? <>📦 পণ্য:{' '}<b>{bn(units)}</b>টি</> : null)}{(on.weight && weight ? <>{(on.item_count ? " · " : null)}⚖️ ওজন:{' '}<b>{bn(weight >= 1000 ? (weight / 1000).toFixed(2) + ' কেজি' : weight + ' গ্রাম')}</b></> : null)}</p> : null)}{' '}{(on.customer_note && order.note ? <p className="lb-note">📝{' '}<Val v={order.note} /></p> : null)}{' '}{(on.handling && c.handling_text ? <p className="lb-handle"><Val v={docs.fill(c.handling_text, s)} /></p> : null)}{' '}{((on.return_note && c.return_text) || c.footer_text ? <footer className="lb-foot">{(on.return_note && c.return_text ? <p><Val v={docs.fill(c.return_text, s)} />{(s.address ? <>{' '}·{' '}<Val v={s.address} /></> : null)}</p> : null)}{(c.footer_text ? <p><Val v={docs.fill(c.footer_text, s)} /></p> : null)}{(site ? <p className="lb-site"><Val v={bare(site)} /></p> : null)}</footer> : null)}</section>;
}
function labelCss(c: PaperDoc) {
  const z = docs.LABEL_SIZES[String(c.size)];
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
function invoicePage(orders: PrintOrder[], s: Settings, c: PaperDoc = docs.invoice(s), opts: ShellProps = {}) {
  return shell(`${c.title} ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}`, labelCss(c), <div className="sheet"><Val v={orders.map((o) => labelBody(o, s, c))} /></div>, opts);
}

export { invoicePage, checklistPage, labelBody, checklistBody, mergedItems };

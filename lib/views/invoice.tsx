// The two printed papers of an order — only for the shop's admin and staff, one or many orders at once.
//   🏷️ ইনভয়েস  (invoicePage)   — stuck on the parcel: courier ID, receiver, cash to collect, two QR codes. No product list.
//      Owner, 2026-11-15 (after the 4×4 / 4×2 sticker samples): no bar codes (a phone camera can't read them). The
//      courier's ID — the only number couriers follow — sits big in a black band at the top. Two QR codes, each with
//      its job written under it: 📦 হ্যান্ডওভার (any phone camera opens /admin/handover?code=… for this order) and
//      📋 ভেতরে কী আছে (the customer's order page with the products). The sender is the logo + a big phone number.
//   📋 চেকলিস্ট (checklistPage) — inside the box for the customer: pictures, names, warranty, prices.
// Every part follows Admin → স্টোর ডিজাইন → ইনভয়েস ও চেকলিস্ট (lib/services/docs.js).
// Both are printed black & white (owner, 2026-11-14): no coloured fills or colour pickers; the receiver's lines are
// labelled নাম / মোবাইল / ঠিকানা so nobody has to guess which line is which.

// The same product on two lines (e.g. added twice while editing) is shown once with the quantities added up,
// so each product's picture appears only once.
import { Val, RawHtml, attrValue, jsxList, renderHtml, htmlValue } from '../react/html';
import { ASSET_V as PA_V } from '../admin/layout';
import { raw, money, bn, fmtDate, roundOff, roundOffLabel } from '../util';
import * as ordersModel from '../models/orders';
import * as docs from '../services/docs';
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
  if (s.logo_id) {
    // An uploaded logo is drawn the size of the written name it replaces (about as tall as the "সব" tile + wordmark
    // block reads), not as big as it may get: the checklist/invoice header 44px, the parcel label 26px. Its width and
    // height (saved with the logo) let the paper keep the logo's place even before the picture has arrived.
    const w = Number(s.logo_w), h = Number(s.logo_h);
    const size = w > 0 && h > 0 ? { width: w, height: h } : {};
    const small = String(cls).includes('lb');
    return <img className={`dc-logo-img ${attrValue(cls)}`} src={`/media/${attrValue(s.logo_id)}`} alt={attrValue(s.store_name)} {...size}
      style={{ height: small ? '26px' : '44px', width: 'auto', maxHeight: 'none', maxWidth: small ? '150px' : '260px', objectFit: 'contain', objectPosition: 'left center', verticalAlign: 'middle' }} />;
  }
  const name = s.store_name || 'সবমিলবে';
  return <><img className={`dc-mark ${attrValue(cls)}`} src="/brand/favicon-192.png" alt="" aria-hidden="true" /><span className="dc-word">{(name === 'সবমিলবে' ? <><b className="a">সব</b><b className="b">মিলবে</b></> : <b className="a"><Val v={name} /></b>)}</span></>;
}
/** 📋 for the customer: the order page — what is in the box and where it is (no phone or address shown to others) */
function qrSvg(s: Settings, order: PrintOrder, px?: number) {
  const site = siteOf(s);
  return site ? $services_qr.svg(`${site}/order/${encodeURIComponent(order.code)}`, { px, label: 'ভেতরে কী আছে' }) : '';
}
/** 📦 for the shop: opens Admin → কুরিয়ারে হ্যান্ডওভার with this order (only for someone logged into the admin) */
function handoverQr(s: Settings, order: PrintOrder, px?: number) {
  const site = siteOf(s);
  return site ? $services_qr.svg(`${site}/admin/handover?code=${encodeURIComponent(order.code)}`, { px, label: 'হ্যান্ডওভার' }) : '';
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
  return <section className="iv"><div className="iv-strip"></div><header className="iv-head"><div className="iv-brand">{(on.logo ? <div className="iv-logo">{brandMark(s)}</div> : <p className="iv-shop"><Val v={s.store_name} /></p>)}{' '}{(on.tagline && tag ? <p className="iv-tag"><Val v={tag} /></p> : null)}{' '}{(on.contact || on.address ? <p className="iv-contact">{(on.contact ? <>{(s.phone ? <>📞{' '}<Val v={s.phone} /></> : null)}{(s.whatsapp ? <>{' '}· WhatsApp{' '}<Val v={s.whatsapp} /></> : null)}{(site ? <>{' '}· 🌐{' '}<Val v={bare(site)} /></> : null)}</> : null)}{(on.address && s.address ? <>{(on.contact ? <RawHtml html={'<br>'} /> : null)}📍{' '}<Val v={s.address} /></> : null)}</p> : null)}</div><div className="iv-title"><h1><Val v={c.title} /></h1><p className="iv-no">#{' '}<b><Val v={order.code} /></b></p><p className="iv-date">{fmtDate(order.created_at)}</p></div></header>{(on.receiver || on.order_info || on.qr ? <div className="iv-cards">{(on.receiver ? <div className="iv-card iv-to"><p className="iv-label">📦 প্রাপক</p><p className="iv-kv" translate="no"><span className="iv-k">নাম:</span>{' '}<b className="iv-cname"><Val v={order.customer_name} /></b></p><p className="iv-kv" translate="no"><span className="iv-k">মোবাইল:</span>{' '}<b><Val v={order.phone} /></b></p><p className="iv-kv" translate="no"><span className="iv-k">ঠিকানা:</span>{' '}<Val v={order.address} />{(area ? <>,{' '}<Val v={area} /></> : null)}</p>{(order.note ? <p className="iv-note">নোট:{' '}<span translate="no"><Val v={order.note} /></span></p> : null)}</div> : null)}{' '}{(on.order_info ? <div className="iv-card"><p className="iv-label">🧾 অর্ডারের তথ্য</p><p>পেমেন্ট:{' '}<b><Val v={ordersModel.PAYMENT_METHODS[order.payment] || order.payment} /></b>{' '}·{' '}<Val v={ordersModel.PAYMENT_STATUSES[order.payment_status] || ''} /><br />পণ্য:{' '}<b>{bn(items.length)}</b>{' '}ধরনের, মোট{' '}<b>{bn(units)}</b>টি{(order.courier ? <><br />কুরিয়ার:{' '}<b><Val v={courierName(order.courier)} /></b>{(order.consignment_id ? <>{' '}·{' '}<Val v={order.consignment_id} /></> : null)}</> : null)}</p></div> : null)}{' '}{(on.qr && qrSvg(s, order, 84) ? <div className="iv-qr"><RawHtml html={qrSvg(s, order, 84)} /><span>স্ক্যান করে<br />অর্ডার দেখুন</span></div> : null)}</div> : null)}<table className="iv-table"><thead><tr><th className="c">#</th>{(on.pictures ? <th>ছবি</th> : null)}<th>পণ্যের নাম</th>{(on.prices ? <th className="num">দাম</th> : null)}<th className="num">পরিমাণ</th>{(on.prices ? <th className="num">মোট</th> : null)}<th className="c iv-tick">✓</th></tr></thead><tbody>{jsxList(items.map((it, i) => <tr><td className="c iv-sl">{bn(i + 1)}</td>{(on.pictures ? <td className="iv-pic">{(it.image_id ? <img src={`/media/${attrValue(it.image_id)}/t`} alt="" /> : <span><Val v={it.emoji || '📦'} /></span>)}</td> : null)}<td><b className="iv-pname"><Val v={it.name} /></b>{' '}{((on.sku && it.sku) || it.note ? <span className="iv-sub">{(on.sku && it.sku ? <>SKU{' '}<Val v={it.sku} /></> : null)}{(it.note ? <>{' '}·{' '}<Val v={it.note} /></> : null)}</span> : null)}{' '}{(on.warranty && wt(it) ? <span className="iv-war">🛡️{' '}<Val v={wt(it)} /></span> : null)}</td>{(on.prices ? <td className="num">{money(it.price)}</td> : null)}<td className="num"><b>{bn(it.qty)}</b></td>{(on.prices ? <td className="num"><b>{money(it.price * it.qty)}</b></td> : null)}<td className="c iv-tick"><span className="iv-box-tick"></span></td></tr>))}</tbody></table>{(anyWarranty || on.note_box || on.totals ? <div className={`iv-bottom ${on.totals ? '' : 'no-sum'}`}><div className="iv-left">{(anyWarranty ? <div className="iv-box iv-wbox"><p className="iv-label"><Val v={c.warranty_title} /></p><p><Val v={docs.fill(c.warranty_text, s)} /></p></div> : null)}{' '}{(on.note_box ? <div className="iv-box"><p className="iv-label"><Val v={c.note_title} /></p><p><Val v={docs.fill(c.note_text, s)} /></p></div> : null)}</div>{(on.totals ? <table className="iv-sum"><tr><td>পণ্যের দাম</td><td className="num">{money(order.subtotal)}</td></tr>{(order.discount ? <tr><td>ছাড়{(order.coupon_code ? ` (${order.coupon_code})` : null)}</td><td className="num">−{' '}{money(order.discount)}</td></tr> : null)}{' '}{(Number(order.points_discount) ? <tr><td>পয়েন্ট ছাড়</td><td className="num">−{' '}{money(order.points_discount)}</td></tr> : null)}<tr><td>ডেলিভারি চার্জ</td><td className="num">{(order.delivery ? money(order.delivery) : "ফ্রি")}</td></tr>{(roundOff(order) ? <tr><td>{roundOffLabel(roundOff(order))}</td><td className="num">{(roundOff(order) > 0 ? "+ " : "− ")}{money(Math.abs(roundOff(order)))}</td></tr> : null)}<tr className="iv-total"><td>সর্বমোট</td><td className="num">{money(order.total)}</td></tr>{(order.paid_amount ? <tr><td>আগে পরিশোধিত</td><td className="num">−{' '}{money(order.paid_amount)}</td></tr> : null)}{' '}{(on.cod_box ? <tr className={due ? 'iv-due' : 'iv-paid'}><td>{(due ? "ডেলিভারির সময় দিতে হবে" : "পুরো টাকা পরিশোধিত")}</td><td className="num">{(due ? money(due) : "✅")}</td></tr> : null)}</table> : null)}</div> : null)}{' '}{(on.thanks || on.footer ? <footer className="iv-foot">{(on.thanks ? <p className="iv-thanks"><Val v={docs.fill(c.thanks_text, s)} /></p> : null)}{' '}{(on.footer && docs.fill(c.footer_text, s) ? <p><Val v={docs.fill(c.footer_text, s)} /></p> : null)}</footer> : null)}</section>;
}
// A6 (105×148 mm, the owner's small paper, 2026-11-15): the same design, everything smaller, one column
const A6_CSS = `.iv{font-size:11px}.iv-strip{height:3px}.iv-head{padding:10px 12px 6px;gap:8px}.iv-logo .dc-mark{width:30px;height:30px;border-radius:8px}.iv-logo .dc-word{font-size:20px}
.iv-logo .dc-logo-img{height:28px!important;max-width:150px!important}.iv-tag{font-size:9.5px;margin-top:3px}.iv-contact{font-size:9px;line-height:1.4}
.iv-title h1{font-size:16px}.iv-no{font-size:10.5px}.iv-no b{font-size:11.5px}.iv-date{font-size:9px}
.iv-cards{padding:2px 12px 6px;gap:6px}.iv-card{padding:5px 7px;border-radius:7px}.iv-card p{font-size:9.5px;line-height:1.45}.iv-cname{font-size:11px}.iv-k{min-width:40px;font-size:9px}
.iv-label{font-size:8.5px!important}.iv-qr{padding:3px;border-radius:7px;font-size:8px}.iv-qr svg{width:58px;height:58px}
.iv-table{width:calc(100% - 24px);margin:0 12px;font-size:9.5px}.iv-table th{font-size:9px;padding:4px 4px}.iv-table td{padding:4px 4px}
.iv-pic{width:36px}.iv-pic img,.iv-pic span{width:30px;height:30px;border-radius:5px;font-size:15px}.iv-sub{font-size:8.5px}.iv-war{font-size:8.5px;padding:0 6px;margin-top:2px}
.iv-tick{width:20px}.iv-box-tick{width:11px;height:11px;border-width:1.5px}
.iv-bottom{grid-template-columns:1fr;gap:6px;padding:6px 12px 2px}.iv-box{padding:5px 7px;border-radius:7px}.iv-box p{font-size:9px;line-height:1.4}
.iv-sum{font-size:10px}.iv-sum td{padding:2px 3px}.iv-total td{font-size:12px;padding-top:4px}.iv-due td,.iv-paid td{font-size:11.5px;padding:5px 7px}.iv-due td:last-child,.iv-paid td:last-child{font-size:13px}
.iv-foot{padding:6px 12px 8px;margin-top:6px}.iv-foot p{font-size:9px}.iv-thanks{font-size:10.5px!important}
/* A6 is narrower than a phone, so the phone layout would stack everything: keep the paper's own two-column layout */
.iv-head{flex-direction:row!important;padding:10px 12px 6px!important}.iv-title{text-align:right!important}
.iv-cards{flex-direction:row!important;padding:2px 12px 6px!important}.iv-cards>.iv-qr{flex-direction:column!important}
.iv-table{width:calc(100% - 24px)!important;margin:0 12px!important;font-size:9.5px!important}.iv-table th,.iv-table td{padding:4px!important}
.iv-pic{width:36px!important}.iv-pic img,.iv-pic span{width:30px!important;height:30px!important}.iv-bottom{grid-template-columns:1fr!important;padding:6px 12px 2px!important}
.dc-word{font-size:20px!important}.dc-mark{width:30px!important;height:30px!important}`;
function checklistCss(c: PaperDoc) {
  return `${BASE_CSS}
:root{--p:#000;--a:#000}
.iv{background:#fff;max-width:${c.paper === 'A6' ? '420px' : c.paper === 'A5' ? '600px' : '820px'};margin:18px auto;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(20,33,61,.10);page-break-after:always;position:relative}
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
.iv-kv{margin:0 0 2px!important}.iv-k{display:inline-block;min-width:58px;font-size:12px;font-weight:700;color:#000}
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
/* black & white (owner, 2026-11-14): no coloured fills, dark text, pictures in grey — what the printer will give */
.iv-strip{background:#000;height:4px}.iv-head,.iv,.iv *{color:#000}.iv-tag,.iv-contact,.iv-date,.iv-sub,.iv-sl,.iv-sum td:first-child,.iv-foot p,.iv-qr{color:#333!important}
.iv-card,.iv-to,.iv-wbox{background:#fff;border-color:#000}.iv-to{border-left:3px solid #000}.iv-note{color:#000!important;font-weight:600}
.iv-table th{background:#fff;color:#000;border-top:1.5px solid #000;border-bottom:1.5px solid #000}.iv-table th:first-child,.iv-table th:last-child{border-radius:0}
.iv-table td{border-bottom-color:#999}.iv-table tbody tr:nth-child(even) td{background:#fff}.iv-box-tick{border-color:#000}
.iv-war{color:#000;background:#fff;border-color:#000}.iv-box{border-color:#666}.iv-due td,.iv-paid td{background:#fff;border-top:1.5px solid #000;border-bottom:1.5px solid #000}
.iv-thanks{color:#000!important}.iv img,.dc-mark,.dc-logo-img{filter:grayscale(1)}.dc-word .a,.dc-word .b{color:#000}
${c.paper === 'A6' ? A6_CSS : ''}
@media print{@page{size:${c.paper};margin:${c.paper === 'A6' ? '4mm' : '8mm'}}body{background:#fff}.bar{display:none}.iv{margin:0;border-radius:0;box-shadow:none;max-width:none}tr{page-break-inside:avoid}}`;
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
  const size = String(c.size);
  const z = docs.LABEL_SIZES[size] || docs.LABEL_SIZES.a4x6;
  const mini = z.h < 60; // 4×2
  const compact = z.h < 120;
  const qpx = mini ? 62 : compact ? 88 : 100;
  const qrHand = on.handover_qr ? handoverQr(s, order, qpx) : '';
  const qrIn = on.qr ? qrSvg(s, order, qpx) : '';
  const courier = order.courier ? String(courierName(order.courier)) : '';
  return <section className={`lb lb-mono ${compact ? 'lb-compact' : ''} ${mini ? 'lb-mini' : ''}`}>
    <header className="lb-head">
      <div className="lb-brand">{on.logo ? brandMark(s, 'lb-sm') : <b className="lb-shop"><Val v={s.store_name} /></b>}</div>
      {on.sender ? <p className="lb-from"><span className="lb-tag">প্রেরক</span>{' '}{s.phone ? <b className="lb-fphone"><Val v={s.phone} /></b> : null}{on.sender_address && s.address && !mini ? <small><Val v={s.address} /></small> : null}</p> : null}
    </header>
    {on.courier ? <div className="lb-cid"><span className="lb-cname">{courier ? <Val v={courier} /> : 'কুরিয়ার'}</span><span className="lb-clabel">আইডি</span><b className={order.consignment_id ? '' : 'blank'}>{order.consignment_id ? <Val v={order.consignment_id} /> : ' '}</b></div> : null}
    {on.code_date || on.item_count || (on.weight && weight) ? <p className="lb-meta">{on.code_date ? <><span>অর্ডার #{' '}<b><Val v={order.code} /></b></span>{' '}<span>{fmtDate(order.created_at, false)}</span></> : null}{on.item_count ? <span>📦 <b>{bn(units)}</b>টি পণ্য</span> : null}{on.weight && weight ? <span>⚖️ <b>{bn(weight >= 1000 ? (weight / 1000).toFixed(2) + ' কেজি' : weight + ' গ্রাম')}</b></span> : null}</p> : null}
    <div className="lb-body">
      <div className="lb-left">
        {on.receiver ? <div className="lb-to"><p className="lb-k">প্রাপক</p><p className="lb-name" translate="no"><span className="lb-f">নাম:</span>{' '}<Val v={order.customer_name} /></p><p className="lb-phone"><span className="lb-f">মোবাইল:</span>{' '}<Val v={order.phone} /></p><p className="lb-addr" translate="no"><span className="lb-f">ঠিকানা:</span>{' '}<Val v={order.address} />{area ? <>,{' '}<b><Val v={area} /></b></> : null}</p></div> : null}
        {on.cod ? <div className={`lb-cod ${due ? '' : 'paid'}`}><span>{due ? 'নিতে হবে (COD)' : 'টাকা পরিশোধিত'}</span><b>{due ? money(due) : '৳০ ✅'}</b>{on.payment && !mini ? <small><Val v={ordersModel.PAYMENT_METHODS[order.payment] || order.payment} />{' '}·{' '}<Val v={ordersModel.PAYMENT_STATUSES[order.payment_status] || ''} /></small> : null}</div> : null}
      </div>
      {qrHand || qrIn ? <div className="lb-qrs">
        {qrHand ? <figure className="lb-q"><RawHtml html={qrHand} /><figcaption><b>📦 হ্যান্ডওভার</b>{mini ? null : <small>দোকান স্ক্যান করবে</small>}</figcaption></figure> : null}
        {qrIn ? <figure className="lb-q"><RawHtml html={qrIn} /><figcaption><b>📋 ভেতরে কী আছে</b>{mini ? null : <small>কাস্টমার স্ক্যান করুন</small>}</figcaption></figure> : null}
      </div> : null}
    </div>
    {on.customer_note && order.note && !mini ? <p className="lb-note">📝{' '}<Val v={order.note} /></p> : null}
    {on.handling && c.handling_text && !mini ? <p className="lb-handle"><Val v={docs.fill(c.handling_text, s)} /></p> : null}
    {!mini && ((on.return_note && c.return_text) || c.footer_text) ? <footer className="lb-foot">{on.return_note && c.return_text ? <p><Val v={docs.fill(c.return_text, s)} />{s.address ? <>{' '}·{' '}<Val v={s.address} /></> : null}</p> : null}{c.footer_text ? <p><Val v={docs.fill(c.footer_text, s)} /></p> : null}{site ? <p className="lb-site"><Val v={bare(site)} /></p> : null}</footer> : null}
  </section>;
}
function labelCss(c: PaperDoc) {
  const z = docs.LABEL_SIZES[String(c.size)] || docs.LABEL_SIZES.a4x6;
  const small = z.w < 105;
  return `${BASE_CSS}
:root{--p:#000;--a:#000}
.sheet{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;padding:16px}
.embed .sheet{padding:0}
.lb{width:${z.w}mm;height:${z.h}mm;background:#fff;border-radius:6px;box-shadow:0 6px 20px rgba(20,33,61,.12);overflow:hidden;display:flex;flex-direction:column;font-size:${small ? 11.5 : 12.5}px;page-break-inside:avoid;color:#000}
.lb *{color:#000}
.lb-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2.2mm 3mm 1.6mm}
.lb-brand{display:flex;align-items:center;min-width:0}.lb-brand .dc-mark{width:30px;height:30px;border-radius:7px;box-shadow:none;margin-right:6px;filter:grayscale(1) contrast(1.4)}
.lb-brand .dc-word{font-size:22px}.lb-brand .dc-word .a,.lb-brand .dc-word .b{color:#000}.lb-brand .dc-logo-img{filter:grayscale(1)}.lb-shop{font-size:18px}
.lb-from{margin:0;text-align:right;line-height:1.15}.lb-tag{display:inline-block;border:1px solid #000;border-radius:4px;padding:0 5px;font-size:10px;font-weight:700;vertical-align:middle}
.lb-fphone{font-size:${small ? 17 : 19}px;font-weight:800;letter-spacing:.3px;vertical-align:middle}.lb-from small{display:block;font-size:9.5px}
.lb-cid{display:flex;align-items:center;gap:2.5mm;background:#000;margin:0 2.5mm;border-radius:3px;padding:1.3mm 3mm}
.lb-cid *{color:#fff!important}.lb-cname{font-weight:800;font-size:${small ? 14 : 16}px;text-transform:uppercase;letter-spacing:.5px}
.lb-clabel{font-size:10px;font-weight:700;border:1px solid #fff;border-radius:3px;padding:0 4px}
.lb-cid b{margin-left:auto;font-size:${small ? 21 : 25}px;font-weight:800;letter-spacing:1px;font-family:'Noto Sans Bengali',Arial,sans-serif}
.lb-cid b.blank{min-width:45%;height:1.25em;background:#fff;border-radius:2px}
.lb-meta{display:flex;flex-wrap:wrap;gap:0 3mm;margin:1.2mm 3mm 0;font-size:10.5px}
.lb-body{flex:1;display:flex;gap:2.5mm;padding:1.6mm 3mm 1.6mm;min-height:0}
.lb-left{flex:1;display:flex;flex-direction:column;gap:1.6mm;min-width:0}
.lb-to p{margin:0}.lb-k{font-size:9.5px;font-weight:800;letter-spacing:.5px;text-decoration:underline}
.lb-f{display:inline-block;min-width:3.9em;font-size:10.5px;font-weight:700}
.lb-name{font-size:${small ? 15 : 17}px;font-weight:800;line-height:1.25}.lb-phone{font-size:${small ? 16 : 18}px;font-weight:800;letter-spacing:.4px;margin:1px 0!important}
.lb-addr{font-size:${small ? 12 : 13}px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.lb-cod{border:2px solid #000;border-radius:6px;padding:1.2mm 2.5mm;display:flex;align-items:center;gap:2mm;flex-wrap:wrap;margin-top:auto}
.lb-cod span{font-size:10.5px;font-weight:800}.lb-cod b{margin-left:auto;font-size:${small ? 22 : 26}px;font-weight:800;line-height:1.05}.lb-cod small{flex-basis:100%;font-size:9.5px}
.lb-qrs{display:flex;flex-direction:column;justify-content:space-between;gap:1.5mm;flex:0 0 auto}
.lb-q{margin:0;display:flex;flex-direction:column;align-items:center;text-align:center}.lb-q svg{display:block}
.lb-q figcaption{line-height:1.15;margin-top:.4mm}.lb-q figcaption b{display:block;font-size:9.5px;font-weight:800;white-space:nowrap}.lb-q figcaption small{display:block;font-size:8.5px}
.lb-note{margin:0 3mm 1mm;font-size:10.5px;font-weight:600}
.lb-handle{margin:0 3mm 1.2mm;padding:1mm 2mm;border:1.5px solid #000;border-radius:4px;font-weight:700;font-size:10.5px;text-align:center}
.lb-foot{padding:1mm 3mm 1.6mm;border-top:1px dashed #000;text-align:center}.lb-foot p{margin:0;font-size:9px;line-height:1.3}.lb-site{font-weight:800}
/* 4×4, 100×75, A4-এ ৬টা: a little tighter */
.lb-compact .lb-head{padding:1.8mm 2.5mm 1.2mm}.lb-compact .lb-brand .dc-mark{width:24px;height:24px}.lb-compact .lb-brand .dc-word{font-size:18px}
.lb-compact .lb-brand .dc-logo-img{max-height:26px}.lb-compact .lb-body{padding:1.2mm 2.5mm}.lb-compact .lb-meta{margin:1mm 2.5mm 0}
/* 4×2 (50 mm tall): logo + phone, courier ID, receiver + cash on the left, the two QR codes side by side on the right */
.lb-mini{font-size:10px}.lb-mini .lb-head{padding:1.2mm 2.5mm .8mm}.lb-mini .lb-brand .dc-mark{width:18px;height:18px;margin-right:4px}.lb-mini .lb-brand .dc-word{font-size:14px}
.lb-mini .lb-brand .dc-logo-img{max-height:18px!important;height:18px!important}.lb-mini .lb-fphone{font-size:14px}.lb-mini .lb-tag{font-size:8.5px}
.lb-mini .lb-cid{padding:.7mm 2.5mm;margin:0 2mm}.lb-mini .lb-cname{font-size:11px}.lb-mini .lb-clabel{font-size:8.5px}.lb-mini .lb-cid b{font-size:16px}
.lb-mini .lb-meta{display:none}.lb-mini .lb-body{padding:1mm 2.5mm 1.2mm;gap:2mm}.lb-mini .lb-left{gap:.8mm}
.lb-mini .lb-k{display:none}.lb-mini .lb-f{min-width:0;font-size:8.5px;margin-right:2px}.lb-mini .lb-name{font-size:12px}.lb-mini .lb-phone{font-size:12.5px}
.lb-mini .lb-addr{font-size:9.5px;line-height:1.25;-webkit-line-clamp:2}.lb-mini .lb-cod{padding:.6mm 2mm;border-width:1.5px}.lb-mini .lb-cod span{font-size:8.5px}.lb-mini .lb-cod b{font-size:15px}
.lb-mini .lb-qrs{flex-direction:row;align-items:flex-end;gap:1mm}.lb-mini .lb-q figcaption b{white-space:normal;max-width:17mm}.lb-mini .lb-q figcaption b{font-size:7.5px}
@media print{@page{size:${z.sheet ? 'A4' : `${z.w}mm ${z.h}mm`};margin:0}body{background:#fff}.bar{display:none}
  .sheet{padding:0;gap:0;justify-content:flex-start}.lb{box-shadow:none;border-radius:0;height:${z.h}mm;${z.sheet ? 'outline:1px dashed #999;' : 'page-break-after:always;'}}}`;
}
function invoicePage(orders: PrintOrder[], s: Settings, c: PaperDoc = docs.invoice(s), opts: ShellProps = {}) {
  return shell(`${c.title} ${orders.length === 1 ? orders[0].code : `(${bn(orders.length)}টি)`}`, labelCss(c), <div className="sheet"><Val v={orders.map((o) => labelBody(o, s, c))} /></div>, opts);
}

export { invoicePage, checklistPage, labelBody, checklistBody, mergedItems };

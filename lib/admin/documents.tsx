// Admin → স্টোর ডিজাইন → 🖨️ ইনভয়েস ও চেকলিস্ট: everything on the two printed papers, with a live sample.
import { Val, attrValue, attrProps, jsxList } from '../react/html';
import { raw, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as docs from '../services/docs';
import * as O from '../models/orders';
import { invoicePage, checklistPage } from '../views/invoice';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/design/documents';

// a real recent order to show the sample with, or a made-up one if the shop has none yet
async function sampleOrder() {
  const r = await db.one(`SELECT id FROM orders WHERE status NOT IN ('cancelled') ORDER BY (SELECT count(*) FROM order_items i WHERE i.order_id=orders.id) >= 2 DESC, id DESC LIMIT 1`).catch(() => null);
  if (r) { const o = await O.getOrder({ id: r.id }); if (o && o.items.length) return o; }
  const p = await db.q('SELECT id, name, sku, price, image_id, emoji, warranty, warranty_type, barcode, weight_g FROM products WHERE active ORDER BY id LIMIT 3').catch(() => []);
  const items = (p.length ? p : [{ name: 'নমুনা পণ্য', price: 250 }]).map((x, i) => ({ ...x, product_id: x.id, qty: i + 1 }));
  const subtotal = items.reduce((t: number, x: Loose) => t + x.price * x.qty, 0);
  return { id: 0, code: 'SM12AB34', created_at: new Date(), customer_name: 'মোঃ রাকিব হাসান', phone: '01912345678', address: 'বাসা ২৪, রোড ৭, শ্যামলী', district: 'Dhaka', thana: 'Adabor', area: 'dhaka',
    note: 'বিকেল ৫টার পর দিন', payment: 'cod', payment_status: 'unpaid', items, subtotal, discount: 0, points_discount: 0, delivery: 60, total: subtotal + 60, paid_amount: 0, courier: 'Steadfast', consignment_id: '12345678' };
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const tab = ctx.query.get('tab') === 'checklist' ? 'checklist' : 'invoice';
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const kind = b.kind === 'checklist' ? 'checklist' : 'invoice';
    if (b.reset === '1') await db.setSetting(kind === 'invoice' ? 'doc_invoice' : 'doc_checklist', '');
    else await db.setSetting(kind === 'invoice' ? 'doc_invoice' : 'doc_checklist', JSON.stringify(docs.fromForm(kind, b)));
    await ctx.reloadSettings();
    await ctx.log('settings', 'design', null, `${kind === 'invoice' ? 'ইনভয়েস' : 'চেকলিস্ট'} ডিজাইন ${b.reset === '1' ? 'আগের মতো করা হলো' : 'বদলানো হলো'}`);
    return ctx.redirect(`${BASE}?tab=${kind}&msg=saved`);
  }
  const c = tab === 'invoice' ? docs.invoice(s) : docs.checklist(s);
  const parts = tab === 'invoice' ? docs.INVOICE_PARTS : docs.CHECKLIST_PARTS;
  const sample = await sampleOrder();
  const previewHtml = tab === 'invoice' ? invoicePage([sample], s, c, { embed: true }) : checklistPage([sample], s, c, { embed: true });
  const text = (name?: Loose, label?: Loose, hint?: Loose, rows: Loose = 1) => ui.field(label, rows > 1 ? ui.textarea(name, c[name], { rows, maxlength: 600 }) : ui.input(name, c[name], { maxlength: 120 }), hint);
  const body = <><div className="title-row"><h1>🖨️ ইনভয়েস ও চেকলিস্ট</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href="/admin/orders">অর্ডারে যান</a></div></div><Val v={ui.flash(ctx.flash)} /><nav className="imp-tabs"><a className={`imp-tab ${tab === 'invoice' ? 'on' : ''}`} href={`${attrValue(BASE)}?tab=invoice`}><span className="imp-tab-ic">🏷️</span><span><b>ইনভয়েস — বক্সের উপরে</b><small>শুধু ডেলিভারির তথ্য: বারকোড, প্রাপক, কত টাকা নিতে হবে</small></span></a>{' '}<a className={`imp-tab ${tab === 'checklist' ? 'on' : ''}`} href={`${attrValue(BASE)}?tab=checklist`}><span className="imp-tab-ic">📋</span><span><b>চেকলিস্ট — বক্সের ভেতরে</b><small>কাস্টমারের জন্য: পণ্যের ছবি, নাম, ওয়ারেন্টি, দাম</small></span></a></nav><div className="doc-cols"><form method="post" action={attrValue(BASE)} className="form panel doc-form" data-doc-form=""><input type="hidden" name="kind" defaultValue={attrValue(tab)} /><h2>কী কী দেখাবে{' '}<small>চাপ দিয়ে চালু/বন্ধ করুন — পাশের নমুনা সাথে সাথে বদলায়</small></h2><div className="doc-parts">{jsxList(parts.map(([k, label]) => <label className="nav-chip doc-chip"><span className="nav-chip-t"><Val v={label} /></span>{' '}<span className="switch switch-sm"><input type="checkbox" name={`show_${attrValue(k)}`} defaultValue="1" {...attrProps(c.show[k] ? raw('checked') : '')} /><span className="switch-ui" aria-hidden="true"></span></span></label>))}</div><h2 className="mt">লেখা, মাপ ও রং</h2><div className="field-row"><Val v={text('title', 'উপরের শিরোনাম', tab === 'invoice' ? 'যেমন: ইনভয়েস / ডেলিভারি স্লিপ' : 'যেমন: চেকলিস্ট / পণ্যের তালিকা')} />{' '}{(tab === 'invoice' ? <Val v={ui.field('কাগজের মাপ', ui.select('size', Object.entries(docs.LABEL_SIZES).map(([k, v]) => [k, v.label]), c.size), 'সাধারণ প্রিন্টারে "A4-এ ৬টা" সবচেয়ে সস্তা (কেটে নিন); স্টিকার প্রিন্টারে ১০০×৭৫ বা ৪×৬ — সাথে "সাদা-কালো" চালু করুন')} /> : <Val v={ui.field('কাগজের মাপ', ui.select('paper', [['A4', 'A4 (পুরো পাতা)'], ['A5', 'A5 (অর্ধেক পাতা)']], c.paper))} />)}</div><div className="field-row"><Val v={ui.field('প্রধান রং', ui.input('primary', c.primary, { type: 'color' }))} />{' '}<Val v={ui.field('দ্বিতীয় রং', ui.input('accent', c.accent, { type: 'color' }))} /></div>{(tab === 'invoice' ? <>{' '}<Val v={text('handling_text', 'সাবধানতার লেখা', 'ডেলিভারিম্যানের জন্য, লাল ঘরে দেখায়')} />{' '}<Val v={text('return_text', 'ফেরতের লেখা', 'নিচে ছোট করে, সাথে দোকানের ঠিকানা')} />{' '}<Val v={text('footer_text', 'নিচের বাড়তি লেখা (ঐচ্ছিক)', '{shop} {phone} {site} লিখলে দোকানের নাম/ফোন/ওয়েবসাইট বসবে')} /></> : <>{' '}<Val v={text('tagline', 'ট্যাগলাইন (খালি = দোকানের নিজের ট্যাগলাইন)', '')} />{' '}<Val v={text('note_title', '"পণ্য হাতে পেয়ে" বক্সের শিরোনাম', '')} />{' '}<Val v={text('note_text', '"পণ্য হাতে পেয়ে" বক্সের লেখা', '', 3)} />{' '}<Val v={text('warranty_title', 'ওয়ারেন্টির বক্সের শিরোনাম', 'কোনো পণ্যে ওয়ারেন্টি থাকলে তবেই এই বক্স আসে')} />{' '}<Val v={text('warranty_text', 'ওয়ারেন্টির শর্ত', '', 3)} />{' '}<Val v={text('thanks_text', 'ধন্যবাদের লেখা', '{shop} = দোকানের নাম')} />{' '}<Val v={text('footer_text', 'নিচের যোগাযোগ লাইন', '{phone} {site} {shop} লিখলে নিজে থেকে বসবে')} /></>)}<div className="row-actions doc-actions"><button className="btn btn-lg">💾 সেভ করুন</button>{' '}<button className="btn btn-ghost btn-sm" name="reset" value="1" data-confirm-btn="সব বদল মুছে আগের (শুরুর) ডিজাইনে ফেরত যাবেন?">↩️ শুরুর ডিজাইনে ফেরত</button></div></form><section className="panel doc-preview"><h2>👀 নমুনা{' '}<small>{(sample.id ? `অর্ডার ${sample.code} দিয়ে` : "বানানো নমুনা অর্ডার")}</small></h2><iframe title="নমুনা" className={`doc-frame doc-${attrValue(tab)}`} data-doc-preview="" srcdoc={attrValue(previewHtml)}></iframe><p className="small muted">{(tab === 'invoice' ? "ইনভয়েসে ভেতরের পণ্যের নাম থাকে না — শুধু কতটা পণ্য। বারকোডটা \"কুরিয়ারে হ্যান্ডওভার\" পেজে স্ক্যান করলেই অর্ডার খুঁজে পাবে।" : "ডান পাশের ✓ ঘরে প্যাক করার সময় টিক দিন — কিছু বাদ পড়বে না।")}</p></section></div></>;
  return ctx.page('ইনভয়েস ও চেকলিস্ট', body, 'documents');
}

// live sample while editing (not saved)
async function preview(ctx: AdminCtx) {
  const b = await ctx.body();
  const kind = b.kind === 'checklist' ? 'checklist' : 'invoice';
  const c = (kind === 'invoice' ? docs.invoice : docs.checklist)({ ...ctx.settings, [kind === 'invoice' ? 'doc_invoice' : 'doc_checklist']: JSON.stringify(docs.fromForm(kind, b)) });
  const o = await sampleOrder();
  return ctx.send(200, kind === 'invoice' ? invoicePage([o], ctx.settings, c, { embed: true }) : checklistPage([o], ctx.settings, c, { embed: true }));
}

export const routes = [
    { method: '*', path: BASE, perm: 'design', handler: page },
    { method: 'POST', path: BASE + '/preview', perm: 'design', handler: preview },
  ];
export { sampleOrder };
void int;

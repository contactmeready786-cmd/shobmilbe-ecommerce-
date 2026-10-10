'use strict';
// Settings for the two printed papers of every order (Admin → স্টোর ডিজাইন → ইনভয়েস ও চেকলিস্ট):
//   🏷️ ইনভয়েস  — stuck on top of the parcel: only what delivery needs (barcode, receiver, cash to collect).
//   📋 চেকলিস্ট — goes inside the box for the customer: pictures, names, warranty, prices, totals.
// Every part can be switched on/off and every text changed. Saved as JSON in settings (doc_invoice / doc_checklist).

const INVOICE = {
  title: 'ইনভয়েস',
  size: 'a4x6',
  primary: '#0866D6', accent: '#F5A524',
  show: {
    logo: true, sender: true, sender_address: false, barcode: true, code_date: true, receiver: true, cod: true, payment: true,
    courier: true, consignment_barcode: true, item_count: true, weight: false, customer_note: true, handling: true, qr: true, return_note: true, mono: false,
  },
  handling_text: '⚠️ সাবধানে বহন করুন — ইলেকট্রনিক পণ্য, চাপ দেবেন না',
  return_text: 'ডেলিভারি না হলে দয়া করে প্রেরকের কাছে ফেরত দিন।',
  footer_text: '',
};
const CHECKLIST = {
  title: 'চেকলিস্ট',
  paper: 'A4',
  primary: '#0866D6', accent: '#F5A524',
  show: {
    logo: true, tagline: true, contact: true, address: true, barcode: true, qr: true, receiver: true, order_info: true,
    pictures: true, sku: true, warranty: true, prices: true, totals: true, cod_box: true, warranty_terms: true, note_box: true, thanks: true, footer: true,
  },
  tagline: '',
  note_title: '✅ পণ্য হাতে পেয়ে',
  note_text: 'ডেলিভারিম্যানের সামনে প্যাকেট খুলে পণ্য মিলিয়ে নিন। কোনো সমস্যা হলে ২৪ ঘণ্টার মধ্যে আমাদের জানান।',
  warranty_title: '🛡️ ওয়ারেন্টির শর্ত',
  warranty_text: 'ওয়ারেন্টি ডেলিভারির দিন থেকে গোনা হবে। ওয়ারেন্টি দাবি করতে এই কাগজ আর পণ্যের বক্স রেখে দিন। পানি, আগুন, ভুল সংযোগ/ভোল্টেজ বা ভাঙার কারণে নষ্ট হলে ওয়ারেন্টি প্রযোজ্য নয়।',
  thanks_text: '{shop} থেকে কেনার জন্য ধন্যবাদ! 💙',
  footer_text: 'আবার কিনতে বা জানতে: {phone} · {site}',
};
// What each switch does, in the order shown on the settings page
const INVOICE_PARTS = [
  ['logo', 'লোগো'], ['sender', 'প্রেরক (দোকানের নাম ও ফোন)'], ['sender_address', 'প্রেরকের ঠিকানা'], ['barcode', 'অর্ডারের বারকোড (বড়)'],
  ['code_date', 'অর্ডার নম্বর ও তারিখ'], ['receiver', 'প্রাপকের নাম, ফোন, ঠিকানা'], ['cod', 'কত টাকা নিতে হবে (বড় করে)'], ['payment', 'পেমেন্টের অবস্থা'],
  ['courier', 'কুরিয়ার ও কনসাইনমেন্ট নম্বর'], ['consignment_barcode', 'কনসাইনমেন্টের বারকোড'], ['item_count', 'পণ্যের সংখ্যা (শুধু সংখ্যা, নাম না)'],
  ['weight', 'ওজন'], ['customer_note', 'কাস্টমারের নোট'], ['handling', 'সাবধানতার লেখা'], ['qr', 'ট্র্যাক করার QR কোড'], ['return_note', 'ফেরতের লেখা'],
  ['mono', '⚫ সাদা-কালো (থার্মাল স্টিকার প্রিন্টার / কালি বাঁচাতে)'],
];
const CHECKLIST_PARTS = [
  ['logo', 'লোগো'], ['tagline', 'ট্যাগলাইন'], ['contact', 'ফোন ও ওয়েবসাইট'], ['address', 'দোকানের ঠিকানা'], ['barcode', 'অর্ডারের বারকোড'], ['qr', 'ট্র্যাক করার QR কোড'],
  ['receiver', 'প্রাপকের তথ্য'], ['order_info', 'অর্ডারের তথ্য (পেমেন্ট, সংখ্যা)'], ['pictures', 'পণ্যের ছবি'], ['sku', 'SKU'], ['warranty', 'ওয়ারেন্টি ব্যাজ'],
  ['prices', 'দাম ও মোট (প্রতিটা পণ্যের)'], ['totals', 'নিচের টাকার হিসাব'], ['cod_box', '"দিতে হবে" হলুদ ঘর'], ['warranty_terms', 'ওয়ারেন্টির শর্তের বক্স'],
  ['note_box', '"পণ্য হাতে পেয়ে" বক্স'], ['thanks', 'ধন্যবাদের লেখা'], ['footer', 'নিচের যোগাযোগ লাইন'],
];
// Smaller paper = less printing cost per parcel. "per" = parcels per A4 sheet (paper) — stickers print one by one.
const LABEL_SIZES = {
  a4x6: { w: 105, h: 99, per: 6, label: '📄 A4 কাগজে ৬টা — সবচেয়ে কম খরচ (প্রস্তাবিত)', sheet: true },
  a4x4: { w: 105, h: 148.5, per: 4, label: '📄 A4 কাগজে ৪টা — বড় লেখা', sheet: true },
  '100x75': { w: 100, h: 75, label: '🏷️ স্টিকার ১০০×৭৫ মিমি (থার্মাল, ছোট)' },
  '4x4': { w: 101.6, h: 101.6, label: '🏷️ স্টিকার ৪×৪ ইঞ্চি (১০০×১০০ মিমি)' },
  '4x6': { w: 101.6, h: 152.4, label: '🏷️ স্টিকার ৪×৬ ইঞ্চি (১০০×১৫০ মিমি, কুরিয়ারের মতো)' },
  a6: { w: 105, h: 148, label: '📄 A6 আলাদা কাগজ (১০৫×১৪৮ মিমি)' },
};
const PAPERS = { A4: 'A4', A5: 'A5' };

const HEX = /^#[0-9a-f]{6}$/i;
function merge(def, saved) {
  const out = { ...def, ...(saved && typeof saved === 'object' ? saved : {}) };
  out.show = { ...def.show, ...((saved && saved.show) || {}) };
  if (!HEX.test(out.primary)) out.primary = def.primary;
  if (!HEX.test(out.accent)) out.accent = def.accent;
  return out;
}
function parse(s, key) { try { return JSON.parse(s[key] || '{}'); } catch (_) { return {}; } }
function invoice(s) { const c = merge(INVOICE, parse(s, 'doc_invoice')); if (!LABEL_SIZES[c.size]) c.size = INVOICE.size; return c; }
function checklist(s) { const c = merge(CHECKLIST, parse(s, 'doc_checklist')); if (!PAPERS[c.paper]) c.paper = 'A4'; return c; }

// form body → saved settings
function fromForm(kind, b) {
  const def = kind === 'invoice' ? INVOICE : CHECKLIST;
  const parts = kind === 'invoice' ? INVOICE_PARTS : CHECKLIST_PARTS;
  const out = { show: {} };
  for (const [k] of parts) out.show[k] = !!b['show_' + k];
  for (const k of Object.keys(def)) {
    if (k === 'show') continue;
    if (b[k] === undefined) continue;
    out[k] = String(b[k]).slice(0, k.endsWith('_text') ? 600 : 120).trim();
  }
  if (kind === 'invoice' && !LABEL_SIZES[out.size]) out.size = def.size;
  if (kind === 'checklist' && !PAPERS[out.paper]) out.paper = def.paper;
  for (const c of ['primary', 'accent']) if (!HEX.test(out[c] || '')) out[c] = def[c];
  if (!out.title) out.title = def.title;
  return out;
}
// {shop} {phone} {site} in the texts
function fill(text, s) {
  const site = String(s.site_url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return String(text || '').replace(/\{shop\}/g, s.store_name || 'সবমিলবে').replace(/\{phone\}/g, s.phone || '').replace(/\{site\}/g, site)
    .replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '');
}

module.exports = { INVOICE, CHECKLIST, INVOICE_PARTS, CHECKLIST_PARTS, LABEL_SIZES, PAPERS, invoice, checklist, fromForm, fill };

'use strict';
// Every part of the shop the owner can show or hide (Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে),
// plus the texts on those parts that can be changed without any coding.
//   switch:  { key, label, desc }            → setting key = '1' (shown) / '0' (hidden); missing = shown
//   text:    { key, label, def, max }        → setting key; empty = the default text
// Some keys already existed before this page (show_buy_now_on_card, pp_whatsapp, wishlist_on …); they are the same
// switches, so changing them here or on their own page is the same thing.
// Things that would stop people from ordering (price, "add to cart", address, confirm button) have no switch on purpose.

const GROUPS = [
  { id: 'top', title: '🔝 একদম উপরের অংশ', items: [
    { key: 'ui_notice', label: 'উপরের নোটিশ বার', desc: 'একদম উপরের পাতলা বারের লেখা। বন্ধ করলে বারটা থাকবে না (ভাষার বাটন চালু থাকলে শুধু সেটা থাকবে)।',
      text: { key: 'notice', label: 'নোটিশের লেখা', max: 160 } },
    { key: 'show_cat_strip', label: 'হেডারের নিচে ক্যাটাগরির বার', desc: 'ছোট আইকনসহ ক্যাটাগরির সারি আর ড্রপডাউন মেনু।' },
    { key: 'ui_search', label: 'হেডারের সার্চ বক্স', desc: 'বন্ধ করলে উপরে পণ্য খোঁজার ঘর থাকবে না।',
      text: { key: 'uit_search_ph', label: 'সার্চ বক্সের ভেতরের লেখা', def: 'কী খুঁজছেন? যেমন: capacitor', max: 60 } },
  ] },
  { id: 'card', title: '🗂️ পণ্যের কার্ড (তালিকা আর হোমপেজের ছোট বক্স)', items: [
    { key: 'ui_card_discount', label: 'ছাড়ের % ব্যাজ', desc: 'ছবির কোণে "২০% ছাড়" লেখা।' },
    { key: 'ui_card_new', label: '"নতুন" ট্যাগ', desc: 'নতুন তোলা পণ্যের ছবিতে "নতুন" লেখা।' },
    { key: 'ui_card_category', label: 'ক্যাটাগরির নাম', desc: 'পণ্যের নামের উপরে ছোট করে ক্যাটাগরি।' },
    { key: 'ui_card_rating', label: 'রেটিং স্টার', desc: 'রিভিউ থাকলে নামের নিচে ★★★★☆ (১২)।' },
    { key: 'wishlist_on', hidden: true, label: 'পছন্দের তালিকা (♡)', desc: 'কার্ড আর পণ্যের পেজে ♡ বাটন, আর "পছন্দের তালিকা" পেজ।' },
    { key: 'show_buy_now_on_card', label: '"এখনই কিনুন" বাটন (কার্ডে)', desc: '"কার্টে যোগ করুন" এর নিচে দ্বিতীয় বাটন।',
      text: { key: 'uit_buy_now', label: 'বাটনের লেখা', def: 'এখনই কিনুন', max: 30 } },
    { key: 'ui_card_flash_timer', label: 'ফ্ল্যাশ সেলের সময় (কার্ডে)', desc: 'ফ্ল্যাশ সেলের পণ্যের কার্ডে "⚡ শেষ হবে ০২:১৫:০৯" উল্টো গণনা।' },
    { key: 'ui_show_out_of_stock', label: 'স্টক শেষ পণ্য তালিকায় দেখাও', desc: 'বন্ধ করলে স্টক শেষ পণ্য তালিকা, হোমপেজ আর খোঁজার ফলাফলে আসবে না (লিংক দিয়ে পেজটা খোলা যাবে)।' },
  ] },
  { id: 'pdp', title: '📄 পণ্যের পেজ', items: [
    { key: 'ui_pdp_meta', label: 'SKU, মডেল, ব্র্যান্ড আর ক্যাটাগরির লাইন', desc: 'নামের নিচের ছোট তথ্যের লাইন।' },
    { key: 'ui_pdp_stock', label: 'স্টকের লেখা', desc: '"✓ স্টকে আছে" / "মাত্র ৩টি বাকি আছে"। (স্টক শেষ হলে "স্টকে নেই" সবসময় দেখাবে।)' },
    { key: 'ui_pdp_short', label: 'সংক্ষেপে বিবরণের বক্স', desc: 'দামের নিচে "📝 সংক্ষেপে" অংশ।' },
    { key: 'ui_pdp_qty', label: 'পরিমাণ বাড়ানো-কমানোর বক্স', desc: 'বন্ধ করলে কাস্টমার এখানে ১টা করে যোগ করবে, কার্টে গিয়ে পরিমাণ বদলাতে পারবে।' },
    { key: 'ui_pdp_buy_now', label: '"এখনই কিনুন" বাটন', desc: 'পণ্যের পেজে কমলা বাটন।' },
    { key: 'pp_whatsapp', label: 'WhatsApp বাটন', desc: 'নম্বর সেটিংসে দেওয়া থাকলে "কার্টে যোগ" এর পাশে।' },
    { key: 'ui_pdp_sticky', label: 'মোবাইলে নিচে আটকানো কেনার বার', desc: 'নিচে স্ক্রল করলে দাম আর "এখনই কিনুন" নিচে আটকে থাকে।' },
    { key: 'ui_pdp_flash', label: 'ফ্ল্যাশ সেলের কাউন্টডাউন', desc: '"এই দাম শেষ হবে ০২:১৫:০৯"। (দাম ঠিকই সেলের থাকবে।)' },
    { key: 'ui_pdp_tiers', label: '"বেশি কিনলে কম দাম" টেবিল', desc: 'পাইকারি দামের ছোট টেবিল। (কার্টে কম দাম ঠিকই বসবে।)' },
    { key: 'ui_pdp_offers', label: 'অফারের বক্স', desc: '"🎁 ২টা কিনলে ১টা ফ্রি" এর মতো লেখা। (উপহার ঠিকই যোগ হবে।)' },
    { key: 'ui_pdp_facts', label: 'ডেলিভারির তথ্যের বক্স', desc: 'কেনার বাটনের নিচে ডেলিভারি চার্জ, ক্যাশ অন ডেলিভারি, ফোন নম্বর।',
      text: { key: 'uit_pdp_fact_extra', label: 'বক্সে বাড়তি এক লাইন (ঐচ্ছিক)', def: '', max: 140, ph: 'যেমন: ✅ ৭ দিনের রিপ্লেসমেন্ট গ্যারান্টি' } },
    { key: 'ui_pdp_specs', label: '"স্পেসিফিকেশন" ট্যাব', desc: 'পণ্যে স্পেসিফিকেশন দেওয়া থাকলে।' },
    { key: 'ui_pdp_video', label: 'ভিডিও', desc: 'YouTube লিংক থাকলে ছবির পাশে আর নিচে ভিডিও।' },
    { key: 'ui_pdp_ship_tab', label: '"ডেলিভারি ও রিটার্ন" ট্যাব', desc: 'বিবরণের পাশের ট্যাব।',
      text: { key: 'uit_ship_extra', label: 'ট্যাবে বাড়তি লেখা (ঐচ্ছিক)', def: '', max: 300, ph: 'যেমন: ভাঙা বা ভুল পণ্য পেলে ৩ দিনের মধ্যে জানান' } },
    { key: 'ui_pdp_cross', label: '"এর সাথে যা লাগবে"', desc: 'পণ্যের এডিট পেজে ক্রস-সেল দেওয়া থাকলে।',
      text: { key: 'uit_cross', label: 'শিরোনাম', def: '🔗 এর সাথে যা লাগবে', max: 50 } },
    { key: 'ui_pdp_upsell', label: '"আরও ভালো বিকল্প"', desc: 'পণ্যের এডিট পেজে আপসেল দেওয়া থাকলে।',
      text: { key: 'uit_upsell', label: 'শিরোনাম', def: '⬆️ আরও ভালো বিকল্প', max: 50 } },
    { key: 'ui_pdp_related', label: '"একই রকম আরও পণ্য"', desc: 'পেজের নিচে একই ক্যাটাগরির পণ্য।',
      text: { key: 'uit_related', label: 'শিরোনাম', def: 'একই রকম আরও পণ্য', max: 50 } },
    { key: 'reviews_on', hidden: true, label: 'রিভিউ', desc: 'পণ্যের পেজে রিভিউ আর অর্ডারের পেজে "রিভিউ দিন" — দুটোই। ("রিভিউ" পেজেও একই সুইচ।)' },
    { key: 'ui_restock_notify', hidden: true, label: '"স্টকে এলে জানাও" বক্স', desc: 'স্টক শেষ পণ্যে মোবাইল নম্বর রেখে যাওয়ার ঘর। পণ্য এলে SMS যায় (তালিকা: মার্কেটিং → স্টকে এলে জানাও)।',
      text: { key: 'uit_restock_title', label: 'বক্সের শিরোনাম', def: 'স্টকে এলে জানাও', max: 40 } },
    { key: 'ui_qa', hidden: true, label: 'প্রশ্ন-উত্তর (Q&A)', desc: 'পণ্যের পেজের নিচে কাস্টমারের প্রশ্ন আর আপনার উত্তর, আর প্রশ্ন করার ঘর।',
      text: { key: 'uit_qa_title', label: 'শিরোনাম', def: 'প্রশ্ন ও উত্তর', max: 40 } },
    { key: 'ui_compare', label: '"⚖️ তুলনা" বাটন', desc: 'দুই থেকে চারটা পণ্য পাশাপাশি তুলনা করার বাটন আর পেজ।' },
    { key: 'ui_share', label: '"শেয়ার করুন" বাটন', desc: 'পণ্যের পেজে Facebook, Messenger, WhatsApp আর লিংক কপির ছোট বাটন — কাস্টমার বন্ধুকে পাঠাতে পারেন।' },
    { key: 'price_alert_on', hidden: true, label: '"দাম কমলে জানাও" বক্স', desc: 'পণ্যের পেজে মোবাইল নম্বর রেখে যাওয়ার ঘর। দাম কমলে বা ফ্ল্যাশ সেল এলে একবার SMS যায় (SMS চালু থাকলে)।' },
    { key: 'ui_spec_filters', label: 'স্পেসিফিকেশন দিয়ে ফিল্টার', desc: 'পণ্যের তালিকার "⚙️ ফিল্টার"-এ ভোল্টেজ, ওয়াট, সাইজের মতো স্পেসিফিকেশন দিয়ে বাছাই — একই স্পেসিফিকেশন কয়েকটা পণ্যে থাকলে নিজে থেকে আসে।' },
    { key: 'ui_recent', label: '"সম্প্রতি দেখেছেন" সারি', desc: 'কাস্টমার শেষ যে পণ্যগুলো দেখেছেন (তার নিজের ব্রাউজারে মনে থাকে) — পণ্যের পেজ আর হোমপেজের নিচে।',
      text: { key: 'uit_recent', label: 'শিরোনাম', def: '🕘 সম্প্রতি দেখেছেন', max: 40 } },
  ] },
  { id: 'cart', title: '🛒 কার্ট ও চেকআউট', items: [
    { key: 'ui_cart_suggest', label: '"এগুলোও লাগতে পারে"', desc: 'কার্টের নিচে ক্রস-সেল পণ্যের সাজেশন।',
      text: { key: 'uit_cart_suggest', label: 'শিরোনাম', def: '🔗 এগুলোও লাগতে পারে', max: 50 } },
    { key: 'ui_cart_free_msg', label: 'ফ্রি ডেলিভারির বার্তা', desc: '"আরও ৳১৫০ কিনলে ডেলিভারি ফ্রি" (সেটিংসে ফ্রি ডেলিভারির টাকা দেওয়া থাকলে)।' },
    { key: 'ui_co_coupon', label: 'কুপনের বক্স', desc: 'চেকআউটে "কুপন কোড আছে?"। বন্ধ করলে কেউ কুপন দিতে পারবে না।' },
    { key: 'ui_co_note', label: '"বিশেষ নির্দেশনা" ঘর', desc: 'কাস্টমারের নোট লেখার ঘর।',
      text: { key: 'uit_co_note', label: 'ঘরের নাম', def: 'বিশেষ নির্দেশনা (ঐচ্ছিক)', max: 50 } },
  ] },
  { id: 'order', title: '✅ অর্ডারের পর (কাস্টমারের অর্ডারের পেজ)', items: [
    { key: 'ui_order_thanks', label: 'ধন্যবাদের বার্তা', desc: 'অর্ডারের ঠিক পরে সবুজ বক্স।',
      text: { key: 'uit_order_thanks', label: 'নামের পরের লেখা', def: 'আপনার অর্ডার পেয়েছি।', max: 80 } },
    { key: 'ui_order_steps', label: 'অর্ডারের ধাপ', desc: 'নতুন → কনফার্ম → প্যাকিং → কুরিয়ারে → ডেলিভারি।' },
    { key: 'ui_order_tracking', label: 'কুরিয়ারের ট্র্যাকিং নম্বর ও লিংক', desc: 'কুরিয়ারে দেওয়ার পর।' },
  ] },
  { id: 'footer', hidden: true, title: '⬇️ ফুটার (একদম নিচে)', items: [
    { key: 'ui_foot_about', label: 'দোকান সম্পর্কে লেখা', desc: 'ফুটারের লোগোর নিচের লেখা ("লোগো, রং ও হোমপেজ" থেকে বদলানো যায়)।' },
    { key: 'ui_foot_social', label: 'সোশ্যাল মিডিয়ার আইকন', desc: 'ফেসবুক, ইউটিউব… লিংক দেওয়া থাকলে।' },
    { key: 'foot_contact', label: 'যোগাযোগের কলাম', desc: 'ফোন, WhatsApp, ইমেইল, ঠিকানা।' },
  ] },
];

// home page rows: shown/hidden with the home-page list; their titles and small lines can be changed here
const HOME_TEXTS = {
  flash: { title: '' , sub: 'অফার শেষ হবে' },
  new: { title: '🆕 নতুন এসেছে', sub: 'সদ্য দোকানে তোলা পণ্য' },
  offers: { title: '🔥 অফারে আছে', sub: 'সীমিত সময়ের ছাড়' },
  bestsellers: { title: '🏆 সবচেয়ে বেশি বিক্রি', sub: 'কাস্টমাররা যা সবচেয়ে বেশি কিনছেন' },
  popular: { title: '👀 সবাই দেখছে', sub: 'এই সপ্তাহে সবচেয়ে বেশি দেখা পণ্য' },
  featured: { title: '⭐ আমাদের বাছাই', sub: 'যাচাই করা ভালো মানের পণ্য' },
  budget: { title: '💰 ৳১০০ এর মধ্যে দরকারি জিনিস', sub: 'কম দামে প্রতিদিনের দরকারি পার্টস' },
  categories: { title: 'ক্যাটাগরি', sub: '' },
  blog: { title: 'ব্লগ ও টিপস', sub: '' },
};

// hidden: the switch lives on its own page (reviews, Q&A, restock/price alerts, header & footer menu) —
// it is not shown again on "দোকানে কী দেখাবে", so every switch is in exactly one place.
const SWITCHES = GROUPS.flatMap((g) => g.items.filter((i) => i.key).map((i) => (g.hidden ? { ...i, hidden: true } : i)));
const KEYS = new Set(SWITCHES.map((i) => i.key));
const TEXTS = new Map(SWITCHES.filter((i) => i.text).map((i) => [i.text.key, i.text]));
for (const [k, v] of Object.entries(HOME_TEXTS)) {
  TEXTS.set(`uit_home_${k}`, { label: 'শিরোনাম', def: v.title, max: 60 });
  if (v.sub) TEXTS.set(`uit_home_${k}_sub`, { label: 'ছোট লাইন', def: v.sub, max: 80 });
}

// defaults: every new switch on, every text empty (= its default)
const DEFAULTS = {};
SWITCHES.forEach((i) => { if (/^ui_/.test(i.key)) DEFAULTS[i.key] = '1'; });

const on = (s, key) => !s || s[key] !== '0';
function text(s, key) {
  const t = TEXTS.get(key);
  const v = s && typeof s[key] === 'string' ? s[key].trim() : '';
  return v || (t ? t.def || '' : '');
}

module.exports = { GROUPS, HOME_TEXTS, KEYS, TEXTS, DEFAULTS, on, text };

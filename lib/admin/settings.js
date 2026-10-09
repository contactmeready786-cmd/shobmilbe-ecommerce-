'use strict';
const { html, raw, int, list, num, bn, money, qtyRule } = require('../util');
const O = require('../models/orders');
const ui = require('./ui');
const navswitch = require('./navswitch');
const { saveKeys } = require('./marketing');

async function settingsPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    for (const [k, lo, hi, def] of [['small_max_price', 0.01, 100000, 5], ['small_min_value', 0.01, 1000000, 10], ['small_max_value', 0.01, 10000000, 100]]) {
      if (k in b) b[k] = String(Math.min(hi, Math.max(lo, Math.round(num(b[k], def) * 100) / 100)));
    }
    if (Number(b.small_max_value) < Number(b.small_min_value)) b.small_max_value = b.small_min_value;
    if ('max_qty_per_item' in b) b.max_qty_per_item = String(Math.min(999, Math.max(1, int(b.max_qty_per_item) || 10)));
    if ('new_badge_days' in b) b.new_badge_days = String(Math.min(365, Math.max(0, int(b.new_badge_days))));
    for (const k of ['delivery_dhaka', 'delivery_outside', 'free_delivery_min', 'min_order', 'max_orders_per_phone_day', 'low_stock_default']) {
      if (k in b) b[k] = String(Math.max(0, int(b[k])));
    }
    if ('order_prefix' in b) b.order_prefix = String(b.order_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'SM';
    const areas = list(b.city_area).filter((a) => O.GEO.dhakaCity.includes(a) || O.GEO.districts[0].areas.some((x) => x[0] === a));
    b.dhaka_city_areas = JSON.stringify(areas);
    // extra delivery zones: name + charge + districts (a district belongs to the first zone that lists it)
    if ('zone_name' in b) {
      const names = list(b.zone_name);
      const fees = list(b.zone_fee);
      const known = new Set(O.GEO.districts.map((d) => d.en));
      const zones = [];
      names.forEach((n, i) => {
        const ds = list(b['zone_d_' + i]).filter((d) => known.has(d));
        if (String(n || '').trim() && ds.length) zones.push({ name: String(n).trim().slice(0, 60), fee: Math.max(0, Math.round(num(fees[i], 0) * 100) / 100), districts: [...new Set(ds)] });
      });
      b.delivery_zones = JSON.stringify(zones.slice(0, 8));
    }
    if ('delivery_per_kg' in b) b.delivery_per_kg = String(Math.max(0, Math.round(num(b.delivery_per_kg, 0) * 100) / 100));
    if ('delivery_free_kg' in b) b.delivery_free_kg = String(Math.min(50, Math.max(0, num(b.delivery_free_kg, 1))));
    if ('cod_advance' in b && !['off', 'new', 'all'].includes(b.cod_advance)) b.cod_advance = 'off';
    await saveKeys(ctx, ['store_name', 'phone', 'whatsapp', 'email', 'address', 'delivery_dhaka', 'delivery_outside', 'free_delivery_min',
      'dhaka_city_areas', 'min_order', 'max_orders_per_phone_day', 'block_message', 'order_prefix', 'low_stock_default', 'max_qty_per_item',
      'show_phone', 'pp_whatsapp', 'small_qty_on', 'small_max_price', 'small_min_value', 'small_max_value', 'new_badge_days',
      'delivery_zones', 'delivery_per_kg', 'delivery_free_kg', 'cod_advance', 'cod_advance_note'], b,
    { checkboxes: ['show_phone', 'pp_whatsapp', 'small_qty_on'] });
    await ctx.log('settings', 'settings', null, 'সাধারণ সেটিংস');
    return ctx.back('/admin/settings', 'saved');
  }
  const city = O.dhakaCityAreas(s);
  const dhaka = O.GEO.districts.find((d) => d.en === 'Dhaka');
  const body = html`<h1>সেটিংস</h1>${ui.flash(ctx.flash)}
${navswitch.box(ctx, { fixed: ['cart'], footer: ['contact'], back: '/admin/settings', note: 'ফুটারের "যোগাযোগ" কলামে এই পেজের ফোন, WhatsApp, ইমেইল আর ঠিকানা দেখায়।' })}
<form method="post" action="/admin/settings" class="form">
  <div class="two-col">
    <div>
      <section class="panel">
        <h2>দোকানের তথ্য</h2>
        ${ui.field('দোকানের নাম', ui.input('store_name', s.store_name, { required: true, maxlength: 60 }))}
        ${ui.field('ইমেইল', ui.input('email', s.email, { type: 'email' }))}
        ${ui.field('ঠিকানা (ইনভয়েসে দেখাবে)', ui.textarea('address', s.address, { rows: 2, maxlength: 300 }))}
        <p class="small">লোগো, রং, নোটিশ বার → <a href="/admin/design">স্টোর ডিজাইন</a> · সোশ্যাল লিংক → <a href="/admin/marketing/social">সোশ্যাল</a></p>
      </section>
      <section class="panel" id="contact">
        <h2>📞 কাস্টমারের সাথে যোগাযোগ</h2>
        <p class="muted small">কাস্টমার যেন দরকার হলে সরাসরি আপনাকে কল বা WhatsApp করতে পারে। প্রতিটা আলাদা করে চালু/বন্ধ করা যায়।</p>
        ${ui.field('যোগাযোগের মোবাইল নম্বর', ui.input('phone', s.phone, { inputmode: 'tel', maxlength: 30, placeholder: '01XXXXXXXXX' }))}
        ${ui.switchRow('show_phone', s.show_phone !== '0', 'সাইটে মোবাইল নম্বর দেখাও', 'পণ্যের পেজ, ফুটার, অর্ডারের পরের পেজ আর হোমপেজে "কল করুন" হিসেবে দেখাবে। বন্ধ করলে সাইটের কোথাও দেখাবে না (ইনভয়েসে থাকবে)।')}
        ${ui.field('WhatsApp নম্বর', ui.input('whatsapp', s.whatsapp, { inputmode: 'tel', maxlength: 30, placeholder: '01XXXXXXXXX' }), 'যে নম্বরে WhatsApp চালু আছে। কাস্টমার বাটন চাপলে সরাসরি তার মোবাইলের WhatsApp খুলে এই নম্বরে মেসেজ লেখার ঘর আসবে — পণ্যের নাম, দাম আর লিংক আগে থেকেই লেখা থাকবে।')}
        ${ui.switchRow('pp_whatsapp', s.pp_whatsapp !== '0', 'পণ্যের পেজে WhatsApp বাটন দেখাও', '"কার্টে যোগ করুন" আর "এখনই কিনুন" এর পাশে ছোট সবুজ "WhatsApp" বাটন। মোবাইলে নিচের বারেও ছোট করে থাকবে।')}
        <p class="small muted">সাইটের কোণায় ভাসমান সবুজ চ্যাট বাটন আলাদা — সেটা <a href="/admin/marketing/social">সোশ্যাল ও লাইভ চ্যাট</a> থেকে চালু/বন্ধ করুন।</p>
      </section>
      <section class="panel" id="small-items">
        <h2>🔩 কম দামের পণ্যের নিয়ম</h2>
        <p class="muted small">৳০.২৫, ৳০.৫০, ৳১… এর মতো খুব কম দামের পণ্য কেউ ১টা নিলে ডেলিভারি চার্জের তুলনায় লোকসান। তাই এমন পণ্যে কাস্টমারকে কমপক্ষে নির্দিষ্ট টাকার সমান পরিমাণ নিতে হবে। দোকানে দাম প্রতি পিস হিসেবেই দেখাবে।</p>
        ${ui.switchRow('small_qty_on', s.small_qty_on !== '0', 'কম দামের পণ্যে সর্বনিম্ন পরিমাণের নিয়ম চালু', 'বন্ধ করলে যেকোনো পণ্য ১টা করেও কেনা যাবে।')}
        <div class="field-row">
          ${ui.field('যে পণ্যের দাম এত টাকা বা কম (৳)', ui.input('small_max_price', s.small_max_price || '5', { type: 'number', min: 0.01 }), 'যেমন ৫ = ৳০.২৫ থেকে ৳৫ পর্যন্ত পণ্যে নিয়ম চলবে')}
          ${ui.field('কমপক্ষে এত টাকার নিতে হবে (৳)', ui.input('small_min_value', s.small_min_value || '10', { type: 'number', min: 0.01 }), 'যেমন ১০ = ৳৫ এর পণ্য কমপক্ষে ২টি')}
          ${ui.field('একসাথে সর্বোচ্চ এত টাকার (৳)', ui.input('small_max_value', s.small_max_value || '100', { type: 'number', min: 0.01 }), 'এর বেশি নিতে চাইলে যোগাযোগ করতে বলা হবে')}
        </div>
        <p class="small"><b>এখনকার সেটিং অনুযায়ী হিসাব:</b></p>
        <div class="table-wrap"><table class="table small-rule-table">
          <thead><tr><th>প্রতি পিসের দাম</th><th class="num">কমপক্ষে নিতে হবে</th><th class="num">সর্বোচ্চ নেওয়া যাবে</th></tr></thead>
          <tbody>${[0.25, 0.5, 1, 2, 3, 5, 9].map((p) => { const r = qtyRule(s, p); return html`<tr class="${r.small ? '' : 'muted'}"><td>${money(p)}</td>
            <td class="num">${r.small ? html`<b>${bn(r.min)}টি</b> (${money(r.min * p)})` : '১টি (নিয়ম নেই)'}</td><td class="num">${bn(r.max)}টি</td></tr>`; })}</tbody>
        </table></div>
        <p class="muted small">কমানো-বাড়ানো: উপরের তিনটা ঘরে সংখ্যা বদলে "সেভ করুন" চাপুন, এই টেবিলটাও নতুন হিসাব দেখাবে। Admin থেকে নিজে অর্ডার তৈরি করলে কোনো নিয়ম লাগবে না।</p>
      </section>
      <section class="panel">
        <h2>অর্ডারের নিয়ম</h2>
        <div class="field-row">
          ${ui.field('সর্বনিম্ন অর্ডার (৳)', ui.input('min_order', s.min_order, { type: 'number', min: 0 }), '০ = কোনো সীমা নেই')}
          ${ui.field('এক নম্বর থেকে ২৪ ঘণ্টায় সর্বোচ্চ অর্ডার', ui.input('max_orders_per_phone_day', s.max_orders_per_phone_day, { type: 'number', min: 0 }), 'ফেক অর্ডার ঠেকাতে। ০ = সীমা নেই')}
        </div>
        <div class="field-row">
          ${ui.field('অর্ডার নম্বরের শুরু', ui.input('order_prefix', s.order_prefix, { maxlength: 4, style: 'text-transform:uppercase' }), 'যেমন SM → SM7K2P9Q')}
          ${ui.field('নতুন পণ্যে "স্টক কম" সীমা', ui.input('low_stock_default', s.low_stock_default, { type: 'number', min: 0 }))}
        </div>
        <div id="new-badge">${ui.field('নতুন তোলা পণ্যে কত দিন "নতুন" ট্যাগ থাকবে', ui.input('new_badge_days', s.new_badge_days ?? '14', { type: 'number', min: 0, max: 365 }), '০ দিলে শুধু যেসব পণ্যে হাতে "নতুন" টিক দেওয়া আছে সেগুলোতে দেখাবে।')}</div>
        ${ui.field('একটি পণ্য একবারে সর্বোচ্চ কয়টি অর্ডার করা যাবে', ui.input('max_qty_per_item', s.max_qty_per_item || '10', { type: 'number', min: 1, max: 999 }),
    'এর বেশি নিতে চাইলে কাস্টমারকে বলা হবে সরাসরি আপনার সাথে যোগাযোগ করতে (উপরের নম্বর দেখিয়ে)। Admin থেকে নিজে অর্ডার তৈরি করলে এই সীমা লাগবে না।')}
        ${ui.field('ব্লক করা কাস্টমার অর্ডার করতে গেলে যা দেখাবে', ui.input('block_message', s.block_message, { maxlength: 300 }))}
      </section>
    </div>
    <div>
      <section class="panel">
        <h2>ডেলিভারি চার্জ</h2>
        <div class="field-row">
          ${ui.field('ঢাকা সিটির ভেতরে (৳)', ui.input('delivery_dhaka', s.delivery_dhaka, { type: 'number', min: 0 }))}
          ${ui.field('ঢাকার বাইরে (৳)', ui.input('delivery_outside', s.delivery_outside, { type: 'number', min: 0 }))}
        </div>
        ${ui.field('এত টাকার বেশি কিনলে ডেলিভারি ফ্রি (৳)', ui.input('free_delivery_min', s.free_delivery_min, { type: 'number', min: 0 }), '০ = ফ্রি ডেলিভারি বন্ধ')}
        <h2>কোন এলাকাগুলো "ঢাকা সিটির ভেতরে"</h2>
        <p class="muted small">চেকআউটে কাস্টমার জেলা আর থানা বাছাই করেন। নিচে টিক দেওয়া থানাগুলো হলে ঢাকা সিটির চার্জ (৳${s.delivery_dhaka}) লাগবে, বাকি সব জায়গায় ঢাকার বাইরের চার্জ (৳${s.delivery_outside})। ডিফল্টভাবে ঢাকা মেট্রোপলিটন পুলিশের (DMP) ৫০টি থানা টিক দেওয়া আছে; সাভার, কেরানীগঞ্জ, ধামরাই, দোহার, নবাবগঞ্জ ঢাকার বাইরে ধরা আছে — আপনার কুরিয়ারের নিয়ম অনুযায়ী বদলাতে পারেন।</p>
        <div class="area-checks">
          ${dhaka.areas.map(([en, bn]) => html`<label class="check"><input type="checkbox" name="city_area[]" value="${en}" ${city.includes(en) ? raw('checked') : ''}> <span>${bn}</span></label>`)}
        </div>
      </section>
      <section class="panel" id="zones">
        <h2>🗺️ আরও ডেলিভারি জোন (ঐচ্ছিক)</h2>
        <p class="muted small">কিছু জেলায় আলাদা চার্জ চাইলে এখানে জোন বানান — যেমন "ঢাকার আশেপাশে" ৳১০০: গাজীপুর, নারায়ণগঞ্জ, মুন্সিগঞ্জ। ঢাকা সিটির থানাগুলো সবসময় ঢাকা সিটির চার্জ পায়; ঢাকা জেলার বাকি থানাগুলো (সাভার, কেরানীগঞ্জ…) কোনো জোনে "ঢাকা" জেলা রাখলে সেই জোনের চার্জ পাবে। কোনো জোনে না থাকলে ঢাকার বাইরের চার্জ।</p>
        ${(() => {
    const zones = O.customZones(s);
    const rows = [...zones, { name: '', fee: '', districts: [] }, { name: '', fee: '', districts: [] }].slice(0, Math.max(2, zones.length + 1));
    return rows.map((z, i) => html`<div class="zone-box">
          <div class="field-row">${ui.field('জোনের নাম', ui.input('zone_name[]', z.name, { maxlength: 60, placeholder: 'যেমন: ঢাকার আশেপাশে' }))}${ui.field('চার্জ (৳)', ui.input('zone_fee[]', z.fee, { type: 'number', min: 0, step: '0.01', class: 'w-num' }))}</div>
          <details ${z.districts.length ? '' : raw('open')}><summary class="small">জেলা বাছুন ${z.districts.length ? `(${ui.bn(z.districts.length)}টি বাছাই করা)` : ''}</summary>
            <div class="area-checks">${O.GEO.districts.map((d) => html`<label class="check"><input type="checkbox" name="zone_d_${i}[]" value="${d.en}" ${z.districts.includes(d.en) ? raw('checked') : ''}> <span>${d.bn}</span></label>`)}</div>
          </details></div>`);
  })()}
        <p class="small muted">জোন মুছতে নাম খালি করে সেভ করুন। নতুন জোনের জন্য সেভ করার পর আরেকটা খালি ঘর আসবে।</p>
        <h2>⚖️ ভারী পার্সেল</h2>
        <div class="field-row">
          ${ui.field('প্রতি বাড়তি কেজিতে (৳)', ui.input('delivery_per_kg', s.delivery_per_kg || '0', { type: 'number', min: 0, step: '0.01' }), '০ = বন্ধ। পণ্যের "ওজন" ঘর থেকে পুরো অর্ডারের ওজন হিসাব হয়।')}
          ${ui.field('কত কেজি পর্যন্ত বাড়তি চার্জ নেই', ui.input('delivery_free_kg', s.delivery_free_kg || '1', { type: 'number', min: 0, step: '0.5' }))}
        </div>
      </section>
      <section class="panel" id="cod-advance">
        <h2>💵 ক্যাশ অন ডেলিভারিতে ডেলিভারি চার্জ আগে</h2>
        <p class="muted small">ভুয়া অর্ডার কমাতে: ক্যাশ অন ডেলিভারি বাছলে কাস্টমারকে শুধু ডেলিভারি চার্জটা আগে বিকাশ/নগদে Send Money করে TrxID দিতে হবে। নম্বরগুলো আসে "পেমেন্ট → Send Money" সেটিং থেকে।</p>
        ${ui.field('কখন লাগবে', ui.select('cod_advance', [['off', 'বন্ধ — আগের মতো, কিছু আগে লাগবে না'], ['new', 'শুধু নতুন কাস্টমার (যার আগে কোনো অর্ডার ডেলিভারি হয়নি)'], ['all', 'সব ক্যাশ অন ডেলিভারি অর্ডারে']], s.cod_advance || 'off'))}
        ${ui.field('কাস্টমারকে যা দেখাবে', ui.textarea('cod_advance_note', s.cod_advance_note, { rows: 2, maxlength: 300 }))}
      </section>
    </div>
  </div>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>`;
  return ctx.page('সেটিংস', body, 'settings');
}

module.exports = { routes: [{ method: '*', path: '/admin/settings', perm: 'settings', handler: settingsPage }] };

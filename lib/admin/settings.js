'use strict';
const { html, raw, int, list } = require('../util');
const O = require('../models/orders');
const ui = require('./ui');
const { saveKeys } = require('./marketing');

async function settingsPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    for (const k of ['delivery_dhaka', 'delivery_outside', 'free_delivery_min', 'min_order', 'max_orders_per_phone_day', 'low_stock_default']) {
      if (k in b) b[k] = String(Math.max(0, int(b[k])));
    }
    if ('order_prefix' in b) b.order_prefix = String(b.order_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'SM';
    const areas = list(b.city_area).filter((a) => O.GEO.dhakaCity.includes(a) || O.GEO.districts[0].areas.some((x) => x[0] === a));
    b.dhaka_city_areas = JSON.stringify(areas);
    await saveKeys(ctx, ['store_name', 'phone', 'whatsapp', 'email', 'address', 'delivery_dhaka', 'delivery_outside', 'free_delivery_min',
      'dhaka_city_areas', 'min_order', 'max_orders_per_phone_day', 'block_message', 'order_prefix', 'low_stock_default'], b);
    await ctx.log('settings', 'settings', null, 'সাধারণ সেটিংস');
    return ctx.back('/admin/settings', 'saved');
  }
  const city = O.dhakaCityAreas(s);
  const dhaka = O.GEO.districts.find((d) => d.en === 'Dhaka');
  const body = html`<h1>সেটিংস</h1>${ui.flash(ctx.flash)}
<form method="post" action="/admin/settings" class="form">
  <div class="two-col">
    <div>
      <section class="panel">
        <h2>দোকানের তথ্য</h2>
        ${ui.field('দোকানের নাম', ui.input('store_name', s.store_name, { required: true, maxlength: 60 }))}
        <div class="field-row">${ui.field('ফোন', ui.input('phone', s.phone, { inputmode: 'tel' }))}${ui.field('WhatsApp', ui.input('whatsapp', s.whatsapp, { inputmode: 'tel' }))}</div>
        ${ui.field('ইমেইল', ui.input('email', s.email, { type: 'email' }))}
        ${ui.field('ঠিকানা (ইনভয়েসে দেখাবে)', ui.textarea('address', s.address, { rows: 2, maxlength: 300 }))}
        <p class="small">লোগো, রং, নোটিশ বার → <a href="/admin/design">স্টোর ডিজাইন</a> · সোশ্যাল লিংক → <a href="/admin/marketing/social">সোশ্যাল</a></p>
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
    </div>
  </div>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>`;
  return ctx.page('সেটিংস', body, 'settings');
}

module.exports = { routes: [{ method: '*', path: '/admin/settings', perm: 'settings', handler: settingsPage }] };

'use strict';
// Admin → স্টোর ডিজাইন → 🎞️ রানিং স্লাইডার: the big moving picture banner at the top of the home page.
// On/off switch, up to 5 pictures (each with an optional link), how many seconds each picture stays,
// and how it moves. Pictures are kept as "slider" banners, so the old ব্যানার page keeps working too.
const { html, raw, bn, int, str } = require('../util');
const db = require('../db');
const content = require('../models/content');
const ui = require('./ui');

const BASE = '/admin/design/slider';
const MAX = 5;
const SECONDS = [1, 2, 3, 4, 5, 6, 8, 10, 15];

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const current = (await content.listBanners({ placement: 'slider' })).slice(0, MAX);
    const ids = [].concat(b.slide_id || []);
    const imgs = [].concat(b.slide_image || []);
    const links = [].concat(b.slide_link || []);
    let shown = 0;
    for (let i = 0; i < MAX; i++) {
      const id = int(ids[i]);
      const img = int(imgs[i]);
      const link = str(links[i], 300);
      const was = current.find((x) => x.id === id);
      if (img) {
        await content.saveBanner({ id: was ? id : null, image_id: img, link, title: was ? was.title : '', subtitle: was ? was.subtitle : '', button: was ? was.button : '', placement: 'slider', sort: i, active: true });
        shown += 1;
      } else if (was) {
        await ctx.trash('banner', id); // removed picture → recycle bin (owner can bring it back)
      }
    }
    const on = !!b.slider_on;
    const sec = SECONDS.includes(int(b.slider_interval)) ? int(b.slider_interval) : 4;
    await db.setMany({ slider_on: on ? '1' : '0', slider_interval: String(sec), slider_effect: b.slider_effect === 'fade' ? 'fade' : 'slide' });
    // switching it on puts the slider at the top of the home page if it was taken off there
    if (on) {
      const secs = db.jsonSetting(ctx.settings, 'home_sections', []);
      if (Array.isArray(secs) && secs.length && !secs.includes('slider')) await db.setSetting('home_sections', JSON.stringify(['slider', ...secs]));
    }
    await ctx.reloadSettings();
    await ctx.log('banner_save', 'banner', null, `রানিং স্লাইডার: ${on ? 'চালু' : 'বন্ধ'}, ${shown}টি ছবি, ${sec} সেকেন্ড`);
    const msg = on ? (shown ? `✅ সেভ হয়েছে — ${bn(shown)}টি ছবি হোমপেজে প্রতি ${bn(sec)} সেকেন্ডে বদলাবে।` : '✅ সেভ হয়েছে — তবে কোনো ছবি নেই, তাই হোমপেজে আগের নীল ব্যানার দেখাবে।') : '✅ সেভ হয়েছে — রানিং স্লাইডার বন্ধ।';
    return ctx.redirect(ctx.res, BASE + '?info=' + encodeURIComponent(msg));
  }
  const slides = (await content.listBanners({ placement: 'slider' })).filter((x) => x.active && x.image_id).slice(0, MAX);
  const on = s.slider_on !== '0';
  const sec = int(s.slider_interval) || 4;
  const effect = s.slider_effect === 'fade' ? 'fade' : 'slide';
  const body = html`<div class="title-row"><h1>🎞️ রানিং স্লাইডার <small>হোমপেজের উপরের চলমান ছবি</small></h1><a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div>
${ui.flash(ctx.flash)}
${slides.length ? html`<section class="panel sl-preview-wrap">
  <h2>👀 এখন যেমন দেখাচ্ছে <small>${on ? `${bn(slides.length)}টি ছবি · প্রতি ${bn(sec)} সেকেন্ডে বদলায়` : 'স্লাইডার বন্ধ আছে'}</small></h2>
  <div class="sl-preview ${effect === 'fade' ? 'fx-fade' : 'fx-slide'}" data-sl-preview data-interval="${sec}">
    <div class="sl-track">${slides.map((x) => html`<img src="/media/${x.image_id}" alt="">`)}</div>
  </div>
</section>` : ''}
<form method="post" action="${BASE}" class="form">
  <section class="panel">
    <div class="switch-list">${ui.switchRow('slider_on', on, 'রানিং স্লাইডার চালু', 'বন্ধ করলে হোমপেজে ছবির বদলে আগের নীল ব্যানার (লেখাসহ) দেখাবে')}</div>
    <div class="field-row">
      ${ui.field('প্রতিটা ছবি কত সেকেন্ড থাকবে', ui.select('slider_interval', SECONDS.map((n) => [n, `${bn(n)} সেকেন্ড${n === 4 ? ' (প্রস্তাবিত)' : ''}`]), sec))}
      ${ui.field('কীভাবে বদলাবে', ui.select('slider_effect', [['slide', '➡️ চলমান — পাশ দিয়ে সরে যায়'], ['fade', '✨ আস্তে মিলিয়ে বদলায়']], effect))}
    </div>
    <p class="small muted">খুব কম সময় দিলে (১-২ সেকেন্ড) কাস্টমার পড়ার আগেই ছবি সরে যায় — ৩-৫ সেকেন্ড সবচেয়ে ভালো। কেউ ছবিতে আঙুল/মাউস রাখলে থেমে থাকে।</p>
  </section>
  <section class="panel">
    <h2>ছবিগুলো <small>সর্বোচ্চ ${bn(MAX)}টি · মাপ ১৬০০×৬০০ পিক্সেল (জরুরি লেখা মাঝখানে রাখুন)</small></h2>
    <div class="sl-slots">
      ${Array.from({ length: MAX }, (_, i) => {
    const x = slides[i] || {};
    return html`<div class="sl-slot">
        <input type="hidden" name="slide_id[]" value="${x.id || ''}">
        ${ui.imagePicker('slide_image[]', x.image_id || null, { label: `ছবি ${bn(i + 1)}${i === 0 ? ' (প্রথমে দেখাবে)' : ''}`, wide: true })}
        ${ui.field('ছবিতে চাপলে কোথায় যাবে (ঐচ্ছিক)', ui.input('slide_link[]', x.link || '', { maxlength: 300, placeholder: '/products?sort=offer বা পণ্যের লিংক' }))}
      </div>`;
  })}
    </div>
  </section>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">✅ ছবিগুলো কনফার্ম করে সেভ করুন</button></div>
</form>
<p class="small muted">লেখা বা বাটনসহ ব্যানার, মাঝের ছোট ব্যানার আর পপআপ অফার আগের মতোই <a href="/admin/design/banners">ব্যানার</a> পেজে।</p>`;
  return ctx.page('রানিং স্লাইডার', body, 'slider');
}

module.exports = { routes: [{ method: '*', path: BASE, perm: 'design', handler: page }], MAX };
void raw;

'use strict';
// Admin: product feed links for Google Merchant Center and Facebook Commerce Manager.
const crypto = require('crypto');
const { html, bn, int } = require('../util');
const db = require('../db');
const ui = require('./ui');
const { saveKeys } = require('./marketing');
const feeds = require('../services/feeds');

function baseUrl(ctx) {
  const s = ctx.settings;
  if (s.site_url) return s.site_url.replace(/\/+$/, '');
  const req = ctx.req;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ch = b.channel === 'facebook' ? 'facebook' : b.channel === 'google' ? 'google' : '';
    if (b.action === 'generate' && ch) {
      await db.setSetting(`feed_${ch}_token`, crypto.randomBytes(12).toString('hex'));
      await ctx.reloadSettings();
      await ctx.log('settings', 'marketing', null, `${ch} ফিড লিংক তৈরি`);
      return ctx.back('/admin/marketing/feeds', 'saved');
    }
    if (b.action === 'revoke' && ch) {
      await db.setSetting(`feed_${ch}_token`, '');
      await ctx.reloadSettings();
      await ctx.log('settings', 'marketing', null, `${ch} ফিড লিংক বন্ধ`);
      return ctx.back('/admin/marketing/feeds', 'saved');
    }
    b.feed_condition = ['new', 'refurbished', 'used'].includes(b.feed_condition) ? b.feed_condition : 'new';
    b.feed_google_category = String(b.feed_google_category || '').trim().replace(/[^0-9]/g, '').slice(0, 8);
    const ship = String(b.feed_shipping || '').trim();
    b.feed_shipping = ship === '' ? '' : ship.toLowerCase() === 'none' ? 'none' : String(Math.max(0, int(ship)));
    await saveKeys(ctx, ['feed_brand', 'feed_condition', 'feed_include_out', 'feed_google_category', 'feed_shipping'], b, { checkboxes: ['feed_include_out'] });
    await ctx.log('settings', 'marketing', null, 'প্রোডাক্ট ফিড সেটিংস');
    return ctx.back('/admin/marketing/feeds', 'saved');
  }

  const base = baseUrl(ctx);
  const [g, f] = await Promise.all([feeds.build('google', s, base), feeds.build('facebook', s, base)]);
  const link = (ch, fmt) => `${base}/feeds/${ch}.${fmt}?key=${s[`feed_${ch}_token`]}`;
  const card = (ch, title, built, steps) => {
    const token = s[`feed_${ch}_token`];
    return html`<section class="panel feed-card">
      <h2><span class="brand-dot ${ch === 'google' ? 'gg' : 'fb'}"></span> ${title}</h2>
      <p class="muted small">ফিডে যাবে <b>${bn(built.report.included)}</b>টি পণ্য (মোট চালু পণ্য ${bn(built.report.total)}টি)।</p>
      ${token ? html`
        ${ui.field('ফিড লিংক (XML — এটাই দিন)', html`<code class="copy feed-url" title="চাপলে কপি হবে">${link(ch, 'xml')}</code>`, 'লিংকের উপর চাপ দিলেই কপি হবে।')}
        <p class="small">অন্য ফরম্যাট: <a href="${link(ch, 'csv')}" target="_blank" rel="noopener">CSV (Excel এ খোলা যায়)</a> ·
          <a href="${link(ch, 'tsv')}" target="_blank" rel="noopener">TSV</a> · <a href="${link(ch, 'xml')}" target="_blank" rel="noopener">XML দেখুন</a></p>
        <div class="row-actions">
          <form method="post" action="/admin/marketing/feeds" data-confirm="নতুন লিংক বানালে পুরনো লিংক আর কাজ করবে না — ${title} এ নতুন লিংক বসাতে হবে। চালিয়ে যাবেন?">
            <input type="hidden" name="action" value="generate"><input type="hidden" name="channel" value="${ch}">
            <button class="btn btn-sm btn-ghost">নতুন লিংক বানান</button></form>
          <form method="post" action="/admin/marketing/feeds" data-confirm="ফিড বন্ধ করলে ${title} আর পণ্য আপডেট পাবে না। বন্ধ করবেন?">
            <input type="hidden" name="action" value="revoke"><input type="hidden" name="channel" value="${ch}">
            <button class="link-btn danger small">বন্ধ করুন</button></form>
        </div>` : html`
        <form method="post" action="/admin/marketing/feeds">
          <input type="hidden" name="action" value="generate"><input type="hidden" name="channel" value="${ch}">
          <button class="btn">🔗 ${ch === 'google' ? 'Google' : 'Facebook'} ফিড লিংক তৈরি করুন</button></form>`}
      <details class="feed-steps"><summary>কোথায় বসাবেন? (ধাপে ধাপে)</summary><ol class="small">${steps}</ol></details>
      ${built.report.excluded.length ? html`<details class="feed-issues" open><summary class="warn">⚠️ ${bn(built.report.excluded.length)}টি পণ্য ফিডে যাচ্ছে না</summary>
        <ul class="small">${built.report.excluded.slice(0, 50).map((x) => html`<li><a href="/admin/products/${x.id}">${x.name}</a> — ${x.why.join(', ')}</li>`)}</ul></details>` : ''}
      ${built.report.warnings.length ? html`<details class="feed-issues"><summary>ℹ️ ${bn(built.report.warnings.length)}টি পণ্যে ছোট সমস্যা (তবুও ফিডে যাচ্ছে)</summary>
        <ul class="small">${built.report.warnings.slice(0, 50).map((x) => html`<li><a href="/admin/products/${x.id}">${x.name}</a> — ${x.why.join(', ')}</li>`)}</ul></details>` : ''}
    </section>`;
  };

  const googleSteps = html`<li><a href="https://merchants.google.com" target="_blank" rel="noopener">merchants.google.com</a> এ ঢুকুন (Business info এ দেশ: Bangladesh, ওয়েবসাইট যাচাই করা থাকতে হবে — SEO পেজের Search Console কোড দিয়ে)।</li>
    <li>Products → <b>Add products</b> → <b>Add products from a file</b> → <b>Add a file link</b>।</li>
    <li>উপরের XML লিংকটা পেস্ট করুন। দেশ: <b>Bangladesh</b>, ভাষা: পণ্যের নাম যে ভাষায় (বাংলা হলে Bengali, ইংরেজি হলে English), মুদ্রা: <b>BDT</b>।</li>
    <li>Fetch frequency: <b>Daily (প্রতিদিন)</b> দিন। এরপর নতুন পণ্য তুললে বা দাম/স্টক বদলালে Google নিজেই আপডেট নেবে।</li>
    <li>Shipping: ফিডেই ডেলিভারি চার্জ দেওয়া আছে, Merchant Center এ আলাদা করে না দিলেও চলবে।</li>`;
  const fbSteps = html`<li><a href="https://business.facebook.com/commerce" target="_blank" rel="noopener">business.facebook.com/commerce</a> → আপনার ক্যাটালগ (না থাকলে Create catalog → E-commerce → Upload product info)।</li>
    <li>Catalog → <b>Data sources</b> → <b>Add items</b> → <b>Data feed</b> → Next।</li>
    <li><b>Use a URL</b> বেছে উপরের XML লিংকটা পেস্ট করুন। Schedule: <b>Daily</b>। মুদ্রা: <b>BDT</b>।</li>
    <li>Catalog → <b>Events</b> থেকে আপনার Pixel কানেক্ট করুন। সাইটের Pixel যে পণ্য ID পাঠায়, ফিডেও হুবহু সেই ID — তাই ডায়নামিক অ্যাড (যে যা দেখেছে তাকে সেটাই দেখানো) ঠিকঠাক কাজ করবে।</li>`;

  const body = html`<h1>প্রোডাক্ট ফিড (Google ও Facebook)</h1>${ui.flash(ctx.flash)}
${ui.helpBox('ফিড লিংক কী কাজে লাগে?', html`দোকানের সব পণ্য (নাম, দাম, ছবি, স্টক) একটা লিংকে থাকে। এই লিংক Google Merchant Center আর Facebook ক্যাটালগে একবার বসালে তারা প্রতিদিন নিজে থেকেই পণ্যের তালিকা আপডেট নেবে।
  এরপর Google Shopping অ্যাড, Facebook/Instagram শপ আর ক্যাটালগ অ্যাড চালাতে পারবেন। দুইটা প্ল্যাটফর্মের সব বাধ্যতামূলক তথ্য (id, title, description, link, image_link, availability, condition, price, brand ইত্যাদি) সঠিক ফরম্যাটে দেওয়া আছে।
  ${s.site_url ? '' : html`<br><b class="warn">⚠️ আগে <a href="/admin/marketing/seo">SEO পেজে</a> ওয়েবসাইটের ঠিকানা (যেমন https://shobmilbe.com) দিন — নাহলে লিংকে Vercel এর ঠিকানা চলে যাবে।</b>`}`)}
<div class="two-col">
  ${card('google', 'Google Merchant Center', g, googleSteps)}
  ${card('facebook', 'Facebook / Instagram ক্যাটালগ', f, fbSteps)}
</div>
<form method="post" action="/admin/marketing/feeds" class="form panel">
  <h2>ফিড সেটিংস</h2>
  <div class="field-row">
    ${ui.field('ব্র্যান্ড (যেসব পণ্যে ব্র্যান্ড দেওয়া নেই)', ui.input('feed_brand', s.feed_brand, { maxlength: 70, placeholder: s.store_name }), 'দুই প্ল্যাটফর্মেই ব্র্যান্ড বাধ্যতামূলক। পণ্য এডিট পেজে আলাদা ব্র্যান্ড দিলে সেটাই যাবে।')}
    ${ui.field('পণ্যের অবস্থা', ui.select('feed_condition', [['new', 'নতুন (new)'], ['refurbished', 'রিফার্বিশড'], ['used', 'ব্যবহৃত (used)']], s.feed_condition))}
  </div>
  <div class="field-row">
    ${ui.field('Google ক্যাটাগরি নম্বর (ঐচ্ছিক)', ui.input('feed_google_category', s.feed_google_category, { inputmode: 'numeric', placeholder: 'যেমন 222 = Electronics' }), 'Google এর তালিকা থেকে নম্বর: 222 ইলেকট্রনিক্স, 166 পোশাক, 536 ঘর-বাড়ি, 469 স্বাস্থ্য ও সৌন্দর্য। খালি রাখলে Google নিজেই ঠিক করে নেয়।')}
    ${ui.field('Google এ ডেলিভারি চার্জ (৳)', ui.input('feed_shipping', s.feed_shipping, { placeholder: `খালি = ঢাকার বাইরের চার্জ (${s.delivery_outside || 110})` }), 'Google বলে চার্জ কম দেখানো যাবে না, তাই ঢাকার বাইরের (বেশি) চার্জটাই দেওয়া নিরাপদ। "none" লিখলে ফিডে চার্জ যাবে না।')}
  </div>
  ${ui.check('feed_include_out', s.feed_include_out !== '0', 'স্টকে নেই এমন পণ্যও ফিডে রাখুন ("out of stock" হিসেবে — অ্যাড বন্ধ থাকবে, স্টক এলে আবার চালু হবে)')}
  <div class="form-actions"><button class="btn">সেভ করুন</button></div>
</form>`;
  return ctx.page('প্রোডাক্ট ফিড', body, 'feeds');
}

module.exports = {
  routes: [{ method: '*', path: '/admin/marketing/feeds', perm: 'marketing', handler: page }],
};

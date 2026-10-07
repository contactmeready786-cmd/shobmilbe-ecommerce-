'use strict';
const { html, bn, int, str, list } = require('../util');
const db = require('../db');
const content = require('../models/content');
const ui = require('./ui');
const { saveKeys } = require('./marketing');

const SECTIONS = { slider: 'বড় ব্যানার স্লাইডার', categories: 'ক্যাটাগরি', featured: 'জনপ্রিয় পণ্য', offers: 'অফারের পণ্য', new: 'নতুন এসেছে', bestsellers: 'সবচেয়ে বেশি বিক্রি', promo: 'মাঝের ছোট ব্যানার', blog: 'ব্লগ পোস্ট' };

async function claim(id) { if (int(id)) await db.q(`UPDATE media SET owner_type='setting', owner_id=0 WHERE id=$1 AND owner_type IS NULL`, [int(id)]); }

async function general(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    for (const k of ['logo_id', 'favicon_id']) {
      if (k in b) {
        const old = int(s[k]);
        await claim(b[k]);
        if (old && old !== int(b[k])) await db.q(`DELETE FROM media WHERE id=$1 AND owner_type='setting'`, [old]);
      }
    }
    for (const k of ['color_primary', 'color_accent']) if (b[k] && !/^#[0-9a-f]{6}$/i.test(b[k])) delete b[k];
    const order = list(b.section_order);
    const on = list(b.section_on);
    b.home_sections = JSON.stringify(order.filter((x) => SECTIONS[x] && on.includes(x)));
    b.grid_cols = ['3', '4', '5'].includes(b.grid_cols) ? b.grid_cols : '4';
    await saveKeys(ctx, ['store_name', 'tagline', 'hero_title', 'notice', 'logo_id', 'favicon_id', 'color_primary', 'color_accent', 'grid_cols',
      'home_sections', 'footer_about', 'show_buy_now_on_card', 'copy_protect'], b, { checkboxes: ['show_buy_now_on_card', 'copy_protect'] });
    await ctx.log('settings', 'design', null, 'লোগো ও ডিজাইন');
    return ctx.back('/admin/design', 'saved');
  }
  const enabled = db.jsonSetting(s, 'home_sections', []);
  const ordered = [...enabled, ...Object.keys(SECTIONS).filter((k) => !enabled.includes(k))];
  const body = html`<h1>লোগো, রং ও হোমপেজ</h1>${ui.flash(ctx.flash)}
<form method="post" action="/admin/design" class="form">
  <div class="two-col">
    <div>
      <section class="panel">
        <h2>লোগো</h2>
        <div class="field-row">
          ${ui.imagePicker('logo_id', s.logo_id, { label: 'হেডারের লোগো', hint: 'PNG (স্বচ্ছ ব্যাকগ্রাউন্ড) সবচেয়ে ভালো, চওড়া লোগো ৪০০×১২০ এর মতো। না দিলে দোকানের নাম লেখা দেখাবে।', wide: true })}
          ${ui.imagePicker('favicon_id', s.favicon_id, { label: 'ব্রাউজার ট্যাবের ছোট লোগো (Favicon)', hint: 'বর্গাকার ছবি, ৫১২×৫১২। ব্রাউজারের ট্যাবে আর মোবাইলে সাইট সেভ করলে এটা দেখাবে।' })}
        </div>
      </section>
      <section class="panel">
        <h2>দোকানের লেখা</h2>
        ${ui.field('দোকানের নাম', ui.input('store_name', s.store_name, { required: true, maxlength: 60 }))}
        ${ui.field('হোমপেজের বড় শিরোনাম', ui.input('hero_title', s.hero_title, { maxlength: 80 }), 'ব্যানার না থাকলে উপরে এটা দেখাবে')}
        ${ui.field('ছোট বর্ণনা (ট্যাগলাইন)', ui.input('tagline', s.tagline, { maxlength: 160 }))}
        ${ui.field('একদম উপরের নোটিশ বার', ui.input('notice', s.notice, { maxlength: 160 }), 'খালি রাখলে নোটিশ বার দেখাবে না')}
        ${ui.field('ফুটারে দোকান সম্পর্কে', ui.textarea('footer_about', s.footer_about, { rows: 3, maxlength: 500, placeholder: s.tagline }))}
      </section>
    </div>
    <div>
      <section class="panel">
        <h2>রং</h2>
        <div class="field-row">
          ${ui.field('মূল রং', ui.input('color_primary', s.color_primary, { type: 'color' }))}
          ${ui.field('দ্বিতীয় রং (বাটন/অফার)', ui.input('color_accent', s.color_accent, { type: 'color' }))}
        </div>
        <p class="muted small">আগের মতো নীল-কমলা রাখতে: <code>#0866D6</code> আর <code>#F5A524</code></p>
      </section>
      <section class="panel">
        <h2>হোমপেজে কী কী দেখাবে (ক্রম অনুযায়ী)</h2>
        <ul class="sortable" data-sortable>
          ${ordered.map((k) => html`<li><input type="hidden" name="section_order[]" value="${k}">
            ${ui.check('section_on[]', enabled.includes(k), SECTIONS[k], k)}
            <span class="sort-btns"><button type="button" data-up aria-label="উপরে">▲</button><button type="button" data-down aria-label="নিচে">▼</button></span></li>`)}
        </ul>
      </section>
      <section class="panel">
        <h2>পণ্য দেখানো</h2>
        ${ui.field('কম্পিউটারে এক লাইনে কয়টা পণ্য', ui.select('grid_cols', [['3', '৩টি (বড় কার্ড)'], ['4', '৪টি'], ['5', '৫টি (ছোট কার্ড)']], s.grid_cols))}
        ${ui.check('show_buy_now_on_card', s.show_buy_now_on_card === '1', 'পণ্যের কার্ডে "এখনই কিনুন" বাটন দেখাও')}
        <p class="muted small">মোবাইলে সবসময় এক লাইনে ২টি পণ্য দেখাবে।</p>
      </section>
      <section class="panel">
        <h2>কপি প্রটেকশন</h2>
        ${ui.check('copy_protect', s.copy_protect === '1', 'কেউ যেন লেখা সিলেক্ট/কপি বা ছবি সেভ করতে না পারে')}
        <p class="muted small">চালু থাকলে মাউস দিয়ে লেখা সিলেক্ট, Ctrl+C / Ctrl+A / Ctrl+S / Ctrl+U, রাইট-ক্লিক, ছবি টেনে নেওয়া আর মোবাইলে ছবি চেপে ধরে সেভ — সব বন্ধ থাকবে। (চেকআউটের ফর্মে কাস্টমার স্বাভাবিকভাবে লিখতে পারবেন।) স্ক্রিনশট কোনো ওয়েবসাইটই আটকাতে পারে না।</p>
      </section>
    </div>
  </div>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button> <a href="/" target="_blank">দোকান দেখুন ↗</a></div>
</form>`;
  return ctx.page('স্টোর ডিজাইন', body, 'design');
}

// ---------------------------------------------------------------- banners
async function banners(ctx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!int(b.id) && !int(b.image_id)) return ctx.fail('/admin/design/banners', 'ব্যানারের ছবি দিন।');
    await content.saveBanner({ ...b, active: int(b.id) ? b.active : true });
    await ctx.log('banner_save', 'banner', int(b.id) || null, str(b.title, 60));
    return ctx.back('/admin/design/banners', 'saved');
  }
  const rows = await content.listBanners({});
  const body = html`<h1>ব্যানার</h1>${ui.flash(ctx.flash)}
${ui.helpBox('ব্যানারের মাপ', html`<b>স্লাইডার:</b> ১৬০০×৬০০ পিক্সেল (মোবাইলে মাঝের অংশ দেখাবে, তাই জরুরি লেখা মাঝখানে রাখুন)।<br><b>মাঝের ছোট ব্যানার:</b> ৮০০×৪০০।<br><b>পপআপ অফার:</b> ৬০০×৬০০ — সাইটে ঢুকলে একবার দেখাবে।<br>Canva দিয়ে সহজে বানাতে পারেন।`)}
<div class="banner-list">
  ${rows.map((r) => html`<form method="post" action="/admin/design/banners" class="panel banner-row ${r.active ? '' : 'row-off'}">
    <input type="hidden" name="id" value="${r.id}">
    ${ui.imagePicker('image_id', r.image_id, { label: 'ছবি', wide: true })}
    <div>
      <div class="field-row">
        ${ui.field('কোথায়', ui.select('placement', Object.entries(content.PLACEMENTS), r.placement))}
        ${ui.field('ক্রম', ui.input('sort', r.sort, { type: 'number', class: 'w-num' }))}
      </div>
      ${ui.field('লিংক (ক্লিক করলে কোথায় যাবে)', ui.input('link', r.link, { placeholder: '/products?sort=offer বা /p/পণ্যের-লিংক' }))}
      <div class="field-row">
        ${ui.field('লেখা (ঐচ্ছিক)', ui.input('title', r.title, { maxlength: 120 }))}
        ${ui.field('বাটনের লেখা', ui.input('button', r.button, { maxlength: 40, placeholder: 'এখনই কিনুন' }))}
      </div>
      ${ui.field('ছোট লেখা', ui.input('subtitle', r.subtitle, { maxlength: 200 }))}
      ${ui.check('active', r.active, 'দেখাও')}
      <div class="row-actions"><button class="btn btn-sm">সেভ</button>
        <button class="link-btn danger" formaction="/admin/design/banners/${r.id}/delete" data-confirm-btn="ব্যানারটি মুছবেন?">মুছুন</button></div>
    </div>
  </form>`)}
</div>
<form method="post" action="/admin/design/banners" class="panel banner-row">
  <h2>নতুন ব্যানার</h2>
  ${ui.imagePicker('image_id', null, { label: 'ছবি', wide: true })}
  <div>
    <div class="field-row">
      ${ui.field('কোথায়', ui.select('placement', Object.entries(content.PLACEMENTS), 'slider'))}
      ${ui.field('ক্রম', ui.input('sort', rows.length, { type: 'number', class: 'w-num' }))}
    </div>
    ${ui.field('লিংক', ui.input('link', '', { placeholder: '/products?sort=offer' }))}
    <div class="field-row">${ui.field('লেখা (ঐচ্ছিক)', ui.input('title', '', { maxlength: 120 }))}${ui.field('বাটনের লেখা', ui.input('button', '', { maxlength: 40 }))}</div>
    ${ui.field('ছোট লেখা', ui.input('subtitle', '', { maxlength: 200 }))}
    <button class="btn">ব্যানার যোগ করুন</button>
  </div>
</form>`;
  return ctx.page('ব্যানার', body, 'banners');
}
async function deleteBanner(ctx, m) {
  await content.deleteBanner(int(m[1]));
  return ctx.back('/admin/design/banners', 'deleted');
}

// ---------------------------------------------------------------- menus
function linkRows(name, rows) {
  return html`<div data-repeat="${name}">${[...rows, { label: '', url: '' }].map((r) => html`<div class="field-row repeat-row">
    ${ui.field('লেখা', ui.input(`${name}_label[]`, r.label, { maxlength: 40 }))}
    ${ui.field('লিংক', ui.input(`${name}_url[]`, r.url, { maxlength: 300, placeholder: '/products?cat=… বা https://…' }))}
  </div>`)}</div><button type="button" class="btn btn-sm btn-ghost" data-repeat-add="${name}">+ আরেকটা লিংক</button>`;
}
function readRows(b, name) {
  const labels = list(b[`${name}_label`]);
  const urls = list(b[`${name}_url`]);
  return labels.map((l, i) => ({ label: str(l, 40), url: str(urls[i], 300) })).filter((r) => r.label && r.url);
}
async function menus(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    await saveKeys(ctx, ['header_menu', 'footer_links', 'phone', 'email', 'address'], {
      header_menu: JSON.stringify(readRows(b, 'hm')), footer_links: JSON.stringify(readRows(b, 'fl')), phone: b.phone, email: b.email, address: b.address,
    });
    await ctx.log('settings', 'design', null, 'মেনু');
    return ctx.back('/admin/design/menus', 'saved');
  }
  const [cats, pages] = await Promise.all([require('../models/catalog').listCategories(), content.listPages({})]);
  const body = html`<h1>হেডার ও ফুটার মেনু</h1>${ui.flash(ctx.flash)}
<form method="post" action="/admin/design/menus" class="form">
  <div class="two-col">
    <section class="panel"><h2>হেডার মেনু</h2>${linkRows('hm', db.jsonSetting(s, 'header_menu', []))}</section>
    <section class="panel"><h2>ফুটারের বাড়তি লিংক</h2>
      <p class="muted small">"পেজ" গুলো (About, Policy) নিজে থেকেই ফুটারে আসে। এখানে বাড়তি লিংক দিন।</p>
      ${linkRows('fl', db.jsonSetting(s, 'footer_links', []))}
      <h2>ফুটারের যোগাযোগ তথ্য</h2>
      ${ui.field('ফোন', ui.input('phone', s.phone, { inputmode: 'tel' }))}
      ${ui.field('ইমেইল', ui.input('email', s.email, { type: 'email' }))}
      ${ui.field('ঠিকানা', ui.textarea('address', s.address, { rows: 2, maxlength: 300 }))}
    </section>
  </div>
  <section class="panel"><h2>কাজে লাগতে পারে এমন লিংক</h2>
    <p class="small">${cats.map((c) => html`<code>/products?cat=${c.slug}</code> (${c.name}) · `)}<code>/products?sort=offer</code> (অফার) · <code>/products?sort=new</code> (নতুন) · <code>/blog</code> · <code>/track</code> ·
    ${pages.map((p) => html`<code>/page/${p.slug}</code> (${p.title}) · `)}</p></section>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>`;
  return ctx.page('মেনু', body, 'menus');
}

// ---------------------------------------------------------------- pages
async function pages(ctx) {
  const rows = await content.listPages({});
  const body = html`<div class="title-row"><h1>পেজ <small>${bn(rows.length)}টি</small></h1><a class="btn" href="/admin/design/pages/new">+ নতুন পেজ</a></div>${ui.flash(ctx.flash)}
<section class="panel table-wrap"><table class="table"><thead><tr><th>শিরোনাম</th><th>লিংক</th><th>ফুটারে</th><th>অবস্থা</th></tr></thead>
<tbody>${rows.map((p) => html`<tr class="${p.active ? '' : 'row-off'}"><td><a href="/admin/design/pages/${p.id}"><b>${p.title}</b></a></td>
  <td><a href="/page/${p.slug}" target="_blank" class="small">/page/${p.slug}</a></td><td>${p.in_footer ? 'হ্যাঁ' : 'না'}</td><td>${p.active ? 'চালু' : 'লুকানো'}</td></tr>`)}</tbody></table></section>`;
  return ctx.page('পেজ', body, 'pages');
}
async function pageForm(ctx, m) {
  const id = m && m[1] ? int(m[1]) : null;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.title)) return ctx.fail(id ? `/admin/design/pages/${id}` : '/admin/design/pages/new', 'শিরোনাম দিন।');
    const pid = await content.savePage({ ...b, id });
    await ctx.log('page_save', 'page', pid, str(b.title, 60));
    return ctx.back(`/admin/design/pages/${pid}`, 'saved');
  }
  const p = id ? await content.getPage({ id }) : { active: true, in_footer: true, sort: 10 };
  if (!p) return ctx.redirect(ctx.res, '/admin/design/pages');
  const body = html`<p class="crumbs"><a href="/admin/design/pages">← সব পেজ</a></p><h1>${id ? p.title : 'নতুন পেজ'}</h1>${ui.flash(ctx.flash)}
<form method="post" action="${id ? `/admin/design/pages/${id}` : '/admin/design/pages/new'}" class="form panel">
  ${ui.field('শিরোনাম', ui.input('title', p.title || '', { required: true, maxlength: 120 }))}
  ${id ? html`<p class="small">লিংক: <a href="/page/${p.slug}" target="_blank">/page/${p.slug}</a></p>` : ui.field('লিংকের নাম (ইংরেজি, ঐচ্ছিক)', ui.input('slug', '', { maxlength: 60, placeholder: 'about-us' }))}
  ${ui.field('লেখা', ui.textarea('content', p.content || '', { rows: 16, maxlength: 100000, class: 'editor' }), 'ব্লগের মতো একই নিয়ম: ## শিরোনাম, - বুলেট, **মোটা**')}
  <div class="field-row">${ui.field('ক্রম', ui.input('sort', p.sort || 0, { type: 'number' }))}</div>
  ${ui.check('in_footer', p.in_footer, 'ফুটারে লিংক দেখাও')}
  ${ui.check('active', p.active, 'চালু')}
  <button class="btn">সেভ করুন</button>
</form>
${id ? html`<form method="post" action="/admin/design/pages/${id}/delete" class="danger-zone" data-confirm="পেজটি মুছবেন?"><button class="btn btn-danger btn-sm">পেজ মুছুন</button></form>` : ''}`;
  return ctx.page('পেজ', body, 'pages');
}
async function deletePage(ctx, m) {
  await content.deletePage(int(m[1]));
  return ctx.back('/admin/design/pages', 'deleted');
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/design', perm: 'design', handler: general },
    { method: '*', path: '/admin/design/banners', perm: 'design', handler: banners },
    { method: 'POST', path: /^\/admin\/design\/banners\/(\d+)\/delete$/, perm: 'design', handler: deleteBanner },
    { method: '*', path: '/admin/design/menus', perm: 'design', handler: menus },
    { method: 'GET', path: '/admin/design/pages', perm: 'design', handler: pages },
    { method: '*', path: '/admin/design/pages/new', perm: 'design', handler: (ctx) => pageForm(ctx, null) },
    { method: '*', path: /^\/admin\/design\/pages\/(\d+)$/, perm: 'design', handler: pageForm },
    { method: 'POST', path: /^\/admin\/design\/pages\/(\d+)\/delete$/, perm: 'design', handler: deletePage },
  ],
};

'use strict';
const { html, bn, int, str, list } = require('../util');
const db = require('../db');
const content = require('../models/content');
const ui = require('./ui');
const { saveKeys } = require('./marketing');

const SECTIONS = {
  slider: 'বড় ব্যানার স্লাইডার', trust: 'ভরসার বার (ডেলিভারি, ক্যাশ অন ডেলিভারি, রিটার্ন)', categories: 'ক্যাটাগরি বক্স', flash: '⚡ ফ্ল্যাশ সেল (চলার সময় দেখায়)',
  new: '🆕 নতুন এসেছে (নিজে থেকে সরে)', offers: '🔥 অফারে আছে', bestsellers: '🏆 সবচেয়ে বেশি বিক্রি', popular: '👀 সবাই দেখছে (সবচেয়ে বেশি দেখা)',
  promo: 'মাঝের ছোট ব্যানার', cat_rows: 'ক্যাটাগরি অনুযায়ী পণ্যের সারি', budget: '💰 ৳১০০ এর মধ্যে দরকারি জিনিস',
  featured: '⭐ আমাদের বাছাই (যেগুলোতে "জনপ্রিয়" টিক দেওয়া)', blog: 'ব্লগ পোস্ট',
};

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
  await ctx.trash('banner', int(m[1]));
  await ctx.log('banner_delete', 'banner', int(m[1]), '');
  return ctx.back('/admin/design/banners', 'deleted');
}

// ---------------------------------------------------------------- menus
// switch whose value is the page id (several in one form)
function pageSwitch(id, on, title, desc) {
  return html`<label class="switch-row">
    <span class="switch-text"><b>${title}</b>${desc ? html`<small>${desc}</small>` : ''}</span>
    <span class="switch"><input type="checkbox" name="page_footer[]" value="${id}" ${on ? html`checked` : ''}><span class="switch-ui" aria-hidden="true"></span></span>
    <span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>`;
}
function linkRows(name, rows, { onOff = false } = {}) {
  return html`<div data-repeat="${name}">${[...rows, { label: '', url: '' }].map((r) => html`<div class="field-row repeat-row">
    ${ui.field('লেখা', ui.input(`${name}_label[]`, r.label, { maxlength: 40 }))}
    ${ui.field('লিংক', ui.input(`${name}_url[]`, r.url, { maxlength: 300, placeholder: '/products?cat=… বা https://…' }))}
    ${onOff ? ui.field('দেখাবে?', ui.select(`${name}_on[]`, [['1', '✅ চালু'], ['0', '⛔ বন্ধ']], r.on === false ? '0' : '1')) : ''}
  </div>`)}</div><button type="button" class="btn btn-sm btn-ghost" data-repeat-add="${name}">+ আরেকটা লিংক</button>`;
}
function readRows(b, name) {
  const labels = list(b[`${name}_label`]);
  const urls = list(b[`${name}_url`]);
  const ons = list(b[`${name}_on`]);
  return labels.map((l, i) => {
    const r = { label: str(l, 40), url: str(urls[i], 300) };
    if (ons.length && ons[i] === '0') r.on = false;
    return r;
  }).filter((r) => r.label && r.url);
}
async function menus(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const footKeys = Object.values(require('./navswitch').FOOTER).map((f) => f.key);
    await saveKeys(ctx, ['header_menu', 'footer_links', 'phone', 'email', 'address', 'nav_cart', 'nav_live', ...footKeys], {
      header_menu: JSON.stringify(readRows(b, 'hm')), footer_links: JSON.stringify(readRows(b, 'fl')), phone: b.phone, email: b.email, address: b.address,
      nav_cart: b.nav_cart, nav_live: b.nav_live, ...Object.fromEntries(footKeys.map((k) => [k, b[k]])),
    }, { checkboxes: ['nav_cart', 'nav_live', ...footKeys] });
    // pages shown in the footer "তথ্য" column
    const onPages = new Set(list(b.page_footer).map((x) => int(x)));
    for (const pid of list(b.page_ids).map((x) => int(x)).filter(Boolean)) {
      await db.q('UPDATE pages SET in_footer=$1, updated_at=now() WHERE id=$2', [onPages.has(pid), pid]);
    }
    await ctx.log('settings', 'design', null, 'মেনু');
    return ctx.back('/admin/design/menus', 'saved');
  }
  const [cats, pages] = await Promise.all([require('../models/catalog').listCategories(), content.listPages({})]);
  const body = html`<h1>হেডার ও ফুটার মেনু</h1>${ui.flash(ctx.flash)}
<form method="post" action="/admin/design/menus" class="form">
  <div class="two-col">
    <section class="panel"><h2>হেডার মেনু (সার্চ বারের পাশের বাটন)</h2>
      <p class="muted small">প্রতিটা বাটনের পাশে "দেখাবে?" থেকে <b>চালু</b> বা <b>বন্ধ</b> বাছুন। বন্ধ করলে বাটনটা মুছে যায় না, শুধু দোকানে লুকিয়ে থাকে — পরে আবার চালু করা যায়।
      একই সুইচ সংশ্লিষ্ট পেজেও আছে: সব পণ্য ও অফার → <a href="/admin/products">পণ্য</a>, ব্লগ → <a href="/admin/blog">ব্লগ</a>, অর্ডার ট্র্যাক → <a href="/admin/orders">অর্ডার</a>, লাইভ স্কোর → <a href="/admin/design/live">লাইভ খেলার স্কোর</a>।</p>
      ${linkRows('hm', db.jsonSetting(s, 'header_menu', []), { onOff: true })}
      <div class="switch-list" style="margin-top:14px">
        ${ui.switchRow('nav_live', s.nav_live !== '0', '"লাইভ স্কোর" বাটন', 'ক্রিকেট বা ফুটবল স্কোর চালু থাকলে তবেই দেখা যায়। স্কোর নিজেই চালু/বন্ধ করতে: লাইভ খেলার স্কোর পেজ')}
        ${ui.switchRow('nav_cart', s.nav_cart !== '0', '"কার্ট" বাটন', 'বন্ধ করলে উপরের কার্ট আইকন লুকাবে। "কার্টে যোগ" আর "এখনই কিনুন" আগের মতোই কাজ করবে')}
      </div>
    </section>
    <section class="panel"><h2>ফুটার (পেজের একদম নিচে) — কোন লিংক দেখাবে</h2>
      <p class="muted small">ফুটারে ৩টা কলাম: <b>কেনাকাটা</b>, <b>তথ্য</b> আর <b>যোগাযোগ</b>। যেটা বন্ধ করবেন সেটা লুকিয়ে যাবে। একটা কলামের সব লিংক বন্ধ করলে কলামটাই চলে যাবে।
        একই সুইচ সংশ্লিষ্ট পেজেও আছে: সব পণ্য ও অফার → <a href="/admin/products">পণ্য</a>, অর্ডার ট্র্যাক → <a href="/admin/orders">অর্ডার</a>, ব্লগ → <a href="/admin/blog">ব্লগ</a>, তথ্যের পেজগুলো → <a href="/admin/design/pages">পেজ</a>, যোগাযোগ → <a href="/admin/settings">সেটিংস</a>।</p>
      <p class="nav-sw-group">"কেনাকাটা" কলাম</p>
      <div class="switch-list">${['products', 'offer', 'track', 'blog'].map((k) => { const f = require('./navswitch').FOOTER[k]; return ui.switchRow(f.key, s[f.key] !== '0', `"${f.label}" লিংক`, ''); })}</div>
      <p class="nav-sw-group">"তথ্য" কলাম (আপনার পেজগুলো)</p>
      ${pages.length ? html`<div class="switch-list">${pages.map((pg) => html`<input type="hidden" name="page_ids[]" value="${pg.id}">${pageSwitch(pg.id, pg.in_footer, `"${pg.title}"`, pg.active ? `লিংক: /page/${pg.slug}` : 'এই পেজটা লুকানো আছে, তাই ফুটারে চালু থাকলেও খুলবে না')}`)}</div>`
        : html`<p class="muted small">কোনো পেজ নেই।</p>`}
      <p class="muted small">পেজের লেখা বদলাতে: <a href="/admin/design/pages">পেজ (About, Policy)</a></p>
      <p class="nav-sw-group">"যোগাযোগ" কলাম</p>
      <div class="switch-list">${ui.switchRow('foot_contact', s.foot_contact !== '0', 'যোগাযোগ কলাম দেখাও', 'নিচের ফোন, ইমেইল, ঠিকানা আর সেটিংসের WhatsApp নম্বর')}</div>
      <h2 style="margin-top:18px">ফুটারের "কেনাকাটা" কলামে বাড়তি লিংক</h2>
      ${linkRows('fl', db.jsonSetting(s, 'footer_links', []), { onOff: true })}
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
${ui.helpBox('এই পেজগুলো দোকানের কোথায় দেখায়?', html`দোকানের প্রতিটা পেজের <b>একদম নিচে (ফুটারে)</b> <b>"তথ্য"</b> নামের কলামে এদের লিংক থাকে — যেমন আমাদের সম্পর্কে, রিটার্ন ও রিফান্ড পলিসি, প্রাইভেসি পলিসি, শর্তাবলী।
  নিচের <b>"ফুটারে দেখাবে"</b> সুইচ চাপলেই সাথে সাথে লিংকটা চালু বা বন্ধ হবে। বন্ধ করলে পেজ মুছে যায় না, শুধু ফুটার থেকে লিংক লুকায়। সব ফুটার লিংক একসাথে: <a href="/admin/design/menus">হেডার ও ফুটার মেনু</a>`)}
<section class="panel table-wrap"><table class="table"><thead><tr><th>শিরোনাম</th><th>লিংক</th><th>ফুটারের "তথ্য" কলামে দেখাবে</th><th>পেজ চালু</th><th>কাজ</th></tr></thead>
<tbody>${rows.map((p) => html`<tr class="${p.active ? '' : 'row-off'}"><td><b>${p.title}</b></td>
  <td><a href="/page/${p.slug}" target="_blank" class="small">/page/${p.slug}</a></td>
  <td><form method="post" action="/admin/design/pages/${p.id}/footer" class="inline-switch">
    <label class="switch"><input type="checkbox" name="in_footer" value="1" ${p.in_footer ? html`checked` : ''} data-autosubmit aria-label="${p.title} ফুটারে দেখাবে"><span class="switch-ui" aria-hidden="true"></span></label>
    <span class="small ${p.in_footer ? 'ok' : 'muted'}">${p.in_footer ? 'চালু' : 'বন্ধ'}</span></form></td>
  <td>${ui.rowSwitch(`/admin/toggle/page/${p.id}`, p.active, 'বন্ধ করলে পেজটা দোকান থেকে লুকাবে')}</td>
  ${ui.rowActions({ edit: `/admin/design/pages/${p.id}`, del: `/admin/design/pages/${p.id}/delete` })}</tr>`)}</tbody></table></section>`;
  return ctx.page('পেজ', body, 'pages');
}
async function pageFooter(ctx, m) {
  const b = await ctx.body();
  const id = int(m[1]);
  await db.q('UPDATE pages SET in_footer=$1, updated_at=now() WHERE id=$2', [!!b.in_footer, id]);
  await ctx.log('page_save', 'page', id, b.in_footer ? 'ফুটারে চালু' : 'ফুটারে বন্ধ');
  return ctx.back('/admin/design/pages', 'saved');
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
  ${ui.check('in_footer', p.in_footer, 'দোকানের নিচে ফুটারের "তথ্য" কলামে এই পেজের লিংক দেখাও')}
  ${ui.check('active', p.active, 'চালু')}
  <button class="btn">সেভ করুন</button>
</form>
${id ? html`<form method="post" action="/admin/design/pages/${id}/delete" class="danger-zone" data-confirm="পেজটি মুছবেন?"><button class="btn btn-danger btn-sm">পেজ মুছুন</button></form>` : ''}`;
  return ctx.page('পেজ', body, 'pages');
}
async function deletePage(ctx, m) {
  await ctx.trash('page', int(m[1]));
  await ctx.log('page_delete', 'page', int(m[1]), '');
  return ctx.back('/admin/design/pages', 'deleted');
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/design', perm: 'design', handler: general },
    { method: '*', path: '/admin/design/banners', perm: 'design', handler: banners },
    { method: 'POST', path: /^\/admin\/design\/banners\/(\d+)\/delete$/, perm: 'design', handler: deleteBanner },
    { method: '*', path: '/admin/design/menus', perm: 'design', handler: menus },
    { method: 'GET', path: '/admin/design/pages', perm: 'design', handler: pages },
    { method: 'POST', path: /^\/admin\/design\/pages\/(\d+)\/footer$/, perm: 'design', handler: pageFooter },
    { method: '*', path: '/admin/design/pages/new', perm: 'design', handler: (ctx) => pageForm(ctx, null) },
    { method: '*', path: /^\/admin\/design\/pages\/(\d+)$/, perm: 'design', handler: pageForm },
    { method: 'POST', path: /^\/admin\/design\/pages\/(\d+)\/delete$/, perm: 'design', handler: deletePage },
  ],
};

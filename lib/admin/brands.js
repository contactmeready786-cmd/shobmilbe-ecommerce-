'use strict';
// Admin → পণ্য → ব্র্যান্ড: add / edit / hide / delete brands (logo, description, SEO). Each brand gets its own page in the shop (/brand/…).
const { html, bn, int, str } = require('../util');
const catalog = require('../models/catalog');
const ui = require('./ui');

function form(b, error) {
  const isNew = !b.id;
  return html`<form method="post" action="${isNew ? '/admin/brands' : `/admin/brands/${b.id}`}" class="form panel">
    <h2>${isNew ? 'নতুন ব্র্যান্ড' : `এডিট: ${b.name}`}</h2>
    ${error ? html`<p class="flash flash-error">${error}</p>` : ''}
    ${ui.field('ব্র্যান্ডের নাম', ui.input('name', b.name || '', { required: true, maxlength: 60, placeholder: 'যেমন: Philips, Walton, Arduino' }))}
    ${ui.imagePicker('logo_id', b.logo_id, { label: 'লোগো (ঐচ্ছিক)', hint: 'স্কয়ার বা চওড়া, সাদা ব্যাকগ্রাউন্ড হলে ভালো দেখায়' })}
    ${ui.field('ব্র্যান্ড সম্পর্কে (ঐচ্ছিক)', ui.textarea('description', b.description || '', { rows: 3, maxlength: 3000 }), 'ব্র্যান্ডের পেজে পণ্যের উপরে দেখাবে।')}
    <details class="help"><summary>SEO (গুগলে কেমন দেখাবে)</summary><div>
      ${ui.field('SEO টাইটেল', ui.input('seo_title', b.seo_title || '', { maxlength: 120, placeholder: 'খালি রাখলে: "<নাম> পণ্য — দাম ও অর্ডার"' }))}
      ${ui.field('SEO বিবরণ', ui.textarea('seo_description', b.seo_description || '', { rows: 2, maxlength: 300 }))}
    </div></details>
    <div class="field-row">${ui.field('ক্রম', ui.input('sort', b.sort ?? 0, { type: 'number', class: 'w-num' }), 'ছোট সংখ্যা আগে')}</div>
    ${ui.check('active', isNew ? true : b.active, 'দোকানে ব্র্যান্ডের পেজ দেখাও')}
    <div class="row-actions"><button class="btn">${isNew ? 'যোগ করুন' : 'সেভ করুন'}</button>${isNew ? '' : html`<a class="btn btn-ghost" href="/admin/brands">বাতিল</a>`}</div>
  </form>`;
}

async function page(ctx, m, error = null, values = null) {
  const id = m && m[1] ? int(m[1]) : null;
  if (ctx.method === 'POST' && !error) {
    const b = await ctx.body();
    try {
      const bid = await catalog.saveBrand({ id, name: b.name, logoId: b.logo_id, description: b.description, seoTitle: b.seo_title, seoDescription: b.seo_description, active: !!b.active, sort: b.sort });
      if (int(b.logo_id)) await catalog.claimMedia(b.logo_id, 'brand', bid);
      await ctx.log('brand_save', 'brand', bid, str(b.name, 60));
      return ctx.back('/admin/brands', 'saved');
    } catch (e) {
      return page({ ...ctx, method: 'GET' }, m, e.message, { ...b, id, active: !!b.active });
    }
  }
  const brands = await catalog.listBrands();
  const editing = values || (id ? brands.find((x) => x.id === id) : null);
  if (id && !editing) return ctx.redirect(ctx.res, '/admin/brands');
  const canEdit = ctx.can('products');
  const canDel = ctx.can('products_delete');
  const body = html`<div class="title-row"><h1>ব্র্যান্ড <small>${bn(brands.length)}টি</small></h1></div>
${ui.flash(ctx.flash)}
${ui.helpBox('ব্র্যান্ড কীভাবে কাজ করে', html`পণ্য যোগ বা এডিট করার সময় "ব্র্যান্ড" ঘরে নাম লিখলেই সেটা এই তালিকায় চলে আসে। এখানে লোগো, বিবরণ আর SEO দিতে পারবেন। দোকানে প্রতিটা ব্র্যান্ডের নিজের পেজ থাকে (যেমন <b>/brand/philips</b>) — সেখানে সেই ব্র্যান্ডের সব পণ্য দেখায়, আর পণ্যের পেজে ব্র্যান্ডের নামে চাপ দিলে সেখানে যায়।`)}
<div class="two-col">
  <section class="panel table-wrap">
    ${brands.length ? html`<table class="table"><thead><tr><th>লোগো</th><th>নাম</th><th class="num">পণ্য</th><th>দোকানে দেখাবে</th><th>কাজ</th></tr></thead>
    <tbody>${brands.map((b) => html`<tr class="${b.active ? '' : 'row-off'}">
      <td class="thumb">${b.logo_id ? html`<img src="/media/${b.logo_id}/t" alt="" loading="lazy">` : html`<span>🏷️</span>`}</td>
      <td><b>${b.name}</b><br><a class="small" href="/brand/${b.slug}" target="_blank" rel="noopener">/brand/${b.slug} ↗</a></td>
      <td class="num"><a href="/admin/products?brand=${b.id}">${bn(b.product_count)}</a>${b.product_count !== b.active_count ? html`<br><span class="small muted">চালু ${bn(b.active_count)}</span>` : ''}</td>
      <td>${canEdit ? ui.rowSwitch(`/admin/brands/${b.id}/active`, b.active, 'বন্ধ করলে দোকানে ব্র্যান্ডের পেজ দেখাবে না (পণ্যগুলো দেখাবে)') : (b.active ? 'চালু' : 'বন্ধ')}</td>
      ${ui.rowActions({ edit: canEdit ? `/admin/brands/${b.id}` : '', del: canDel ? `/admin/brands/${b.id}/delete` : '',
    delConfirm: `'${b.name}' ব্র্যান্ড মুছবেন? পণ্যগুলো মুছবে না, শুধু ব্র্যান্ডহীন হবে। রিসাইকেল বিনে থাকবে — ফেরত আনলে পণ্যগুলোও আবার এই ব্র্যান্ডে ফিরবে।` })}
    </tr>`)}</tbody></table>` : ui.empty('এখনো কোনো ব্র্যান্ড নেই। ডান পাশ থেকে যোগ করুন, অথবা পণ্যের "ব্র্যান্ড" ঘরে নাম লিখুন।')}
  </section>
  <div>${canEdit ? form(editing || { active: true, sort: 0 }, error) : html`<p class="muted panel">ব্র্যান্ড বদলানোর অনুমতি আপনার নেই।</p>`}</div>
</div>`;
  return ctx.page('ব্র্যান্ড', body, 'brands', { status: error ? 400 : 200 });
}

async function setActive(ctx, m) {
  const id = int(m[1]);
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const r = await require('../db').one('UPDATE brands SET active=$1 WHERE id=$2 RETURNING name', [on, id]);
  if (r) await ctx.log('brand_save', 'brand', id, `${r.name}: ${on ? 'চালু' : 'বন্ধ'}`);
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ctx.res, r ? 200 : 404, { ok: !!r, active: on });
  return ctx.back('/admin/brands', 'saved');
}
async function remove(ctx, m) {
  const id = int(m[1]);
  const b = await catalog.getBrand({ id });
  await ctx.trash('brand', id);
  await ctx.log('brand_delete', 'brand', id, `${b ? b.name : ''} → রিসাইকেল বিনে`);
  return ctx.back('/admin/brands', 'deleted');
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/brands', perm: 'products', handler: (ctx) => page(ctx, null) },
    { method: '*', path: /^\/admin\/brands\/(\d+)$/, perm: 'products', handler: page },
    { method: 'POST', path: /^\/admin\/brands\/(\d+)\/active$/, perm: 'products', handler: setActive },
    { method: 'POST', path: /^\/admin\/brands\/(\d+)\/delete$/, perm: 'products', handler: remove },
  ],
};

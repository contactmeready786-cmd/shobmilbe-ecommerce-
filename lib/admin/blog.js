'use strict';
const { html, bn, fmtDate, int, str } = require('../util');
const content = require('../models/content');
const ui = require('./ui');
const navswitch = require('./navswitch');

async function listPage(ctx) {
  const [posts, cats] = await Promise.all([content.listPosts({ limit: 200 }), content.listBlogCategories()]);
  const body = html`<div class="title-row"><h1>ব্লগ <small>${bn(posts.length)}টি পোস্ট</small></h1>
  <div class="row-actions"><a class="btn" href="/admin/blog/new">+ নতুন পোস্ট</a><a class="btn btn-ghost" href="/blog" target="_blank">ব্লগ দেখুন ↗</a></div></div>
${ui.flash(ctx.flash)}
${navswitch.box(ctx, { urls: ['/blog'], footer: ['blog'], back: '/admin/blog' })}
<div class="two-col">
  <section class="panel table-wrap">
    ${posts.length ? html`<table class="table"><thead><tr><th></th><th>শিরোনাম</th><th>ক্যাটাগরি</th><th>প্রকাশিত</th><th class="num">ভিউ</th><th>কাজ</th></tr></thead>
    <tbody>${posts.map((p) => html`<tr><td class="thumb">${p.cover_id ? html`<img src="/media/${p.cover_id}/t" alt="">` : html`<span>📝</span>`}</td>
      <td><b>${p.title}</b><br><span class="small muted">${fmtDate(p.published_at || p.created_at)} · ${p.author_name || ''}</span></td>
      <td class="small">${p.category_name || '—'}</td>
      <td>${ui.rowSwitch(`/admin/toggle/blog/${p.id}`, p.status === 'published', 'চালু = দোকানে প্রকাশিত, বন্ধ = ড্রাফট (লুকানো)')}</td><td class="num">${bn(p.views)}</td>${ui.rowActions({ edit: `/admin/blog/${p.id}`, del: `/admin/blog/${p.id}/delete` })}</tr>`)}</tbody></table>`
    : html`<p class="muted">এখনো কোনো পোস্ট নেই। ব্লগে পণ্যের ব্যবহার, টিপস, গাইড লিখলে গুগল থেকে ফ্রি ভিজিটর আসে।</p>`}
  </section>
  <section class="panel">
    <h2>ব্লগ ক্যাটাগরি</h2>
    ${cats.map((c) => html`<form method="post" action="/admin/blog/categories" class="inline-form">
      <input type="hidden" name="id" value="${c.id}">
      <input name="name" value="${c.name}" required maxlength="60" aria-label="নাম">
      <input name="sort" type="number" value="${c.sort}" class="w-num" aria-label="ক্রম">
      <button class="btn btn-sm btn-ghost">সেভ</button>
      <button class="link-btn danger small" formaction="/admin/blog/categories/${c.id}/delete" data-confirm-btn="ক্যাটাগরি মুছবেন? পোস্টগুলো থাকবে।">মুছুন</button>
    </form>`)}
    <form method="post" action="/admin/blog/categories" class="inline-form mt">
      <input name="name" required maxlength="60" placeholder="নতুন ক্যাটাগরি, যেমন: টিপস ও গাইড" aria-label="নাম">
      <input name="sort" type="number" value="${cats.length}" class="w-num" aria-label="ক্রম">
      <button class="btn btn-sm">যোগ করুন</button>
    </form>
  </section>
</div>`;
  return ctx.page('ব্লগ', body, 'blog');
}

function postForm(p, cats, error) {
  const isNew = !p.id;
  return html`<p class="crumbs"><a href="/admin/blog">← সব পোস্ট</a></p>
<div class="title-row"><h1>${isNew ? 'নতুন ব্লগ পোস্ট' : p.title}</h1>${!isNew && p.status === 'published' ? html`<a class="btn btn-ghost btn-sm" href="/blog/${p.slug}" target="_blank">দেখুন ↗</a>` : ''}</div>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/blog/new' : `/admin/blog/${p.id}`}" class="form">
  <div class="two-col">
    <section class="panel">
      ${ui.field('শিরোনাম', ui.input('title', p.title || '', { required: true, maxlength: 160 }))}
      ${ui.field('সারাংশ (লিস্টে আর গুগলে দেখাবে)', ui.textarea('excerpt', p.excerpt || '', { rows: 2, maxlength: 500 }))}
      ${ui.field('লেখা', ui.textarea('content', p.content || '', { rows: 18, maxlength: 100000, class: 'editor' }),
    html`নতুন লাইন = নতুন প্যারাগ্রাফ · <b>## শিরোনাম</b> · <b>- বুলেট</b> · <b>**মোটা**</b> · <b>[লেখা](https://লিংক)</b> · একটা লাইনে শুধু ছবির লিংক দিলে ছবি দেখাবে · <b>/p/পণ্যের-slug</b> দিলে পণ্যের কার্ড দেখাবে`)}
    </section>
    <section class="panel">
      ${ui.field('অবস্থা', ui.select('status', [['draft', 'ড্রাফট (লুকানো)'], ['published', 'প্রকাশ করুন']], p.status || 'draft'))}
      ${ui.field('ক্যাটাগরি', ui.select('category_id', [['', 'কোনোটি না'], ...cats.map((c) => [c.id, c.name])], p.category_id || ''))}
      ${ui.imagePicker('cover_id', p.cover_id, { label: 'কভার ছবি', wide: true })}
      <h2>SEO</h2>
      ${ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120 }))}
      ${ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300 }))}
      <button class="btn btn-lg btn-block">সেভ করুন</button>
    </section>
  </div>
</form>
${isNew ? '' : html`<form method="post" action="/admin/blog/${p.id}/delete" class="danger-zone" data-confirm="পোস্টটি মুছে ফেলবেন?"><button class="btn btn-danger btn-sm">পোস্ট মুছুন</button></form>`}`;
}

async function form(ctx, m) {
  const id = m && m[1] ? int(m[1]) : null;
  const cats = await content.listBlogCategories();
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!str(b.title)) return ctx.page('ব্লগ পোস্ট', postForm({ ...b, id }, cats, 'শিরোনাম লিখুন।'), 'blog', { status: 400 });
    const pid = await content.savePost({ ...b, id }, ctx.user.id);
    await ctx.log(id ? 'post_edit' : 'post_add', 'blog', pid, str(b.title, 80));
    return ctx.back(`/admin/blog/${pid}`, 'saved');
  }
  const p = id ? await content.getPost({ id }) : {};
  if (id && !p) return ctx.redirect(ctx.res, '/admin/blog');
  return ctx.page(id ? p.title : 'নতুন পোস্ট', html`${ui.flash(ctx.flash)}${postForm(p, cats)}`, 'blog');
}
async function remove(ctx, m) {
  await ctx.trash('blog_post', int(m[1]));
  await ctx.log('post_delete', 'blog', int(m[1]), '');
  return ctx.back('/admin/blog', 'deleted');
}
async function saveCat(ctx) {
  const b = await ctx.body();
  if (str(b.name)) await content.saveBlogCategory(b);
  return ctx.back('/admin/blog', 'saved');
}
async function deleteCat(ctx, m) {
  await ctx.trash('blog_category', int(m[1]));
  await ctx.log('blog_category_delete', 'blog', int(m[1]), '');
  return ctx.back('/admin/blog', 'deleted');
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/blog', perm: 'blog', handler: listPage },
    { method: '*', path: '/admin/blog/new', perm: 'blog', handler: (ctx) => form(ctx, null) },
    { method: '*', path: /^\/admin\/blog\/(\d+)$/, perm: 'blog', handler: form },
    { method: 'POST', path: /^\/admin\/blog\/(\d+)\/delete$/, perm: 'blog', handler: remove },
    { method: 'POST', path: '/admin/blog/categories', perm: 'blog', handler: saveCat },
    { method: 'POST', path: /^\/admin\/blog\/categories\/(\d+)\/delete$/, perm: 'blog', handler: deleteCat },
  ],
};

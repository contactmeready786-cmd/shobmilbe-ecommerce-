import { toHtml, Val, A, L } from '../react/render';
import { html, bn, fmtDate, int, str } from '../util';
import * as content from '../models/content';
import * as ui from './ui';
import type { AdminCtx, Loose } from '../types';

async function listPage(ctx: AdminCtx) {
  const [posts, cats] = await Promise.all([content.listPosts({ limit: 200 }), content.listBlogCategories()]);
  const body = toHtml(<><div className="title-row"><h1>ব্লগ{' '}<small><Val v={bn(posts.length)} />টি পোস্ট</small></h1><div className="row-actions"><a className="btn" href="/admin/blog/new">+ নতুন পোস্ট</a><a className="btn btn-ghost" href="/blog" target="_blank">ব্লগ দেখুন ↗</a></div></div><Val v={ui.flash(ctx.flash)} /><div className="two-col"><section className="panel table-wrap">{(posts.length ? <table className="table"><thead><tr><th></th><th>শিরোনাম</th><th>ক্যাটাগরি</th><th>প্রকাশিত</th><th className="num">ভিউ</th><th>কাজ</th></tr></thead><tbody>{L(posts.map((p) => <tr><td className="thumb">{(p.cover_id ? <img src={`/media/${A(p.cover_id)}/t`} alt="" /> : <span>📝</span>)}</td><td><b><Val v={p.title} /></b><br /><span className="small muted"><Val v={fmtDate(p.published_at || p.created_at)} />{' '}·{' '}<Val v={p.author_name || ''} /></span></td><td className="small"><Val v={p.category_name || '—'} /></td><td><Val v={ui.rowSwitch(`/admin/toggle/blog/${p.id}`, p.status === 'published', 'চালু = দোকানে প্রকাশিত, বন্ধ = ড্রাফট (লুকানো)')} /></td><td className="num"><Val v={bn(p.views)} /></td><Val v={ui.rowActions({ edit: `/admin/blog/${p.id}`, del: `/admin/blog/${p.id}/delete` })} /></tr>))}</tbody></table> : <p className="muted">এখনো কোনো পোস্ট নেই। ব্লগে পণ্যের ব্যবহার, টিপস, গাইড লিখলে গুগল থেকে ফ্রি ভিজিটর আসে।</p>)}</section><section className="panel"><h2>ব্লগ ক্যাটাগরি</h2>{L(cats.map((c) => <form method="post" action="/admin/blog/categories" className="inline-form"><input type="hidden" name="id" defaultValue={A(c.id)} />{' '}<input name="name" defaultValue={A(c.name)} required maxLength={60} {...{ "aria-label": "নাম" }} />{' '}<input name="sort" type="number" defaultValue={A(c.sort)} className="w-num" {...{ "aria-label": "ক্রম" }} />{' '}<button className="btn btn-sm btn-ghost">সেভ</button>{' '}<button className="link-btn danger small" formAction={`/admin/blog/categories/${A(c.id)}/delete`} data-confirm-btn="ক্যাটাগরি মুছবেন? পোস্টগুলো থাকবে।">মুছুন</button></form>))}<form method="post" action="/admin/blog/categories" className="inline-form mt"><input name="name" required maxLength={60} placeholder="নতুন ক্যাটাগরি, যেমন: টিপস ও গাইড" {...{ "aria-label": "নাম" }} />{' '}<input name="sort" type="number" defaultValue={A(cats.length)} className="w-num" {...{ "aria-label": "ক্রম" }} />{' '}<button className="btn btn-sm">যোগ করুন</button></form></section></div></>);
  return ctx.page('ব্লগ', body, 'blog');
}

function postForm(p?: Loose, cats?: Loose, error?: Loose) {
  const isNew = !p.id;
  return toHtml(<><p className="crumbs"><a href="/admin/blog">← সব পোস্ট</a></p><div className="title-row"><h1>{(isNew ? "নতুন ব্লগ পোস্ট" : <Val v={p.title} />)}</h1>{(!isNew && p.status === 'published' ? <a className="btn btn-ghost btn-sm" href={`/blog/${A(p.slug)}`} target="_blank">দেখুন ↗</a> : null)}</div>{(error ? <p className="flash flash-error"><Val v={error} /></p> : null)}<form method="post" action={A(isNew ? '/admin/blog/new' : `/admin/blog/${p.id}`)} className="form"><div className="two-col"><section className="panel"><Val v={ui.field('শিরোনাম', ui.input('title', p.title || '', { required: true, maxlength: 160 }))} />{' '}<Val v={ui.field('সারাংশ (লিস্টে আর গুগলে দেখাবে)', ui.textarea('excerpt', p.excerpt || '', { rows: 2, maxlength: 500 }))} />{' '}<Val v={ui.field('লেখা', ui.textarea('content', p.content || '', { rows: 18, maxlength: 100000, class: 'editor' }),
    toHtml(<>নতুন লাইন = নতুন প্যারাগ্রাফ ·{' '}<b>## শিরোনাম</b>{' '}·{' '}<b>- বুলেট</b>{' '}·{' '}<b>**মোটা**</b>{' '}·{' '}<b>[লেখা](https://লিংক)</b>{' '}· একটা লাইনে শুধু ছবির লিংক দিলে ছবি দেখাবে ·{' '}<b>/p/পণ্যের-slug</b>{' '}দিলে পণ্যের কার্ড দেখাবে</>))} /></section><section className="panel"><Val v={ui.field('অবস্থা', ui.select('status', [['draft', 'ড্রাফট (লুকানো)'], ['published', 'প্রকাশ করুন']], p.status || 'draft'))} />{' '}<Val v={ui.field('ক্যাটাগরি', ui.select('category_id', [['', 'কোনোটি না'], ...cats.map((c?: Loose) => [c.id, c.name])], p.category_id || ''))} />{' '}<Val v={ui.imagePicker('cover_id', p.cover_id, { label: 'কভার ছবি', wide: true })} /><h2>SEO</h2><Val v={ui.field('SEO টাইটেল', ui.input('seo_title', p.seo_title || '', { maxlength: 120 }))} />{' '}<Val v={ui.field('SEO বিবরণ', ui.textarea('seo_description', p.seo_description || '', { rows: 2, maxlength: 300 }))} />{' '}<button className="btn btn-lg btn-block">সেভ করুন</button></section></div></form>{(isNew ? null : <form method="post" action={`/admin/blog/${A(p.id)}/delete`} className="danger-zone" data-confirm="পোস্টটি মুছে ফেলবেন?"><button className="btn btn-danger btn-sm">পোস্ট মুছুন</button></form>)}</>);
}

async function form(ctx: AdminCtx, m?: Loose) {
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
  return ctx.page(id ? p!.title : 'নতুন পোস্ট', toHtml(<><Val v={ui.flash(ctx.flash)} /><Val v={postForm(p, cats)} /></>), 'blog');
}
async function remove(ctx: AdminCtx, m?: Loose) {
  await ctx.trash('blog_post', int(m[1]));
  await ctx.log('post_delete', 'blog', int(m[1]), '');
  return ctx.back('/admin/blog', 'deleted');
}
async function saveCat(ctx: AdminCtx) {
  const b = await ctx.body();
  if (str(b.name)) await content.saveBlogCategory(b);
  return ctx.back('/admin/blog', 'saved');
}
async function deleteCat(ctx: AdminCtx, m?: Loose) {
  await ctx.trash('blog_category', int(m[1]));
  await ctx.log('blog_category_delete', 'blog', int(m[1]), '');
  return ctx.back('/admin/blog', 'deleted');
}

export const routes = [
    { method: 'GET', path: '/admin/blog', perm: 'blog', handler: listPage },
    { method: '*', path: '/admin/blog/new', perm: 'blog', handler: (ctx: AdminCtx) => form(ctx, null) },
    { method: '*', path: /^\/admin\/blog\/(\d+)$/, perm: 'blog', handler: form },
    { method: 'POST', path: /^\/admin\/blog\/(\d+)\/delete$/, perm: 'blog', handler: remove },
    { method: 'POST', path: '/admin/blog/categories', perm: 'blog', handler: saveCat },
    { method: 'POST', path: /^\/admin\/blog\/categories\/(\d+)\/delete$/, perm: 'blog', handler: deleteCat },
  ];

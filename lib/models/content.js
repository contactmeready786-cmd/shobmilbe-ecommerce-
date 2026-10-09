'use strict';
// Blog, pages, banners and coupons.
const { q, one, uniqueSlug } = require('../db');
const { slugify, int, str, validYmd } = require('../util');

// ---------------------------------------------------------------- blog
async function listBlogCategories() {
  return q(`SELECT c.*, (SELECT count(*) FROM blog_posts p WHERE p.category_id=c.id AND p.status='published')::int AS posts
            FROM blog_categories c ORDER BY sort, id`);
}
async function saveBlogCategory({ id, name, sort }) {
  if (int(id)) { await q('UPDATE blog_categories SET name=$1, sort=$2 WHERE id=$3', [str(name, 60), int(sort), int(id)]); return int(id); }
  const slug = await uniqueSlug('blog_categories', slugify(name));
  return (await one('INSERT INTO blog_categories(name, slug, sort) VALUES($1,$2,$3) RETURNING id', [str(name, 60), slug, int(sort)])).id;
}
async function deleteBlogCategory(id) { await q('DELETE FROM blog_categories WHERE id=$1', [id]); }

const POST_COLS = `p.id, p.title, p.slug, p.category_id, p.excerpt, p.cover_id, p.status, p.published_at, p.seo_title, p.seo_description,
  p.views, p.created_at, p.updated_at, c.name AS category_name, c.slug AS category_slug, s.name AS author_name`;
async function listPosts({ published, categorySlug, q: search, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (published) where.push(`p.status='published' AND p.published_at <= now()`);
  if (categorySlug) { params.push(categorySlug); where.push(`c.slug=$${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(p.title ILIKE $${params.length} OR p.excerpt ILIKE $${params.length})`); }
  params.push(limit, offset);
  return q(`SELECT ${POST_COLS} FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id LEFT JOIN staff s ON s.id=p.author_id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY coalesce(p.published_at, p.created_at) DESC, p.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function getPost({ id, slug }) {
  return one(`SELECT ${POST_COLS}, p.content FROM blog_posts p LEFT JOIN blog_categories c ON c.id=p.category_id
              LEFT JOIN staff s ON s.id=p.author_id WHERE ${id ? 'p.id=$1' : 'p.slug=$1'}`, [id || slug]);
}
async function savePost(data, staffId) {
  const status = data.status === 'published' ? 'published' : 'draft';
  const f = {
    title: str(data.title, 160), category_id: int(data.category_id) || null, excerpt: str(data.excerpt, 500),
    content: str(data.content, 100000), cover_id: int(data.cover_id) || null, status,
    seo_title: str(data.seo_title, 120), seo_description: str(data.seo_description, 300),
  };
  const id = int(data.id);
  if (id) {
    const before = await one('SELECT status, published_at FROM blog_posts WHERE id=$1', [id]);
    const publishedAt = status === 'published' ? (before && before.published_at) || new Date() : before && before.published_at;
    const cols = Object.keys(f);
    await q(`UPDATE blog_posts SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}, published_at=$${cols.length + 1}, updated_at=now() WHERE id=$${cols.length + 2}`,
      [...cols.map((c) => f[c]), publishedAt, id]);
    if (f.cover_id) await q(`UPDATE media SET owner_type='blog', owner_id=$1 WHERE id=$2 AND owner_type IS NULL`, [id, f.cover_id]);
    return id;
  }
  const slug = await uniqueSlug('blog_posts', slugify(f.title) === 'item' ? 'post' : slugify(f.title));
  const cols = Object.keys(f);
  const row = await one(`INSERT INTO blog_posts(${cols.join(',')}, slug, author_id, published_at) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}, $${cols.length + 2}, $${cols.length + 3}) RETURNING id`,
    [...cols.map((c) => f[c]), slug, staffId || null, status === 'published' ? new Date() : null]);
  if (f.cover_id) await q(`UPDATE media SET owner_type='blog', owner_id=$1 WHERE id=$2 AND owner_type IS NULL`, [row.id, f.cover_id]);
  return row.id;
}
async function deletePost(id) {
  await q(`DELETE FROM media WHERE owner_type='blog' AND owner_id=$1`, [id]);
  await q('DELETE FROM blog_posts WHERE id=$1', [id]);
}

// ---------------------------------------------------------------- pages
async function listPages({ active } = {}) {
  return q(`SELECT * FROM pages ${active ? 'WHERE active' : ''} ORDER BY sort, id`);
}
async function getPage({ id, slug }) { return one(`SELECT * FROM pages WHERE ${id ? 'id=$1' : 'slug=$1'}`, [id || slug]); }
async function savePage(data) {
  const f = [str(data.title, 120), str(data.content, 100000), !!data.in_footer, !!data.active, int(data.sort)];
  if (int(data.id)) {
    await q('UPDATE pages SET title=$1, content=$2, in_footer=$3, active=$4, sort=$5, updated_at=now() WHERE id=$6', [...f, int(data.id)]);
    return int(data.id);
  }
  const slug = await uniqueSlug('pages', slugify(data.slug || data.title) === 'item' ? 'page' : slugify(data.slug || data.title));
  return (await one('INSERT INTO pages(title, content, in_footer, active, sort, slug) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [...f, slug])).id;
}
async function deletePage(id) { await q('DELETE FROM pages WHERE id=$1', [id]); }

// ---------------------------------------------------------------- banners
const PLACEMENTS = { slider: 'হোমপেজ স্লাইডার (বড় ব্যানার)', promo: 'হোমপেজ মাঝের ছোট ব্যানার', popup: 'পপআপ অফার' };
async function listBanners({ active, placement } = {}) {
  const params = [];
  const where = [];
  if (active) where.push('active AND image_id IS NOT NULL');
  if (placement) { params.push(placement); where.push(`placement=$${params.length}`); }
  return q(`SELECT * FROM banners ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY placement, sort, id`, params);
}
async function saveBanner(data) {
  const f = [int(data.image_id) || null, str(data.title, 120), str(data.subtitle, 200), str(data.link, 300), str(data.button, 40),
    PLACEMENTS[data.placement] ? data.placement : 'slider', int(data.sort), !!data.active];
  let id = int(data.id);
  if (id) {
    const before = await one('SELECT image_id FROM banners WHERE id=$1', [id]);
    await q('UPDATE banners SET image_id=coalesce($1, image_id), title=$2, subtitle=$3, link=$4, button=$5, placement=$6, sort=$7, active=$8 WHERE id=$9', [...f, id]);
    if (f[0] && before && before.image_id && before.image_id !== f[0]) await q('DELETE FROM media WHERE id=$1', [before.image_id]);
  } else {
    id = (await one('INSERT INTO banners(image_id, title, subtitle, link, button, placement, sort, active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', f)).id;
  }
  if (f[0]) await q(`UPDATE media SET owner_type='banner', owner_id=$1 WHERE id=$2`, [id, f[0]]);
  return id;
}
async function deleteBanner(id) {
  const b = await one('SELECT image_id FROM banners WHERE id=$1', [id]);
  await q('DELETE FROM banners WHERE id=$1', [id]);
  if (b && b.image_id) await q('DELETE FROM media WHERE id=$1', [b.image_id]);
}

// ---------------------------------------------------------------- coupons
const COUPON_TYPES = { percent: 'শতকরা ছাড় (%)', fixed: 'নির্দিষ্ট টাকা ছাড় (৳)', free_delivery: 'ফ্রি ডেলিভারি' };
async function listCoupons() { return q('SELECT * FROM coupons ORDER BY active DESC, created_at DESC'); }
async function saveCoupon(data) {
  const code = str(data.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw new Error('কুপন কোড দিন (শুধু ইংরেজি অক্ষর ও সংখ্যা)।');
  const type = COUPON_TYPES[data.type] ? data.type : 'percent';
  const value = Math.max(0, int(data.value));
  if (type === 'percent' && (value <= 0 || value > 100)) throw new Error('শতকরা ছাড় ১ থেকে ১০০ এর মধ্যে দিন।');
  if (type === 'fixed' && value <= 0) throw new Error('ছাড়ের টাকার পরিমাণ দিন।');
  const f = [code, type, value, Math.max(0, int(data.min_order)), Math.max(0, int(data.max_discount)), validYmd(data.starts_on),
    validYmd(data.ends_on), Math.max(0, int(data.usage_limit)), Math.max(0, int(data.per_phone)), !!data.active, str(data.note, 200)];
  const clash = await one('SELECT id FROM coupons WHERE upper(code)=$1 AND id<>$2', [code, int(data.id)]);
  if (clash) throw new Error('এই কোডের কুপন আগে থেকেই আছে।');
  // only for some products / categories (empty = the whole cart), and first order only
  const ids = (v) => [...new Set([].concat(v ?? []).flatMap((x) => String(x).split(',')).map((x) => int(x)).filter((x) => x > 0))].slice(0, 300);
  const extra = [ids(data.product_ids), ids(data.category_ids), !!data.first_order];
  if (int(data.id)) {
    await q(`UPDATE coupons SET code=$1, type=$2, value=$3, min_order=$4, max_discount=$5, starts_on=$6, ends_on=$7, usage_limit=$8,
             per_phone=$9, active=$10, note=$11, product_ids=$13, category_ids=$14, first_order=$15 WHERE id=$12`, [...f, int(data.id), ...extra]);
    return int(data.id);
  }
  return (await one(`INSERT INTO coupons(code, type, value, min_order, max_discount, starts_on, ends_on, usage_limit, per_phone, active, note, product_ids, category_ids, first_order)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [...f, ...extra])).id;
}
async function deleteCoupon(id) { await q('DELETE FROM coupons WHERE id=$1', [id]); }

module.exports = {
  listBlogCategories, saveBlogCategory, deleteBlogCategory, listPosts, getPost, savePost, deletePost,
  listPages, getPage, savePage, deletePage,
  PLACEMENTS, listBanners, saveBanner, deleteBanner,
  COUPON_TYPES, listCoupons, saveCoupon, deleteCoupon,
};

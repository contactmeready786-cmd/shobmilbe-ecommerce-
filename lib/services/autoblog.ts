// 📝 অটো ব্লগ — one "দাম তালিকা" (price list) article for every main category, written from the shop's own
// products and refreshed every week. People in Bangladesh search "<thing> price in BD"; these pages answer
// exactly that, link to every product, and keep Google seeing fresh pages on the site.
//
// Each article is one blog post marked with auto_key = 'price-list:<category id>', updated in place (same link),
// never duplicated. If the owner switches one to draft in Admin → ব্লগ, it is left alone from then on.
import * as db from '../db';
import { bn, slugify } from '../util';
import * as $seo from './seo';
import type { Body, Id, Loose, Settings } from '../types';

const REFRESH_DAYS = 7;
const MIN_PRODUCTS = 5;
const MAX_ROWS = 40;
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const money = (n: number) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const cell = (t?: Loose) => String(t || '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();

function monthLabel(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { month: `${MONTHS[get('month') - 1]} ${bn(get('year'))}`, date: `${bn(get('day'))} ${MONTHS[get('month') - 1]} ${bn(get('year'))}` };
}

async function blogCategory() {
  const row = await db.one(`SELECT id FROM blog_categories WHERE slug='price-list'`);
  if (row) return row.id;
  return (await db.one(`INSERT INTO blog_categories(name, slug, sort) VALUES('দাম তালিকা','price-list',0)
    ON CONFLICT (slug) DO UPDATE SET name=blog_categories.name RETURNING id`))!.id;
}

// main categories, each with all products in it and its sub-categories
async function categoriesWithProducts() {
  const cats = await db.q('SELECT id, name, slug, parent_id FROM categories WHERE coalesce(active,true) AND NOT coalesce(noindex,false)');
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootOf = (id?: Id) => { let c = byId.get(id); for (let i = 0; c && c.parent_id && i < 10; i++) c = byId.get(c.parent_id) || c; return c; };
  const products = await db.q(`SELECT id, name, slug, price, old_price, stock, image_id, category_id, coalesce(sold_count,0)::int AS sold
    FROM products WHERE active AND parent_id IS NULL AND price > 0 AND NOT coalesce(noindex,false)`);
  const roots = new Map();
  for (const p of products) {
    const root = rootOf(p.category_id);
    if (!root) continue;
    if (!roots.has(root.id)) roots.set(root.id, { cat: root, items: [] });
    const sub = byId.get(p.category_id);
    roots.get(root.id).items.push({ ...p, sub: sub && sub.id !== root.id ? sub.name : '' });
  }
  return [...roots.values()].filter((r) => r.items.length >= MIN_PRODUCTS);
}

function article({ cat, items }: Body, settings: Settings) {
  const store = settings.store_name || 'সবমিলবে';
  const { month, date } = monthLabel();
  const inStock = items.filter((p: { stock: number; }) => p.stock > 0);
  const sorted = [...items].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || b.sold - a.sold || a.price - b.price);
  const rows = sorted.slice(0, MAX_ROWS);
  const prices = inStock.length ? inStock.map((p: Loose) => p.price) : items.map((p: Loose) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const cheapest = (inStock.length ? inStock : items).find((p: { price: number; }) => p.price === lo);
  const top = [...inStock].sort((a, b) => b.sold - a.sold || Number(b.old_price > b.price) - Number(a.old_price > a.price)).slice(0, 3);
  const dhaka = Number(settings.delivery_dhaka) || 60;
  const outside = Number(settings.delivery_outside) || 110;

  const subs = new Map();
  for (const p of items) if (p.sub) { if (!subs.has(p.sub)) subs.set(p.sub, []); subs.get(p.sub).push(p); }

  const lines = [
    `${cat.name} কিনতে চাইলে দাম এক জায়গায় মিলিয়ে নিন। ${store}-তে এখন ${bn(items.length)}টা ${cat.name} পণ্য আছে, দাম ${money(lo)} থেকে ${money(hi)} পর্যন্ত। নিচের তালিকার দাম শেষবার মিলানো হয়েছে ${date}।`,
    '',
    `## ${cat.name} দামের তালিকা — ${month}`,
    '',
    '| পণ্য | দাম | অবস্থা |',
    '|---|---|---|',
    ...rows.map((p) => `| [${cell(p.name)}](/p/${encodeURIComponent(p.slug)}) | ${money(p.price)}${p.old_price > p.price ? ` (আগে ${money(p.old_price)})` : ''} | ${p.stock > 0 ? 'স্টকে আছে' : 'স্টক শেষ'} |`),
    '',
  ];
  if (items.length > rows.length) lines.push(`আরো ${bn(items.length - rows.length)}টা পণ্য দেখুন: [সব ${cat.name}](/products?cat=${encodeURIComponent(cat.slug)})`, '');
  if (subs.size > 1) {
    lines.push(`## ধরন অনুযায়ী ${cat.name}-এর দাম`, '');
    for (const [name, list] of [...subs.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
      const ps = list.map((p: Loose) => p.price);
      lines.push(`- **${name}:** ${bn(list.length)}টা পণ্য, ${money(Math.min(...ps))} থেকে ${money(Math.max(...ps))}`);
    }
    lines.push('');
  }
  if (top.length) {
    lines.push(`## সবচেয়ে জনপ্রিয় ${cat.name}`, '');
    for (const p of top) lines.push(`/p/${p.slug}`);
    lines.push('');
  }
  lines.push('## কেনার আগে যা দেখে নেবেন', '',
    '- পণ্যের মডেল নম্বর আর বিবরণ মিলিয়ে নিন — বিশেষ করে রিমোট, পার্টস আর বদলি জিনিসের ক্ষেত্রে।',
    '- পণ্যের পেজে সব ছবি আর ভিডিও (থাকলে) দেখে নিন।',
    `- কোনটা লাগবে বুঝতে না পারলে পুরোনো জিনিসের ছবি WhatsApp-এ পাঠান${settings.whatsapp ? ` (${settings.whatsapp})` : ''} — আমরা মিলিয়ে দেব।`,
    '',
    '## প্রশ্ন ও উত্তর', '',
    `**ডেলিভারি চার্জ কত?** ঢাকার ভেতরে ${money(dhaka)}, ঢাকার বাইরে ${money(outside)}। সারা বাংলাদেশে হোম ডেলিভারি হয়।`, '',
    '**টাকা কখন দেব?** ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিতে পারবেন।', '',
    cheapest ? `**সবচেয়ে কম দামে কোনটা পাওয়া যায়?** ${cheapest.name} — মাত্র ${money(cheapest.price)}।` : '', '',
    `**দাম কি বদলায়?** হ্যাঁ, বাজার অনুযায়ী দাম বদলাতে পারে। এই তালিকা প্রতি সপ্তাহে নিজে থেকে আপডেট হয়; সবচেয়ে সঠিক দাম পণ্যের পেজে।`);

  const title = `${cat.name} দাম বাংলাদেশে (${month}) — ${cat.name} Price in BD`;
  return {
    title: title.slice(0, 160),
    excerpt: `${cat.name}-এর ${bn(items.length)}টা পণ্যের দাম এক জায়গায় — ${money(lo)} থেকে ${money(hi)}। ক্যাশ অন ডেলিভারি, সারা দেশে হোম ডেলিভারি।`.slice(0, 500),
    content: lines.join('\n').replace(/\n{3,}/g, '\n\n'),
    seo_title: `${cat.name} Price in BD ${month} — দাম তালিকা`.slice(0, 120),
    seo_description: `${cat.name}-এর সর্বশেষ দাম: ${money(lo)} থেকে ${money(hi)}। ${bn(items.length)}টা পণ্য, ক্যাশ অন ডেলিভারি, ঢাকায় ডেলিভারি ${money(dhaka)}।`.slice(0, 300),
    cover_id: (top[0] || rows[0] || {}).image_id || null,
  };
}

// Write / refresh the price-list articles that are due (at most `max` per call, so a wake-up stays short).
async function run(settings: Settings, { force = false, max = 2 }: Body = {}) {
  if (!force && settings.autoblog_on !== '1') return { off: true };
  const groups = await categoriesWithProducts();
  if (!groups.length) return { none: true };
  const catId = await blogCategory();
  const done: Loose[] = [];
  for (const g of groups) {
    if (done.length >= max) break;
    const key = `price-list:${g.cat.id}`;
    const old = await db.one('SELECT id, status, updated_at FROM blog_posts WHERE auto_key=$1', [key]);
    if (old && old.status !== 'published') continue; // the owner switched it off
    if (old && !force && Date.now() - new Date(old.updated_at).getTime() < REFRESH_DAYS * 864e5) continue;
    const a = article(g, settings);
    if (old) {
      await db.q(`UPDATE blog_posts SET title=$1, excerpt=$2, content=$3, seo_title=$4, seo_description=$5, cover_id=coalesce($6, cover_id), updated_at=now() WHERE id=$7`,
        [a.title, a.excerpt, a.content, a.seo_title, a.seo_description, a.cover_id, old.id]);
      done.push({ id: old.id, title: a.title, updated: true });
    } else {
      const slug = await db.uniqueSlug('blog_posts', `${slugify(g.cat.slug || g.cat.name) || 'category'}-price-in-bd`);
      const row = await db.one(`INSERT INTO blog_posts(title, slug, category_id, excerpt, content, cover_id, status, published_at, seo_title, seo_description, auto_key)
        VALUES($1,$2,$3,$4,$5,$6,'published',now(),$7,$8,$9) RETURNING id`,
      [a.title, slug, catId, a.excerpt, a.content, a.cover_id, a.seo_title, a.seo_description, key]);
      done.push({ id: row!.id, title: a.title, created: true });
    }
  }
  if (done.length) {
    // tell Google / Bing right away when IndexNow is set up
    try {
      const rows = await db.q('SELECT slug FROM blog_posts WHERE id = ANY($1::int[])', [done.map((d) => d.id)]);
      await $seo.indexNowPing(settings.site_url || 'https://shobmilbe.com', ['/blog', ...rows.map((r) => `/blog/${r.slug}`)]);
    } catch (_) { /* Google finds them through the sitemap anyway */ }
  }
  return { done };
}

async function list() {
  return db.q(`SELECT id, title, slug, status, updated_at FROM blog_posts WHERE auto_key IS NOT NULL ORDER BY title`).catch(() => []);
}

export { run, list, article, categoriesWithProducts };

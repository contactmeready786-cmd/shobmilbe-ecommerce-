// 🔎 Automatic SEO for every product and category page.
// When the owner has written their own SEO title / description (Admin → পণ্য → SEO), that is always used.
// When the box is empty, a good one is made from the product's own name, price, brand and category,
// so all products get a proper Google title and description without typing one by one.

// Words copied from other shops that do not belong in a product name ("Product details of …", "Buy …")
import * as crypto from 'node:crypto';
import { bn } from '../util';
import * as md from '../views/md';
import * as $autoseo from './autoseo';
import * as $db from '../db';
import * as $dupcanon from './dupcanon';
import type { Loose, Settings } from '../types';
const JUNK_START = /^\s*(?:product\s+details?\s+of|product\s+name\s*:)\s*/i;
function cleanName(name?: Loose) {
  return String(name || '').replace(JUNK_START, '').replace(/\s*[|,–-]\s*$/, '').replace(/\s{2,}/g, ' ').trim() || String(name || '').trim();
}
function needsNameFix(name?: Loose) { return JUNK_START.test(String(name || '')); }

// Cut at a word boundary, never in the middle of a word ("… Circuit Boar" ✗)
function cut(text?: Loose, max?: Loose) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const part = t.slice(0, max + 1);
  const sp = part.lastIndexOf(' ');
  return (sp > max * 0.6 ? part.slice(0, sp) : t.slice(0, max)).replace(/[\s,.;:|–-]+$/, '');
}
// Text copied from other sites often has words glued together ("BoardMain Chip"): put the space back.
function unglue(text?: Loose) { return String(text || '').replace(/([a-z\d)])([A-Z][a-z])/g, '$1 $2').replace(/([.:;!?।])(?=\S)/g, '$1 '); }

const money = (n?: Loose) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));

// Google title (the shop name " | সবমিলবে" is added after this by the layout)
function productTitle(p?: Loose) {
  if (p.seo_title && p.seo_title.trim()) return p.seo_title.trim();
  // People in Bangladesh search "<product> price in bd" — so the title says exactly that.
  return `${cut(cleanName(p.name), 52)} Price in BD`;
}

function productDescription(p?: Loose, settings: Settings = {} as Settings) {
  if (p.seo_description && p.seo_description.trim()) return p.seo_description.trim();
  const name = cut(cleanName(p.name), 55);
  const price = Number(p.price) > 0 ? ` মাত্র ${money(p.price)}-এ` : '';
  const tail = ` সারা বাংলাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি — ${settings.store_name || 'সবমিলবে'}।`;
  const head = `${name} কিনুন${price}।`;
  const room = 158 - head.length - tail.length;
  const own = md.plain(p.short_description || p.description || '', 400);
  // 🤖 no own text: a sentence of the auto description (what it is, what it is used for)
  const text = own.length >= 40 || settings.autoseo_desc === '0' ? own : $autoseo.metaLine(p, room - 2);
  const about = room > 25 ? cut(unglue(text), room - 1) : '';
  return cut(`${head}${about ? ' ' + about + '।' : ''}${tail}`.replace(/।।/g, '।').replace(/\.।/g, '।'), 160);
}

// Extra search words: the same product as people type it — English, Bangla, "price in bd", brand, model, category
function productKeywords(p?: Loose) {
  if (p.seo_keywords && p.seo_keywords.trim()) return p.seo_keywords.trim();
  const name = cut(cleanName(p.name), 60);
  const list = [name, `${name} price in bd`, p.model ? `${p.model} price in bangladesh` : '', p.brand || '', p.category_name ? `${p.category_name} দাম` : ''];
  return [...new Set(list.filter(Boolean))].join(', ');
}

function listTitle(c?: Loose, page?: Loose) {
  const base = c.seo_title && c.seo_title.trim() ? c.seo_title.trim() : `${c.name} — দাম ও অনলাইন অর্ডার বাংলাদেশে`;
  return page > 1 ? `${base} (পেজ ${bn(page)})` : base;
}
function listDescription(c?: Loose, total?: Loose, settings: Settings = {} as Settings) {
  if (c.seo_description && c.seo_description.trim()) return c.seo_description.trim();
  const own = md.plain(c.description || '', 300);
  if (own.length >= 60) return cut(own, 160);
  return cut(`${c.name}: ${total ? bn(total) + 'টি পণ্য ' : ''}সেরা দামে কিনুন ${settings.store_name || 'সবমিলবে'} থেকে। সারা বাংলাদেশে হোম ডেলিভারি, পণ্য হাতে পেয়ে টাকা দিন।`, 160);
}

// Homepage defaults (used only when the owner left Admin → মার্কেটিং → SEO empty)
function homeTitle(s?: Loose) {
  return s.seo_title || `${s.store_name || 'সবমিলবে'} | ইলেকট্রনিক্স পার্টস, টুলস ও রিমোটের অনলাইন শপ`;
}
function homeDescription(s?: Loose) {
  return s.seo_description || 'ইলেকট্রনিক্স কম্পোনেন্ট, সার্কিট মডিউল, সোল্ডারিং টুলস, এসি ও টিভি রিমোট, ইলেকট্রিক্যাল আর প্রতিদিনের দরকারি জিনিস — সেরা দামে। সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।';
}

// Category / brand list → ItemList for Google (the products on this page, in order)
function itemListLd(base: Loose, products?: Loose, offset: Loose = 0) {
  if (!products.length) return null;
  return { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: products.slice(0, 30).map((p?: Loose, i?: Loose) => ({
    '@type': 'ListItem', position: offset + i + 1, url: `${base}/p/${p.slug}`, name: cleanName(p.name) })) };
}

// ⚡ IndexNow: tells Bing, Yandex, Seznam … about new or changed pages within minutes (Google reads the sitemap).
// The key is made once and kept in the shop's settings, so it never changes.
async function indexNowKey() {
  const db = $db;
  const s = await db.getSettings();
  if (/^[a-f0-9]{32}$/.test(s.indexnow_key || '')) return s.indexnow_key;
  const key = crypto.randomBytes(16).toString('hex');
  await db.setMany({ indexnow_key: key });
  return key;
}
async function indexNowPing(siteUrl?: Loose, paths?: Loose) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || /vercel\.app|localhost/.test(base) || !paths.length) return null;
  const host = base.replace(/^https:\/\//, '');
  try {
    const key = await indexNowKey();
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ host, key, keyLocation: `${base}/${key}.txt`, urlList: [...new Set(paths)].slice(0, 1000).map((p) => base + encodeURI(p as string)) }),
    });
    return r.status;
  } catch (_) { return null; }
}

// Runs with the round-the-clock tick: at most once an hour, sends the pages that are new or changed since the
// last time (the very first time: the whole shop). Nothing to do → nothing is sent.
async function indexNowSweep(settings: Settings) {
  const db = $db;
  const base = String(settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
  if (Date.now() - (Number(settings.indexnow_try) || 0) < 55 * 60 * 1000) return { skipped: true };
  await db.setMany({ indexnow_try: String(Date.now()) });
  const last = Number(settings.indexnow_last) || 0; // last time Bing & co. received the list
  const started = String(Date.now());
  const [prods, cats, kits] = await Promise.all([
    db.q('SELECT slug FROM products WHERE active AND NOT noindex AND parent_id IS NULL AND updated_at > $1 ORDER BY updated_at DESC LIMIT 900', [new Date(last)]),
    last ? [] : db.q('SELECT slug FROM categories WHERE coalesce(active,true) AND NOT noindex'),
    settings.kits_on !== '0' ? db.q('SELECT slug FROM kits WHERE active AND updated_at > $1 LIMIT 50', [new Date(last)]).catch(() => []) : [],
  ]);
  const dupSlugs = await $dupcanon.copies().catch(() => new Map()); // copies of another product: not sent
  const paths = [...(last ? [] : ['/', '/products']), ...cats.map((c) => `/products?cat=${c.slug}`), ...prods.filter((p) => !dupSlugs.has(p.slug)).map((p) => `/p/${p.slug}`), ...kits.map((k) => `/kit/${k.slug}`)];
  if (!paths.length) return { sent: 0 };
  const status = await indexNowPing(base, paths);
  // 200/202 = received. Anything else: the same pages go again next hour.
  if (status === 200 || status === 202) await db.setMany({ indexnow_last: started });
  return { sent: paths.length, status };
}

export { indexNowSweep, cleanName, needsNameFix, cut, unglue, productTitle, productDescription, productKeywords, listTitle, listDescription, homeTitle, homeDescription, itemListLd, indexNowKey, indexNowPing };

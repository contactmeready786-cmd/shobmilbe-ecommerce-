// 👯 Same product listed more than once (for example imported again, so it got a "…-2" link).
// Google then finds two pages that say the same thing and picks one of them by itself — Search Console
// reports it as "Duplicate, Google chose different canonical than user".
// Here the shop picks first: every copy's canonical link points at ONE main page, and only the main page
// is in the sitemap / sent to IndexNow. The copies still open and sell normally for people who have the link.
//
// Same product = same name after cleaning (word order, upper/lower case, "Product details of …",
// "new / original / high quality" and similar words do not count). Names that differ in a size or
// model number (40W vs 60W, PAM8403 vs PAM8610) stay separate products.
// Main page = the oldest one that is in stock; if none is in stock, the oldest one.
import * as db from '../db';
import * as seo from './seo';
import { words } from '../models/duplicates';
import type { Loose } from '../types';
import type { ProductsRow } from '../data/rows';

const TTL = 5 * 60 * 1000;
let cache: Loose = null;
let cachedAt = 0;

function keyOf(name: string) {
  const ws = words(seo.cleanName(name));
  return ws.length ? [...ws].sort().join(' ') : '';
}

// slug of a copy -> slug of its main page (main pages and single products are not in the map)
async function copies() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const rows = await db.q<Pick<ProductsRow, 'id' | 'slug' | 'name' | 'stock' | 'product_type'>>(`SELECT id, slug, name, stock, product_type FROM products
    WHERE active AND NOT noindex AND parent_id IS NULL ORDER BY id`);
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r.name);
    if (!k) continue;
    const g = `${r.product_type || 'single'}|${k}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const map = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const main = list.find((r: Loose) => Number(r.stock) > 0) || list[0];
    for (const r of list) if (r !== main) map.set(r.slug, main.slug);
  }
  cache = map;
  cachedAt = Date.now();
  return map;
}

// canonical path for a product page
async function canonicalFor(slug: string) {
  try {
    const main = (await copies()).get(slug);
    return `/p/${main || slug}`;
  } catch (_) {
    return `/p/${slug}`;
  }
}

async function isCopy(slug?: Loose) {
  try { return (await copies()).has(slug); } catch (_) { return false; }
}

function forget() { cache = null; }

export { copies, canonicalFor, isCopy, keyOf, forget };

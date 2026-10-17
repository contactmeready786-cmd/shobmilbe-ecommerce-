// What a Next.js shop page shows, loaded the same way for the page itself and for proxy.ts (which must know
// beforehand whether the thing exists — see missing() below).
import { cache } from 'react';
import * as db from '../db';
import * as content from '../models/content';
import * as catalog from '../models/catalog';
import type { Loose } from '../types';

export const blogCategory = cache(async (slug: string) => {
  await db.ensureReady();
  const cats = (await content.listBlogCategories()) as Loose[];
  return { cats, category: cats.find((c) => c.slug === slug) || null };
});

export const ownerPage = cache(async (slug: string) => {
  await db.ensureReady();
  const p = (await content.getPage({ slug })) as Loose;
  return p && p.active ? p : null;
});

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * Before a Next.js page is drawn: can it be drawn here — does the thing at this address exist and live at this address?
 * If not (a deleted page, a mistyped category, a hidden product — or a product whose link changed, or a variant's own
 * link), proxy.ts lets the original code answer: the shop's real 404 page, or the same permanent redirect as always.
 * (Next.js can't yet draw its "not found" page on the server — notFound() sends an empty page that only fills in with
 * JavaScript, github.com/vercel/next.js/issues/99793.)  The checks match the page's own (lib/shop/router.tsx).
 */
export async function drawableHere(path: string): Promise<boolean> {
  let m = /^\/blog\/category\/([^/]+)$/.exec(path);
  if (m) return !!(await blogCategory(safeDecode(m[1]))).category;
  m = /^\/page\/([^/]+)$/.exec(path);
  if (m) return !!(await ownerPage(safeDecode(m[1])));
  m = /^\/brand\/([^/]+)$/.exec(path);
  if (m) {
    await db.ensureReady();
    const b = (await catalog.getBrand({ slug: m[1] })) as Loose;
    return !!(b && b.active);
  }
  m = /^\/p\/([^/]+)$/.exec(path);
  if (m) {
    await db.ensureReady();
    const p = await db.one('SELECT active, parent_id FROM products WHERE slug=$1', [m[1]]);
    return !!(p && p.active && !p.parent_id);
  }
  return true;
}

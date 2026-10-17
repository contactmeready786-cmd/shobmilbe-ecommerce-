// What a Next.js shop page shows, loaded the same way for the page itself and for proxy.ts (which must know
// beforehand whether the thing exists — see missing() below).
import { cache } from 'react';
import * as db from '../db';
import * as content from '../models/content';
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
 * Does this address point at something that doesn't exist (a deleted page, a mistyped category)?
 * Next.js can't yet draw its "not found" page on the server (a known Next.js bug — notFound() sends an empty page
 * that only fills in with JavaScript, github.com/vercel/next.js/issues/99793), so proxy.ts sends such addresses to the
 * shop's original 404 page instead: status 404, the shop's frame, "পাওয়া যায়নি".
 */
export async function missing(path: string): Promise<boolean> {
  let m = /^\/blog\/category\/([^/]+)$/.exec(path);
  if (m) return !(await blogCategory(safeDecode(m[1]))).category;
  m = /^\/page\/([^/]+)$/.exec(path);
  if (m) return !(await ownerPage(safeDecode(m[1])));
  return false;
}

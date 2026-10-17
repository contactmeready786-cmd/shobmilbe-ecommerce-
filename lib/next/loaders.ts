// What a Next.js shop page shows, loaded the same way for the page itself and for proxy.ts (which must know
// beforehand whether the thing exists — see missing() below).
import { cache } from 'react';
import * as db from '../db';
import * as content from '../models/content';
import * as catalog from '../models/catalog';
import * as security from '../security';
import * as kits from '../models/kits';
import * as accounts from '../models/accounts';
import * as livescore from '../services/livescore';
import { publishedPost } from '../shop/blog';
import type { Loose, Settings, ShopRequest } from '../types';

async function settingsNow(): Promise<Settings> { await db.ensureReady(); return db.getSettings(); }

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

export const blogPostLive = cache(async (slug: string) => {
  await db.ensureReady();
  return publishedPost(slug);
});

/** The order exists and this visit is under the limit for trying many order numbers (60 in 10 minutes per connection). */
async function orderAllowed(code: string, headers: Headers): Promise<boolean> {
  await db.ensureReady();
  const plain: Record<string, string> = {};
  headers.forEach((v, k) => { plain[k] = v; });
  // a missing order goes to the original code without counting here (it counts the try itself, once)
  if (!(await db.one('SELECT 1 FROM orders WHERE code=$1', [code.toUpperCase()]))) return false;
  return security.hit(db, 'orderview:' + security.clientIp({ headers: plain } as ShopRequest), 60, 600);
}

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * Before a Next.js page is drawn: can it be drawn here — does the thing at this address exist and live at this address?
 * If not (a deleted page, a mistyped category, a hidden product — or a product whose link changed, or a variant's own
 * link), proxy.ts lets the original code answer: the shop's real 404 page, or the same permanent redirect as always.
 * (Next.js can't yet draw its "not found" page on the server — notFound() sends an empty page that only fills in with
 * JavaScript, github.com/vercel/next.js/issues/99793.)  The checks match the page's own (lib/shop/router.tsx).
 */
export async function drawableHere(path: string, headers: Headers): Promise<boolean> {
  let m = /^\/blog\/category\/([^/]+)$/.exec(path);
  if (m) return !!(await blogCategory(safeDecode(m[1]))).category;
  m = /^\/blog\/([^/]+)$/.exec(path);
  if (m) return !!(await blogPostLive(safeDecode(m[1])));
  m = /^\/page\/([^/]+)$/.exec(path);
  if (m) return !!(await ownerPage(safeDecode(m[1])));
  m = /^\/brand\/([^/]+)$/.exec(path);
  if (m) {
    await db.ensureReady();
    const b = (await catalog.getBrand({ slug: m[1] })) as Loose;
    return !!(b && b.active);
  }
  // live scores, compare, kits: only when the owner has them on; /live itself opens the first sport (a redirect);
  // the checkout first asks a brand-new account for its name (a redirect) — lib/shop/more.tsx
  if (path === '/live') return false;
  m = /^\/live\/(cricket|football)$/.exec(path);
  if (m) return !!livescore.enabled(await settingsNow())[m[1]];
  if (path === '/compare') return (await settingsNow()).ui_compare !== '0';
  if (path === '/kits') return (await settingsNow()).kits_on !== '0';
  m = /^\/kit\/([^/]+)$/.exec(path);
  if (m) return (await settingsNow()).kits_on !== '0' && !!(await kits.forShop(safeDecode(m[1])));
  if (path === '/checkout') {
    const s = await settingsNow();
    const cu = await accounts.current({ headers: { cookie: headers.get('cookie') || '' } } as ShopRequest, s);
    return !(cu && accounts.needsProfile(cu));
  }
  if (path === '/complaint' || path === '/complaint/status') return (await settingsNow()).complaints_on !== '0';
  if (path === '/gift-card') return (await settingsNow()).gift_on === '1';
  // a return request (when the owner takes returns): counts against the same limit as an order's page
  m = /^\/order\/([A-Za-z0-9]+)\/return$/.exec(path);
  if (m) return (await settingsNow()).returns_on === '1' && (await orderAllowed(m[1], headers));
  // an order's page: counts against the limit for trying many order numbers (over it → the original code's "wait" page)
  m = /^\/order\/([A-Za-z0-9]+)$/.exec(path);
  if (m) return orderAllowed(m[1], headers);
  m = /^\/p\/([^/]+)$/.exec(path);
  if (m) {
    await db.ensureReady();
    const p = await db.one('SELECT active, parent_id FROM products WHERE slug=$1', [m[1]]);
    return !!(p && p.active && !p.parent_id);
  }
  return true;
}

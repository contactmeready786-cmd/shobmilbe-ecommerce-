// What every Next.js shop page needs, read once per visit (React cache) and through the shop's 15-second memory:
// settings, categories, the owner's pages, the pop-up offer — plus the address the visitor asked for.
import { cache } from 'react';
import { headers } from 'next/headers';
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as content from '../models/content';
import { siteUrl } from '../gate';
import { resolveShop, type Resolved } from '../shop/router';
import type { Loose, Settings } from '../types';

export const getSettings = cache(async (): Promise<Settings> => {
  await db.ensureReady();
  return db.getSettings();
});

export const getChrome = cache(async () => {
  const settings = await getSettings();
  const [categories, pages, popups] = await Promise.all([
    catalog.listCategories({ includeInactive: false }) as Promise<Loose[]>,
    content.listPages({ active: true }) as Promise<Loose[]>,
    content.listBanners({ active: true, placement: 'popup' }) as Promise<Loose[]>,
  ]);
  return { settings, categories, pages, popup: popups[0] || null };
});

/** The address the visitor asked for (proxy.ts writes it), e.g. "/blog" and its ?query. */
export const getRequestUrl = cache(async (): Promise<URL> => {
  const h = await headers();
  return new URL(h.get('x-shop-url') || '/', 'http://local');
});

/** Which header menu item is lit: the first part of the address, for the pages that light one. */
export function activeFor(pathname: string): string {
  const first = pathname.split('/')[1] || '';
  return ['blog', 'cart', 'live', 'products', 'track', 'account'].includes(first) ? first : '';
}

/** The address as the shop's router sees it: decoded, without a trailing slash. */
export const getShopPath = cache(async (): Promise<string> => {
  const url = await getRequestUrl();
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
});

/** The page at this address from lib/shop/router.tsx — loaded once per visit and shared by the frame, the head and the body. */
export const currentShopPage = cache(async (): Promise<Resolved> => {
  const [{ settings, categories }, url, path, h] = await Promise.all([getChrome(), getRequestUrl(), getShopPath(), headers()]);
  const plain: Record<string, string> = {};
  h.forEach((v: string, k: string) => { plain[k] = v; });
  return resolveShop({ path, query: url.searchParams, settings, categories, base: siteUrl({ headers: plain }, settings) });
});

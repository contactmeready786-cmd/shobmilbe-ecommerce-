// Which customer addresses are already served by Next.js pages (app/(shop)). proxy.ts runs the security gate for these;
// every other address still goes to the original code (lib/app.ts). Grows as pages move; when it covers everything,
// the original router goes.
const EXACT = new Set(['/', '/products', '/track', '/blog', '/live', '/cart', '/wishlist', '/compare', '/checkout', '/kits']);
const PATTERNS = [/^\/brand\/[^/]+$/, /^\/p\/[^/]+$/, /^\/blog\/category\/[^/]+$/, /^\/blog\/[^/]+$/, /^\/page\/[^/]+$/,
  /^\/live\/(cricket|football)$/, /^\/kit\/[^/]+$/];

/** Addresses drawn by lib/shop/router.tsx (home, lists, product pages). */
export function servesShopRouter(path: string): boolean {
  return path === '/' || path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/p\/[^/]+$/.test(path);
}

/** Addresses drawn by lib/shop/more.tsx (live scores, cart, wishlist, compare, checkout, kits). */
export function servesMore(path: string): boolean {
  return ['/live', '/cart', '/wishlist', '/compare', '/checkout', '/kits'].includes(path) || /^\/live\/(cricket|football)$/.test(path) || /^\/kit\/[^/]+$/.test(path);
}

/** Does a Next.js page exist for this address (for some requests)? */
export function hasNextPage(path: string): boolean {
  return EXACT.has(path) || PATTERNS.some((re) => re.test(path));
}

/** Is this request drawn by a Next.js page? (forms and other methods still go to the original code) */
export function servedByNext(path: string, query: URLSearchParams, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  // /track with an order number AND a phone number: the original code checks it and opens the order
  if (path === '/track' && query.get('code') && query.get('phone')) return false;
  return hasNextPage(path);
}

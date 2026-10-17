// Which customer addresses are already served by Next.js pages (app/(shop)). proxy.ts runs the security gate for these;
// every other address still goes to the original code (lib/app.ts). Grows as pages move; when it covers everything,
// the original router goes.
const EXACT = new Set(['/', '/products', '/track', '/blog']);
const PATTERNS = [/^\/brand\/[^/]+$/, /^\/p\/[^/]+$/, /^\/blog\/category\/[^/]+$/, /^\/blog\/[^/]+$/, /^\/page\/[^/]+$/];

/** Addresses drawn by lib/shop/router.tsx (home, lists, product pages). */
export function servesShopRouter(path: string): boolean {
  return path === '/' || path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/p\/[^/]+$/.test(path);
}

/** Is this GET address drawn by a Next.js page? (forms and other methods still go to the original code) */
export function servedByNext(path: string, query: URLSearchParams, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  // /track with an order number AND a phone number: the original code checks it and opens the order
  if (path === '/track' && query.get('code') && query.get('phone')) return false;
  return EXACT.has(path) || PATTERNS.some((re) => re.test(path));
}

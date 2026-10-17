import { ADMIN_GET_ROUTES } from './admin-routes';

// Which customer addresses are already served by Next.js pages (app/(shop)). proxy.ts runs the security gate for these;
// every other address still goes to the original code (lib/site.ts). Grows as pages move; when it covers everything,
// the original router goes.
const EXACT = new Set(['/', '/products', '/track', '/blog', '/live', '/cart', '/wishlist', '/compare', '/checkout', '/kits', '/complaint', '/complaint/status', '/gift-card', '/account']);
const PATTERNS = [/^\/brand\/[^/]+$/, /^\/p\/[^/]+$/, /^\/blog\/category\/[^/]+$/, /^\/blog\/[^/]+$/, /^\/page\/[^/]+$/,
  /^\/live\/(cricket|football)$/, /^\/kit\/[^/]+$/, /^\/order\/[A-Za-z0-9]+$/, /^\/order\/[A-Za-z0-9]+\/return$/];

/** Addresses drawn by lib/shop/router.tsx (home, lists, product pages). */
export function servesShopRouter(path: string): boolean {
  return path === '/' || path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/p\/[^/]+$/.test(path);
}

/** Addresses drawn by lib/shop/more.tsx (live scores, cart, wishlist, compare, checkout, kits, order pages). */
export function servesMore(path: string): boolean {
  return ['/live', '/cart', '/wishlist', '/compare', '/checkout', '/kits'].includes(path) || /^\/live\/(cricket|football)$/.test(path) || /^\/kit\/[^/]+$/.test(path) || /^\/order\/[A-Za-z0-9]+$/.test(path);
}

/** Addresses drawn by lib/shop/forms.tsx (my account, complaint, complaint status, return request, gift card — opening them). */
export function servesForms(path: string): boolean {
  return ['/complaint', '/complaint/status', '/gift-card', '/account'].includes(path) || /^\/order\/[A-Za-z0-9]+\/return$/.test(path);
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
  // the same for a complaint's status (it counts tries)
  if (path === '/complaint/status' && query.get('code') && query.get('phone')) return false;
  return hasNextPage(path);
}

// ---------------------------------------------------------------- admin
// Admin addresses that answer with a file, a picture, a print page or data rather than an admin page: always the
// original code. (Any other admin page that turns out not to be a page is sent there too — lib/next/admin.ts.)
const ADMIN_SITE = [
  /^\/admin\/api\//, /\.(csv|xlsx|json|txt|xml|pdf)$/, /^\/admin\/avatar\//, /\/photo\/\d+$/,
  /^\/admin\/orders\/(invoice|checklist)$/, /^\/admin\/orders\/\d+\/mushak$/, /^\/admin\/products\/labels$/, /^\/admin\/pos\/memo\//,
  /^\/admin\/reports\/staff$/, /^\/admin\/accounts\/vat\/return$/, /^\/admin\/reach(\/live)?$/, /^\/admin\/design\/documents$/, /^\/admin\/marketing\/email\/preview$/,
];

/** Is this an admin page request drawn by Next.js (app/(admin))? Forms (POST), files and addresses without a page
 * (lib/next/admin-routes.ts) stay with the original code. */
export function adminServedByNext(path: string, query: URLSearchParams, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (path !== '/admin' && !path.startsWith('/admin/')) return false;
  if (query.has('__site')) return false;
  // a page's download links (?excel=…, ?export=…) answer with a file
  if (['excel', 'export', 'download', 'csv', 'xlsx'].some((k) => query.has(k))) return false;
  if (ADMIN_SITE.some((re) => re.test(path))) return false;
  return ADMIN_GET_ROUTES.some((r) => (typeof r === 'string' ? r === path : r.test(path)));
}

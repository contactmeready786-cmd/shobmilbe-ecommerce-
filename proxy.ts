// Runs before every request (Next.js 16 "proxy", formerly "middleware").
//  • Pages served by Next.js (lib/next/routes.ts): the shop's security gate runs here first (lib/gate.ts — the same
//    checks the original code does: blocked IPs, hacking attempts, the country lock, blocked bots), and the
//    security headers are added. A visitor who is turned away gets the same page as before.
//  • The admin's forms, files and exports go to app/api/admin (lib/next/admin-route.ts); the customer forms to their own
//    routes (lib/shopx.tsx); everything else to the shop's 404 / redirect answers (the fallback rewrite to /api/site).
// In both cases the exact address the visitor asked for is passed on as x-shop-url — any copy the visitor sent is
// overwritten, so it can't be faked.
import { NextResponse, type NextRequest } from 'next/server';
import { servedByNext, hasNextPage, adminServedByNext, formRouteFor } from './lib/next/routes';
import { accountOrdersCookie } from './lib/shop/forms';
import { drawableHere } from './lib/next/loaders';
import { shopGate, adminGateOk, refCookie, refToRemember } from './lib/gate';
import { BASE_HEADERS, adminCsp, adminHeaders } from './lib/security';

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set('x-shop-url', url.pathname + url.search);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');

  // 🔐 the admin panel: its pages are drawn by Next.js (app/(admin)); files, exports and forms by app/api/admin
  if (path === '/admin' || path.startsWith('/admin/')) return adminProxy(request, path, headers);

  if (!servedByNext(path, url.searchParams, request.method)) {
    // an address a Next.js page also has, but the page doesn't draw this request (/track?code=…&phone=…, or a form
    // sent to it): the customer forms' own route answers (lib/shopx.tsx), anything else the original code, as always
    if (hasNextPage(path)) return NextResponse.rewrite(new URL(answeredBy(path, url.pathname) + url.search, request.url), { request: { headers } });
    return NextResponse.next({ request: { headers } });
  }

  // something that doesn't exist: the shop's own 404 page (the original code also runs the gate for it);
  // something that moved: its new address — exactly as the original code does
  if (!(await drawableHere(path, request.headers))) return NextResponse.rewrite(new URL(answeredBy(path, url.pathname) + url.search, request.url), { request: { headers } });

  const plain: Record<string, string> = {};
  request.headers.forEach((v, k) => { plain[k] = v; });
  const gate = await shopGate({ headers: plain, socket: { remoteAddress: plain['x-real-ip'] || '' }, url: url.pathname + url.search }, path, url.search, request.method);
  if (!gate.ok) {
    return new NextResponse(gate.body, { status: gate.status, headers: { 'Content-Type': gate.type, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...gate.headers } });
  }
  const res = NextResponse.next({ request: { headers } });
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.headers.set(k, v);
  // opening the account dashboard adds the customer's latest orders to this browser's order list (as it always did)
  if (path === '/account') {
    const oc = await accountOrdersCookie({ headers: plain }, gate.settings);
    if (oc) res.headers.append('Set-Cookie', oc);
  }
  const ref = refToRemember(gate.settings, url.searchParams.get('ref'));
  if (ref) res.headers.append('Set-Cookie', refCookie({ headers: plain }, ref));
  return res;
}

/** Where a request for a customer address that its Next.js page doesn't draw goes: the form's own route, else the
 * original code. (The address asked for always travels along as x-shop-url.) */
function answeredBy(path: string, asked: string): string {
  return formRouteFor(path) || '/api/site' + asked;
}

async function adminProxy(request: NextRequest, path: string, headers: Headers) {
  const url = request.nextUrl;
  const toAdminRoute = () => {
    // the mark that sent this visit here (lib/next/admin.ts) is not passed on
    const q = new URLSearchParams(url.searchParams);
    q.delete('__site');
    const search = q.toString();
    headers.set('x-shop-url', url.pathname + (search ? '?' + search : ''));
    return NextResponse.rewrite(new URL('/api/admin' + (search ? '?' + search : ''), request.url), { request: { headers } });
  };
  if (!adminServedByNext(path, url.searchParams, request.method)) return toAdminRoute();
  const plain: Record<string, string> = {};
  request.headers.forEach((v, k) => { plain[k] = v; });
  const gate = await adminGateOk({ headers: plain, socket: { remoteAddress: plain['x-real-ip'] || '' }, url: url.pathname + url.search }, request.method);
  if (!gate.ok) return toAdminRoute();
  // only scripts carrying this visit's nonce may run (lib/security.ts); Next.js puts it on its own scripts too
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  headers.set('x-nonce', nonce);
  // (the development server needs eval for its error messages; the live site never allows it)
  const csp = process.env.NODE_ENV === 'development' ? adminCsp(nonce).replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") : adminCsp(nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  for (const [k, v] of Object.entries({ ...BASE_HEADERS, ...adminHeaders(nonce), 'Content-Security-Policy': csp })) res.headers.set(k, v);
  return res;
}

export const config = {
  // Next.js's own build files never need it, and neither do the site's fixed files (styles, browser code, icons): for
  // those it only passed the request on, so leaving them out saves a step on every file a page loads.
  matcher: ['/((?!_next/static|_next/image|css/|js/|brand/favicon-|brand/apple-touch-icon|flags/|downloads/|favicon.ico|favicon.svg|icon-192.png|icon-512.png).*)'],
};

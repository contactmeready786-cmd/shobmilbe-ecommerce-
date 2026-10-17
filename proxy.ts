// Runs before every request (Next.js 16 "proxy", formerly "middleware").
//  • Pages served by Next.js (lib/next/routes.ts): the shop's security gate runs here first (lib/gate.ts — the same
//    checks the original code does: blocked IPs, hacking attempts, the country lock, blocked bots), and the
//    security headers are added. A visitor who is turned away gets the same page as before.
//  • Everything else goes on to the original shop code (the fallback rewrite to /api/legacy in next.config.ts).
// In both cases the exact address the visitor asked for is passed on as x-shop-url — any copy the visitor sent is
// overwritten, so it can't be faked.
import { NextResponse, type NextRequest } from 'next/server';
import { servedByNext } from './lib/next/routes';
import { shopGate, refCookie, refToRemember } from './lib/gate';
import { BASE_HEADERS } from './lib/security';

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set('x-shop-url', url.pathname + url.search);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');

  if (!servedByNext(path, url.searchParams, request.method)) {
    // an address a Next.js page also has, but this request belongs to the original code (e.g. /track?code=…&phone=…)
    if (path === '/track') return NextResponse.rewrite(new URL('/api/legacy/track' + url.search, request.url), { request: { headers } });
    return NextResponse.next({ request: { headers } });
  }

  const plain: Record<string, string> = {};
  request.headers.forEach((v, k) => { plain[k] = v; });
  const gate = await shopGate({ headers: plain, socket: { remoteAddress: plain['x-real-ip'] || '' }, url: url.pathname + url.search }, path, url.search, request.method);
  if (!gate.ok) {
    return new NextResponse(gate.body, { status: gate.status, headers: { 'Content-Type': gate.type, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...gate.headers } });
  }
  const res = NextResponse.next({ request: { headers } });
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.headers.set(k, v);
  const ref = refToRemember(gate.settings, url.searchParams.get('ref'));
  if (ref) res.headers.append('Set-Cookie', refCookie({ headers: plain }, ref));
  return res;
}

export const config = {
  // Next.js's own build files never need it.
  matcher: ['/((?!_next/static|_next/image).*)'],
};

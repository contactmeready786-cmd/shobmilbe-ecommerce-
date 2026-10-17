// Runs before every request (Next.js 16 "proxy", formerly "middleware").
// Remembers the exact address the visitor asked for, so the original shop code (reached through a
// rewrite to /api/legacy/...) sees the same URL it always saw. A visitor can't fake it: any incoming copy
// of the header is overwritten here.
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-shop-url', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Next.js's own build files never need it.
  matcher: ['/((?!_next/static|_next/image).*)'],
};

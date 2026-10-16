// Every address that has no Next.js page of its own yet arrives here (see the fallback rewrite in
// next.config.ts) and is answered by the original shop code, so the site behaves exactly as before.
import { handleWithLegacy } from '@/src/legacy/bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  // proxy.ts records the address the visitor really asked for, before Next.js rewrote it to /legacy/...
  const original = request.headers.get('x-shop-url');
  if (!original) return new Response('Not found', { status: 404 }); // /legacy/... opened directly
  return handleWithLegacy(request, original);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };

// Every request that no Next.js page answers arrives here (the fallback rewrite in next.config.ts, and proxy.ts for
// forms, files, exports and the shop's own 404 / redirect answers) and is answered by the original shop code
// (lib/app.ts, through src/legacy/bridge.ts) — forms, JSON APIs, pictures, payments, webhooks, feeds, robots.txt.
// The original code makes its few remaining text pages with react-dom/server, loaded when first needed
// (lib/react/render.tsx — Next.js allows it in a route that way).
import { handleWithLegacy } from '@/src/legacy/bridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  // proxy.ts records the address the visitor really asked for, before Next.js rewrote it to /api/legacy/...
  const original = request.headers.get('x-shop-url');
  if (!original) return new Response('Not found', { status: 404 }); // opened directly
  return handleWithLegacy(request, original);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };

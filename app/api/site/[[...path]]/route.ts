// Every request no other Next.js page or route answers arrives here (the fallback rewrite in next.config.ts, and
// proxy.ts for forms, the admin's files and exports, and the shop's own 404 / redirect answers). lib/site.ts answers
// them (through lib/site-answer.ts): shop and admin forms, /admin/api, the country-lock page, verification files.
// Its few text pages are made with react-dom/server, loaded when first needed (lib/react/render.tsx).
import { answerWithSite } from '@/lib/site-answer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  // proxy.ts records the address the visitor really asked for, before Next.js rewrote it to /api/site/...
  const original = request.headers.get('x-shop-url');
  if (!original) return new Response('Not found', { status: 404 }); // opened directly
  return answerWithSite(request, original);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD, handle as OPTIONS };

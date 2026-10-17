// /img/p/<product id> — old links to a product's picture (lib/api/files.ts)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { productImage } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/img\/p\/\d+$/.test(ctx.path) ? productImage(ctx) : otherMethods(ctx.request)));
const answer = handler;
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };

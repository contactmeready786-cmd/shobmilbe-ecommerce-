// GET /media/<id> — a picture (lib/api/files.ts)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { media } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/media\/\d+$/.test(ctx.path) ? media(false)(ctx) : otherMethods(ctx.request)), { bots: false });
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

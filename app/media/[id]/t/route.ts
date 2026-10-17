// GET /media/<id>/t — a picture, small (lib/api/files.ts)
import { apiRoute, otherMethods, toSite } from '@/lib/next/api';
import { media } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/media\/\d+\/t$/.test(ctx.path) ? media(true)(ctx) : toSite(ctx)), { bots: false });
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

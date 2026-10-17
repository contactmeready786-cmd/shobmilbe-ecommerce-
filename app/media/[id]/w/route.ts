// GET /media/<id>/w — a product picture with the shop's watermark (lib/api/files.ts)
import { apiRoute, otherMethods, toLegacy } from '@/lib/next/api';
import { mediaWatermarked } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/media\/\d+\/w$/.test(ctx.path) ? mediaWatermarked(ctx) : toLegacy(ctx)), { bots: false });
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

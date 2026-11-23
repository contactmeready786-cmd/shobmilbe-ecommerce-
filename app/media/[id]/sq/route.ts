// GET /media/<id>/sq — a picture as a white 1000×1000 square for the product feeds (lib/api/files.ts)
import { apiRoute, otherMethods, toSite } from '@/lib/next/api';
import { mediaSquare } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
const handler = apiRoute(async (ctx) => (/^\/media\/\d+\/sq$/.test(ctx.path) ? mediaSquare(ctx) : toSite(ctx)), { bots: false });
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

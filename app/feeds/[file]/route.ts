// GET /feeds/google.xml, facebook.csv … — product feeds (lib/api/files.ts)
import { apiRoute, otherMethods, toLegacy } from '@/lib/next/api';
import { feed } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/feeds\/(google|facebook)\.(xml|csv|tsv)$/.test(ctx.path) ? feed(ctx) : toLegacy(ctx)));
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

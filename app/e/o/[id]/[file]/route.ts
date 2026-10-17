// GET /e/o/<id>/<mark>.gif — an offer e-mail was opened (lib/api/files.ts)
import { apiRoute, otherMethods, toLegacy } from '@/lib/next/api';
import { mailOpened } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/e\/o\/\d{1,15}\/[A-Za-z0-9_-]{16}\.gif$/.test(ctx.path) ? mailOpened(ctx) : toLegacy(ctx)));
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

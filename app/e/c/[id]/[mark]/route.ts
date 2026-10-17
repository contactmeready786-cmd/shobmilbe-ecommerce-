// GET /e/c/<id>/<mark>?u=… — a link in an offer e-mail (lib/api/files.ts)
import { apiRoute, otherMethods, toLegacy } from '@/lib/next/api';
import { mailClicked } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const handler = apiRoute(async (ctx) => (/^\/e\/c\/\d{1,15}\/[A-Za-z0-9_-]{16}$/.test(ctx.path) ? mailClicked(ctx) : toLegacy(ctx)));
export const GET = handler;
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

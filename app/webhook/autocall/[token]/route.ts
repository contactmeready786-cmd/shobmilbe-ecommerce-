// /webhook/autocall/<token> — what the customer pressed on the robot call (lib/api/payments.ts)
import { apiRoute, otherMethods, toSite } from '@/lib/next/api';
import { autocallHook } from '@/lib/api/payments';

export const dynamic = 'force-dynamic';
// only addresses the original code knew answer here; anything else is the original code's answer (its 404 page)
const answer = apiRoute(async (ctx) => (/^\/webhook\/autocall\/[A-Za-z0-9_-]{10,80}$/.test(ctx.path) ? autocallHook(ctx) : toSite(ctx)));
export { answer as GET, answer as POST };
export { otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

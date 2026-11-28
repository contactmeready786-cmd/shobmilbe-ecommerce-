// POST /api/smsgw/pair | pull | report — the shop's own SMS app on the owner's phone (lib/api/smsgw.ts)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { smsgw } from '@/lib/api/smsgw';

export const dynamic = 'force-dynamic';
// bots: false — the phone app is not a browser; quiet: it never changes what the 15-second memory holds
export const POST = apiRoute(smsgw, { bots: false, quiet: true });
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

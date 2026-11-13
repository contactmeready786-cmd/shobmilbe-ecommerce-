// POST /api/geo/reverse — the address of the place the customer's phone gave at checkout (lib/api/georeverse.ts)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { geoReverse } from '@/lib/api/georeverse';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(geoReverse);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

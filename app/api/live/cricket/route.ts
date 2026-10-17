// GET /api/live/cricket — lib/api/shop-actions.ts (live)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { live } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(live);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

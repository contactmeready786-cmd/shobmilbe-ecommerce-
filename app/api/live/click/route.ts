// POST /api/live/click — lib/api/shop-actions.ts (liveClick)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { liveClick } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(liveClick);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

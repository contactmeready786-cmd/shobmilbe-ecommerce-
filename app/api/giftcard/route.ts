// POST /api/giftcard — lib/api/shop-actions.ts (giftcard)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { giftcard } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(giftcard);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

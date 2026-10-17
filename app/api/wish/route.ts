// POST /api/wish — lib/api/shop-actions.ts (wish)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { wish } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(wish);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

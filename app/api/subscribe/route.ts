// POST /api/subscribe — lib/api/shop-actions.ts (subscribe)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { subscribe } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(subscribe);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

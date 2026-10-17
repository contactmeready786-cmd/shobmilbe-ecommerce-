// POST /api/push/subscribe — lib/api/shop-actions.ts (pushSubscription)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { pushSubscription } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(pushSubscription);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

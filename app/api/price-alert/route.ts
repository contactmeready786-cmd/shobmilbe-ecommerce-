// POST /api/price-alert — lib/api/shop-actions.ts (priceAlert)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { priceAlert } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(priceAlert);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

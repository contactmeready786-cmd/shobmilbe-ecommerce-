// POST /api/stock-alert — lib/api/shop-actions.ts (stockAlert)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { stockAlert } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(stockAlert);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

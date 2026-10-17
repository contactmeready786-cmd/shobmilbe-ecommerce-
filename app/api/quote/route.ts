// POST /api/quote — lib/api/shop-actions.ts (quote)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { quote } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(quote);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

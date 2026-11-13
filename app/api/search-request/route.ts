// POST /api/search-request — lib/api/shop-actions.ts (searchRequest)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { searchRequest } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(searchRequest);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

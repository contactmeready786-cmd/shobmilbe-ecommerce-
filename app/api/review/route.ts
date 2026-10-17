// POST /api/review — lib/api/shop-actions.ts (review)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { review } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(review);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

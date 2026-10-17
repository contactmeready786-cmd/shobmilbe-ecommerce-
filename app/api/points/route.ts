// POST /api/points — lib/api/shop-actions.ts (points)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { points } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(points);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

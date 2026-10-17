// POST /api/v — lib/api/shop-actions.ts (visit)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { visit } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(visit);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

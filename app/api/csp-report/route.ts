// POST /api/csp-report — lib/api/shop-actions.ts (cspReport)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { cspReport } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(cspReport);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

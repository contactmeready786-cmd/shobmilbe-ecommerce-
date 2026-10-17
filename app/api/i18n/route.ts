// POST /api/i18n — lib/api/shop-actions.ts (i18n)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { i18n } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(i18n);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// GET /api/i18n/fix — lib/api/shop-actions.ts (i18nFix)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { i18nFix } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(i18nFix);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// POST /api/checkout-draft — lib/api/shop-actions.ts (checkoutDraft)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { checkoutDraft } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(checkoutDraft);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

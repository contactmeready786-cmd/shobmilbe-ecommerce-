// GET /api/app/offers — the Android app's new-offer check
import { apiRoute, otherMethods } from '@/lib/next/api';
import { appOffers } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(appOffers);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// GET /api/cards?ids=… — product cards for recently viewed
import { apiRoute, otherMethods } from '@/lib/next/api';
import { cards } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(cards);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

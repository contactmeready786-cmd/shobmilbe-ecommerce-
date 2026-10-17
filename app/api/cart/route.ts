// GET /api/cart?ids=… — what the cart holds, with today's prices and stock
import { apiRoute, otherMethods } from '@/lib/next/api';
import { cart } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(cart);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

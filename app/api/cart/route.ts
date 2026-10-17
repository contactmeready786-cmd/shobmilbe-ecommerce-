// GET /api/cart?ids=… — what the cart holds, with today's prices and stock
import { apiRoute } from '@/lib/next/api';
import { cart } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(cart);

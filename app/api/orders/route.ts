// POST /api/orders — a new order from the checkout page (lib/api/checkout.ts placeOrder)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { placeOrder } from '@/lib/api/checkout';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = apiRoute(placeOrder);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

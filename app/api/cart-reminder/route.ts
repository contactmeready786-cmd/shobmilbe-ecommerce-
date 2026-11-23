// POST /api/cart-reminder — the cart changed (lib/api/shop-actions.ts cartReminder)
// GET  /api/cart-reminder?t=… — the reminder link's products (lib/api/shop-read.ts cartRestore)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { cartReminder } from '@/lib/api/shop-actions';
import { cartRestore } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(cartReminder, { quiet: true });
export const GET = apiRoute(cartRestore);
export { otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// POST /api/checkout-otp/status | send | smscheck | verify — the checkout's SMS code (lib/api/checkout.ts checkoutOtp)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { checkoutOtp } from '@/lib/api/checkout';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(checkoutOtp);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// POST /api/want — "এই পণ্যটা খুঁজে দিন" (lib/api/shop-actions.ts want)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { want } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(want);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

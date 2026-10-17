// GET /api/for-you — the "আপনার জন্য" picks
import { apiRoute, otherMethods } from '@/lib/next/api';
import { forYou } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(forYou);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

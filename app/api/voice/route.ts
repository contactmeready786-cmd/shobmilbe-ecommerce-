// POST /api/voice — lib/api/shop-actions.ts (voice): a customer's voice message
import { apiRoute, otherMethods } from '@/lib/next/api';
import { voice } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(voice);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

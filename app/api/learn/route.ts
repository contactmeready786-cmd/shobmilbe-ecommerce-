// POST /api/learn — the AI teacher on the free electronics class pages — lib/api/learn.ts (ask)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { ask } from '@/lib/api/learn';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(ask);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// GET /api/app/inbox — the Android app's inbox
import { apiRoute, otherMethods } from '@/lib/next/api';
import { appInbox } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(appInbox);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

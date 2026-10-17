// GET /api/resume?id=… — the reminder SMS link's checkout
import { apiRoute, otherMethods } from '@/lib/next/api';
import { resume } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(resume);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

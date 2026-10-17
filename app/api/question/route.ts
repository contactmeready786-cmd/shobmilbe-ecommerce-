// POST /api/question — lib/api/shop-actions.ts (question)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { question } from '@/lib/api/shop-actions';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(question);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

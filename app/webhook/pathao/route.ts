// POST /webhook/pathao — the courier's status updates (lib/api/payments.ts)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { pathao } from '@/lib/api/payments';

export const dynamic = 'force-dynamic';
export const POST = apiRoute(pathao);
export { otherMethods as GET, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

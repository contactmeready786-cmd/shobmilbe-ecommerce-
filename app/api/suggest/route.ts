// GET /api/suggest?ids=… — products bought together with the cart's
import { apiRoute, otherMethods } from '@/lib/next/api';
import { suggest } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(suggest);
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

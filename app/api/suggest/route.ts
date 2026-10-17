// GET /api/suggest?ids=… — products bought together with the cart's
import { apiRoute } from '@/lib/next/api';
import { suggest } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(suggest);

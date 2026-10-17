// GET /api/cards?ids=… — product cards for recently viewed
import { apiRoute } from '@/lib/next/api';
import { cards } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(cards);

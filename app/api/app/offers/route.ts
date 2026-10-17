// GET /api/app/offers — the Android app's new-offer check
import { apiRoute } from '@/lib/next/api';
import { appOffers } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(appOffers);

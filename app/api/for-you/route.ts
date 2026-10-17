// GET /api/for-you — the "আপনার জন্য" picks
import { apiRoute } from '@/lib/next/api';
import { forYou } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(forYou);

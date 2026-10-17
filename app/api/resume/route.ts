// GET /api/resume?id=… — the reminder SMS link's checkout
import { apiRoute } from '@/lib/next/api';
import { resume } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(resume);

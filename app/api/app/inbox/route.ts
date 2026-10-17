// GET /api/app/inbox — the Android app's inbox
import { apiRoute } from '@/lib/next/api';
import { appInbox } from '@/lib/api/shop-read';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(appInbox);

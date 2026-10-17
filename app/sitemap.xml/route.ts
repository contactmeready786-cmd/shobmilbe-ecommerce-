// /sitemap.xml — every page for Google (lib/api/files.ts)
import { apiRoute } from '@/lib/next/api';
import { sitemap } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
const answer = apiRoute(sitemap);
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };

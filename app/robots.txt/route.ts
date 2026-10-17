// /robots.txt — what search engines may read (lib/api/files.ts)
import { apiRoute } from '@/lib/next/api';
import { robots } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
const answer = apiRoute(robots, { bots: false });
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };

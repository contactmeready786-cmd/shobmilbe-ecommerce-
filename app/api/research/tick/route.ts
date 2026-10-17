// /api/research/tick — market research and the shop's small scheduled jobs (lib/api/files.ts)
import { apiRoute } from '@/lib/next/api';
import { researchTick } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const answer = apiRoute(researchTick);
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };

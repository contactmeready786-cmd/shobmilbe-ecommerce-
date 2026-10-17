// /unsubscribe?t=… — leave the offer e-mail list (lib/api/files.ts)
import { apiRoute } from '@/lib/next/api';
import { unsubscribe } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
const answer = apiRoute(unsubscribe);
export { answer as GET, answer as POST, answer as PUT, answer as PATCH, answer as DELETE, answer as OPTIONS, answer as HEAD };

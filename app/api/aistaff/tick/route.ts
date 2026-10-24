// /api/aistaff/tick — 🤖 AI স্টাফ's scheduled work (lib/api/files.ts aistaffTick)
import { apiRoute, otherMethods } from '@/lib/next/api';
import { aistaffTick } from '@/lib/api/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = apiRoute(aistaffTick, { bots: false });
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

// GET /api/social-video-jobs — the products waiting for a YouTube / TikTok video (lib/api/socialvideo.ts; read by
// .github/workflows/social-video.yml). Only product pictures and prices the shop shows anyway.
import { apiRoute, otherMethods } from '@/lib/next/api';
import { socialVideoJobs } from '@/lib/api/socialvideo';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(socialVideoJobs, { bots: false });
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

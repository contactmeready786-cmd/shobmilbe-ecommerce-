// GET /api/whiten-jobs — the pictures waiting for the cloud AI (lib/models/whitencloud.ts; read by
// .github/workflows/whiten-cloud.yml). Only product pictures the shop shows anyway; nothing can be sent back here.
import { apiRoute, otherMethods } from '@/lib/next/api';
import { whitenJobs } from '@/lib/api/whitenjobs';

export const dynamic = 'force-dynamic';
export const GET = apiRoute(whitenJobs, { bots: false });
export { otherMethods as POST, otherMethods as PUT, otherMethods as PATCH, otherMethods as DELETE, otherMethods as OPTIONS, otherMethods as HEAD };

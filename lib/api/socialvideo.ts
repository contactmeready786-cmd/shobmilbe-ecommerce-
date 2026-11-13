// GET /api/social-video-jobs (app/api/social-video-jobs): the products that need a short video for YouTube / TikTok
// (lib/services/social.ts videoJobs; read by .github/workflows/social-video.yml). Only what the shop shows anyway —
// the product picture, its price and name. Nothing can be sent back here: the shop fetches finished videos itself.
import * as social from '../services/social';
import { json, type ApiCtx } from '../next/api';

export async function socialVideoJobs(ctx: ApiCtx) {
  const jobs = await social.videoJobs(ctx.settings).catch(() => []);
  return json(200, { jobs });
}

// GET /api/whiten-jobs (app/api/whiten-jobs): what the cloud AI should do — the waiting white-background jobs and the
// product pictures the picture-recognition AI hasn't described yet. Finished descriptions are copied in first.
import * as cloud from '../models/whitencloud';
import * as recognize from '../models/recognize';
import { json, type ApiCtx } from '../next/api';

export async function whitenJobs(ctx: ApiCtx) {
  const base = ctx.settings.site_url || `${ctx.url.protocol}//${ctx.url.host}`;
  await recognize.importCloud(cloud.RAW, String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || ctx.url.host)).catch(() => 0);
  const [jobs, emb] = await Promise.all([cloud.waiting(base), recognize.cloudWaiting(base)]);
  return json(200, { jobs, emb });
}

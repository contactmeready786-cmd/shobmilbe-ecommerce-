// GET /api/whiten-jobs (app/api/whiten-jobs): the waiting white-background jobs for the cloud AI.
import * as cloud from '../models/whitencloud';
import { json, type ApiCtx } from '../next/api';

export async function whitenJobs(ctx: ApiCtx) {
  const base = ctx.settings.site_url || `${ctx.url.protocol}//${ctx.url.host}`;
  return json(200, { jobs: await cloud.waiting(base) });
}

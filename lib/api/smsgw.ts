// POST /api/smsgw/pair | pull | report — the shop's own SMS app on the owner's phone (services/smsgw.ts, android-sms/).
//   pair   { code, model }                     → { key }        (the 6-digit code from Admin → SMS, once)
//   pull   { battery, charging, model, app }   → { messages: [{ id, phone, body }] }   (waits up to 25 s)
//   report { results: [{ id, state, error }] } → { ok }
// pull / report carry "Authorization: Bearer <key>". A wrong key or code is counted per connection and slowed down.
import { allow, json, tooMany, type ApiCtx } from '../next/api';
import * as GW from '../services/smsgw';

export async function smsgw(ctx: ApiCtx): Promise<Response> {
  const action = ctx.path.split('/').pop();
  const b = await ctx.body();
  if (action === 'pair') {
    // a 6-digit code lives 15 minutes and works once: 20 tries per connection and 60 in all per 15 minutes can't guess it
    if (!(await allow(ctx, 'smsgw-pair2:', 20, 900)) || !(await GW.pairBudget())) return tooMany(ctx);
    const key = await GW.pair(b.code, b.model);
    if (!key) return json(403, { error: 'কোডটা মেলেনি বা সময় পেরিয়ে গেছে — অ্যাডমিন থেকে নতুন কোড নিন' });
    return json(200, { key, shop: String(ctx.settings.store_name || '') });
  }
  if (action !== 'pull' && action !== 'report') return json(404, { error: 'not found' });
  const auth = String(ctx.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!GW.keyOk(ctx.settings, auth)) {
    if (!(await allow(ctx, 'smsgw-key:', 30, 600))) return tooMany(ctx);
    return json(401, { error: 'unpaired' });
  }
  // the owner chose another SMS company (or switched SMS off): the phone just waits, nothing is handed out
  const on = ctx.settings.sms_on === '1' && ctx.settings.sms_provider === 'ownapp';
  if (action === 'report') return json(200, { ok: true, n: await GW.report(b.results) });
  const messages = await GW.pull({ battery: b.battery, charging: b.charging, model: b.model, app: b.app }, on ? undefined : 0);
  if (!on && !messages.length) await new Promise((r) => setTimeout(r, 20_000)); // switched off: don't let it spin
  return json(200, { messages, on });
}

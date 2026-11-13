// ⏱️ The shop's own timer (owner, 2026-11-13). On Vercel the background jobs were woken from outside: Vercel's cron and
// an "hourly" GitHub workflow. On the VPS only GitHub was left — and GitHub starts that workflow just three or four
// times a day (its timers are best-effort), so the day's Facebook post was often missed, "দাম কত?" comments waited
// hours for an answer, and the new platforms' posts and the backup clean-up would have been just as late.
// The VPS is always on, so the shop now wakes itself:
//   • every 5 minutes: runShopJobs  (posts at the owner's hours, comment answers, e-mails, backup, research …)
//   • every 15 minutes: runAiJobs   (AI staff report, product texts, Bangla names, duplicate count)
// Each job still decides itself whether it is due and claims its slot in the database, so GitHub's spare wake-up
// (/api/research/tick) can never double anything. Started once from instrumentation.ts — only on the real server:
// not while building, not in tests / CI, not on Vercel.
import * as db from './db';
import * as cache from './cache';
import type { Settings } from './types';

const SHOP_EVERY = 5 * 60e3;
const AI_EVERY = 15 * 60e3;
type State = { started: boolean; running: Set<string>; last: Record<string, number> };
const g = globalThis as unknown as { __smScheduler?: State };

export function shouldStart(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'production' && !env.CI && !env.VERCEL && env.NEXT_PHASE !== 'phase-production-build' && env.SHOP_SCHEDULER !== '0';
}

async function round(name: string, fn: (settings: Settings) => Promise<unknown>) {
  const st = g.__smScheduler!;
  if (st.running.has(name)) return; // the last round is still going
  st.running.add(name);
  try {
    await db.ensureReady();
    cache.clearAll();
    await cache.runFresh(async () => { await fn(await db.getSettings()); });
    st.last[name] = Date.now();
  } catch (e) { console.error('scheduler', name, (e as Error).message); } finally { st.running.delete(name); cache.clearAll(); }
}

export function start() {
  if (g.__smScheduler?.started || !shouldStart()) return false;
  g.__smScheduler = { started: true, running: new Set(), last: {} };
  const shop = () => round('shop', async (s) => { await (await import('./api/files')).runShopJobs(s); });
  const ai = () => round('ai', async (s) => { await (await import('./api/files')).runAiJobs(s); });
  setTimeout(shop, 60e3).unref(); // a minute after the start, so a fresh deploy answers customers first
  setInterval(shop, SHOP_EVERY).unref();
  setTimeout(() => { ai(); setInterval(ai, AI_EVERY).unref(); }, 4 * 60e3).unref();
  return true;
}
/** when the shop's own timer last finished a round (for Admin → সার্ভার ও ডাটাবেস) */
export function status() { return { on: !!g.__smScheduler?.started, last: { ...(g.__smScheduler?.last || {}) } }; }

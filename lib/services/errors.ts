// Error reporting. The shop code calls report(); where the error goes is plugged in at start-up
// (sentry.server.config.ts hands in a starter for Sentry). The Sentry key (DSN) is set by the owner in ONE place:
// Admin → সেটিংস → আমার নোটিফিকেশন (setting sentry_dsn). SENTRY_DSN in Vercel, if ever set, wins.
// Without a key, errors are only logged.
type Reporter = (error: unknown, context?: Record<string, unknown>) => void;
type Starter = (dsn: string) => Reporter | null;
let reporter: Reporter | null = null;
let starter: Starter | null = null;
let activeDsn = '';
let flusher: ((ms: number) => Promise<unknown>) | null = null;
let unsent = false;
// the site's own error log (services/health.ts → error_log), so the owner sees failing pages even without Sentry
let store: Reporter | null = null;
export function setStore(fn: Reporter | null): void { store = fn; }

export function setReporter(fn: Reporter | null): void { reporter = fn; }
/** How to send waiting reports right away (Vercel may pause the server as soon as the answer is sent). */
export function setFlusher(fn: ((ms: number) => Promise<unknown>) | null): void { flusher = fn; }
/** Called at the end of a request: if something was reported, wait (max ms) until it has gone out. */
export async function flush(ms = 2000): Promise<void> {
  if (!unsent || !flusher) return;
  unsent = false;
  try { await flusher(ms); } catch { /* never break a page */ }
}
/** Called once by sentry.server.config.ts: how to switch Sentry on for a DSN ('' = off). */
export function setStarter(fn: Starter | null): void { starter = fn; activeDsn = ''; }

export const DSN_RE = /^https:\/\/[A-Za-z0-9]{8,64}@[A-Za-z0-9.-]*sentry\.io\/\d{1,20}$/;
export function validDsn(v: unknown): boolean { return DSN_RE.test(String(v || '').trim()); }

/** The key to use: Vercel's SENTRY_DSN if set, else the one saved in the admin. */
type HasDsn = { sentry_dsn?: unknown } | Record<string, unknown> | null | undefined;
export function dsnFrom(settings: HasDsn): string {
  const env = String(process.env.SENTRY_DSN || '').trim();
  if (env) return env;
  const v = String((settings as { sentry_dsn?: unknown } | null | undefined)?.sentry_dsn || '').trim();
  return validDsn(v) ? v : '';
}

/** Cheap check on every request: start, change or stop Sentry when the saved key changed. */
export function ensure(settings: HasDsn): void {
  if (!starter) return;
  const dsn = dsnFrom(settings);
  if (dsn === activeDsn) return;
  activeDsn = dsn;
  try { reporter = starter(dsn); } catch (e) { console.error('Sentry start failed', e); reporter = null; }
}
export function isOn(): boolean { return !!reporter; }

export function report(error: unknown, context?: Record<string, unknown>): void {
  console.error(error);
  if (store) { try { store(error, context); } catch { /* never break a page */ } }
  if (!reporter) return;
  try { reporter(error, context); unsent = true; } catch { /* reporting must never break a page */ }
}

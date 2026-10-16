// Error reporting. The shop code calls report(); where the error goes is plugged in once at start-up
// (instrumentation.ts hands in Sentry when SENTRY_DSN is set). Without a reporter, errors are only logged.
type Reporter = (error: unknown, context?: Record<string, unknown>) => void;
let reporter: Reporter | null = null;

export function setReporter(fn: Reporter | null): void { reporter = fn; }

export function report(error: unknown, context?: Record<string, unknown>): void {
  console.error(error);
  if (!reporter) return;
  try { reporter(error, context); } catch { /* reporting must never break a page */ }
}

// Runs once when a server instance starts (Next.js instrumentation hook).
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
}

// Errors thrown while Next.js renders a page or runs a route are reported too (only when SENTRY_DSN is set).
export const onRequestError = Sentry.captureRequestError;

// Sentry (error alerts) for the server. The owner pastes the key (DSN, from sentry.io → Project → Client Keys)
// once in Admin → সেটিংস → আমার নোটিফিকেশন; lib/services/errors.ts starts Sentry with it on the next request.
// (SENTRY_DSN in Vercel → Environment Variables also works and wins.) Without a key nothing is sent.
import * as Sentry from '@sentry/nextjs';
import { setStarter, setFlusher, ensure } from './lib/services/errors';

function start(dsn: string) {
  if (!dsn) {
    Promise.resolve(Sentry.getClient()?.close()).catch(() => {});
    return null;
  }
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // errors only — no performance tracing, so the free plan's monthly allowance goes to real problems
    tracesSampleRate: 0,
    // customers' details stay in the shop: cookies, IP addresses and form contents are removed before sending
    beforeSend(event) {
      if (event.user) delete event.user.ip_address;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) if (/cookie|authorization|x-real-ip|forwarded/i.test(h)) delete event.request.headers[h];
        }
      }
      return event;
    },
  });
  return (error: unknown, context?: Record<string, unknown>) => { Sentry.captureException(error, context ? { extra: context } : undefined); };
}

setStarter(start);
setFlusher((ms) => Sentry.flush(ms));
ensure(null); // a SENTRY_DSN set in Vercel starts at once; the admin's key starts with the first request

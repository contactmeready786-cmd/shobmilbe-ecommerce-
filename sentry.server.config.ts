// Sentry (error alerts) for the server. Switched on only when SENTRY_DSN is set in Vercel → Settings →
// Environment Variables (the DSN comes from sentry.io → Project → Client Keys). Without it nothing is sent.
import * as Sentry from '@sentry/nextjs';
import { setReporter } from './lib/services/errors';

const dsn = process.env.SENTRY_DSN || '';
if (dsn) {
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
  setReporter((error, context) => { Sentry.captureException(error, context ? { extra: context } : undefined); });
}

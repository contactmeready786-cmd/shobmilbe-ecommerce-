// 📮 The customer forms as Next.js route handlers (lib/shopx.tsx holds what each one does). formRoute() wraps one of
// them the way the original router (lib/site.ts) did for these addresses, so every answer stays exactly the same:
//  • the shop's front gate first (lib/gate.ts: database ready, blocked IPs, hacking checks, country lock, bots),
//  • a form that changes something reads fresh data and empties the 15-second memory before and after (lib/cache.ts),
//  • answers are whole shop pages (the shop's frame around them, drawn as text), redirects or the shop's 404 page,
//  • something that breaks is reported (Sentry) and answered with the shop's "something went wrong" page.
// The address the visitor really asked for comes from proxy.ts (x-shop-url, always overwritten there, so it can't be
// faked): forms sent to an address that also has a Next.js page are handed to these routes under /api/forms/….
import * as security from '../security';
import * as cache from '../cache';
import * as errors from '../services/errors';
import * as catalog from '../models/catalog';
import * as content from '../models/content';
import * as shop from '../views/shop';
import { shopGate } from '../gate';
import { shopLayout } from '../views/layout';
import { loadRenderer } from '../react/render';
import { Reply, type HeaderMap, type ReplyBody } from '../reply';
import type { ReactNode } from 'react';
import type { PageOpts } from '../shop/router';
import type { Settings, ShopRequest } from '../types';

/** What one customer form gets: the request as the shop's helpers read it, and the three ways of answering. */
export type FormCtx = {
  req: ShopRequest;
  reply: Reply;
  /** the address the visitor asked for (decoded, no trailing slash) */
  path: string;
  method: string;
  query: URLSearchParams;
  settings: Settings;
  ip: string;
  /** a whole shop page with this title and body */
  page: (title: string, body: ReactNode, opts?: PageOpts) => void;
  /** the shop's own "not found" page */
  notFound: () => void;
  /** "see other" to another address (a form's usual answer), with extra headers such as Set-Cookie */
  redirect: (to: string, extra?: HeaderMap) => void;
};

// the same answer the original code gives when something breaks (lib/site.ts)
const ERROR_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>';

/** The address the visitor asked for: proxy.ts's x-shop-url, else the request's own. */
export function askedFor(request: Request): URL {
  const url = new URL(request.url);
  const original = request.headers.get('x-shop-url');
  return original ? new URL(original, url.origin) : url;
}

/** The shop's path rules (lib/site.ts): decoded, and no slash at the end. */
export function shopPath(url: URL): string {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** Turns one customer form (lib/shopx.tsx) into a Next.js route handler. */
export function formRoute(fn: (f: FormCtx) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    const url = askedFor(request);
    const path = shopPath(url);
    const method = request.method;
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const req: ShopRequest = {
      url: url.pathname + url.search, method, headers,
      socket: { remoteAddress: headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1' },
      __body: method === 'GET' || method === 'HEAD' ? '' : await request.text(),
    };
    const reply = new Reply();
    const send = (status: number, body: ReplyBody, type = 'text/html; charset=utf-8', extra: HeaderMap = {}) =>
      reply.answer(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...extra }, body);

    const gate = await shopGate(req, path, url.search, method);
    if (!gate.ok) {
      send(gate.status, gate.body, gate.type, gate.headers);
      return reply.toResponse();
    }
    const settings = gate.settings;
    await loadRenderer(); // the answers here are whole pages drawn as text (lib/react/render.tsx)

    const run = async () => {
      const [categories, pages, popups] = await Promise.all([
        catalog.listCategories({ includeInactive: false }), content.listPages({ active: true }), content.listBanners({ active: true, placement: 'popup' }),
      ]);
      const page: FormCtx['page'] = (title, body, opts = {}) => send(opts.status || 200,
        shopLayout({ settings, title, body, categories, pages, popup: popups[0] || null, ...opts }));
      const ctx: FormCtx = {
        req, reply, path, method, query: url.searchParams, settings, ip: security.clientIp(req), page,
        notFound: () => page('পাওয়া যায়নি', shop.notFound(), { status: 404, noindex: true }),
        redirect: (to, extra = {}) => reply.answer(303, { Location: to, 'Cache-Control': 'no-store', ...extra }),
      };
      await fn(ctx);
      if (!reply.answered) ctx.notFound(); // (every form answers; this only guards against a forgotten answer)
    };

    // a form that changes something reads fresh data and empties the short-lived memory before and after
    const changes = method !== 'GET' && method !== 'HEAD';
    try {
      if (!changes) await run();
      else {
        cache.clearAll();
        try { await cache.runFresh(run); } finally { cache.clearAll(); }
      }
    } catch (e) {
      errors.report(e, { path, method });
      if (!reply.answered) send(500, ERROR_PAGE);
    } finally {
      await errors.flush(); // an error reported to Sentry goes out before the server may be paused
    }
    return reply.toResponse();
  };
}

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
import { Reply, type HeaderMap } from '../reply';
import { answers, askedFor, shopPath, shopRequest, ERROR_PAGE } from './answers';
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

/** Turns one customer form (lib/shopx.tsx) into a Next.js route handler. */
export function formRoute(fn: (f: FormCtx) => Promise<unknown>) {
  return async (request: Request): Promise<Response> => {
    const url = askedFor(request);
    const path = shopPath(url);
    const method = request.method;
    const req = await shopRequest(request, url);
    const reply = new Reply();
    const { send, redirect } = answers(reply);

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
        redirect,
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

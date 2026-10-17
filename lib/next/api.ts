// 🔌 The shop's small JSON APIs as Next.js route handlers (app/api/…/route.ts). apiRoute() runs the same front gate as
// every shop page first (lib/gate.ts: database ready, blocked IPs, hacking checks, country lock, blocked bots) and
// hands the handler what it needs; answers carry the shop's security headers, as they always did.
import * as db from '../db';
import * as security from '../security';
import * as guard from '../services/guard';
import * as errors from '../services/errors';
import { shopGate } from '../gate';
import { parseBody } from '../util';
import type { Body, Settings, ShopRequest } from '../types';

export type ApiCtx = {
  request: Request; url: URL; path: string; query: URLSearchParams; settings: Settings; ip: string;
  /** a Node-style request for the shop's helpers that read headers / cookies (accounts, my-orders list) */
  req: ShopRequest;
  /** the form or JSON that came with it */
  body: () => Promise<Body>;
};

// the same answer the original code gives when something breaks
const ERROR_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>';
const JSON_TYPE = 'application/json; charset=utf-8';

/** A JSON answer (never kept by the browser unless the caller says so). */
export function json(status: number, data: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...extra } });
}

/** Too many tries from one connection: noted for the security watch, and a "wait a little" answer. */
export function tooMany(ctx: ApiCtx): Response {
  guard.record({ req: ctx.req, kind: 'flood', path: ctx.path.slice(0, 200) }).catch(() => {});
  return json(429, { error: 'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' }, { 'Retry-After': '120' });
}

/** At most `max` calls per `seconds` from this connection for `key` (lib/security hit). */
export const allow = (ctx: ApiCtx, key: string, max: number, seconds: number) => security.hit(db, key + ctx.ip, max, seconds);

export function apiRoute(fn: (ctx: ApiCtx) => Promise<Response>, opts: { bots?: boolean } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    const req = { headers, url: url.pathname + url.search, method: request.method, socket: { remoteAddress: headers['x-real-ip'] || '' }, __body: text } as unknown as ShopRequest;
    const gate = await shopGate(req, path, url.search, request.method, opts);
    if (!gate.ok) return new Response(gate.body, { status: gate.status, headers: { 'Content-Type': gate.type, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...gate.headers } });
    const ctx: ApiCtx = { request, url, path, query: url.searchParams, settings: gate.settings, ip: security.clientIp(req), req, body: () => parseBody(req) };
    try {
      return await fn(ctx);
    } catch (e) {
      errors.report(e, { path, method: request.method });
      await errors.flush(); // goes out before the server may be paused
      return new Response(ERROR_PAGE, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...security.BASE_HEADERS } });
    }
  };
}

/** Any other way of asking (OPTIONS, HEAD, a form sent where only GET is meant): the original code's answer, as always. */
export async function otherMethods(request: Request): Promise<Response> {
  const { handleWithLegacy } = await import('../../src/legacy/bridge');
  const url = new URL(request.url);
  return handleWithLegacy(request, url.pathname + url.search);
}

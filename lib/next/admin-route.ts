// 🔐 The admin's forms (POST), /admin/api, its files and exports, and any admin address the Next.js admin page
// doesn't draw (lib/next/admin.ts sends those here with ?__site=1): a Next.js route handler (app/api/admin).
// proxy.ts hands these requests here with the address the visitor asked for (x-shop-url). The admin's own code
// (lib/admin: login, two-step login, permissions, the forms) answers them, after the same front checks as always:
//  • the database is there, • the customer Android app never opens the admin, • the admin opens only from
//  Bangladesh (+ countries the owner opened for a trip), • blocked bots get nothing,
// and only scripts carrying this answer's nonce may run on an admin page (lib/security.ts).
import * as db from '../db';
import * as security from '../security';
import * as cache from '../cache';
import * as guard from '../services/guard';
import * as errors from '../services/errors';
import * as geolock from '../services/geolock';
import * as admin from '../admin';
import { backgroundTick, blockedBots } from '../gate';
import { loadRenderer } from '../react/render';
import { Reply, type HeaderMap, type ReplyBody } from '../reply';
import { answers, askedFor, shopPath, shopRequest, setupErrorPage, verificationFile, ERROR_PAGE } from './answers';
import type { Base } from '../types';

// the customer Android app never shows the admin panel (that is the separate admin app's job)
const NOT_IN_THE_APP = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>সবমিলবে</title><body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#14213d"><div style="font-size:48px">🛍️</div><h2>এই পেজটা এখানে খোলে না</h2><p style="color:#5b6475">কেনাকাটা চালিয়ে যান।</p><p><a href="/" style="display:inline-block;background:#0866D6;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold">হোমে যান</a></p></body>';

/** Is this an admin address? */
export const isAdminPath = (path: string) => path === '/admin' || path.startsWith('/admin/');

/** Answers one admin request (the Web Request Next.js gives app/api/admin). */
export async function adminAnswer(request: Request): Promise<Response> {
  const url = askedFor(request);
  const path = shopPath(url);
  // only admin addresses come here (proxy.ts); this route opened directly is not one
  if (!isAdminPath(path)) return new Response('Not found', { status: 404 });
  const method = request.method;
  const query = url.searchParams;
  const req = await shopRequest(request, url);
  const reply = new Reply();
  const { send, json, redirect } = answers(reply);
  await loadRenderer(); // the admin's answers here are text (lib/react/render.tsx)

  const run = async () => {
    try {
      await db.ensureReady();
    } catch (e) {
      console.error('Database setup failed:', e);
      return send(503, setupErrorPage(e));
    }
    try {
      const settings = await db.getSettings();
      errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
      const nonce = security.startNonce(); // only our own admin <script> tags may run (lib/security.ts)
      const adminSend = (status: number, body: ReplyBody, type?: string, extra: HeaderMap = {}) => send(status, body, type, { ...security.adminHeaders(nonce), ...extra });

      if (/ShobmilbeApp\//.test(String(req.headers['user-agent'] || ''))) {
        return send(403, NOT_IN_THE_APP, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      }
      // 🔐 the admin panel opens only from Bangladesh (+ countries the owner opened for a trip, until its last day)
      const shutCountry = geolock.adminBlocked(req, settings);
      if (shutCountry) {
        geolock.count(shutCountry, 'admin');
        guard.record({ req, kind: 'probe', path: ('অ্যাডমিন (দেশ বন্ধ): ' + path).slice(0, 200) }).catch(() => {});
        return send(404, geolock.adminBlockedPage(), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
      }
      // small jobs that must run now and then (Vercel's own schedule runs only once a day)
      if (method === 'GET') backgroundTick(req, settings);
      // tools that ignore robots.txt: the blocked spy / copier bots get nothing at all
      const ua = String(req.headers['user-agent'] || '');
      if (ua) {
        const bad = blockedBots(settings);
        if (bad.length && bad.some((b) => ua.toLowerCase().includes(b.toLowerCase()))) return send(403, 'Forbidden', 'text/plain', { 'X-Robots-Tag': 'noindex' });
      }
      if (verificationFile(path, settings, reply)) return;
      const base: Base = { req, reply, path, method, query, settings, send: adminSend, json, redirect };
      return await admin.handle(base);
    } catch (e) {
      errors.report(e, { path, method });
      return send(500, ERROR_PAGE);
    }
  };

  try {
    // admin pages and changes always read fresh data; a change empties the 15-second memory before and after (lib/cache.ts)
    const changes = method !== 'GET' && method !== 'HEAD';
    if (changes) cache.clearAll();
    try { await cache.runFresh(run); } finally { if (changes) cache.clearAll(); }
    // (an answer is always given; this only waits if a handler gave it a moment after returning)
    if (!reply.answered) await Promise.race([reply.done, new Promise((r) => setTimeout(r, 55_000))]);
  } catch (e) {
    console.error('admin handler failed', e);
  } finally {
    await errors.flush(); // an error reported to Sentry goes out before the server may be paused
  }
  return reply.answered ? reply.toResponse() : new Response('Server error', { status: 500 });
}

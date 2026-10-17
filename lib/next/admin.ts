// ⚛️ The Next.js side of the admin panel: runs the admin's own page code (lib/admin — the same code the original router
// runs) for the address being visited and keeps the page's pieces, so app/(admin) can draw them inside the React frame.
// Loaded once per visit (React cache) and shared by the frame, the head and the page.
//
// An admin page that answers with something other than a page — a redirect, a file, a status other than 200 — is
// answered as follows: a plain redirect goes there; anything else is sent to the original code (proxy.ts sends
// ?__site=1 there), which answers it exactly as before. proxy.ts already sends the addresses known to be files.
import { cache } from 'react';
import { headers } from 'next/headers';
import * as admin from '../admin';
import * as security from '../security';
import * as db from '../db';
import { runFresh } from '../cache';
import { Reply } from '../reply';
import type { AdminDrawn, Base, Loose, ShopRequest } from '../types';

export type AdminOutcome =
  | ({ kind: 'page'; nonce: string } & AdminDrawn)
  | { kind: 'redirect'; location: string }
  | { kind: 'site' };

/** The marker proxy.ts looks for: "let the original code answer this one". */
export const SITE_MARK = '__site';

export const currentAdminPage = cache(async (): Promise<AdminOutcome> => {
  const h = await headers();
  const plain: Record<string, string> = {};
  h.forEach((v: string, k: string) => { plain[k] = v; });
  const url = new URL(plain['x-shop-url'] || '/admin', 'http://local');
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const nonce = plain['x-nonce'] || '';
  // admin pages always read fresh from the database (lib/cache.ts), so what the owner saved shows at once
  const settings = await runFresh(() => db.getSettings());

  let out: AdminOutcome = { kind: 'site' };
  const req: ShopRequest = { headers: plain, url: url.pathname + url.search, method: 'GET', socket: { remoteAddress: plain['x-real-ip'] || '' } };
  // a page that sets a cookie or answers with a file (reply.answer) is left to lib/site.ts
  const reply = new Reply();
  const base: Base = {
    req, reply, path, method: 'GET', query: url.searchParams as Loose, settings,
    send: () => { out = { kind: 'site' }; },
    json: () => { out = { kind: 'site' }; },
    redirect: (to, extra) => { out = extra && Object.keys(extra).length ? { kind: 'site' } : { kind: 'redirect', location: String(to) }; },
    drawPage: (p) => { out = p.status === 200 ? { kind: 'page', nonce, ...p } : { kind: 'site' }; },
  };
  try {
    await runFresh(() => security.withNonce(nonce, () => admin.handle(base)));
  } catch (e) {
    // a page the Next.js side can't draw yet (e.g. it needs its HTML as text): the original code answers it
    console.error('admin page via lib/site.ts:', path, (e as Error).message, String((e as Error).stack || '').split('\n').slice(1, 7).map((l) => l.trim()).join(' < '));
    return { kind: 'site' };
  }
  const done = out as AdminOutcome; // (set by the callbacks above)
  if (reply.answered) return { kind: 'site' };
  return reply.get('set-cookie') !== undefined && done.kind === 'page' ? { kind: 'site' } : done;
});

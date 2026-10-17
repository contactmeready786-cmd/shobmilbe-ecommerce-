// ⚛️ The Next.js side of the admin panel: runs the admin's own page code (lib/admin — the same code the original router
// runs) for the address being visited and keeps the page's pieces, so app/(admin) can draw them inside the React frame.
// Loaded once per visit (React cache) and shared by the frame, the head and the page.
//
// An admin page that answers with something other than a page — a redirect, a file, a status other than 200 — is
// answered as follows: a plain redirect goes there; anything else is sent to the original code (proxy.ts sends
// ?__legacy=1 there), which answers it exactly as before. proxy.ts already sends the addresses known to be files.
import { cache } from 'react';
import { headers } from 'next/headers';
import * as admin from '../admin';
import * as security from '../security';
import { getSettings } from './shop-data';
import type { AdminDrawn, Base, Loose, ShopRequest, ShopResponse } from '../types';

export type AdminOutcome =
  | ({ kind: 'page'; nonce: string } & AdminDrawn)
  | { kind: 'redirect'; location: string }
  | { kind: 'legacy' };

/** The marker proxy.ts looks for: "let the original code answer this one". */
export const LEGACY_MARK = '__legacy';

export const currentAdminPage = cache(async (): Promise<AdminOutcome> => {
  const h = await headers();
  const plain: Record<string, string> = {};
  h.forEach((v: string, k: string) => { plain[k] = v; });
  const url = new URL(plain['x-shop-url'] || '/admin', 'http://local');
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const nonce = plain['x-nonce'] || '';
  const settings = await getSettings();

  let out: AdminOutcome = { kind: 'legacy' };
  let cookie = false;
  const req = { headers: plain, url: url.pathname + url.search, method: 'GET', socket: { remoteAddress: plain['x-real-ip'] || '' } } as unknown as ShopRequest;
  const res = {
    headersSent: false,
    setHeader(k: string) { if (/^set-cookie$/i.test(k)) cookie = true; },
    getHeader() { return undefined; },
    writeHead() { return this; },
    end() {},
  } as unknown as ShopResponse;
  const base: Base = {
    req, res, path, method: 'GET', query: url.searchParams as Loose, settings,
    send: () => { out = { kind: 'legacy' }; },
    json: () => { out = { kind: 'legacy' }; },
    redirect: (_r, to, extra) => { out = extra && Object.keys(extra).length ? { kind: 'legacy' } : { kind: 'redirect', location: String(to) }; },
    drawPage: (p) => { out = p.status === 200 ? { kind: 'page', nonce, ...p } : { kind: 'legacy' }; },
  };
  try {
    await security.withNonce(nonce, () => admin.handle(base));
  } catch (e) {
    // a page the Next.js side can't draw yet (e.g. it needs its HTML as text): the original code answers it
    console.error('admin page via legacy:', path, (e as Error).message);
    return { kind: 'legacy' };
  }
  const done = out as AdminOutcome; // (set by the callbacks above)
  return cookie && done.kind === 'page' ? { kind: 'legacy' } : done;
});

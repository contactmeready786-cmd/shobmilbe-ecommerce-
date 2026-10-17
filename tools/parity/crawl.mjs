#!/usr/bin/env node
// Parity crawler: visits every page reachable from the shop and the admin panel (GET only) and saves
// a normalised copy of each, so the old and the new site can be compared page by page.
//
//   node tools/parity/crawl.mjs <base-url> <out-dir> [--login user:pass]
//
// Runs only against a LOCAL test server with test data. It never submits forms (no POST), never follows
// logout / delete links, and stays on the same host.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalise } from './normalise.mjs';

const [base, outDir, ...rest] = process.argv.slice(2);
if (!base || !outDir) { console.error('usage: crawl.mjs <base-url> <out-dir> [--login user:pass] [--setup]'); process.exit(2); }
const loginArg = rest.includes('--login') ? rest[rest.indexOf('--login') + 1] : '';
const doSetup = rest.includes('--setup');
const origin = new URL(base).origin;
fs.mkdirSync(outDir, { recursive: true });

let cookies = {};
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
function keepCookies(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
    if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) delete cookies[k]; else cookies[k] = v;
  }
}
async function get(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader(), 'user-agent': 'Mozilla/5.0 parity-crawler', 'accept-language': 'bn' } });
  keepCookies(res);
  return res;
}
async function post(url, form) {
  const res = await fetch(url, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(form),
    headers: { cookie: cookieHeader(), origin, referer: url, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 parity-crawler' },
  });
  keepCookies(res);
  return res;
}

const KEEP_HEADERS = ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cache-control', 'x-robots-tag', 'content-disposition'];
const SKIP = /\/(logout|delete|remove|purge|empty|destroy|clear|reset|cancel|unsubscribe)(\/|$|\?)|[?&](delete|remove|logout)=|^\/(__dbmove|api\/(backup|research)\/tick|webhook|pay\/)/i;
const fileFor = (u) => {
  const key = u.pathname + u.search;
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  return safe + '-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
};

async function main() {
  if (doSetup) {
    const r = await post(origin + '/admin/setup', { name: 'Test Owner', username: 'owner', password: 'Parity-Test-9271!', password2: 'Parity-Test-9271!' });
    console.error('setup ->', r.status, r.headers.get('location'));
  }
  if (loginArg) {
    const [u, p] = loginArg.split(':');
    const r = await post(origin + '/admin/login', { login: u, password: p });
    console.error('login ->', r.status, r.headers.get('location'));
  }
  const seeds = ['/', '/products', '/cart', '/checkout', '/wishlist', '/compare', '/track', '/blog', '/kits', '/live',
    '/account', '/gift-card', '/complaint', '/robots.txt', '/sitemap.xml', '/admin', '/product/arduino-uno-r3', '/order/TEST1001',
    ...fs.readFileSync(new URL('./seeds.txt', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/') && !SKIP.test(l))];
  const queue = seeds.map((s) => new URL(s, origin).href);
  const seen = new Set(queue);
  // pages that differ only by query string (filters, page numbers) are capped per path, or the crawl never ends
  const perPath = {};
  const MAX_VARIANTS = Number(process.env.CRAWL_VARIANTS || 4);
  const allow = (n) => { const k = n.pathname; if (n.search && (perPath[k] = (perPath[k] || 0) + 1) > MAX_VARIANTS) return false; return true; };
  const index = [];
  const LIMIT = Number(process.env.CRAWL_LIMIT || 3000);
  while (queue.length && index.length < LIMIT) {
    const href = queue.shift();
    const u = new URL(href);
    let res;
    try { res = await get(href); } catch (e) { index.push({ path: u.pathname + u.search, status: 'ERR', error: String(e) }); continue; }
    const type = res.headers.get('content-type') || '';
    const loc = res.headers.get('location');
    const entry = { path: u.pathname + u.search, status: res.status, type: type.split(';')[0], location: loc ? normalise(loc) : undefined, headers: {} };
    // security and caching headers must stay exactly the same too
    for (const h of KEEP_HEADERS) { const v = res.headers.get(h); if (v) entry.headers[h] = normalise(v); }
    // Next.js says "never keep this page" in its own longer words: the same thing as no-store
    if (/no-store/.test(entry.headers['cache-control'] || '')) entry.headers['cache-control'] = 'no-store';
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) entry.headers['set-cookie'] = sc.map((c) => c.replace(/=[^;]*/, '=<v>').replace(/expires=[^;]*/i, 'expires=<d>')).sort().join(' | ');
    if (/^(text\/|application\/(json|xml|rss\+xml|ld\+json|javascript|manifest\+json))/.test(type)) {
      const body = await res.text();
      const file = fileFor(u);
      fs.writeFileSync(path.join(outDir, file + '.txt'), normalise(body));
      entry.file = file;
      if (/html/.test(type)) {
        for (const m of body.matchAll(/(?:href|action)="([^"#]+)"/g)) {
          let next;
          try { next = new URL(m[1].replace(/&amp;/g, '&'), href); } catch { continue; }
          if (next.origin !== origin || SKIP.test(next.pathname + next.search)) continue;
          if (/\.(css|js|png|jpe?g|webp|svg|ico|woff2?|json|webmanifest)$/i.test(next.pathname)) continue;
          next.hash = '';
          if (!seen.has(next.href) && allow(next)) { seen.add(next.href); queue.push(next.href); }
        }
      }
    } else { entry.bytes = (await res.arrayBuffer()).byteLength > 0; }
    if (loc) {
      try { const n = new URL(loc, href); if (n.origin === origin && !seen.has(n.href) && !SKIP.test(n.pathname)) { seen.add(n.href); queue.push(n.href); } } catch {}
    }
    index.push(entry);
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  console.error(`crawled ${index.length} pages, ${queue.length} left in queue`);
}
main().catch((e) => { console.error(e); process.exit(1); });

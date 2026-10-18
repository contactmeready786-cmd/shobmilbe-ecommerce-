// 🧭 The shop's own answers for addresses no Next.js page or route draws: the shop's 404 page, things that moved
// (redirects), a page switched off, the country-lock page and its "I'm at home" check, the verification files, and any
// other way of asking a shop route doesn't handle (lib/next/api.ts otherMethods). Served by app/api/site (proxy.ts and
// the fallback rewrite in next.config.ts send them there): siteAnswer() takes the Web Request and gives back a Web
// Response. (The admin's forms and files: lib/next/admin-route.ts. The customer forms: lib/shopx.tsx.)
import * as db from './db';
import * as catalog from './models/catalog';
import * as content from './models/content';
import * as guard from './services/guard';
import { shopLayout } from './views/layout';
import { resolveShop, type PageOpts } from './shop/router';
import { scoped } from './cache';
import * as shop from './views/shop';
import * as md from './views/md';
import { parseBody } from './util';
import * as security from './security';
import * as $services_geolock from './services/geolock';
import * as $shop_blog from './shop/blog';
import * as $shop_more from './shop/more';
import { ORDER_PAGE } from './shop/more';
import * as $services_errors from './services/errors';
import { siteUrl, blockedBots, backgroundTick, SITE_BLOCKED_PAGE, refCookie } from './gate';
import { Reply } from './reply';
import { loadRenderer } from './react/render';
import { answers, shopPath, tooMany, setupErrorPage, verificationFile, ERROR_PAGE } from './next/answers';
import type { ReactNode } from 'react';
import type { Body, Settings, ShopRequest } from './types';

const clientIp = security.clientIp;

// Shop pages may share 15-second copies; a request that changes something reads fresh data (lib/cache.ts).
const handler = scoped(handlerInner);
async function handlerInner(req: ShopRequest, reply: Reply) {
  const { send, json, redirect } = answers(reply);
  const url = new URL(req.url || '/', 'http://local');
  const path = shopPath(url);
  const method = req.method || 'GET';
  const query = url.searchParams;

  try {
    await db.ensureReady();
  } catch (e) {
    console.error('Database setup failed:', e);
    return send(503, setupErrorPage(e));
  }

  try {
    const settings = await db.getSettings();
    $services_errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
    const base = { req, reply, path, method, query, settings, send, json, redirect };

    // ---- security watch: IPs the owner shut out get nothing ----
    if (settings.guard_on !== '0') {
      if (await guard.siteBlocked(clientIp(req))) {
        return send(403, SITE_BLOCKED_PAGE, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
      }
      guard.inspect(req, path, url.search, settings);
    }

    // ---- 🌍 দেশ ব্লক: only the countries the owner ticked may open the shop (services/geolock.ts) ----
    const geo = $services_geolock;
    if (path === geo.BLOCK_PATH && method === 'GET') {
      const why = query.get('w') === 'tz' ? 'tz' : 'country';
      if (geo.config(settings).on) geo.count(geo.countryOf(req) || '??', why);
      return send(403, geo.blockedPage(settings, { country: geo.countryOf(req), why }), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
    }
    // a visitor whose own clock is in a ticked country (e.g. a Bangladeshi on a VPN) — only when the owner allows it
    if (path === geo.BLOCK_PATH + '/pass' && method === 'POST') {
      const c = geo.config(settings);
      const b: Body = await parseBody(req).catch(() => ({}));
      if (!c.on || !c.vpnHome || !c.zones.has(String(b.tz || '')) || !(await security.hit(db, 'geopass:' + clientIp(req), 10, 3600))) return json(403, { ok: false });
      return json(200, { ok: true }, { 'Set-Cookie': geo.passCookie(req, settings) });
    }
    const shut = await geo.check(req, path, settings, method);
    if (shut) {
      geo.count(shut.country, 'country');
      if (path.startsWith('/api/')) return json(403, { error: 'region' });
      return send(403, geo.blockedPage(settings, { country: shut.country }), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
    }

    // ---- small jobs that must run now and then (Vercel's own schedule runs only once a day) ----
    if (method === 'GET' && !path.startsWith('/media/') && !path.startsWith('/api/')) backgroundTick(req, settings);

    // ---- tools that ignore robots.txt: the blocked spy / copier bots get nothing at all ----
    const ua = String(req.headers['user-agent'] || '');
    if (ua) {
      const bad = blockedBots(settings);
      if (bad.length && bad.some((b) => ua.toLowerCase().includes(b.toLowerCase()))) return send(403, 'Forbidden', 'text/plain', { 'X-Robots-Tag': 'noindex' });
    }
    // ---- crawlers & verification ----
    // (pictures, robots.txt, sitemap.xml, feeds, the e-mail counters, /unsubscribe and the scheduled jobs: lib/api/files.ts;
    //  the other shop APIs, payments and webhooks: their own Next.js routes, lib/api/…)
    if (verificationFile(path, settings, reply)) return;

    return await shopRoutes(base);
  } catch (e) {
    $services_errors.report(e, { path, method });
    return send(500, ERROR_PAGE);
  }
}

// ---------------------------------------------------------------- storefront
/** What the storefront's fallback needs for one request. */
type ShopCtx = { req: ShopRequest; reply: Reply; path: string; method: string; query: URLSearchParams; settings: Settings };

async function shopRoutes({ req, reply, path, method, query, settings }: ShopCtx) {
  const { send } = answers(reply);
  // Admin → দোকানে কী দেখাবে → "স্টক শেষ পণ্য তালিকায় দেখাও" off: lists, home rows and search skip them
  const hideOut = settings.ui_show_out_of_stock === '0';
  const [categories, pages, popups] = await Promise.all([
    catalog.listCategories({ includeInactive: false }), content.listPages({ active: true }), content.listBanners({ active: true, placement: 'popup' }),
  ]);
  const page = (title: string, body: ReactNode, opts: PageOpts = {}) => send(opts.status || 200,
    shopLayout({ settings, title, body, categories, pages, popup: popups[0] || null, ...opts }));
  const notFound = () => page('পাওয়া যায়নি', shop.notFound(), { status: 404, noindex: true });
  // (👤 account, 🙋 own-order changes, 📮 complaints, 🔎 tracking, ↩️ returns, 🎁 gift cards: their own Next.js routes —
  //  lib/shopx.tsx; proxy.ts sends them there)
  if (method !== 'GET' && method !== 'HEAD') return notFound();
  // 🎁 a friend's referral link: remember the code for checkout
  const ref = query.get('ref') || '';
  if (settings.ref_on === '1' && /^[A-Za-z0-9-]{4,24}$/.test(ref)) reply.header('Set-Cookie', refCookie(req, ref));

  // home, product lists / search / brands, product pages: lib/shop/router.tsx (shared with the Next.js pages)
  if (path === '/' || path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/p\/[^/]+$/.test(path)) {
    const r = await resolveShop({ path, query, settings, categories, base: siteUrl(req, settings) });
    if (r.kind === 'notFound') return notFound();
    if (r.kind === 'redirect') return reply.answer(r.status, { Location: r.location, ...r.headers });
    return page(r.title, r.body, r.opts);
  }
  let m: RegExpMatchArray | null = null;
  // stops someone from trying thousands of order numbers to find other people's orders
  if (ORDER_PAGE.test(path) && !(await security.hit(db, 'orderview:' + clientIp(req), 60, 600))) return tooMany(req, reply);
  // live scores, cart, wishlist, compare, checkout, project kits, order pages: lib/shop/more.tsx (shared with the Next.js pages)
  {
    const r = await $shop_more.resolveMore({ path, query, settings, base: siteUrl(req, settings), req });
    if (r) {
      if (r.kind === 'notFound') return notFound();
      if (r.kind === 'redirect') return reply.answer(r.status, { Location: r.location, ...r.headers });
      return page(r.title, r.body, r.opts);
    }
  }
  if (path === '/blog' || (m = path.match(/^\/blog\/category\/([^/]+)$/))) {
    const cats = await content.listBlogCategories();
    const slug = m ? m[1] : '';
    const category = m ? cats.find((c) => c.slug === slug) : null;
    if (m && !category) return notFound();
    const posts = await content.listPosts({ published: true, categorySlug: category && category.slug, limit: 60 });
    return page(category ? category.name : 'ব্লগ', shop.blogList({ posts, categories: cats, category }), { active: 'blog', canonical: category ? `/blog/category/${category.slug}` : '/blog' });
  }
  m = path.match(/^\/blog\/([^/]+)$/);
  if (m) {
    const r = await $shop_blog.blogPostPage(m[1], settings);
    if (!r) return notFound();
    db.q('UPDATE blog_posts SET views = views + 1 WHERE id=$1', [r.post.id]).catch(() => {});
    return page(r.title, r.body, r.opts);
  }
  m = path.match(/^\/page\/([^/]+)$/);
  if (m) {
    const p = await content.getPage({ slug: m[1] });
    if (!p || !p.active) return notFound();
    return page(p.title, shop.staticPage({ page: p }), { canonical: `/page/${p.slug}`, description: md.plain(p.content) });
  }
  return notFound();
}

/** Answers one request (the Web Request Next.js gives app/api/site) for the address the visitor asked for. */
export async function siteAnswer(request: Request, address: string): Promise<Response> {
  const method = request.method;
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const req: ShopRequest = {
    url: address, method, headers,
    socket: { remoteAddress: headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1' },
    __body: method === 'GET' || method === 'HEAD' ? '' : await request.text(),
  };
  const reply = new Reply();
  await loadRenderer(); // the pages answered here are text (lib/react/render.tsx)
  try {
    await handler(req, reply);
    // (an answer is always given; this only waits if a handler gave it a moment after returning)
    if (!reply.answered) await Promise.race([reply.done, new Promise((r) => setTimeout(r, 55_000))]);
  } catch (e) {
    console.error('site handler failed', e);
  } finally {
    await $services_errors.flush(); // an error reported to Sentry goes out before the server may be paused
  }
  return reply.answered ? reply.toResponse() : new Response('Server error', { status: 500 });
}

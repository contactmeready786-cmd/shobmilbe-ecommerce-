// 🧭 The shop's answers that are not a Next.js page or route of their own: forms sent to the shop and the admin,
// /admin/api and the admin's files and exports, the shop's own 404 page and redirects, the country-lock page and the
// verification files. Served by app/api/site (proxy.ts and the fallback rewrite in next.config.ts send them there):
// siteAnswer() takes the Web Request and gives back a Web Response (lib/reply.ts).
import * as db from './db';
import * as catalog from './models/catalog';
import * as O from './models/orders';
import * as content from './models/content';
import * as guard from './services/guard';
import * as admin from './admin';
import { shopLayout } from './views/layout';
import { resolveShop } from './shop/router';
import { scoped } from './cache';
import * as shop from './views/shop';
import * as md from './views/md';
import { parseBody, str, normalizePhone } from './util';
import * as security from './security';
import * as $services_dbmove from './services/dbmove';
import * as $services_geolock from './services/geolock';
import * as $shop_blog from './shop/blog';
import * as $shop_more from './shop/more';
import { ORDER_PAGE } from './shop/more';
import * as $shopx from './shopx';
import * as $services_errors from './services/errors';
import { siteUrl, blockedBots, backgroundTick, SITE_BLOCKED_PAGE, myOrdersCookie } from './gate';
import { Reply, type HeaderMap, type ReplyBody } from './reply';
import { loadRenderer } from './react/render';
import type { Body, Loose, ShopRequest } from './types';

const securityHeaders = security.BASE_HEADERS;

/** The three ways of answering, bound to one request's reply. */
function answers(reply: Reply) {
  const send = (status: number, body: ReplyBody, type = 'text/html; charset=utf-8', extra: HeaderMap = {}) =>
    reply.answer(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...securityHeaders, ...extra }, body);
  const json = (status: number, data: unknown, extra: HeaderMap = {}) => send(status, JSON.stringify(data), 'application/json; charset=utf-8', extra);
  const redirect = (to: string, extra: HeaderMap = {}) => reply.answer(303, { Location: to, 'Cache-Control': 'no-store', ...extra });
  return { send, json, redirect };
}

const clientIp = security.clientIp;
// Too many requests from one visitor: polite message, nothing else happens.
function tooMany(req: ShopRequest, reply: Reply) {
  guard.record({ req, kind: 'flood', path: String(req.url || '').slice(0, 200) }).catch(() => {});
  const text = 'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  return answers(reply).send(429, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটু অপেক্ষা করুন</h1><p>${text}</p><p><a href="/">হোমে ফিরে যান</a></p></body>`, 'text/html; charset=utf-8', { 'Retry-After': '120' });
}

// Admin pages and changes read fresh data; shop pages may share 15-second copies (lib/cache.ts).
const handler = scoped(handlerInner);
async function handlerInner(req: ShopRequest, reply: Reply) {
  const { send, json, redirect } = answers(reply);
  const url = new URL(req.url || '/', 'http://local');
  let path = url.searchParams.get('__p');
  if (path !== null) {
    url.searchParams.delete('__p');
    path = '/' + path.replace(/^\/+/, '');
  } else {
    path = url.pathname;
  }
  try { path = decodeURIComponent(path); } catch (_) { /* keep raw */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const method = req.method || 'GET';
  const query = url.searchParams;

  try {
    await db.ensureReady();
  } catch (e: Loose) {
    console.error('Database setup failed:', e);
    return send(503, setupErrorPage(e));
  }

  // ---- one-time move from the old Neon database into Supabase (see services/dbmove.js) ----
  try {
    const dbmove = $services_dbmove;
    if (path === '/__dbmove/report' && method === 'GET') {
      const r = await dbmove.report();
      return send(200, JSON.stringify(r ? { done: !!r.done, verify: r.verify || null, finished_at: r.finished_at || null, tries: r.tries || 0 } : null), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    }
    if (await dbmove.pending()) {
      if (path === '/__dbmove' && method === 'POST') {
        try { return send(200, JSON.stringify(await dbmove.step()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
        catch (e: Loose) { console.error('DB move step failed:', e); return send(200, JSON.stringify({ error: String(e.message || e).slice(0, 300), at: String(e.stack || '').split('\n').slice(1, 6).map((l) => l.trim().replace(/^at /, '').replace(/\/var\/task\//g, '')).join(' < ').slice(0, 500) }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
      }
      if (path === '/__dbmove' && method === 'GET') return send(200, JSON.stringify(await dbmove.status()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
      if (/^\/(css|js|vendor|favicon|brand)/.test(path)) { /* let static bits through */ } else
      return send(503, dbmove.page(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'Retry-After': '30' });
    }
  } catch (e) { console.error('DB move check failed:', e); }

  try {
    const settings = await db.getSettings();
    $services_errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
    const isAdmin = path === '/admin' || path.startsWith('/admin/');
    const nonce = isAdmin ? security.startNonce() : ''; // only our own admin <script> tags may run (lib/security.ts)
    const adminSend = (status: number, body: ReplyBody, type?: string, extra: HeaderMap = {}) => send(status, body, type, { ...security.adminHeaders(nonce), ...extra });
    const base = { req, reply, path, method, query, settings, send: isAdmin ? adminSend : send, json, redirect };

    // ---- the customer Android app never shows the admin panel (that is the separate admin app's job) ----
    if (isAdmin && /ShobmilbeApp\//.test(String(req.headers['user-agent'] || ''))) {
      return send(403, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>সবমিলবে</title><body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#14213d"><div style="font-size:48px">🛍️</div><h2>এই পেজটা এখানে খোলে না</h2><p style="color:#5b6475">কেনাকাটা চালিয়ে যান।</p><p><a href="/" style="display:inline-block;background:#0866D6;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold">হোমে যান</a></p></body>', 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    }

    // ---- 🔐 the admin panel opens only from Bangladesh (+ countries the owner opened for a trip, until its last day) ----
    if (isAdmin) {
      const geo = $services_geolock;
      const shutCountry = geo.adminBlocked(req, settings);
      if (shutCountry) {
        geo.count(shutCountry, 'admin');
        guard.record({ req, kind: 'probe', path: ('অ্যাডমিন (দেশ বন্ধ): ' + path).slice(0, 200) }).catch(() => {});
        return send(404, geo.adminBlockedPage(), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
      }
    }

    // ---- security watch: IPs the owner shut out get nothing (the admin panel always stays open) ----
    if (!isAdmin && settings.guard_on !== '0') {
      if (await guard.siteBlocked(clientIp(req))) {
        return send(403, SITE_BLOCKED_PAGE, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
      }
      guard.inspect(req, path, url.search, settings);
    }

    // ---- 🌍 দেশ ব্লক: only the countries the owner ticked may open the shop (services/geolock.js) ----
    if (!isAdmin) {
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
    // (pictures, robots.txt, sitemap.xml, feeds, the e-mail counters, /unsubscribe and the scheduled jobs: lib/api/files.ts)
    // ⚡ IndexNow key file (Bing & co. check it belongs to this shop)
    if (/^\/[a-f0-9]{32}\.txt$/.test(path) && settings.indexnow_key && path === `/${settings.indexnow_key}.txt`) return send(200, settings.indexnow_key, 'text/plain; charset=utf-8');
    const vf = db.jsonSetting(settings, 'verification_files', []).find((f?: Loose) => '/' + f.path === path);
    if (vf) return send(200, vf.content, vf.path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', { 'Content-Security-Policy': "sandbox; default-src 'none'" });

    // ---- API ----
    const ip = clientIp(req);
    // (the other shop APIs are their own Next.js routes: app/api/… → lib/api/shop-read.ts, lib/api/shop-actions.ts)


    // (payments and webhooks: their own Next.js routes, lib/api/payments.ts)

    if (path === '/admin' || path.startsWith('/admin/')) return await admin.handle(base);

    return await shopRoutes(base);
  } catch (e) {
    $services_errors.report(e, { path, method });
    return send(500, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>');
  }
}








// ---------------------------------------------------------------- payments


// ---------------------------------------------------------------- storefront
async function shopRoutes({ req, reply, path, method, query, settings }: Body) {
  const { send, redirect } = answers(reply);
  // Admin → দোকানে কী দেখাবে → "স্টক শেষ পণ্য তালিকায় দেখাও" off: lists, home rows and search skip them
  const hideOut = settings.ui_show_out_of_stock === '0';
  const [categories, pages, popups] = await Promise.all([
    catalog.listCategories({ includeInactive: false }), content.listPages({ active: true }), content.listBanners({ active: true, placement: 'popup' }),
  ]);
  const page = (title?: Loose, body?: Loose, opts: Body = {}) => send(opts.status || 200,
    shopLayout({ settings, title, body, categories, pages, popup: popups[0] || null, ...opts }));
  const notFound = () => page('পাওয়া যায়নি', shop.notFound(), { status: 404, noindex: true });
  // 👤 customer account, ↩️ return request, 🎁 gift card — these pages also take forms
  if (path === '/account' || path.startsWith('/account/') || /^\/order\/[A-Za-z0-9]+\/return$/.test(path) || path === '/gift-card' || path === '/complaint' || path === '/complaint/status' || /^\/order\/[A-Za-z0-9]+\/(cancel|edit)$/.test(path)) {
    const r = await $shopx.route({ req, reply, path, method, query, settings, page, notFound, redirect, ip: clientIp(req) });
    if (r !== null) return r;
  }
  if (method !== 'GET' && method !== 'HEAD') return notFound();
  // 🎁 a friend's referral link: remember the code for checkout
  if (settings.ref_on === '1' && query.get('ref') && /^[A-Za-z0-9-]{4,24}$/.test(query.get('ref'))) reply.header('Set-Cookie', $shopx.refCookie(req, query.get('ref')));

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
  if (path === '/track') {
    const code = str(query.get('code'), 20).toUpperCase();
    const phone = str(query.get('phone'), 20);
    if (code && phone) {
      if (!(await security.hit(db, 'track:' + clientIp(req), 20, 600))) return tooMany(req, reply);
      const order = await O.getOrder({ code });
      if (order && order.phone === normalizePhone(phone)) return redirect(`/order/${order.code}`, { 'Set-Cookie': myOrdersCookie(req, settings, order.code) });
      return page('অর্ডার ট্র্যাক', shop.trackPage({ code, phone, error: 'এই অর্ডার নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।' }), { active: 'track', noindex: true });
    }
    return page('অর্ডার ট্র্যাক', shop.trackPage({ code: code.replace(/[^A-Z0-9]/g, '') }), { active: 'track' });
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

function setupErrorPage(e?: Loose) {
  const missing = /DATABASE_URL/.test(e.message);
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>সেটআপ বাকি</title>
<body style="font-family:'Noto Sans Bengali',sans-serif;max-width:560px;margin:60px auto;padding:0 20px;line-height:1.7;color:#14213D">
<h1>ওয়েবসাইট ডাটাবেসের সাথে যুক্ত হতে পারছে না</h1>
${missing
    ? '<p>Vercel-এ ডাটাবেস এখনো এই প্রজেক্টের সাথে যুক্ত হয়নি। Vercel → প্রজেক্ট → Storage থেকে ডাটাবেসটি (Supabase) এই প্রজেক্টে Connect করুন, তারপর Deployments থেকে Redeploy দিন।</p>'
    : '<p>ডাটাবেস সাময়িকভাবে সাড়া দিচ্ছে না। কিছুক্ষণ পর পেজটি রিফ্রেশ করুন।</p>'}
</body></html>`;
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

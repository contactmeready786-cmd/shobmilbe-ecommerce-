// Every request comes here: storefront pages, small JSON APIs, payments, webhooks, images and the admin panel.
import * as db from './db';
import * as catalog from './models/catalog';
import * as O from './models/orders';
import * as customers from './models/customers';
import * as content from './models/content';
import * as payments from './services/payments';
import * as courier from './services/courier';
import * as notify from './services/notify';
import * as tracking from './services/tracking';
import * as visitors from './services/visitors';
import * as guard from './services/guard';
import * as drafts from './services/drafts';
import * as livescore from './services/livescore';
import * as feeds from './services/feeds';
import * as translate from './services/translate';
import * as admin from './admin';
import { shopLayout } from './views/layout';
import { resolveShop } from './shop/router';
import { scoped } from './cache';
import * as shop from './views/shop';
import * as md from './views/md';
import { parseBody, readBody, int, str, normalizePhone, validPhone, esc, sign, contact, bn, amount, qtyRule } from './util';
import * as security from './security';
import * as seo from './services/seo';
import * as dupcanon from './services/dupcanon';
import * as U from './services/uiswitch';
import * as $services_sms from './services/sms';
import * as $models_giftcards from './models/giftcards';
import * as $services_dbmove from './services/dbmove';
import * as $services_geolock from './services/geolock';
import * as $services_search from './services/search';
import * as $models_extras from './models/extras';
import * as $services_push from './services/push';
import * as $services_pricing from './services/pricing';
import * as $models_accounts from './models/accounts';
import * as $services_mailer from './services/mailer';
import * as $services_health from './services/health';
import * as $services_autobackup from './services/autobackup';
import * as $services_research from './services/research';
import * as $services_imagekit from './services/imagekit';
import * as $services_autoseo from './services/autoseo';
import * as $services_autopost from './services/autopost';
import * as $services_fbreply from './services/fbreply';
import * as $services_telegram from './services/telegram';
import * as $shop_blog from './shop/blog';
import * as $shop_more from './shop/more';
import { ORDER_PAGE } from './shop/more';
import * as $services_autoblog from './services/autoblog';
import * as $services_autocall from './services/autocall';
import * as $models_reviews from './models/reviews';
import * as $models_checkoutotp from './models/checkoutotp';
import * as $models_loyalty from './models/loyalty';
import * as $services_fraud from './services/fraud';
import * as $services_stockalert from './services/stockalert';
import * as $shopx from './shopx';
import * as $models_homerows from './models/homerows';
import * as $models_kits from './models/kits';
import * as $services_errors from './services/errors';
import { siteUrl, blockedBots, backgroundTick, SITE_BLOCKED_PAGE, myOrders, myOrdersCookie } from './gate';
import type { Body, Id, Loose, Settings, ShopRequest, ShopResponse } from './types';

const securityHeaders = security.BASE_HEADERS;

// Customer SMS when an order is confirmed / handed to the courier / delivered (Admin → মার্কেটিং → কাস্টমারকে SMS).
O.onStatusChange(async (id, status) => {
  const ev = { confirmed: 'confirmed', shipped: 'shipped', delivered: 'delivered' }[status];
  if (!ev) return;
  const settings = await db.getSettings();
  if (settings.sms_on !== '1' || settings[`sms_on_${ev}`] !== '1') return;
  const o = await db.one('SELECT id, code, phone, customer_name, total, tracking_code, points_earned, source FROM orders WHERE id=$1', [id]);
  if (!o || o.source === 'pos' || !o.phone) return; // counter sales: the customer is standing in the shop
  await notify.later($services_sms.orderEvent(settings, ev, o, settings.site_url || ''));
});
// 💳 gift card money back when an order is cancelled / returned (taken again if it is switched back on),
// 🎁 the referral reward when a referred first order is delivered, 🏬 a branch's pieces back on its shelf.
O.onStatusChange(async (id, status, prev) => {
  const G = $models_giftcards;
  if (O.RELEASED.has(status)) {
    await G.refundOrder(id).catch((e) => console.error('gift refund', e.message));
    const o = await db.one('SELECT warehouse_id FROM orders WHERE id=$1', [id]);
    if (o && o.warehouse_id && !O.RELEASED.has(prev)) {
      const items = await db.q('SELECT product_id, qty, components FROM order_items WHERE order_id=$1 AND product_id IS NOT NULL', [id]);
      for (const it of items) {
        for (const part of (it.components && it.components.length ? it.components : [{ product_id: it.product_id, qty: it.qty }])) {
          await db.q(`INSERT INTO warehouse_stock(warehouse_id, product_id, qty) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM warehouses WHERE id=$1) AND EXISTS (SELECT 1 FROM products WHERE id=$2)
            ON CONFLICT (warehouse_id, product_id) DO UPDATE SET qty = warehouse_stock.qty + EXCLUDED.qty`, [o.warehouse_id, part.product_id, part.qty]);
          await db.q('INSERT INTO warehouse_moves(product_id, from_wh, to_wh, qty, reason, ref_id) VALUES($1,NULL,$2,$3,$4,$5)', [part.product_id, o.warehouse_id, part.qty, 'sale_cancel', id]);
        }
      }
    }
  } else if (O.RELEASED.has(prev)) {
    await G.respendOrder(id).catch((e) => console.error('gift respend', e.message));
  }
  if (status === 'delivered') {
    const settings = await db.getSettings();
    await G.rewardReferral(settings, id).catch((e) => console.error('referral reward', e.message));
  }
});
// The home page, top to bottom (Admin → স্টোর ডিজাইন can switch rows on/off and change the order).
const HOME_DEFAULT = ['slider', 'trust', 'categories', 'new', 'offers', 'bestsellers', 'popular', 'promo', 'cat_rows', 'budget', 'featured'];
function send(res: ShopResponse, status?: Loose, body?: Loose, type: Loose = 'text/html; charset=utf-8', extra: Loose = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...securityHeaders, ...extra });
  res.end(body);
}
function json(res: ShopResponse, status: Loose, data: unknown, extra: Loose = {}) { send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', extra); }

function redirect(res: ShopResponse, to?: Loose, extra: Loose = {}) { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...extra }); res.end(); }

const clientIp = security.clientIp;
// Too many requests from one visitor: polite message, nothing else happens.
function tooMany(req: ShopRequest, res: ShopResponse, asJson?: Loose) {
  guard.record({ req, kind: 'flood', path: String(req.url || '').slice(0, 200) }).catch(() => {});
  const text = 'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  if (asJson) return send(res, 429, JSON.stringify({ error: text }), 'application/json; charset=utf-8', { 'Retry-After': '120' });
  return send(res, 429, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটু অপেক্ষা করুন</h1><p>${text}</p><p><a href="/">হোমে ফিরে যান</a></p></body>`, 'text/html; charset=utf-8', { 'Retry-After': '120' });
}

// Admin pages and changes read fresh data; shop pages may share 15-second copies (lib/cache.ts).
const handler = scoped(handlerInner);
// every reported error is also counted in the site's own error log (Admin → সার্ভার ও ডাটাবেস)
$services_errors.setStore($services_health.logError);
async function handlerInner(req: ShopRequest, res: ShopResponse) {
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
    return send(res, 503, setupErrorPage(e));
  }

  // ---- one-time move from the old Neon database into Supabase (see services/dbmove.js) ----
  try {
    const dbmove = $services_dbmove;
    if (path === '/__dbmove/report' && method === 'GET') {
      const r = await dbmove.report();
      return send(res, 200, JSON.stringify(r ? { done: !!r.done, verify: r.verify || null, finished_at: r.finished_at || null, tries: r.tries || 0 } : null), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    }
    if (await dbmove.pending()) {
      if (path === '/__dbmove' && method === 'POST') {
        try { return send(res, 200, JSON.stringify(await dbmove.step()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
        catch (e: Loose) { console.error('DB move step failed:', e); return send(res, 200, JSON.stringify({ error: String(e.message || e).slice(0, 300), at: String(e.stack || '').split('\n').slice(1, 6).map((l) => l.trim().replace(/^at /, '').replace(/\/var\/task\//g, '')).join(' < ').slice(0, 500) }), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
      }
      if (path === '/__dbmove' && method === 'GET') return send(res, 200, JSON.stringify(await dbmove.status()), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
      if (/^\/(css|js|vendor|favicon|brand)/.test(path)) { /* let static bits through */ } else
      return send(res, 503, dbmove.page(), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'Retry-After': '30' });
    }
  } catch (e) { console.error('DB move check failed:', e); }

  try {
    const settings = await db.getSettings();
    $services_errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
    const isAdmin = path === '/admin' || path.startsWith('/admin/');
    const nonce = isAdmin ? security.startNonce() : ''; // only our own admin <script> tags may run (lib/security.ts)
    const adminSend = (r?: Loose, status?: Loose, body?: Loose, type?: Loose, extra: Loose = {}) => send(r, status, body, type, { ...security.adminHeaders(nonce), ...extra });
    const base = { req, res, path, method, query, settings, send: isAdmin ? adminSend : send, json, redirect };

    // ---- the customer Android app never shows the admin panel (that is the separate admin app's job) ----
    if (isAdmin && /ShobmilbeApp\//.test(String(req.headers['user-agent'] || ''))) {
      return send(res, 403, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>সবমিলবে</title><body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#14213d"><div style="font-size:48px">🛍️</div><h2>এই পেজটা এখানে খোলে না</h2><p style="color:#5b6475">কেনাকাটা চালিয়ে যান।</p><p><a href="/" style="display:inline-block;background:#0866D6;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold">হোমে যান</a></p></body>', 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    }

    // ---- 🔐 the admin panel opens only from Bangladesh (+ countries the owner opened for a trip, until its last day) ----
    if (isAdmin) {
      const geo = $services_geolock;
      const shutCountry = geo.adminBlocked(req, settings);
      if (shutCountry) {
        geo.count(shutCountry, 'admin');
        guard.record({ req, kind: 'probe', path: ('অ্যাডমিন (দেশ বন্ধ): ' + path).slice(0, 200) }).catch(() => {});
        return send(res, 404, geo.adminBlockedPage(), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
      }
    }

    // ---- security watch: IPs the owner shut out get nothing (the admin panel always stays open) ----
    if (!isAdmin && settings.guard_on !== '0') {
      if (await guard.siteBlocked(clientIp(req))) {
        return send(res, 403, SITE_BLOCKED_PAGE, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
      }
      guard.inspect(req, path, url.search, settings);
    }

    // ---- 🌍 দেশ ব্লক: only the countries the owner ticked may open the shop (services/geolock.js) ----
    if (!isAdmin) {
      const geo = $services_geolock;
      if (path === geo.BLOCK_PATH && method === 'GET') {
        const why = query.get('w') === 'tz' ? 'tz' : 'country';
        if (geo.config(settings).on) geo.count(geo.countryOf(req) || '??', why);
        return send(res, 403, geo.blockedPage(settings, { country: geo.countryOf(req), why }), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
      }
      // a visitor whose own clock is in a ticked country (e.g. a Bangladeshi on a VPN) — only when the owner allows it
      if (path === geo.BLOCK_PATH + '/pass' && method === 'POST') {
        const c = geo.config(settings);
        const b: Body = await parseBody(req).catch(() => ({}));
        if (!c.on || !c.vpnHome || !c.zones.has(String(b.tz || '')) || !(await security.hit(db, 'geopass:' + clientIp(req), 10, 3600))) return json(res, 403, { ok: false });
        return json(res, 200, { ok: true }, { 'Set-Cookie': geo.passCookie(req, settings) });
      }
      const shut = await geo.check(req, path, settings, method);
      if (shut) {
        geo.count(shut.country, 'country');
        if (path.startsWith('/api/')) return json(res, 403, { error: 'region' });
        return send(res, 403, geo.blockedPage(settings, { country: shut.country }), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
      }
    }

    // ---- small jobs that must run now and then (Vercel's own schedule runs only once a day) ----
    if (method === 'GET' && !path.startsWith('/media/') && !path.startsWith('/api/')) backgroundTick(req, settings);


    // ---- tools that ignore robots.txt: the blocked spy / copier bots get nothing at all ----
    const ua = String(req.headers['user-agent'] || '');
    if (ua) {
      const bad = blockedBots(settings);
      if (bad.length && bad.some((b) => ua.toLowerCase().includes(b.toLowerCase()))) return send(res, 403, 'Forbidden', 'text/plain', { 'X-Robots-Tag': 'noindex' });
    }
    // ---- crawlers & verification ----
    // (pictures, robots.txt, sitemap.xml, feeds, the e-mail counters, /unsubscribe and the scheduled jobs: lib/api/files.ts)
    // ⚡ IndexNow key file (Bing & co. check it belongs to this shop)
    if (/^\/[a-f0-9]{32}\.txt$/.test(path) && settings.indexnow_key && path === `/${settings.indexnow_key}.txt`) return send(res, 200, settings.indexnow_key, 'text/plain; charset=utf-8');
    const vf = db.jsonSetting(settings, 'verification_files', []).find((f?: Loose) => '/' + f.path === path);
    if (vf) return send(res, 200, vf.content, vf.path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', { 'Content-Security-Policy': "sandbox; default-src 'none'" });

    // ---- API ----
    const ip = clientIp(req);
    // (the other shop APIs are their own Next.js routes: app/api/… → lib/api/shop-read.ts, lib/api/shop-actions.ts)


    // ---- payments & webhooks ----
    if (path.startsWith('/pay/')) return await paymentRoutes(base);
    if (path === '/webhook/steadfast' && method === 'POST') return await steadfastWebhook(base);
    if (path === '/webhook/pathao' && method === 'POST') return await pathaoWebhook(base);
    const m = path.match(/^\/webhook\/autocall\/([A-Za-z0-9_-]{10,80})$/);
    if (m && (method === 'POST' || method === 'GET')) {
      // the call company tells us what the customer pressed (JSON, form or ?query)
      const b = method === 'POST' ? await parseBody(req) : {};
      for (const [k, v] of query) if (!(k in b)) b[k] = v;
      const r = await $services_autocall.hook(settings, m[1], b);
      return json(res, r.status, r.body);
    }

    if (path === '/admin' || path.startsWith('/admin/')) return await admin.handle(base);

    return await shopRoutes(base);
  } catch (e) {
    $services_errors.report(e, { path, method });
    return send(res, 500, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>');
  }
}








// ---------------------------------------------------------------- payments
async function paymentRoutes({ req, res, path, method, query, settings }: Body) {
  const site = siteUrl(req, settings);
  let m = path.match(/^\/pay\/([A-Z0-9]{4,12})$/i);
  if (m && method === 'GET') {
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return redirect(res, '/track');
    if (order.payment_status === 'paid' || O.RELEASED.has(order.status)) return redirect(res, `/order/${order.code}`);
    let r;
    try {
      r = order.payment === 'bkash' ? await payments.bkashCreate(order, settings, site)
        : order.payment === 'ssl' ? await payments.sslCreate(order, settings, site) : { ok: false };
    } catch (e: Loose) {
      r = { ok: false, message: e.message };
      await db.logIntegration(order.payment, 'create', false, e.message, order.code);
    }
    return r.ok ? redirect(res, r.url) : redirect(res, `/order/${order.code}?new=1&pay=failed`);
  }
  if (path === '/pay/bkash/callback') {
    const paymentID = str(query.get('paymentID'), 80);
    const status = query.get('status');
    const p = paymentID ? await db.one(`SELECT * FROM payments WHERE gateway_ref=$1 AND method='bkash'`, [paymentID]) : null;
    if (!p) return redirect(res, '/track');
    const order = await O.getOrder({ id: p.order_id });
    if (status === 'success') {
      try {
        const r = await payments.bkashExecute(paymentID, settings);
        if (r.ok && r.amount >= Number(p.amount) - 1) {
          await payments.recordSuccess(p, { trxID: r.trxID, amount: r.amount, raw: r.raw, label: 'বিকাশ' });
          return redirect(res, `/order/${order!.code}?new=1`);
        }
        await db.logIntegration('bkash', 'execute', false, r.message, order!.code);
      } catch (e: Loose) {
        await db.logIntegration('bkash', 'execute', false, e.message, order!.code);
      }
    }
    await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [status === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return redirect(res, `/order/${order!.code}?new=1&pay=failed`);
  }
  m = path.match(/^\/pay\/ssl\/(success|fail|cancel|ipn)$/);
  if (m) {
    const b = method === 'POST' ? await parseBody(req) : Object.fromEntries(query);
    const tranId = str(b.tran_id, 80);
    const p = tranId ? await db.one(`SELECT * FROM payments WHERE gateway_ref=$1 AND method='ssl'`, [tranId]) : null;
    if (!p) return m[1] === 'ipn' ? send(res, 200, 'ok', 'text/plain') : redirect(res, '/track');
    const order = await O.getOrder({ id: p.order_id });
    if ((m[1] === 'success' || m[1] === 'ipn') && b.val_id) {
      const v = await payments.sslValidate(str(b.val_id, 120), settings);
      if (v.ok && v.tranId === tranId && v.amount >= p.amount - 1) {
        await payments.recordSuccess(p, { trxID: v.trxID, amount: v.amount, raw: v.raw, label: `কার্ড/মোবাইল (${v.cardType})` });
        return m[1] === 'ipn' ? send(res, 200, 'ok', 'text/plain') : redirect(res, `/order/${order!.code}?new=1`);
      }
      await db.logIntegration('sslcommerz', 'validate', false, JSON.stringify(v.raw).slice(0, 300), order!.code);
    }
    if (m[1] !== 'ipn') await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [m[1] === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return m[1] === 'ipn' ? send(res, 200, 'ok', 'text/plain') : redirect(res, `/order/${order!.code}?new=1&pay=failed`);
  }
  return redirect(res, '/');
}

// ---------------------------------------------------------------- courier webhooks
async function applyCourierUpdate(orderRow?: Loose, courierName?: Loose, rawStatus?: Loose) {
  await O.setCourierStatus(orderRow.id, rawStatus);
  const mapped = courier.mapStatus(courierName, rawStatus);
  if (mapped && mapped !== orderRow.status) {
    try {
      const s = await O.setStatus(orderRow.id, mapped, null);
      if (s.changed) await db.logActivity(null, 'order_status', 'order', orderRow.id, `${s.prev} → ${mapped} (${courierName} ওয়েবহুক)`);
    } catch (e: Loose) { await db.logIntegration(courierName, 'webhook', false, e.message, orderRow.code); }
  }
}
async function steadfastWebhook({ req, res, settings }: Body) {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!settings.steadfast_webhook_token || !security.safeEqual(auth, settings.steadfast_webhook_token)) return json(res, 401, { status: 'error', message: 'Unauthorized' });
  const b = await parseBody(req);
  const cid = String(b.consignment_id || '');
  const order = await db.one(`SELECT id, code, status FROM orders WHERE (consignment_id=$1 AND $1<>'') OR code=$2 LIMIT 1`, [cid, String(b.invoice || '')]);
  if (order && b.status) await applyCourierUpdate(order, 'steadfast', String(b.status));
  await db.logIntegration('steadfast', 'webhook', !!order, `${b.notification_type || ''} ${cid} ${b.status || ''}`, order ? order.code : '');
  return json(res, 200, { status: 'success', message: 'Webhook received successfully.' });
}
async function pathaoWebhook({ req, res, settings }: Body) {
  const sig = String(req.headers['x-pathao-signature'] || '');
  const headers = { 'X-Pathao-Merchant-Webhook-Integration-Secret': 'f3992ecc-59da-4cbe-a049-a13da2018d51' };
  if (!settings.pathao_webhook_secret || !security.safeEqual(sig, settings.pathao_webhook_secret)) return send(res, 401, '{"status":"unauthorized"}', 'application/json');
  const b = await parseBody(req);
  const cid = String(b.consignment_id || '');
  const order = cid || b.merchant_order_id ? await db.one(`SELECT id, code, status FROM orders WHERE (consignment_id=$1 AND $1<>'') OR code=$2 LIMIT 1`, [cid, String(b.merchant_order_id || '')]) : null;
  const st = b.order_status || b.order_status_slug || (b.event ? String(b.event).replace(/^order\./, '') : '');
  if (order && st) await applyCourierUpdate(order, 'pathao', String(st));
  await db.logIntegration('pathao', 'webhook', true, `${b.event || ''} ${cid} ${st}`, order ? order.code : '');
  return send(res, 202, '{"status":"received"}', 'application/json; charset=utf-8', headers);
}

// ---------------------------------------------------------------- storefront
async function shopRoutes({ req, res, path, method, query, settings }: Body) {
  // Admin → দোকানে কী দেখাবে → "স্টক শেষ পণ্য তালিকায় দেখাও" off: lists, home rows and search skip them
  const hideOut = settings.ui_show_out_of_stock === '0';
  const [categories, pages, popups] = await Promise.all([
    catalog.listCategories({ includeInactive: false }), content.listPages({ active: true }), content.listBanners({ active: true, placement: 'popup' }),
  ]);
  const page = (title?: Loose, body?: Loose, opts: Body = {}) => send(res, opts.status || 200,
    shopLayout({ settings, title, body, categories, pages, popup: popups[0] || null, ...opts }));
  const notFound = () => page('পাওয়া যায়নি', shop.notFound(), { status: 404, noindex: true });
  // 👤 customer account, ↩️ return request, 🎁 gift card — these pages also take forms
  if (path === '/account' || path.startsWith('/account/') || /^\/order\/[A-Za-z0-9]+\/return$/.test(path) || path === '/gift-card' || path === '/complaint' || path === '/complaint/status' || /^\/order\/[A-Za-z0-9]+\/(cancel|edit)$/.test(path)) {
    const r = await $shopx.route({ req, res, path, method, query, settings, page, notFound, redirect, ip: clientIp(req) });
    if (r !== null) return r;
  }
  if (method !== 'GET' && method !== 'HEAD') return notFound();
  // 🎁 a friend's referral link: remember the code for checkout
  if (settings.ref_on === '1' && query.get('ref') && /^[A-Za-z0-9-]{4,24}$/.test(query.get('ref'))) res.setHeader('Set-Cookie', $shopx.refCookie(req, query.get('ref')));

  // home, product lists / search / brands, product pages: lib/shop/router.tsx (shared with the Next.js pages)
  if (path === '/' || path === '/products' || /^\/brand\/[^/]+$/.test(path) || /^\/p\/[^/]+$/.test(path)) {
    const r = await resolveShop({ path, query, settings, categories, base: siteUrl(req, settings) });
    if (r.kind === 'notFound') return notFound();
    if (r.kind === 'redirect') { res.writeHead(r.status, { Location: r.location, ...r.headers }); return res.end(); }
    return page(r.title, r.body, r.opts);
  }
  let m: RegExpMatchArray | null = null;
  // stops someone from trying thousands of order numbers to find other people's orders
  if (ORDER_PAGE.test(path) && !(await security.hit(db, 'orderview:' + clientIp(req), 60, 600))) return tooMany(req, res);
  // live scores, cart, wishlist, compare, checkout, project kits, order pages: lib/shop/more.tsx (shared with the Next.js pages)
  {
    const r = await $shop_more.resolveMore({ path, query, settings, base: siteUrl(req, settings), req });
    if (r) {
      if (r.kind === 'notFound') return notFound();
      if (r.kind === 'redirect') { res.writeHead(r.status, { Location: r.location, ...r.headers }); return res.end(); }
      return page(r.title, r.body, r.opts);
    }
  }
  if (path === '/track') {
    const code = str(query.get('code'), 20).toUpperCase();
    const phone = str(query.get('phone'), 20);
    if (code && phone) {
      if (!(await security.hit(db, 'track:' + clientIp(req), 20, 600))) return tooMany(req, res);
      const order = await O.getOrder({ code });
      if (order && order.phone === normalizePhone(phone)) return redirect(res, `/order/${order.code}`, { 'Set-Cookie': myOrdersCookie(req, settings, order.code) });
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

export { handler };

'use strict';
// Every request comes here: storefront pages, small JSON APIs, payments, webhooks, images and the admin panel.
const db = require('./db');
const catalog = require('./models/catalog');
const O = require('./models/orders');
const customers = require('./models/customers');
const content = require('./models/content');
const payments = require('./services/payments');
const courier = require('./services/courier');
const tracking = require('./services/tracking');
const visitors = require('./services/visitors');
const livescore = require('./services/livescore');
const feeds = require('./services/feeds');
const admin = require('./admin');
const { shopLayout } = require('./views/layout');
const shop = require('./views/shop');
const md = require('./views/md');
const { parseBody, readBody, int, str, normalizePhone, validPhone, esc, parseCookies, sign, unsign, contact, bn, amount, qtyRule } = require('./util');
const security = require('./security');

const securityHeaders = security.BASE_HEADERS;
// The home page, top to bottom (Admin → স্টোর ডিজাইন can switch rows on/off and change the order).
const HOME_DEFAULT = ['slider', 'trust', 'categories', 'new', 'offers', 'bestsellers', 'popular', 'promo', 'cat_rows', 'budget', 'featured', 'blog'];
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...securityHeaders, ...extra });
  res.end(body);
}
function json(res, status, data, extra = {}) { send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', extra); }

// "This browser placed / verified these orders" — a signed cookie, so only that customer sees the full address and phone.
function myOrders(req, settings) {
  const v = unsign(parseCookies(req.headers.cookie).sm_orders, settings.session_secret);
  return v ? v.split('.').filter(Boolean) : [];
}
function myOrdersCookie(req, settings, code) {
  const codes = [code, ...myOrders(req, settings).filter((c) => c !== code)].slice(0, 15);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_orders=${encodeURIComponent(sign(codes.join('.'), settings.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${120 * 86400}${secure}`;
}
function redirect(res, to, extra = {}) { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...extra }); res.end(); }

const clientIp = security.clientIp;
// Too many requests from one visitor: polite message, nothing else happens.
function tooMany(res, asJson) {
  const text = 'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  if (asJson) return send(res, 429, JSON.stringify({ error: text }), 'application/json; charset=utf-8', { 'Retry-After': '120' });
  return send(res, 429, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটু অপেক্ষা করুন</h1><p>${text}</p><p><a href="/">হোমে ফিরে যান</a></p></body>`, 'text/html; charset=utf-8', { 'Retry-After': '120' });
}
function siteUrl(req, settings) {
  if (settings.site_url) return settings.site_url.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = String(req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  let path = url.searchParams.get('__p');
  if (path !== null) {
    url.searchParams.delete('__p');
    path = '/' + path.replace(/^\/+/, '');
  } else {
    path = url.pathname;
  }
  try { path = decodeURIComponent(path); } catch (_) { /* keep raw */ }
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const method = req.method;
  const query = url.searchParams;

  try {
    await db.ensureReady();
  } catch (e) {
    console.error('Database setup failed:', e);
    return send(res, 503, setupErrorPage(e));
  }

  try {
    const settings = await db.getSettings();
    const isAdmin = path === '/admin' || path.startsWith('/admin/');
    const adminSend = (r, status, body, type, extra = {}) => send(r, status, body, type, { 'Content-Security-Policy': security.ADMIN_CSP, 'X-Robots-Tag': 'noindex, nofollow', ...extra });
    const base = { req, res, path, method, query, settings, send: isAdmin ? adminSend : send, json, redirect };

    // ---- images ----
    let m = path.match(/^\/media\/(\d+)(\/t)?$/);
    if (m && method === 'GET') return serveMedia(res, int(m[1]), !!m[2]);
    m = path.match(/^\/media\/(\d+)\/w$/);
    if (m && method === 'GET') return serveWatermarked(res, int(m[1]), settings);
    m = path.match(/^\/img\/p\/(\d+)$/);
    if (m) {
      const p = await db.one('SELECT image_id FROM products WHERE id=$1', [int(m[1])]);
      return p && p.image_id ? redirect(res, `/media/${p.image_id}`) : send(res, 404, 'Not found', 'text/plain');
    }

    // ---- crawlers & verification ----
    if (path === '/robots.txt') return robots(req, res, settings);
    if (path === '/sitemap.xml') return sitemap(req, res, settings);
    const vf = db.jsonSetting(settings, 'verification_files', []).find((f) => '/' + f.path === path);
    if (vf) return send(res, 200, vf.content, vf.path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', { 'Content-Security-Policy': "sandbox; default-src 'none'" });

    // ---- API ----
    const ip = clientIp(req);
    if (path === '/api/cart' && method === 'GET') return cartApi(base);
    if (path === '/api/orders' && method === 'POST') {
      // stops fake-order floods: 10 orders per hour from one connection is far above any real customer
      if (!(await security.hit(db, 'order:' + ip, 10, 3600))) return tooMany(res, true);
      return placeOrder(base);
    }
    if (path === '/api/coupon' && method === 'POST') {
      if (!(await security.hit(db, 'coupon:' + ip, 30, 600))) return tooMany(res, true);
      return couponApi(base);
    }
    if (path === '/api/v' && method === 'POST') {
      // visitor-analytics beacon: a real visitor sends a handful per page; a flood is quietly ignored
      if (!(await security.hit(db, 'beacon:' + ip, 240, 60))) return json(res, 200, {});
      return visitApi(base);
    }
    if (path === '/api/live/click' && method === 'POST') {
      if (!(await security.hit(db, 'lclick:' + ip, 60, 60))) { res.statusCode = 204; return res.end(); }
      return liveClickApi(base);
    }
    m = path.match(/^\/api\/live\/(cricket|football)$/);
    if (m && method === 'GET') return liveApi(base, m[1]);

    // ---- market research: one step of the round-the-clock work (GitHub every hour, Vercel cron daily).
    // Safe to call by anyone: it only reads other shops' public product lists, at most once per 90 seconds, and says nothing back.
    if (path === '/api/research/tick') {
      let r = {};
      try { r = await require('./services/research').tick(); } catch (_) { r = {}; }
      return json(res, 200, { ok: true, done: !r.skipped && !r.idle });
    }
    // ---- product feeds for Google Merchant Center / Facebook catalog ----
    m = path.match(/^\/feeds\/(google|facebook)\.(xml|csv|tsv)$/);
    if (m && method === 'GET') return feeds.serve({ ...base, siteUrl: siteUrl(req, settings) }, m[1], m[2]);

    // ---- payments & webhooks ----
    if (path.startsWith('/pay/')) return paymentRoutes(base);
    if (path === '/webhook/steadfast' && method === 'POST') return steadfastWebhook(base);
    if (path === '/webhook/pathao' && method === 'POST') return pathaoWebhook(base);

    if (path === '/admin' || path.startsWith('/admin/')) return admin.handle(base);

    return shopRoutes(base);
  } catch (e) {
    console.error(e);
    return send(res, 500, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>');
  }
}

async function serveMedia(res, id, thumb) {
  const m = await catalog.getMedia(id, thumb);
  if (!m) return send(res, 404, 'Not found', 'text/plain');
  const safeType = /^image\/(jpeg|png|webp|gif|x-icon)$/.test(m.mime) ? m.mime : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': safeType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox" });
  return res.end(m.data);
}

// Product page's big picture with the shop's watermark. Until the marked copy is ready
// the normal picture is sent, and only cached briefly so the marked one shows up soon.
async function serveWatermarked(res, id, settings) {
  const ver = settings.wm_on === '1' ? String(settings.wm_ver || '') : '';
  const m = ver ? await catalog.getWatermarked(id, ver) : await catalog.getMedia(id, false);
  if (!m) return send(res, 404, 'Not found', 'text/plain');
  const ready = !!(ver && m.wm);
  const safeType = ready ? 'image/jpeg' : /^image\/(jpeg|png|webp|gif|x-icon)$/.test(m.mime) ? m.mime : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': safeType, 'Cache-Control': ready ? 'public, max-age=31536000, immutable' : 'public, max-age=120', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox" });
  return res.end(ready ? m.wm : m.data);
}

// ---------------------------------------------------------------- crawlers
function robots(req, res, settings) {
  const base = siteUrl(req, settings);
  send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /api/\nDisallow: /pay/\nDisallow: /track\n\nSitemap: ${base}/sitemap.xml\n`,
    'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
}
async function sitemap(req, res, settings) {
  const base = siteUrl(req, settings);
  const [products, categories, posts, pages] = await Promise.all([
    db.q('SELECT slug, updated_at FROM products WHERE active ORDER BY id'),
    db.q('SELECT slug FROM categories WHERE coalesce(active,true) ORDER BY sort'),
    db.q(`SELECT slug, updated_at FROM blog_posts WHERE status='published' AND published_at <= now()`),
    db.q('SELECT slug, updated_at FROM pages WHERE active'),
  ]);
  const u = (loc, lastmod, pri) => `<url><loc>${esc(base + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}${pri ? `<priority>${pri}</priority>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
    u('/', null, '1.0'), u('/products', null, '0.9'), u('/blog', null, '0.5'),
    ...categories.map((c) => u(`/products?cat=${encodeURIComponent(c.slug)}`, null, '0.8')),
    ...products.map((p) => u(`/p/${encodeURIComponent(p.slug)}`, p.updated_at, '0.7')),
    ...posts.map((p) => u(`/blog/${encodeURIComponent(p.slug)}`, p.updated_at, '0.5')),
    ...pages.map((p) => u(`/page/${encodeURIComponent(p.slug)}`, p.updated_at, '0.3')),
  ].join('')}</urlset>`;
  send(res, 200, xml, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
}

// ---------------------------------------------------------------- API
// Visitor analytics beacons from shop.js. Always answers fast; never breaks the page.
async function visitApi({ req, res, settings }) {
  let out = null;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase().replace(/^www\./, '');
    out = await visitors.record({ req, settings, body: await readBody(req, 16 * 1024), ip: clientIp(req), ownHost: host });
  } catch (e) {
    console.error('visit beacon', e.message);
  }
  return json(res, 200, out || {});
}

// Live scores: cached a few seconds at Vercel's edge so every visitor gets them instantly.
async function liveApi({ res, settings }, sport) {
  if (!livescore.enabled(settings)[sport]) return json(res, 404, { error: 'off' });
  try {
    const data = await livescore.scores(sport, settings);
    return send(res, 200, JSON.stringify(data), 'application/json; charset=utf-8',
      { 'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30' });
  } catch (e) {
    console.error('live scores', e.message);
    return json(res, 502, { error: 'স্কোর এই মুহূর্তে আনা যাচ্ছে না।' });
  }
}

// A visitor tapped a match in the score box / score page: count it per competition per day (shown to the admin).
async function liveClickApi({ req, res }) {
  try {
    let b = {};
    try { b = JSON.parse(await readBody(req, 2048) || '{}'); } catch (_) { b = {}; }
    const sport = b.sport === 'football' ? 'football' : b.sport === 'cricket' ? 'cricket' : '';
    const cat = String(b.cat || '');
    const known = sport === 'cricket' ? livescore.CRICKET_LEAGUES.some(([k]) => k === cat) : livescore.FOOTBALL_LEAGUES.some(([k]) => k === cat);
    if (sport && known) {
      await db.q(`INSERT INTO live_clicks(day, sport, cat, n) VALUES ((now() AT TIME ZONE 'Asia/Dhaka')::date, $1, $2, 1)
        ON CONFLICT (day, sport, cat) DO UPDATE SET n = live_clicks.n + 1`, [sport, cat]);
    }
  } catch (e) {
    console.error('live click', e.message);
  }
  res.statusCode = 204;
  return res.end();
}

async function cartApi({ res, query }) {
  const ids = (query.get('ids') || '').split(',').map((x) => int(x)).filter((x) => x > 0).slice(0, 100);
  const products = await catalog.getProductsByIds(ids);
  return json(res, 200, {
    products: products.map((p) => ({
      id: p.id, name: p.name, slug: p.slug, price: p.price, stock: p.stock, emoji: p.emoji, sku: p.sku,
      category: p.category_name || '', image: p.image_id ? `/media/${p.image_id}/t` : null,
    })),
  });
}

async function couponApi({ req, res }) {
  const b = await parseBody(req);
  const c = await O.checkCoupon(str(b.code, 40), amount(b.subtotal), b.phone ? normalizePhone(b.phone) : '');
  return json(res, 200, c.ok ? { ok: true, discount: c.discount, freeDelivery: c.freeDelivery, code: c.coupon.code, message: c.message } : { ok: false, message: c.message });
}

async function placeOrder({ req, res, settings }) {
  const body = await parseBody(req);
  const name = str(body.name, 80);
  const phone = normalizePhone(body.phone);
  const address = str(body.address, 400);
  const district = str(body.district, 60);
  const thana = str(body.thana, 60);
  const ip = clientIp(req);
  if (name.length < 2) return json(res, 400, { error: 'আপনার নাম লিখুন।', field: 'name' });
  if (!validPhone(phone)) return json(res, 400, { error: 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।', field: 'phone' });
  const dist = O.findDistrict(district);
  if (!dist) return json(res, 400, { error: 'জেলা বাছাই করুন।', field: 'district' });
  if (!dist.areas.some((a) => a[0] === thana)) return json(res, 400, { error: 'থানা / উপজেলা বাছাই করুন।', field: 'thana' });
  if (address.length < 5) return json(res, 400, { error: 'পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', field: 'address' });

  const blocked = await customers.isBlocked(phone, ip);
  if (blocked) return json(res, 403, { error: settings.block_message || 'অর্ডার নেওয়া যাচ্ছে না।' });
  const maxDay = int(settings.max_orders_per_phone_day);
  if (maxDay > 0) {
    const st = await customers.phoneStats(phone);
    if (st.last_day >= maxDay) return json(res, 429, { error: `এই নম্বর থেকে আজ অনেকগুলো অর্ডার হয়েছে। আরও অর্ডার করতে আমাদের কল করুন${contact(settings).phone ? ': ' + contact(settings).phone : ''}।` });
  }
  const methods = payments.methods(settings);
  const method = methods.find((x) => x.id === body.payment) || methods[0];
  let trxId = '';
  let paymentNumber = '';
  if (method.manual) {
    trxId = str(body.trx, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
    paymentNumber = normalizePhone(body.payment_number);
    if (trxId.length < 6) return json(res, 400, { error: 'টাকা পাঠানোর পর পাওয়া Transaction ID (TrxID) লিখুন।', field: 'trx' });
    if (!validPhone(paymentNumber)) return json(res, 400, { error: 'যে নম্বর থেকে টাকা পাঠিয়েছেন সেটা লিখুন।', field: 'payment_number' });
  }
  try {
    const order = await O.createOrder({
      items: Array.isArray(body.items) ? body.items.slice(0, 50) : [], name, phone, email: str(body.email, 120), address, district: dist.en, thana,
      note: str(body.note, 300), payment: method.id, coupon: str(body.coupon, 40), trxId, paymentNumber, ip, source: 'web',
    }, settings);
    // Server-side conversion events (never block the order for long).
    await Promise.race([
      tracking.purchase({ ...order, phone, customer_name: name, district: dist.en, email: str(body.email, 120), ip }, settings, req),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => {});
    const online = method.id === 'bkash' || method.id === 'ssl';
    return json(res, 200, { code: order.code, redirect: online ? `/pay/${order.code}` : `/order/${order.code}?new=1` },
      { 'Set-Cookie': myOrdersCookie(req, settings, order.code) });
  } catch (e) {
    if (e instanceof O.OrderError) return json(res, 409, { error: e.message, field: e.field });
    throw e;
  }
}

// ---------------------------------------------------------------- payments
async function paymentRoutes({ req, res, path, method, query, settings }) {
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
    } catch (e) {
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
          return redirect(res, `/order/${order.code}?new=1`);
        }
        await db.logIntegration('bkash', 'execute', false, r.message, order.code);
      } catch (e) {
        await db.logIntegration('bkash', 'execute', false, e.message, order.code);
      }
    }
    await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [status === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return redirect(res, `/order/${order.code}?new=1&pay=failed`);
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
        return m[1] === 'ipn' ? send(res, 200, 'ok', 'text/plain') : redirect(res, `/order/${order.code}?new=1`);
      }
      await db.logIntegration('sslcommerz', 'validate', false, JSON.stringify(v.raw).slice(0, 300), order.code);
    }
    if (m[1] !== 'ipn') await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [m[1] === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return m[1] === 'ipn' ? send(res, 200, 'ok', 'text/plain') : redirect(res, `/order/${order.code}?new=1&pay=failed`);
  }
  return redirect(res, '/');
}

// ---------------------------------------------------------------- courier webhooks
async function applyCourierUpdate(orderRow, courierName, rawStatus) {
  await O.setCourierStatus(orderRow.id, rawStatus);
  const mapped = courier.mapStatus(courierName, rawStatus);
  if (mapped && mapped !== orderRow.status) {
    try {
      const s = await O.setStatus(orderRow.id, mapped, null);
      if (s.changed) await db.logActivity(null, 'order_status', 'order', orderRow.id, `${s.prev} → ${mapped} (${courierName} ওয়েবহুক)`);
    } catch (e) { await db.logIntegration(courierName, 'webhook', false, e.message, orderRow.code); }
  }
}
async function steadfastWebhook({ req, res, settings }) {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!settings.steadfast_webhook_token || !security.safeEqual(auth, settings.steadfast_webhook_token)) return json(res, 401, { status: 'error', message: 'Unauthorized' });
  const b = await parseBody(req);
  const cid = String(b.consignment_id || '');
  const order = await db.one(`SELECT id, code, status FROM orders WHERE (consignment_id=$1 AND $1<>'') OR code=$2 LIMIT 1`, [cid, String(b.invoice || '')]);
  if (order && b.status) await applyCourierUpdate(order, 'steadfast', String(b.status));
  await db.logIntegration('steadfast', 'webhook', !!order, `${b.notification_type || ''} ${cid} ${b.status || ''}`, order ? order.code : '');
  return json(res, 200, { status: 'success', message: 'Webhook received successfully.' });
}
async function pathaoWebhook({ req, res, settings }) {
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
async function shopRoutes({ req, res, path, method, query, settings }) {
  const [categories, pages, popups] = await Promise.all([
    catalog.listCategories({ includeInactive: false }), content.listPages({ active: true }), content.listBanners({ active: true, placement: 'popup' }),
  ]);
  const page = (title, body, opts = {}) => send(res, opts.status || 200,
    shopLayout({ settings, title, body, categories, pages, popup: popups[0] || null, ...opts }));
  const notFound = () => page('পাওয়া যায়নি', shop.notFound(), { status: 404, noindex: true });
  if (method !== 'GET' && method !== 'HEAD') return notFound();

  if (path === '/') {
    const sections = db.jsonSetting(settings, 'home_sections', HOME_DEFAULT);
    const want = (k) => sections.includes(k);
    const ROW = 16;
    const inStockFirst = (a) => [...a.filter((p) => p.stock > 0), ...a.filter((p) => p.stock <= 0)];
    // most looked-at products of the last 30 days (real visitors)
    const viewedIds = want('popular') ? (await db.q(`SELECT product_id FROM page_views WHERE product_id IS NOT NULL AND created_at > now() - interval '30 days'
      GROUP BY product_id ORDER BY count(DISTINCT visitor_id) DESC LIMIT $1`, [ROW * 2])).map((r) => r.product_id) : [];
    const [slides, promos, featured, latest, best, offers, posts, viewed, budget] = await Promise.all([
      want('slider') ? content.listBanners({ active: true, placement: 'slider' }) : [],
      want('promo') ? content.listBanners({ active: true, placement: 'promo' }) : [],
      want('featured') || want('popular') ? catalog.listProducts({ featured: true, limit: ROW }) : [],
      want('new') ? catalog.listProducts({ sort: 'new', limit: ROW * 2 }) : [],
      want('bestsellers') ? catalog.listProducts({ sort: 'popular', limit: ROW * 2 }) : [],
      want('offers') ? catalog.listProducts({ offer: true, sort: 'offer', limit: ROW * 2 }) : [],
      want('blog') ? content.listPosts({ published: true, limit: 3 }) : [],
      viewedIds.length ? catalog.getProductsByIds(viewedIds) : [],
      want('budget') ? catalog.listProducts({ sort: 'popular', maxPrice: 100, limit: ROW * 2 }) : [],
    ]);
    const order = new Map(viewedIds.map((id, i) => [id, i]));
    const popularList = viewed.sort((a, b) => order.get(a.id) - order.get(b.id));
    // category rows: each main category with its best products
    let catRows = [];
    if (want('cat_rows')) {
      const { roots } = catalog.categoryTree(categories);
      const mains = roots.filter((c) => c.total_count >= 4).slice(0, 8);
      catRows = await Promise.all(mains.map(async (c) => ({
        cat: c, chips: c.children.filter((k) => k.total_count > 0).slice(0, 8),
        products: inStockFirst(await catalog.listProducts({ category: c.slug, sort: 'popular', limit: ROW * 2 })).slice(0, ROW),
      })));
    }
    const take = (a) => inStockFirst(a).slice(0, ROW);
    const data = {
      slides, promos, categories, posts, catRows,
      latest: latest.slice(0, ROW),
      offers: take(offers),
      best: take(best.filter((p) => p.sold_count > 0)),
      popular: take(popularList.length >= 4 ? popularList : featured),
      featured: take(featured),
      budget: take(budget.filter((p) => p.stock > 0)),
    };
    const jsonLd = { '@context': 'https://schema.org', '@type': 'Store', name: settings.store_name, description: settings.tagline,
      url: settings.site_url || undefined, telephone: contact(settings).phone || undefined, address: settings.address || undefined };
    return page('', shop.home({ settings, sections, data }), { canonical: '/', jsonLd, description: settings.seo_description || settings.tagline });
  }
  if (path === '/products') {
    const q = str(query.get('q'), 80);
    const sort = ['new', 'popular', 'offer', 'price_asc', 'price_desc'].includes(query.get('sort')) ? query.get('sort') : '';
    const category = query.get('cat') ? categories.find((c) => c.slug === query.get('cat')) || null : null;
    const perPage = (Number(settings.grid_cols) || 4) * 6;
    const pageNo = Math.max(1, int(query.get('page'), 1));
    const opts = { category: category && category.slug, q, sort, offer: sort === 'offer' };
    const [products, total] = await Promise.all([catalog.listProducts({ ...opts, limit: perPage, offset: (pageNo - 1) * perPage }), catalog.countProducts(opts)]);
    const title = category ? category.name : q ? `খুঁজুন: ${q}` : sort === 'offer' ? 'অফার' : 'সব পণ্য';
    return page(title, shop.listing({ products, categories, category, q, sort, settings, total, page: pageNo, perPage }),
      { q, active: 'products', canonical: category ? `/products?cat=${category.slug}` : '/products', noindex: !!q, track: q ? { event: 'search', q } : null });
  }
  let m = path.match(/^\/p\/([^/]+)$/);
  if (m) {
    const product = await catalog.getProduct({ slug: m[1] });
    if (!product || !product.active) return notFound();
    const related = product.category_slug
      ? (await catalog.listProducts({ category: product.category_slug, limit: 9 })).filter((p) => p.id !== product.id).slice(0, (Number(settings.grid_cols) || 4))
      : [];
    const slugs = [...String(product.description || '').matchAll(/^\s*\/p\/([A-Za-z0-9ঀ-৿-]+)\s*$/gm)].map((x) => x[1]).slice(0, 6);
    const inlineProducts = {};
    for (const s of slugs) { const ip = await catalog.getProduct({ slug: s }); if (ip && ip.active) inlineProducts[s] = ip; }
    const base = (settings.site_url || '').replace(/\/+$/, '');
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'Product', name: product.name, sku: product.sku || undefined,
      description: md.plain(product.short_description || product.description, 300), brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      image: product.images.map((id) => `${base}/media/${id}`),
      offers: { '@type': 'Offer', priceCurrency: 'BDT', price: product.price, availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: `${base}/p/${product.slug}` },
    };
    return page(product.seo_title || product.name, shop.productPage({ product, related, settings, inlineProducts, categories }), {
      description: product.seo_description || md.plain(product.short_description || product.description, 160),
      keywords: product.seo_keywords || '',
      canonical: `/p/${product.slug}`, image: product.image_id ? `/media/${product.image_id}` : '', jsonLd, type: 'product',
      track: { event: 'view_item', id: product.id, name: product.name, price: product.price, category: product.category_name || '' },
    });
  }
  if (path === '/live' || (m = path.match(/^\/live\/(cricket|football)$/))) {
    const on = livescore.enabled(settings);
    const sport = m ? m[1] : (on.cricket ? 'cricket' : 'football');
    if (!on[sport]) return notFound();
    if (!m) return redirect(res, `/live/${sport}`);
    const embed = settings[`live_${sport}_source`] === 'embed' && String(settings[`live_${sport}_embed`] || '').trim();
    let data = null;
    if (!embed) data = await Promise.race([livescore.scores(sport, settings), new Promise((r) => setTimeout(() => r(null), 3500))]).catch(() => null);
    const title = sport === 'cricket' ? 'লাইভ ক্রিকেট স্কোর' : 'লাইভ ফুটবল স্কোর';
    return page(title, shop.livePage({ sport, on, data, embed, settings }), {
      active: 'live', canonical: `/live/${sport}`,
      description: sport === 'cricket' ? 'বাংলাদেশসহ সব আন্তর্জাতিক ও লিগ ক্রিকেটের লাইভ স্কোর, প্রতি কয়েক সেকেন্ডে আপডেট।' : 'বিশ্বকাপ, প্রিমিয়ার লিগ, লা লিগা সহ সব বড় ফুটবল ম্যাচের লাইভ স্কোর।',
    });
  }
  if (path === '/cart') return page('কার্ট', shop.cartPage({ settings }), { active: 'cart', noindex: true });
  if (path === '/checkout') {
    return page('অর্ডার করুন', shop.checkoutPage({ settings, methods: payments.methods(settings), cityAreas: O.dhakaCityAreas(settings) }),
      { active: 'cart', noindex: true, track: { event: 'begin_checkout' } });
  }
  m = path.match(/^\/order\/([A-Za-z0-9]+)(\/invoice)?$/);
  if (m) {
    // stops someone from trying thousands of order numbers to find other people's orders
    if (!(await security.hit(db, 'orderview:' + clientIp(req), 60, 600))) return tooMany(res);
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return notFound();
    const mine = myOrders(req, settings).includes(order.code);
    // Invoices are only for the shop's own staff (Admin → অর্ডার → ইনভয়েস), not for customers.
    if (m[2]) return redirect(res, `/order/${order.code}`);
    const fresh = query.get('new') === '1';
    const trackUrl = order.courier && courier.PROVIDERS[order.courier] ? courier.PROVIDERS[order.courier].track(order) : '';
    const track = fresh && query.get('pay') !== 'failed'
      ? { event: 'purchase', code: order.code, value: order.total, items: order.items.map((i) => ({ id: i.product_id, name: i.name, price: i.price, qty: i.qty })) }
      : null;
    return page(`অর্ডার ${order.code}`, shop.orderPage({ order, settings, fresh, payFailed: query.get('pay') === 'failed', trackUrl, mine }), { noindex: true, track });
  }
  if (path === '/track') {
    const code = str(query.get('code'), 20).toUpperCase();
    const phone = str(query.get('phone'), 20);
    if (code && phone) {
      if (!(await security.hit(db, 'track:' + clientIp(req), 20, 600))) return tooMany(res);
      const order = await O.getOrder({ code });
      if (order && order.phone === normalizePhone(phone)) return redirect(res, `/order/${order.code}`, { 'Set-Cookie': myOrdersCookie(req, settings, order.code) });
      return page('অর্ডার ট্র্যাক', shop.trackPage({ code, phone, error: 'এই অর্ডার নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।' }), { active: 'track', noindex: true });
    }
    return page('অর্ডার ট্র্যাক', shop.trackPage({ code: code.replace(/[^A-Z0-9]/g, '') }), { active: 'track' });
  }
  if (path === '/blog' || (m = path.match(/^\/blog\/category\/([^/]+)$/))) {
    const cats = await content.listBlogCategories();
    const category = m ? cats.find((c) => c.slug === m[1]) : null;
    if (m && !category) return notFound();
    const posts = await content.listPosts({ published: true, categorySlug: category && category.slug, limit: 60 });
    return page(category ? category.name : 'ব্লগ', shop.blogList({ posts, categories: cats, category }), { active: 'blog', canonical: category ? `/blog/category/${category.slug}` : '/blog' });
  }
  m = path.match(/^\/blog\/([^/]+)$/);
  if (m) {
    const post = await content.getPost({ slug: m[1] });
    if (!post || post.status !== 'published' || new Date(post.published_at) > new Date()) return notFound();
    db.q('UPDATE blog_posts SET views = views + 1 WHERE id=$1', [post.id]).catch(() => {});
    let contentHtml = md.render(post.content, { productCard: true });
    const slugs = [...contentHtml.matchAll(/<!--product:([^>]+)-->/g)].map((x) => x[1]).slice(0, 10);
    for (const s of slugs) {
      const p = await catalog.getProduct({ slug: s });
      contentHtml = contentHtml.replace(`<!--product:${s}-->`, p && p.active ? `<div class="grid grid-inline">${shop.productCard(p, settings).s}</div>` : '');
    }
    const related = (await content.listPosts({ published: true, categorySlug: post.category_slug, limit: 4 })).filter((p) => p.id !== post.id).slice(0, 3);
    return page(post.seo_title || post.title, shop.blogPost({ post, contentHtml, related }), {
      active: 'blog', canonical: `/blog/${post.slug}`, description: post.seo_description || post.excerpt || md.plain(post.content), image: post.cover_id ? `/media/${post.cover_id}` : '', type: 'article',
      jsonLd: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, datePublished: post.published_at, author: post.author_name ? { '@type': 'Person', name: post.author_name } : undefined },
    });
  }
  m = path.match(/^\/page\/([^/]+)$/);
  if (m) {
    const p = await content.getPage({ slug: m[1] });
    if (!p || !p.active) return notFound();
    return page(p.title, shop.staticPage({ page: p }), { canonical: `/page/${p.slug}`, description: md.plain(p.content) });
  }
  return notFound();
}

function setupErrorPage(e) {
  const missing = /DATABASE_URL/.test(e.message);
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>সেটআপ বাকি</title>
<body style="font-family:'Noto Sans Bengali',sans-serif;max-width:560px;margin:60px auto;padding:0 20px;line-height:1.7;color:#14213D">
<h1>ওয়েবসাইট ডাটাবেসের সাথে যুক্ত হতে পারছে না</h1>
${missing
    ? '<p>Vercel-এ ডাটাবেস এখনো এই প্রজেক্টের সাথে যুক্ত হয়নি। Vercel → প্রজেক্ট → Storage থেকে Neon ডাটাবেসটি এই প্রজেক্টে Connect করুন, তারপর Deployments থেকে Redeploy দিন।</p>'
    : '<p>ডাটাবেস সাময়িকভাবে সাড়া দিচ্ছে না। কিছুক্ষণ পর পেজটি রিফ্রেশ করুন।</p>'}
</body></html>`;
}

module.exports = { handler };

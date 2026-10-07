'use strict';
const db = require('./db');
const { html, parseCookies, parseBody, hashPassword, verifyPassword, sign, unsign, int } = require('./util');
const { shopLayout, adminLayout } = require('./views/layout');
const shop = require('./views/shop');
const admin = require('./views/admin');

const SESSION_DAYS = 30;
const MESSAGES = {
  saved: 'সেভ হয়েছে।',
  added: 'নতুন পণ্য যোগ হয়েছে।',
  deleted: 'মুছে ফেলা হয়েছে।',
  status: 'অর্ডারের অবস্থা বদলানো হয়েছে।',
  password: 'পাসওয়ার্ড বদলানো হয়েছে।',
  badpw: { type: 'error', text: 'বর্তমান পাসওয়ার্ড ভুল, অথবা নতুন পাসওয়ার্ড ৮ অক্ষরের কম।' },
};

// ---------- response helpers ----------
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...securityHeaders, ...extra });
  res.end(body);
}
function json(res, status, data) { send(res, status, JSON.stringify(data), 'application/json; charset=utf-8'); }
function redirect(res, to, extra = {}) { res.writeHead(303, { Location: to, ...extra }); res.end(); }
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

function normalizePhone(p) {
  let d = String(p || '').replace(/[০-৯]/g, (c) => '০১২৩৪৫৬৭৮৯'.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.startsWith('88')) d = d.slice(2);
  return d;
}

// ---------- admin session ----------
async function adminSession(req, settings) {
  const cookie = parseCookies(req.headers.cookie).sm_admin;
  const value = unsign(cookie, settings.session_secret);
  if (!value) return false;
  const [, issued, pwTag] = value.split(':');
  if (Date.now() - Number(issued) > SESSION_DAYS * 864e5) return false;
  return pwTag === (settings.admin_password || '').slice(-12);
}
function sessionCookie(req, settings) {
  const value = sign(`admin:${Date.now()}:${(settings.admin_password || '').slice(-12)}`, settings.session_secret);
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_admin=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

// ---------- main handler ----------
async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  let path = url.searchParams.get('__p');
  if (path !== null) {
    url.searchParams.delete('__p');
    path = '/' + path.replace(/^\/+/, '');
  } else {
    path = url.pathname;
  }
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
    const ctx = { req, res, path, method, query, settings };

    // ---- images ----
    let m = path.match(/^\/img\/p\/(\d+)$/);
    if (m && method === 'GET') return serveImage(ctx, int(m[1]));

    // ---- API ----
    if (path === '/api/cart' && method === 'GET') {
      const ids = (query.get('ids') || '').split(',').map((x) => int(x)).filter((x) => x > 0).slice(0, 100);
      const products = await db.getProductsByIds(ids);
      return json(res, 200, {
        products: products.map((p) => ({
          id: p.id, name: p.name, slug: p.slug, price: p.price, stock: p.stock, emoji: p.emoji,
          image: p.has_image ? `/img/p/${p.id}?v=${p.version}` : null,
        })),
      });
    }
    if (path === '/api/orders' && method === 'POST') return placeOrder(ctx);

    if (path.startsWith('/admin')) return adminRoutes(ctx);

    // ---- shop pages ----
    const page = (title, body, opts = {}) => send(res, opts.status || 200,
      shopLayout({ settings, title, body, ...opts }));

    if (path === '/' && method === 'GET') {
      const [categories, featured, latest] = await Promise.all([
        db.listCategories(),
        db.listProducts({ featured: true, limit: 8 }),
        db.listProducts({ sort: 'new', limit: 8 }),
      ]);
      const featuredIds = new Set(featured.map((p) => p.id));
      return page('', shop.home({ settings, categories, featured, latest: latest.filter((p) => !featuredIds.has(p.id)).slice(0, 4) }));
    }
    if (path === '/products' && method === 'GET') {
      const q = (query.get('q') || '').trim().slice(0, 80);
      const sort = query.get('sort') || '';
      const categories = await db.listCategories();
      const category = query.get('cat') ? categories.find((c) => c.slug === query.get('cat')) || null : null;
      const products = await db.listProducts({ category: category && category.slug, q, sort });
      return page(category ? category.name : q ? `খুঁজুন: ${q}` : 'সব পণ্য',
        shop.listing({ products, categories, category, q, sort }), { q, active: 'products' });
    }
    m = path.match(/^\/p\/([^/]+)$/);
    if (m && method === 'GET') {
      const product = await db.getProduct({ slug: decodeURIComponent(m[1]) });
      if (!product || !product.active) return page('পাওয়া যায়নি', shop.notFound(), { status: 404 });
      const related = product.category_slug
        ? (await db.listProducts({ category: product.category_slug, limit: 5 })).filter((p) => p.id !== product.id).slice(0, 4)
        : [];
      return page(product.name, shop.productPage({ product, related, settings }),
        { description: (product.description || '').slice(0, 150) });
    }
    if (path === '/cart' && method === 'GET') return page('কার্ট', shop.cartPage({ settings }), { active: 'cart' });
    if (path === '/checkout' && method === 'GET') return page('অর্ডার করুন', shop.checkoutPage({ settings }), { active: 'cart' });
    m = path.match(/^\/order\/([A-Za-z0-9]+)$/);
    if (m && method === 'GET') {
      const order = await db.getOrder({ code: m[1].toUpperCase() });
      if (!order) return page('পাওয়া যায়নি', shop.notFound(), { status: 404 });
      return page(`অর্ডার ${order.code}`, shop.orderPage({ order, settings, fresh: query.get('new') === '1' }));
    }
    if (path === '/track' && method === 'GET') {
      const code = (query.get('code') || '').trim().toUpperCase();
      const phone = (query.get('phone') || '').trim();
      if (code && phone) {
        const order = await db.getOrder({ code });
        if (order && normalizePhone(order.phone) === normalizePhone(phone)) return redirect(res, `/order/${order.code}`);
        return page('অর্ডার ট্র্যাক', shop.trackPage({ code, phone, error: 'এই অর্ডার নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।' }), { active: 'track' });
      }
      return page('অর্ডার ট্র্যাক', shop.trackPage({}), { active: 'track' });
    }
    return page('পাওয়া যায়নি', shop.notFound(), { status: 404 });
  } catch (e) {
    console.error(e);
    return send(res, 500, '<!doctype html><meta charset="utf-8"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>');
  }
}

async function serveImage({ res }, id) {
  const data = await db.getProductImage(id);
  const m = data && data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, Buffer.from(m[2], 'base64'), m[1], { 'Cache-Control': 'public, max-age=31536000, immutable' });
}

async function placeOrder({ req, res }) {
  const body = await parseBody(req);
  const name = String(body.name || '').trim().slice(0, 80);
  const phone = normalizePhone(body.phone);
  const address = String(body.address || '').trim().slice(0, 400);
  const area = body.area === 'outside' ? 'outside' : 'dhaka';
  const note = String(body.note || '').trim().slice(0, 300);
  if (name.length < 2) return json(res, 400, { error: 'আপনার নাম লিখুন।', field: 'name' });
  if (!/^01[3-9]\d{8}$/.test(phone)) return json(res, 400, { error: 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।', field: 'phone' });
  if (address.length < 8) return json(res, 400, { error: 'পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', field: 'address' });
  try {
    const code = await db.createOrder({ items: Array.isArray(body.items) ? body.items : [], name, phone, address, area, note });
    return json(res, 200, { code });
  } catch (e) {
    if (e instanceof db.OrderError) return json(res, 409, { error: e.message });
    throw e;
  }
}

// ---------- admin ----------
async function adminRoutes(ctx) {
  const { req, res, path, method, query } = ctx;
  let { settings } = ctx;
  const page = (title, body, active, extra = {}) => send(res, extra.status || 200,
    adminLayout({ settings, title, body, active, ...extra }));
  const msg = MESSAGES[query.get('msg')];
  const flash = msg ? (typeof msg === 'string' ? { text: msg } : msg) : null;
  const hasPassword = !!settings.admin_password;

  // --- public admin routes ---
  if (path === '/admin/setup' && method === 'POST') {
    if (hasPassword) return redirect(res, '/admin/login');
    const body = await parseBody(req);
    const error = (body.password || '').length < 8 ? 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।'
      : body.password !== body.password2 ? 'দুটো পাসওয়ার্ড মিলছে না।' : null;
    if (error) return page('পাসওয়ার্ড তৈরি', admin.loginPage({ settings, setup: true, error }), '', { bare: true, status: 400 });
    await db.setSetting('admin_password', hashPassword(body.password));
    settings = await db.getSettings();
    return redirect(res, '/admin', { 'Set-Cookie': sessionCookie(req, settings) });
  }
  if (path === '/admin/login') {
    if (!hasPassword) return page('পাসওয়ার্ড তৈরি', admin.loginPage({ settings, setup: true }), '', { bare: true });
    if (method === 'POST') {
      const body = await parseBody(req);
      if (verifyPassword(body.password || '', settings.admin_password)) {
        return redirect(res, '/admin', { 'Set-Cookie': sessionCookie(req, settings) });
      }
      return page('লগইন', admin.loginPage({ settings, error: 'পাসওয়ার্ড ভুল হয়েছে। আবার চেষ্টা করুন।' }), '', { bare: true, status: 401 });
    }
    return page('লগইন', admin.loginPage({ settings }), '', { bare: true });
  }
  if (path === '/admin/logout' && method === 'POST') {
    return redirect(res, '/admin/login', { 'Set-Cookie': 'sm_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
  }

  // --- everything below needs login ---
  if (!(await adminSession(req, settings))) return redirect(res, '/admin/login');

  if (path === '/admin' && method === 'GET') {
    const [stats, orders] = await Promise.all([db.dashboardStats(), db.listOrders({ limit: 8 })]);
    return page('ড্যাশবোর্ড', admin.dashboard({ stats, orders }), 'home');
  }

  // orders
  if (path === '/admin/orders' && method === 'GET') {
    const status = db.STATUSES[query.get('status')] ? query.get('status') : '';
    const q = (query.get('q') || '').trim();
    const orders = await db.listOrders({ status, q });
    return page('অর্ডার', admin.ordersPage({ orders, status, q }), 'orders');
  }
  let m = path.match(/^\/admin\/orders\/(\d+)(\/status)?$/);
  if (m) {
    const id = int(m[1]);
    if (m[2] && method === 'POST') {
      const body = await parseBody(req);
      await db.setOrderStatus(id, body.status);
      return redirect(res, `/admin/orders/${id}?msg=status`);
    }
    const order = await db.getOrder({ id });
    if (!order) return redirect(res, '/admin/orders');
    return page(`অর্ডার ${order.code}`, admin.orderDetail({ order, msg: flash }), 'orders');
  }

  // products
  if (path === '/admin/products' && method === 'GET') {
    let products = await db.listProducts({ includeInactive: true, sort: 'new' });
    const low = query.get('low') === '1';
    if (low) products = products.filter((p) => p.active && p.stock <= 3);
    return page('পণ্য', admin.productsPage({ products, msg: flash, low }), 'products');
  }
  if (path === '/admin/products/new') {
    const categories = await db.listCategories();
    if (method === 'POST') {
      const body = await parseBody(req);
      if (!String(body.name || '').trim()) {
        return page('নতুন পণ্য', admin.productForm({ categories, error: 'পণ্যের নাম লিখুন।' }), 'products', { status: 400 });
      }
      await db.saveProduct({ ...body, name: body.name.trim(), image: validImage(body.image) });
      return redirect(res, '/admin/products?msg=added');
    }
    return page('নতুন পণ্য', admin.productForm({ categories }), 'products');
  }
  m = path.match(/^\/admin\/products\/(\d+)(\/delete)?$/);
  if (m) {
    const id = int(m[1]);
    if (m[2] && method === 'POST') {
      await db.deleteProduct(id);
      return redirect(res, '/admin/products?msg=deleted');
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      if (!String(body.name || '').trim()) return redirect(res, `/admin/products/${id}`);
      await db.saveProduct({ ...body, id, name: body.name.trim(), image: validImage(body.image) });
      return redirect(res, '/admin/products?msg=saved');
    }
    const [product, categories] = await Promise.all([db.getProduct({ id }), db.listCategories()]);
    if (!product) return redirect(res, '/admin/products');
    return page(product.name, admin.productForm({ product, categories }), 'products');
  }

  // categories
  if (path === '/admin/categories') {
    if (method === 'POST') {
      const body = await parseBody(req);
      if (String(body.name || '').trim()) {
        await db.saveCategory({ id: body.id ? int(body.id) : null, name: body.name.trim(), icon: body.icon, sort: body.sort });
      }
      return redirect(res, '/admin/categories?msg=saved');
    }
    const categories = await db.listCategories();
    return page('ক্যাটাগরি', admin.categoriesPage({ categories, msg: flash }), 'categories');
  }
  m = path.match(/^\/admin\/categories\/(\d+)\/delete$/);
  if (m && method === 'POST') {
    await db.deleteCategory(int(m[1]));
    return redirect(res, '/admin/categories?msg=deleted');
  }

  // settings
  if (path === '/admin/settings') {
    if (method === 'POST') {
      const body = await parseBody(req);
      for (const key of ['store_name', 'tagline', 'notice', 'phone', 'whatsapp']) {
        if (key in body) await db.setSetting(key, String(body[key]).trim().slice(0, 200));
      }
      for (const key of ['delivery_dhaka', 'delivery_outside', 'free_delivery_min']) {
        if (key in body) await db.setSetting(key, String(Math.max(0, int(body[key]))));
      }
      return redirect(res, '/admin/settings?msg=saved');
    }
    return page('সেটিংস', admin.settingsPage({ settings, msg: flash }), 'settings');
  }
  if (path === '/admin/password' && method === 'POST') {
    const body = await parseBody(req);
    if (!verifyPassword(body.current || '', settings.admin_password) || (body.password || '').length < 8) {
      return redirect(res, '/admin/settings?msg=badpw');
    }
    await db.setSetting('admin_password', hashPassword(body.password));
    settings = await db.getSettings();
    return redirect(res, '/admin/settings?msg=password', { 'Set-Cookie': sessionCookie(req, settings) });
  }

  return page('পাওয়া যায়নি', html`<h1>পেজটি পাওয়া যায়নি</h1><p><a href="/admin">ড্যাশবোর্ডে ফিরে যান</a></p>`, '', { status: 404 });
}

function validImage(v) {
  if (!v) return null;
  if (v === '__remove__') return v;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 3_000_000 ? v : null;
}

function setupErrorPage(e) {
  const missing = /DATABASE_URL/.test(e.message);
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>সেটআপ বাকি</title>
<body style="font-family:'Hind Siliguri',sans-serif;max-width:560px;margin:60px auto;padding:0 20px;line-height:1.7;color:#14213D">
<h1>ওয়েবসাইট ডাটাবেসের সাথে যুক্ত হতে পারছে না</h1>
${missing
    ? '<p>Vercel-এ ডাটাবেস এখনো এই প্রজেক্টের সাথে যুক্ত হয়নি। Vercel → প্রজেক্ট → Storage থেকে Neon ডাটাবেসটি এই প্রজেক্টে Connect করুন, তারপর Deployments থেকে Redeploy দিন।</p>'
    : '<p>ডাটাবেস সাময়িকভাবে সাড়া দিচ্ছে না। কিছুক্ষণ পর পেজটি রিফ্রেশ করুন।</p>'}
</body></html>`;
}

module.exports = { handler, normalizePhone };

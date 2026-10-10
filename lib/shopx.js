'use strict';
// Customer pages that take forms: 👤 আমার অ্যাকাউন্ট (OTP login, orders, addresses, profile, referral, gift cards),
// ↩️ the return request on a delivered order, and 🎁 buying a gift card.
// Every form here must come from this same site (checked) and the login cookie is SameSite=Lax.
const db = require('./db');
const security = require('./security');
const A = require('./models/accounts');
const V = require('./views/account');
const O = require('./models/orders');
const { parseBody, str, int, normalizePhone, validPhone, parseCookies, sign, unsign } = require('./util');

const safeNext = (n) => (/^\/(?!\/)[A-Za-z0-9/_?=&.%-]{0,200}$/.test(String(n || '')) && !String(n).startsWith('/account') ? String(n) : '');

// The browser's "my orders" list (order page shows the full address / reviews / returns for these).
function ordersCookie(req, settings, codes) {
  const old = (() => { const v = unsign(parseCookies(req.headers.cookie).sm_orders, settings.session_secret); return v ? v.split('.').filter(Boolean) : []; })();
  const all = [...new Set([...codes, ...old])].slice(0, 15);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_orders=${encodeURIComponent(sign(all.join('.'), settings.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${120 * 86400}${secure}`;
}
function myOrders(req, settings) {
  const v = unsign(parseCookies(req.headers.cookie).sm_orders, settings.session_secret);
  return v ? v.split('.').filter(Boolean) : [];
}

async function route({ req, res, path, method, query, settings, page, notFound, redirect, ip }) {
  const isPost = method === 'POST';
  if (isPost && !security.sameSite(req)) return page('অনুমতি নেই', '<div class="wrap section"><p>এই ফর্ম অন্য ওয়েবসাইট থেকে পাঠানো হয়েছে।</p></div>', { status: 403, noindex: true });
  const go = (to, cookies) => redirect(res, to, cookies ? { 'Set-Cookie': cookies } : {});

  // ---------------------------------------------------------------- 🙋 the customer cancels / changes their own order
  let sm = path.match(/^\/order\/([A-Za-z0-9]+)\/(cancel|edit)$/);
  if (sm) {
    if (!isPost) return go(`/order/${sm[1].toUpperCase()}`);
    const code = sm[1].toUpperCase();
    const SS = require('./models/selfservice');
    const back = (msg, ok) => go(`/order/${code}?${ok ? 'done' : 'err'}=${encodeURIComponent(msg)}#self`);
    if (!myOrders(req, settings).includes(code)) return back('এই অর্ডারটি বদলাতে আগে "অর্ডার ট্র্যাক" পেজে অর্ডার নম্বর আর মোবাইল নম্বর দিয়ে খুলুন।');
    if (!(await security.hit(db, 'selfsvc:' + ip, 20, 3600))) return back('অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।');
    const order = await O.getOrder({ code });
    const b = await parseBody(req);
    try {
      if (sm[2] === 'cancel') {
        const r = await SS.cancel(order, { reason: b.reason, details: b.details }, settings);
        return back(`অর্ডারটি বাতিল হয়েছে।${r.paid > 0 ? ' আগে দেওয়া টাকা ১০ দিনের মধ্যে ফেরত দেওয়া হবে।' : ''}`, true);
      }
      const r = await SS.change(order, b, { req, settings });
      return back(`তথ্য বদলানো হয়েছে।${r.delivery !== r.oldDelivery ? ` নতুন এলাকার ডেলিভারি চার্জ ৳${Math.round(r.delivery)}, মোট ৳${r.total}।` : ''}`, true);
    } catch (e) {
      if (!(e instanceof SS.SelfError) && !(e instanceof O.OrderError)) throw e;
      return back(e.message);
    }
  }

  // ---------------------------------------------------------------- 📮 complaints
  if (path === '/complaint' || path === '/complaint/status') {
    if (settings.complaints_on === '0') return notFound();
    const CV = require('./views/complaint');
    const CM = require('./models/complaints');
    if (path === '/complaint/status') {
      const code = str(query.get('code'), 12).toUpperCase().trim();
      const phone = query.get('phone');
      if (code && phone) {
        if (!(await security.hit(db, 'cstat:' + ip, 30, 3600))) return page('অভিযোগের অবস্থা', CV.statusPage({ code, error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার দেখুন।' }), { noindex: true, status: 429 });
        const c = await CM.forCustomer(code, phone);
        return page('অভিযোগের অবস্থা', CV.statusPage({ c, code, error: c ? '' : 'এই নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।' }), { noindex: true });
      }
      return page('অভিযোগের অবস্থা', CV.statusPage({ code }), { noindex: true });
    }
    if (!isPost) {
      const oc = str(query.get('order'), 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const values = { order_code: oc };
      // 🛡️ "ওয়ারেন্টি দাবি করুন" from an order's page: the product is named on the form
      if (query.get('topic') === 'warranty' && oc) {
        const order = await O.getOrder({ code: oc });
        const items = CM.warrantyItems(order);
        const it = items.find((x) => x.product_id === int(query.get('item'))) || (items.length === 1 ? items[0] : null);
        Object.assign(values, { topic: 'warranty', item: it ? it.product_id : '', item_name: it ? it.name : '', item_end: it && it.end instanceof Date ? it.end : null, items });
      }
      return page('অভিযোগ জানান', CV.complaintPage({ settings, values }), { canonical: '/complaint', description: 'অর্ডার, পণ্য, ডেলিভারি বা টাকা নিয়ে সমস্যা জানান — ৭২ ঘণ্টার মধ্যে সমাধান।' });
    }
    const b = await parseBody(req);
    if (b.website) return go('/complaint'); // a robot filled the hidden box
    if (!(await security.hit(db, 'complaint:' + ip, 6, 3600))) return page('অভিযোগ জানান', CV.complaintPage({ settings, values: b, error: 'অনেকগুলো অভিযোগ পাঠানো হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা ফোন করুন।' }), { noindex: true, status: 429 });
    let photos = [];
    try { photos = JSON.parse(b.photos || '[]'); } catch (_) { photos = []; }
    try {
      const c = await CM.create({ name: b.name, phone: b.phone, email: b.email, orderCode: b.order_code, topic: b.topic, message: b.message, photos, ip, settings, productId: b.item });
      const site = (settings.site_url || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
      const hours = CM.hoursOf(settings);
      const notify = require('./services/notify');
      await notify.newComplaint(settings, site, c, CM.TOPICS[c.topic] || c.topic, hours).catch(() => {});
      if (settings.complaint_sms_on !== '0') {
        const SMS = require('./services/sms');
        if (SMS.ready(settings).ok) await notify.later(SMS.send(settings, c.phone, `${settings.store_name || ''}: আপনার অভিযোগ ${c.code} পেয়েছি। ${hours} ঘণ্টার মধ্যে সমাধান করা হবে। অবস্থা দেখুন: ${site}/complaint/status?code=${c.code}`, { kind: 'complaint' }));
      }
      return page('অভিযোগ জমা হয়েছে', CV.complaintPage({ settings, done: c }), { noindex: true });
    } catch (e) {
      if (!(e instanceof CM.ComplaintError)) throw e;
      return page('অভিযোগ জানান', CV.complaintPage({ settings, values: b, error: e.message }), { noindex: true, status: 400 });
    }
  }

  // ---------------------------------------------------------------- account
  if (path === '/account' || path.startsWith('/account/')) {
    if (!A.on(settings)) return notFound();
    const cu = await A.current(req, settings);
    const next = safeNext(isPost ? '' : query.get('next'));
    if (path === '/account/code' && isPost) {
      const b = await parseBody(req);
      try {
        const r = await A.sendCode(settings, b.phone, ip);
        return page('লগইন', V.loginPage({ step: 'code', phone: r.phone, next: safeNext(b.next) }), { noindex: true });
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return page('লগইন', V.loginPage({ phone: str(b.phone, 20), error: e.message, next: safeNext(b.next) }), { noindex: true, status: 400 });
      }
    }
    if (path === '/account/verify' && isPost) {
      const b = await parseBody(req);
      if (!(await security.hit(db, 'otpv:' + ip, 20, 3600))) return page('লগইন', V.loginPage({ error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' }), { noindex: true, status: 429 });
      try {
        const c = await A.verifyCode(settings, b.phone, b.code);
        const codes = (await db.q('SELECT code FROM orders WHERE phone=$1 ORDER BY created_at DESC LIMIT 15', [c.phone])).map((r) => r.code);
        return go(safeNext(b.next) || '/account', [A.cookieFor(req, settings, c), ordersCookie(req, settings, codes)]);
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return page('লগইন', V.loginPage({ step: 'code', phone: normalizePhone(b.phone), error: e.message, next: safeNext(b.next) }), { noindex: true, status: 400 });
      }
    }
    if (path === '/account/logout' && isPost) return go('/', A.CLEAR);
    if (!cu) {
      if (isPost) return go('/account');
      return page('আমার অ্যাকাউন্ট', V.loginPage({ next }), { noindex: true, canonical: '/account' });
    }
    if (isPost) {
      const b = await parseBody(req);
      try {
        if (path === '/account/logout-all') { await A.logoutEverywhere(cu.id); return go('/', A.CLEAR); }
        if (path === '/account/profile') { await A.saveProfile(cu, b); return go('/account?tab=profile&ok=1'); }
        if (path === '/account/address') { await A.saveAddress(cu.id, b); return go('/account?tab=addresses&ok=1'); }
        if (path === '/account/address/delete') { await A.deleteAddress(cu.id, b.id); return go('/account?tab=addresses&ok=1'); }
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return go(`/account?tab=${path.includes('address') ? 'addresses' : 'profile'}&err=${encodeURIComponent(e.message)}`);
      }
      return go('/account');
    }
    const tab = ['orders', 'addresses', 'profile', 'refer', 'gift'].includes(query.get('tab')) ? query.get('tab') : 'orders';
    const G = require('./models/giftcards');
    const RC = G.refCfg(settings);
    const [orders, addresses, cards] = await Promise.all([A.ordersOf(cu), A.addresses(cu.id), settings.gift_on === '1' ? G.forPhone(cu.phone) : []]);
    let referral = null;
    if (RC.on && RC.friendGets) {
      const code = await G.refCodeFor(cu.id);
      const st = await G.referralStats(cu.id);
      referral = { code, friendGets: RC.friendGets, friendMin: RC.friendMin, youGet: RC.youGet, joined: st.joined, rewarded: st.rewarded };
    }
    // their orders open in full on this browser (address, reviews, returns)
    const codes = orders.slice(0, 15).map((o) => o.code);
    if (codes.length) res.setHeader('Set-Cookie', ordersCookie(req, settings, codes));
    return page('আমার অ্যাকাউন্ট', V.dashboard({ cu, orders, addresses, settings, tab, referral, cards,
      flash: query.get('ok') ? 'সেভ হয়েছে।' : '', error: str(query.get('err'), 200) }), { noindex: true, canonical: '/account' });
  }

  // ---------------------------------------------------------------- return request
  let m = path.match(/^\/order\/([A-Za-z0-9]+)\/return$/);
  if (m) {
    if (settings.returns_on !== '1') return notFound();
    if (!(await security.hit(db, 'orderview:' + ip, 60, 600))) return page('একটু অপেক্ষা করুন', '<div class="wrap section"><p>অনেক বেশি চেষ্টা হয়েছে।</p></div>', { status: 429, noindex: true });
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return notFound();
    const R = require('./models/returns');
    const mine = myOrders(req, settings).includes(order.code);
    const existing = mine ? await R.forOrder(order.id) : [];
    if (isPost) {
      if (!mine) return go(`/order/${order.code}/return`);
      const b = await parseBody(req);
      if (b.website) return go(`/order/${order.code}`);
      if (!(await security.hit(db, 'retreq:' + ip, 6, 3600))) return page('রিটার্ন', V.returnForm({ order, existing, settings, mine, error: 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পর আবার চেষ্টা করুন।' }), { noindex: true, status: 429 });
      const ids = [].concat(b.item || []).map((x) => int(x));
      let photos = [];
      try { photos = JSON.parse(b.photos || '[]'); } catch (_) { photos = []; }
      try {
        const cu = await A.current(req, settings);
        const r = await R.create({ order, wanted: ids.map((id) => ({ item_id: id, qty: int(b[`qty_${id}`], 1) })), reason: b.reason, want: b.want, details: b.details,
          photos, refundMethod: b.refund_method, refundNumber: b.refund_number, customerId: cu ? cu.id : null, settings });
        const push = require('./services/push');
        require('./services/notify').later(push.count().then((n) => (n ? push.sendAll({ title: '↩️ নতুন রিটার্ন আবেদন', body: `${order.code} — ${order.customer_name}`, url: '/admin/returns', tag: 'return' }) : null)).catch(() => null));
        return page('রিটার্ন', V.returnForm({ order, existing: await R.forOrder(order.id), settings, mine, done: r.code }), { noindex: true });
      } catch (e) {
        if (!(e instanceof R.ReturnError)) throw e;
        return page('রিটার্ন', V.returnForm({ order, existing, settings, mine, error: e.message }), { noindex: true, status: 400 });
      }
    }
    return page('রিটার্ন / রিফান্ড', V.returnForm({ order, existing, settings, mine }), { noindex: true });
  }

  // ---------------------------------------------------------------- gift card
  if (path === '/gift-card') {
    if (settings.gift_on !== '1') return notFound();
    const methods = require('./services/payments').methods(settings).filter((x) => x.manual && x.number && settings.gift_sell_online !== '0');
    if (isPost) {
      const b = await parseBody(req);
      if (b.website) return go('/gift-card');
      if (!(await security.hit(db, 'giftbuy:' + ip, 5, 3600))) return page('গিফট কার্ড', V.giftPage({ settings, methods, values: b, error: 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পর আবার চেষ্টা করুন।' }), { status: 429 });
      const min = Number(settings.gift_min) || 200; const max = Number(settings.gift_max) || 20000;
      const amt = b.amount === 'custom' ? Number(b.custom_amount) : Number(b.amount);
      const method = methods.find((x) => x.id === b.pay_method);
      const trx = str(b.trx, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const err = !(amt >= min && amt <= max) ? `গিফট কার্ডের পরিমাণ ৳${min} থেকে ৳${max} এর মধ্যে দিন।`
        : str(b.recipient_name).length < 2 ? 'প্রাপকের নাম লিখুন।'
          : !validPhone(normalizePhone(b.recipient_phone)) ? 'প্রাপকের মোবাইল নম্বর ঠিক নেই।'
            : str(b.buyer_name).length < 2 ? 'আপনার নাম লিখুন।'
              : !validPhone(normalizePhone(b.buyer_phone)) ? 'আপনার মোবাইল নম্বর ঠিক নেই।'
                : !method ? 'পেমেন্টের মাধ্যম বাছুন।'
                  : !validPhone(normalizePhone(b.pay_number)) ? 'যে নম্বর থেকে টাকা পাঠিয়েছেন সেটা লিখুন।'
                    : trx.length < 6 ? 'Transaction ID (TrxID) লিখুন।' : '';
      if (err) return page('গিফট কার্ড', V.giftPage({ settings, methods, values: b, error: err }), { status: 400 });
      const G = require('./models/giftcards');
      const dupTrx = await db.one('SELECT id FROM gift_cards WHERE trx_id=$1', [trx]);
      if (dupTrx) return page('গিফট কার্ড', V.giftPage({ settings, methods, values: b, error: 'এই TrxID দিয়ে আগেই অনুরোধ এসেছে।' }), { status: 400 });
      await G.issue({ amount: Math.round(amt), status: 'pending', source: 'shop', buyerName: b.buyer_name, buyerPhone: b.buyer_phone, recipientName: b.recipient_name,
        recipientPhone: b.recipient_phone, message: b.message, validDays: int(settings.gift_valid_days), payMethod: method.id, trxId: trx, payNumber: b.pay_number, ip });
      const push = require('./services/push');
      require('./services/notify').later(push.count().then((n) => (n ? push.sendAll({ title: '💳 গিফট কার্ড কেনার অনুরোধ', body: `৳${Math.round(amt)} — TrxID ${trx}`, url: '/admin/giftcards?status=pending', tag: 'gift' }) : null)).catch(() => null));
      return page('গিফট কার্ড', V.giftPage({ settings, methods, done: { trx, to: normalizePhone(b.recipient_phone) } }), { noindex: true });
    }
    return page('গিফট কার্ড', V.giftPage({ settings, methods }), { canonical: '/gift-card', description: `${settings.store_name} এর গিফট কার্ড — প্রিয়জনকে উপহার দিন।` });
  }
  return null;
}

// The referral link (?ref=CODE) is remembered for 30 days, so the code is in the box at checkout.
function refCookie(req, code) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_ref=${encodeURIComponent(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}
function refFromCookie(req) { return String(parseCookies(req.headers.cookie).sm_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20); }

module.exports = { route, refCookie, refFromCookie, safeNext };

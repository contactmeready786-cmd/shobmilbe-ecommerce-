// Customer pages that take forms: 👤 আমার অ্যাকাউন্ট (OTP login, orders, addresses, profile, referral, gift cards),
// ↩️ the return request on a delivered order, and 🎁 buying a gift card.
// Every form here must come from this same site (checked) and the login cookie is SameSite=Lax.
import { refCookie, refFromCookie, myOrders } from './gate';
import * as db from './db';
import * as security from './security';
import * as A from './models/accounts';
import * as V from './views/account';
import * as O from './models/orders';
import { parseBody, str, int, normalizePhone, validPhone, parseCookies, sign, unsign } from './util';
import * as $models_selfservice from './models/selfservice';
import * as $views_complaint from './views/complaint';
import * as $models_complaints from './models/complaints';
import * as $services_notify from './services/notify';
import * as $services_sms from './services/sms';
import * as $models_giftcards from './models/giftcards';
import * as $models_returns from './models/returns';
import * as $services_push from './services/push';
import { resolveForms, giftMethods, safeNext, ordersCookie, accountOrdersCookie } from './shop/forms';
import type { Resolved } from './shop/router';
import type { Body, Id, Loose, Settings, ShopRequest } from './types';


async function route({ req, res, path, method, query, settings, page, notFound, redirect, ip }: Body) {
  const isPost = method === 'POST';
  if (isPost && !security.sameSite(req)) return page('অনুমতি নেই', '<div class="wrap section"><p>এই ফর্ম অন্য ওয়েবসাইট থেকে পাঠানো হয়েছে।</p></div>', { status: 403, noindex: true });
  const go = (to?: Loose, cookies?: Loose) => redirect(res, to, cookies ? { 'Set-Cookie': cookies } : {});
  const shown = (r: Resolved | null) => (!r || r.kind !== 'page' ? notFound() : page(r.title, r.body, r.opts));

  // ---------------------------------------------------------------- 🙋 the customer cancels / changes their own order
  let sm = path.match(/^\/order\/([A-Za-z0-9]+)\/(cancel|edit)$/);
  if (sm) {
    if (!isPost) return go(`/order/${sm[1].toUpperCase()}`);
    const code = sm[1].toUpperCase();
    const SS = $models_selfservice;
    const back = (msg?: Loose, ok?: Loose) => go(`/order/${code}?${ok ? 'done' : 'err'}=${encodeURIComponent(msg)}#self`);
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
    const CV = $views_complaint;
    const CM = $models_complaints;
    if (path === '/complaint/status') {
      const code = str(query.get('code'), 12).toUpperCase().trim();
      const phone = query.get('phone');
      if (code && phone) {
        if (!(await security.hit(db, 'cstat:' + ip, 30, 3600))) return page('অভিযোগের অবস্থা', CV.statusPage({ code, error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার দেখুন।' }), { noindex: true, status: 429 });
        const c = await CM.forCustomer(code, phone);
        return page('অভিযোগের অবস্থা', CV.statusPage({ c, code, error: c ? '' : 'এই নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।' }), { noindex: true });
      }
      return shown(await resolveForms({ path, query, settings, req }));
    }
    // just opening the form (lib/shop/forms.tsx, shared with the Next.js pages)
    if (!isPost) return shown(await resolveForms({ path, query, settings, req }));
    const b = await parseBody(req);
    if (b.website) return go('/complaint'); // a robot filled the hidden box
    if (!(await security.hit(db, 'complaint:' + ip, 6, 3600))) return page('অভিযোগ জানান', CV.complaintPage({ settings, values: b, error: 'অনেকগুলো অভিযোগ পাঠানো হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা ফোন করুন।' }), { noindex: true, status: 429 });
    let photos: Loose[] = [];
    try { photos = JSON.parse(b.photos || '[]'); } catch (_) { photos = []; }
    try {
      const c = await CM.create({ name: b.name, phone: b.phone, email: b.email, orderCode: b.order_code, topic: b.topic, message: b.message, photos, ip, settings, productId: b.item });
      const site = (settings.site_url || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
      const hours = CM.hoursOf(settings);
      const notify = $services_notify;
      await notify.newComplaint(settings, site, c, CM.TOPICS[c!.topic] || c!.topic, hours).catch(() => {});
      if (settings.complaint_sms_on !== '0') {
        const SMS = $services_sms;
        if (SMS.ready(settings).ok) await notify.later(SMS.send(settings, c!.phone, `${settings.store_name || ''}: আপনার অভিযোগ ${c!.code} পেয়েছি। ${hours} ঘণ্টার মধ্যে সমাধান করা হবে। অবস্থা দেখুন: ${site}/complaint/status?code=${c!.code}`, { kind: 'complaint' }));
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
    const ways = { phoneOn: A.phoneReady(settings), emailOn: A.emailReady(settings) };
    const login = (o?: Loose) => page('লগইন', V.loginPage({ ...ways, ...o }), { noindex: true, status: o.error ? 400 : 200 });
    // after the code is right: a new account first gives its name (and mobile), then goes where it was going
    const afterLogin = (c?: Loose, nxt?: Loose) => (A.needsProfile(c) ? `/account?tab=profile&welcome=1${nxt ? '&next=' + encodeURIComponent(nxt) : ''}` : nxt || '/account');
    // ---------- 📱 mobile + SMS code ----------
    if (path === '/account/code' && isPost) {
      const b = await parseBody(req);
      try {
        const r = await A.sendCode(settings, b.phone, ip);
        return login({ via: 'phone', step: 'code', phone: r.phone, next: safeNext(b.next) });
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return login({ via: 'phone', phone: str(b.phone, 20), error: e.message, next: safeNext(b.next) });
      }
    }
    if (path === '/account/verify' && isPost) {
      const b = await parseBody(req);
      if (!(await security.hit(db, 'otpv:' + ip, 20, 3600))) return login({ via: 'phone', error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
      try {
        const c = await A.verifyCode(settings, b.phone, b.code);
        const codes = (await db.q('SELECT code FROM orders WHERE phone=$1 ORDER BY created_at DESC LIMIT 15', [c!.phone])).map((r) => r.code);
        return go(afterLogin(c, safeNext(b.next)), [A.cookieFor(req, settings, c), ordersCookie(req, settings, codes)]);
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return login({ via: 'phone', step: 'code', phone: normalizePhone(b.phone), error: e.message, next: safeNext(b.next) });
      }
    }
    // ---------- 📧 e-mail + code ----------
    if (path === '/account/email-code' && isPost) {
      const b = await parseBody(req);
      const mode = b.mode === 'reset' ? 'reset' : 'signup';
      try {
        const r = await A.sendEmailCode(settings, b.email, ip, { purpose: mode, password: b.password, password2: b.password2 });
        return login({ via: 'email', mode, step: 'code', email: r.email, next: safeNext(b.next) });
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return login({ via: 'email', mode, email: str(b.email, 120), error: e.message, next: safeNext(b.next) });
      }
    }
    // 📧 e-mail + password (no code)
    if (path === '/account/email-login' && isPost) {
      const b = await parseBody(req);
      try {
        const c = await A.loginWithPassword(b.email, b.password, ip);
        return go(afterLogin(c, safeNext(b.next)), A.cookieFor(req, settings, c));
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return login({ via: 'email', mode: 'login', email: str(b.email, 120).toLowerCase(), error: e.message, next: safeNext(b.next) });
      }
    }
    if (path === '/account/email-verify' && isPost) {
      const b = await parseBody(req);
      if (!(await security.hit(db, 'eotpv:' + ip, 20, 3600))) return login({ via: 'email', error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
      try {
        const c = await A.verifyEmailCode(settings, b.email, b.code);
        return go(afterLogin(c, safeNext(b.next)), A.cookieFor(req, settings, c));
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        return login({ via: 'email', mode: b.mode === 'reset' ? 'reset' : 'signup', step: 'code', email: str(b.email, 120).toLowerCase(), error: e.message, next: safeNext(b.next) });
      }
    }
    if (path === '/account/logout' && isPost) return go('/', A.CLEAR);
    if (!cu) {
      if (isPost) return go('/account');
      return shown(await resolveForms({ path, query, settings, req }));
    }
    if (isPost) {
      const b = await parseBody(req);
      try {
        if (path === '/account/logout-all') { await A.logoutEverywhere(cu.id); return go('/', A.CLEAR); }
        if (path === '/account/profile') {
          await A.saveProfile(cu, b);
          const nxt = safeNext(b.next);
          return go(nxt || (b.welcome ? '/' : '/account?tab=profile&ok=1'));
        }
        if (path === '/account/address') { await A.saveAddress(cu.id, b); return go('/account?tab=addresses&ok=1'); }
        if (path === '/account/address/delete') { await A.deleteAddress(cu.id, b.id); return go('/account?tab=addresses&ok=1'); }
      } catch (e) {
        if (!(e instanceof A.AccountError)) throw e;
        const keep = path === '/account/profile' ? `${b.welcome ? '&welcome=1' : ''}${safeNext(b.next) ? '&next=' + encodeURIComponent(safeNext(b.next)) : ''}` : '';
        return go(`/account?tab=${path.includes('address') ? 'addresses' : 'profile'}${keep}&err=${encodeURIComponent(e.message)}`);
      }
      return go('/account');
    }
    // the dashboard (lib/shop/forms.tsx); their orders open in full on this browser (address, reviews, returns)
    const oc = await accountOrdersCookie(req, settings, cu);
    if (oc) res.setHeader('Set-Cookie', oc);
    return shown(await resolveForms({ path, query, settings, req }));
  }

  // ---------------------------------------------------------------- return request
  let m = path.match(/^\/order\/([A-Za-z0-9]+)\/return$/);
  if (m) {
    if (settings.returns_on !== '1') return notFound();
    if (!(await security.hit(db, 'orderview:' + ip, 60, 600))) return page('একটু অপেক্ষা করুন', '<div class="wrap section"><p>অনেক বেশি চেষ্টা হয়েছে।</p></div>', { status: 429, noindex: true });
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return notFound();
    const R = $models_returns;
    const mine = myOrders(req, settings).includes(order.code);
    const existing = mine ? await R.forOrder(order.id) : [];
    if (isPost) {
      if (!mine) return go(`/order/${order.code}/return`);
      const b = await parseBody(req);
      if (b.website) return go(`/order/${order.code}`);
      if (!(await security.hit(db, 'retreq:' + ip, 6, 3600))) return page('রিটার্ন', V.returnForm({ order, existing, settings, mine, error: 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পর আবার চেষ্টা করুন।' }), { noindex: true, status: 429 });
      const ids = ([] as Loose[]).concat(b.item || []).map((x) => int(x));
      let photos: Loose[] = [];
      try { photos = JSON.parse(b.photos || '[]'); } catch (_) { photos = []; }
      try {
        const cu = await A.current(req, settings);
        const r = await R.create({ order, wanted: ids.map((id) => ({ item_id: id, qty: int(b[`qty_${id}`], 1) })), reason: b.reason, want: b.want, details: b.details,
          photos, refundMethod: b.refund_method, refundNumber: b.refund_number, customerId: cu ? cu.id : null, settings });
        const push = $services_push;
        $services_notify.later(push.count().then((n) => (n ? push.sendAll({ title: '↩️ নতুন রিটার্ন আবেদন', body: `${order.code} — ${order.customer_name}`, url: '/admin/returns', tag: 'return' }) : null)).catch(() => null));
        return page('রিটার্ন', V.returnForm({ order, existing: await R.forOrder(order.id), settings, mine, done: r!.code }), { noindex: true });
      } catch (e) {
        if (!(e instanceof R.ReturnError)) throw e;
        return page('রিটার্ন', V.returnForm({ order, existing, settings, mine, error: e.message }), { noindex: true, status: 400 });
      }
    }
    return shown(await resolveForms({ path, query, settings, req }));
  }

  // ---------------------------------------------------------------- gift card
  if (path === '/gift-card') {
    if (settings.gift_on !== '1') return notFound();
    const methods = giftMethods(settings);
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
      const G = $models_giftcards;
      const dupTrx = await db.one('SELECT id FROM gift_cards WHERE trx_id=$1', [trx]);
      if (dupTrx) return page('গিফট কার্ড', V.giftPage({ settings, methods, values: b, error: 'এই TrxID দিয়ে আগেই অনুরোধ এসেছে।' }), { status: 400 });
      await G.issue({ amount: Math.round(amt), status: 'pending', source: 'shop', buyerName: b.buyer_name, buyerPhone: b.buyer_phone, recipientName: b.recipient_name,
        recipientPhone: b.recipient_phone, message: b.message, validDays: int(settings.gift_valid_days), payMethod: method!.id, trxId: trx, payNumber: b.pay_number, ip });
      const push = $services_push;
      $services_notify.later(push.count().then((n) => (n ? push.sendAll({ title: '💳 গিফট কার্ড কেনার অনুরোধ', body: `৳${Math.round(amt)} — TrxID ${trx}`, url: '/admin/giftcards?status=pending', tag: 'gift' }) : null)).catch(() => null));
      return page('গিফট কার্ড', V.giftPage({ settings, methods, done: { trx, to: normalizePhone(b.recipient_phone) } }), { noindex: true });
    }
    return shown(await resolveForms({ path, query, settings, req }));
  }
  return null;
}

export { route, refCookie, refFromCookie, safeNext };

// 🛒 Placing an order and the checkout's SMS code (চেকআউট OTP) — money, stock and the customer's details are all
// checked here on the server, never trusted from the browser. Served by app/api/orders and app/api/checkout-otp/*
// (lib/next/api.ts runs the gate first). Moved here from lib/site.ts unchanged; tests/orders.db.test.ts and
// tests/checkout-otp.db.test.ts cover the order and code rules.
import * as db from '../db';
import * as O from '../models/orders';
import * as customers from '../models/customers';
import * as payments from '../services/payments';
import * as notify from '../services/notify';
import * as tracking from '../services/tracking';
import * as guard from '../services/guard';
import * as drafts from '../services/drafts';
import * as security from '../security';
import * as $services_sms from '../services/sms';
import * as $services_push from '../services/push';
import * as $services_mailer from '../services/mailer';
import * as $services_autocall from '../services/autocall';
import * as $services_fraud from '../services/fraud';
import * as $services_stockalert from '../services/stockalert';
import * as $models_accounts from '../models/accounts';
import * as $models_checkoutotp from '../models/checkoutotp';
import { siteUrl, myOrdersCookie } from '../gate';
import { int, str, normalizePhone, validPhone, contact } from '../util';
import { allow, json, tooMany, type ApiCtx } from '../next/api';

// 🔐 চেকআউট OTP: /api/checkout-otp/status (does this number need a code?), /send (SMS a code), /verify (check it).
// /smscheck: did the shop's phone really send the code? (tells the owner when the SMS app is off)
export async function checkoutOtp(ctx: ApiCtx) {
  const { settings, path } = ctx;
  const CO = $models_checkoutotp;
  if (!security.sameSite(ctx.req)) return json(403, { error: 'অনুমতি নেই।' });
  const b = await ctx.body();
  const phone = normalizePhone(b.phone);
  const ip = ctx.ip;
  if (!CO.active(settings)) return json(200, { need: false });
  if (!validPhone(phone)) return json(200, { need: true, error: 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।' });
  try {
    if (path === '/api/checkout-otp/status') {
      if (!(await security.hit(db, 'coo:st:' + ip, 120, 3600))) return json(200, { need: true });
      const why = await CO.noNeedWhy(ctx.req, settings, phone);
      return json(200, { need: !why, why: why || '' });
    }
    if (path === '/api/checkout-otp/send') {
      const r = await CO.sendCode(ctx.req, settings, phone, ip, siteUrl(ctx.req, settings));
      return json(200, { sent: true, wait: r.wait, len: CO.CODE_LEN, message: r.again ? 'কোড একটু আগেই পাঠানো হয়েছে — SMS দেখুন।' : `${phone.slice(0, 3)}•••••${phone.slice(-3)} নম্বরে কোড পাঠানো হয়েছে।` });
    }
    if (path === '/api/checkout-otp/smscheck') {
      if (!(await security.hit(db, 'coo:sc:' + ip, 20, 3600))) return json(200, { state: '' });
      const r = await CO.smsCheck(settings, phone);
      return json(200, { stuck: !!r.stuck });
    }
    if (path === '/api/checkout-otp/verify') {
      if (!(await security.hit(db, 'coo:v:' + ip, 30, 3600))) return json(429, { error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
      const r = await CO.verifyCode(settings, phone, b.code);
      const ck = CO.rememberCookie(ctx.req, settings, r.phone);
      return json(200, { ok: true, token: r.token }, ck ? { 'Set-Cookie': ck } : {});
    }
  } catch (e) {
    if (!(e instanceof CO.OtpError)) throw e;
    return json(400, { error: e.message, expired: !!e.expired });
  }
  return json(404, { error: 'নেই' });
}

// A new order from the checkout page (money, stock and the customer's details are all checked on the server).
export async function placeOrder(ctx: ApiCtx) {
  // stops fake-order floods: 10 orders per hour from one connection is far above any real customer
  if (!(await allow(ctx, 'order:', 10, 3600))) return tooMany(ctx);
  const settings = ctx.settings;
  const body = await ctx.body();
  const name = str(body.name, 80);
  const phone = normalizePhone(body.phone);
  const address = str(body.address, 400);
  const district = str(body.district, 60);
  const thana = str(body.thana, 60);
  const ip = ctx.ip;
  if (name.length < 2) return json(400, { error: 'আপনার নাম লিখুন।', field: 'name' });
  if (!validPhone(phone)) return json(400, { error: 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।', field: 'phone' });
  const dist = O.findDistrict(district);
  if (!dist) return json(400, { error: 'জেলা বাছাই করুন।', field: 'district' });
  if (!dist.areas.some((a) => a[0] === thana)) return json(400, { error: 'থানা / উপজেলা বাছাই করুন।', field: 'thana' });
  if (address.length < 5) return json(400, { error: 'পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', field: 'address' });
  // ✅ Digital Commerce Guidelines 2021: the customer's permission to use their details (tick box at checkout)
  const consented = body.consent === '1' || body.consent === true;
  if (settings.consent_on !== '0' && !consented) return json(400, { error: 'অর্ডার করতে নিচের ঘরে টিক দিয়ে আপনার তথ্য ব্যবহারে সম্মতি দিন।', field: 'consent' });

  const blocked = await customers.isBlocked(phone, ip);
  if (blocked) {
    guard.record({ req: ctx.req, kind: 'blocked_order', detail: phone, settings }).catch(() => {});
    return json(403, { error: settings.block_message || 'অর্ডার নেওয়া যাচ্ছে না।' });
  }
  // 🔐 চেকআউট OTP: the number must be checked by SMS code (or already checked: logged in / earlier in this browser)
  const CO = $models_checkoutotp;
  const otp = await CO.checkOrder(ctx.req, settings, phone, body.otp_token);
  if (!otp.ok) return json(400, { error: otp.error, field: 'phone', otp: true });
  const maxDay = int(settings.max_orders_per_phone_day);
  if (maxDay > 0) {
    const st = await customers.phoneStats(phone);
    if (st!.last_day >= maxDay) return json(429, { error: `এই নম্বর থেকে আজ অনেকগুলো অর্ডার হয়েছে। আরও অর্ডার করতে আমাদের কল করুন${contact(settings).phone ? ': ' + contact(settings).phone : ''}।` });
  }
  const methods = payments.methods(settings);
  const method = methods.find((x) => x.id === body.payment) || methods[0];
  let trxId = '';
  let paymentNumber = '';
  let adminNote = '';
  if (method.manual) {
    trxId = str(body.trx, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
    paymentNumber = normalizePhone(body.payment_number);
    if (trxId.length < 6) return json(400, { error: 'টাকা পাঠানোর পর পাওয়া Transaction ID (TrxID) লিখুন।', field: 'trx' });
    if (!validPhone(paymentNumber)) return json(400, { error: 'যে নম্বর থেকে টাকা পাঠিয়েছেন সেটা লিখুন।', field: 'payment_number' });
  } else if (method.advance) {
    // cash on delivery, but the delivery charge first by Send Money (all orders, or a first order only)
    const typed = str(body.trx, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const need = method.advance === 'all' || (await customers.phoneStats(phone))!.delivered === 0;
    if (need || typed) {
      trxId = typed;
      paymentNumber = normalizePhone(body.payment_number);
      if (trxId.length < 6) return json(400, { error: `ডেলিভারি চার্জটা আগে ${method.numberLabel || ''} ${method.number} নম্বরে Send Money করে Transaction ID (TrxID) লিখুন।`.replace(/\s+/g, ' '), field: 'trx' });
      if (!validPhone(paymentNumber)) return json(400, { error: 'যে নম্বর থেকে ডেলিভারি চার্জ পাঠিয়েছেন সেটা লিখুন।', field: 'payment_number' });
      adminNote = `💵 ডেলিভারি চার্জ আগে পাঠিয়েছেন বলে জানিয়েছেন (${method.numberLabel || 'Send Money'}) — TrxID ${trxId}, নম্বর ${paymentNumber}। মিলিয়ে দেখে "টাকা পেয়েছি" দিন।`;
    }
  }
  try {
    const order = await O.createOrder({
      items: Array.isArray(body.items) ? body.items.slice(0, 50) : [], name, phone, email: str(body.email, 120), address, district: dist.en, thana,
      note: str(body.note, 300), payment: method.id, coupon: str(body.coupon, 40), trxId, paymentNumber, ip, source: 'web', adminNote,
      usePoints: body.use_points === true || body.use_points === '1', giftCode: str(body.gift_code, 30),
    }, settings);
    await drafts.markOrdered(phone, order.code);
    if (otp.how) await db.q('UPDATE orders SET phone_check=$1 WHERE id=$2', [otp.how, order.id]).catch(() => {});
    // 👤 the logged-in account that placed it (an e-mail account finds its orders by this)
    const acct = await $models_accounts.current(ctx.req, settings).catch(() => null);
    if (acct) await db.q('UPDATE orders SET account_id=$1 WHERE id=$2', [acct.id, order.id]).catch(() => {});
    if (consented) await db.q('UPDATE orders SET consent_at=now() WHERE id=$1', [order.id]).catch(() => {});
    // 🎁 "অফারের খবর পেতে চাই" at checkout: tick = offer e-mails (when an e-mail was given) and offer SMS; no tick = no offer SMS
    {
      const wants = body.promo === '1' || body.promo === true;
      await db.q('UPDATE customers SET promo_sms=$1 WHERE phone=$2', [wants, phone]).catch(() => {});
      const em = str(body.email, 120) || (acct && acct.email_verified ? acct.email : '');
      if (wants && em && settings.email_mkt_on === '1') await $services_mailer.addSub(em, { name, phone, source: 'checkout' }).catch(() => {});
    }
    // Server-side conversion events + the owner's "new order" e-mail / WhatsApp (never block the order for long).
    await Promise.all([
      Promise.race([
        tracking.purchase({ ...order, phone, customer_name: name, district: dist.en, email: str(body.email, 120), ip }, settings, ctx.req),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {}),
      notify.newOrder(settings, siteUrl(ctx.req, settings), { ...order, name, phone, address, district: dist.bn || dist.en, thana: (dist.areas.find((a) => a[0] === thana) || [])[1] || thana,
        note: str(body.note, 300), payment: method.id, trxId }).catch(() => {}),
      // "we got your order" SMS to the customer (when switched on)
      $services_sms.orderEvent(settings, 'placed', { id: order.id, code: order.code, total: order.total, phone, customer_name: name }, siteUrl(ctx.req, settings)).catch(() => {}),
      // 📞 অটো কল: a robot call asks the customer to press 1 (confirm) or 2 (cancel) — when switched on
      Promise.race([
        $services_autocall.afterOrder(settings, { ...order, phone, customer_name: name, payment: method.id }, siteUrl(ctx.req, settings)),
        new Promise((r) => setTimeout(r, 4000)),
      ]).catch(() => {}),
      // 🛡️ fraud check of the number (Admin → ফ্রড চেক): a note on risky orders, "হোল্ড" if chosen, a phone alert
      settings.fraud_auto === '1' ? Promise.race([(async () => {
        const r = await $services_fraud.check(settings, phone);
        if (!r.ok || r.level !== 'high') return;
        await db.q(`UPDATE orders SET admin_note = left(trim(admin_note || E'\n' || $1), 1000) WHERE id=$2`, [`⛔ ফ্রড চেক: ঝুঁকিপূর্ণ নম্বর — সফল ${r.rate === null ? '?' : r.rate}% (${r.success}/${r.total})। ${r.advice}`, order.id]);
        if (settings.fraud_hold === '1') await O.setStatus(order.id, 'hold', null).catch(() => {});
        const push = $services_push;
        if (await push.count()) await push.sendAll({ title: '⛔ ঝুঁকিপূর্ণ অর্ডার', body: `${order.code} — ${name}: সফল ${r.rate === null ? '?' : r.rate}%`, url: `/admin/orders/${order.id}`, tag: 'fraud' }).catch(() => {});
      })(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {}) : null,
      // products this order made run low → one short message to the owner (once a day per product)
      $services_stockalert.check(settings, (order.lines || []).flatMap((l) => (l.components && l.components.length ? l.components.map((c) => c.product_id) : [l.product_id])))
        .catch(() => {}),
    ]);
    const online = method.id === 'bkash' || method.id === 'ssl';
    return json(200, { code: order.code, redirect: online ? `/pay/${order.code}` : `/order/${order.code}?new=1` },
      { 'Set-Cookie': myOrdersCookie(ctx.req, settings, order.code) });
  } catch (e: unknown) {
    if (e instanceof O.OrderError) return json(409, { error: e.message, field: e.field });
    throw e;
  }
}

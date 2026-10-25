// 🔌 The shop's small "do something" APIs the pages call (stock / price alerts, product questions, reviews, ♡, coupons,
// gift card checks, offer notifications, the e-mail list, the checkout's draft and points, live scores, the English
// switch, visitor counts, the admin's script-rule reports). Each one is served by its own route in app/api/…
// (lib/next/api.ts runs the gate first). Moved here from lib/site.ts unchanged.
import * as db from '../db';
import * as O from '../models/orders';
import * as customers from '../models/customers';
import * as notify from '../services/notify';
import * as visitors from '../services/visitors';
import * as drafts from '../services/drafts';
import * as livescore from '../services/livescore';
import * as translate from '../services/translate';
import * as security from '../security';
import * as $models_extras from '../models/extras';
import * as $models_giftcards from '../models/giftcards';
import * as $models_reviews from '../models/reviews';
import * as $models_loyalty from '../models/loyalty';
import * as $models_accounts from '../models/accounts';
import * as $services_push from '../services/push';
import * as $services_pricing from '../services/pricing';
import * as $services_mailer from '../services/mailer';
import * as $services_health from '../services/health';
import { myOrders } from '../gate';
import { readBody, int, str, normalizePhone, validPhone, amount, fields, arr } from '../util';
import { allow, json, tooMany, type ApiCtx } from '../next/api';

// (an empty "got it", exactly as before: no headers needed)
const nothing = () => new Response(null, { status: 204 });

// 🔔 "স্টকে এলে জানাও" and "দাম কমলে জানাও" (small forms on the product page)
export async function stockAlert(ctx: ApiCtx) {
  if (ctx.settings.ui_restock_notify === '0') return json(403, { error: 'এখন বন্ধ আছে।' });
  const b = await ctx.body();
  if (b.website) return json(200, { ok: true, message: 'ধন্যবাদ!' });
  if (!(await allow(ctx, 'stockalert:', 12, 3600))) return tooMany(ctx);
  const X = $models_extras;
  try {
    const r = await X.subscribeStock({ productId: b.product, phone: b.phone, ip: ctx.ip });
    return json(200, { ok: true, message: `✅ ঠিক আছে! "${r.name}" স্টকে এলেই ${normalizePhone(b.phone)} নম্বরে SMS করে জানাব।` });
  } catch (e) {
    if (e instanceof X.UserError) return json(400, { error: e.message });
    throw e;
  }
}
export async function priceAlert(ctx: ApiCtx) {
  if (ctx.settings.price_alert_on === '0') return json(403, { error: 'এখন বন্ধ আছে।' });
  const b = await ctx.body();
  if (b.website) return json(200, { ok: true, message: 'ধন্যবাদ!' });
  if (!(await allow(ctx, 'pricealert:', 12, 3600))) return tooMany(ctx);
  const X = $models_extras;
  try {
    const r = await X.subscribePrice({ productId: b.product, phone: b.phone, ip: ctx.ip });
    return json(200, { ok: true, message: `✅ ঠিক আছে! "${r.name}" এর দাম ৳${r.price} থেকে কমলেই ${normalizePhone(b.phone)} নম্বরে SMS করে জানাব।` });
  } catch (e) {
    if (e instanceof X.UserError) return json(400, { error: e.message });
    throw e;
  }
}

// ❓ a question on a product
export async function question(ctx: ApiCtx) {
  if (ctx.settings.ui_qa === '0') return json(403, { error: 'এখন প্রশ্ন নেওয়া হচ্ছে না।' });
  const b = await ctx.body();
  if (b.website) return json(200, { ok: true, message: 'ধন্যবাদ!' });
  if (!(await allow(ctx, 'question:', 8, 3600))) return tooMany(ctx);
  const X = $models_extras;
  try {
    const r = await X.askQuestion({ productId: b.product, name: b.name, phone: b.phone, question: b.question, ip: ctx.ip });
    if (!r.dup) {
      notify.later($services_push.count().then((n) => (n ? $services_push.sendAll({ title: '❓ নতুন প্রশ্ন', body: `${r.product}: ${str(b.question, 90)}`, url: '/admin/questions', tag: 'question' }) : null)).catch(() => null));
    }
    return json(200, { ok: true, message: 'ধন্যবাদ! আপনার প্রশ্ন পেয়েছি। উত্তর দেওয়ার পর এখানে দেখাবে' + (b.phone ? ', আর SMS-এ জানাব।' : '।') });
  } catch (e) {
    if (e instanceof X.UserError) return json(400, { error: e.message });
    throw e;
  }
}

// the cart's prices worked out on the server (flash sale, quantity price, gifts)
export async function quote(ctx: ApiCtx) {
  if (!(await allow(ctx, 'readapi:', 600, 600))) return tooMany(ctx);
  const b = await ctx.body();
  return json(200, await $services_pricing.quote(b.items));
}

// 🔔 offer notifications: this phone/computer said "yes" (or "no more")
export async function pushSubscription(ctx: ApiCtx) {
  if (ctx.settings.shoppush_on !== '1') return json(404, { error: 'off' });
  if (!(await allow(ctx, 'pushsub:', 20, 3600))) return tooMany(ctx);
  const b = await ctx.body();
  const push = $services_push;
  try {
    if (ctx.path.endsWith('/unsubscribe')) { await push.shopUnsubscribe(b.endpoint); return json(200, { ok: true }); }
    const cu = await $models_accounts.current(ctx.req, ctx.settings).catch(() => null);
    await push.shopSubscribe(b.sub, { customerId: cu ? cu.id : null, device: str(b.device, 60) });
    return json(200, { ok: true });
  } catch (e) {
    return json(400, { error: 'এই ব্রাউজারে নোটিফিকেশন চালু করা গেল না।' });
  }
}

// 📧 ইমেইল মার্কেটিং: join the offer list (footer box / pop-up)
export async function subscribe(ctx: ApiCtx) {
  if (ctx.settings.email_mkt_on !== '1') return json(404, { error: 'off' });
  if (!security.sameSite(ctx.req)) return json(403, { error: 'অনুমতি নেই।' });
  if (!(await allow(ctx, 'esub:', 8, 3600))) return tooMany(ctx);
  const b = await ctx.body();
  if (str(b.website, 50)) return json(200, { ok: true }); // the hidden box only robots fill in
  const r = await $services_mailer.addSub(b.email, { name: str(b.name, 80), source: str(b.from, 20) === 'popup' ? 'popup' : 'footer' }).catch(() => null);
  if (!r) return json(400, { error: 'সঠিক ইমেইল ঠিকানা লিখুন।' });
  return json(200, { ok: true, message: r.fresh ? '✅ ধন্যবাদ! নতুন অফার আর পণ্যের খবর আপনার ইমেইলে যাবে।' : '✅ আপনি আগে থেকেই তালিকায় আছেন — ধন্যবাদ!' });
}

// 🎁 a gift card's balance (stops guessing codes: a few checks per connection)
export async function giftcard(ctx: ApiCtx) {
  if (ctx.settings.gift_on !== '1') return json(200, { ok: false, message: 'এখন গিফট কার্ড নেওয়া হচ্ছে না।' });
  if (!(await allow(ctx, 'giftchk:', 15, 3600))) return tooMany(ctx);
  const b = await ctx.body();
  const r = await $models_giftcards.check(b.code);
  return json(200, r.ok ? { ok: true, code: r.code, balance: r.balance, message: r.message } : { ok: false, message: r.message });
}

// 🏷️ a coupon (or a friend's referral code) at checkout
export async function coupon(ctx: ApiCtx) {
  if (!(await allow(ctx, 'coupon:', 30, 600))) return tooMany(ctx);
  const settings = ctx.settings;
  if (settings && settings.ui_co_coupon === '0') return json(200, { ok: false, message: 'এখন কুপন নেওয়া হচ্ছে না।' });
  const b = await ctx.body();
  // the cart's own prices are worked out here (never trusted from the browser): flash sale, quantity price, gifts
  const qt = await $services_pricing.quote(Array.isArray(b.items) ? b.items.slice(0, 50) : []);
  const lines = [...qt.lines.map((l) => ({ product_id: l.id, price: l.price, qty: l.qty, kind: l.kind })),
    ...qt.gifts.map((g) => ({ product_id: g.id, price: g.price, qty: g.qty, kind: 'gift' }))];
  const subtotal = lines.length ? qt.subtotal : amount(b.subtotal);
  // a friend's referral code goes in the same box (when it is not one of the shop's coupons)
  if (settings.ref_on === '1' && !(await db.one<{ x: number }>('SELECT 1 AS x FROM coupons WHERE upper(code)=upper($1)', [str(b.code, 40)]))) {
    const G = $models_giftcards;
    if (await G.referrerFor(b.code)) {
      const r = await G.checkReferral(settings, b.code, b.phone, subtotal);
      return json(200, r.ok ? { ok: true, discount: r.discount, freeDelivery: false, code: G.cleanCode(b.code), message: r.message, referral: true } : { ok: false, message: r.message });
    }
  }
  const c = await O.checkCoupon(str(b.code, 40), subtotal, b.phone ? normalizePhone(b.phone) : '', lines.length ? lines : null);
  return json(200, c.ok ? { ok: true, discount: c.discount, freeDelivery: c.freeDelivery, code: c.coupon.code, message: c.message } : { ok: false, message: c.message });
}

// Visitor analytics beacons from shop.js. Always answers fast; never breaks the page (a flood is quietly ignored).
export async function visit(ctx: ApiCtx) {
  if (!(await allow(ctx, 'beacon:', 240, 60))) return json(200, {});
  let out = null;
  try {
    const host = String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '').split(':')[0].toLowerCase().replace(/^www\./, '');
    out = await visitors.record({ req: ctx.req, settings: ctx.settings, body: await readBody(ctx.req, 16 * 1024), ip: ctx.ip, ownHost: host });
  } catch (e) {
    console.error('visit beacon', (e as Error).message);
  }
  return json(200, out || {});
}

// Live scores: cached a few seconds at Vercel's edge so every visitor gets them instantly.
export async function live(ctx: ApiCtx) {
  const sport = ctx.path.endsWith('/football') ? 'football' : 'cricket';
  if (!livescore.enabled(ctx.settings)[sport]) return json(404, { error: 'off' });
  try {
    const data = await livescore.scores(sport, ctx.settings);
    return json(200, data, { 'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30' });
  } catch (e) {
    console.error('live scores', (e as Error).message);
    return json(502, { error: 'স্কোর এই মুহূর্তে আনা যাচ্ছে না।' });
  }
}

// A visitor tapped a match in the score box / score page: count it per competition per day (shown to the admin).
export async function liveClick(ctx: ApiCtx) {
  if (!(await allow(ctx, 'lclick:', 60, 60))) return nothing();
  try {
    let b: Record<string, unknown> = {};
    try { b = JSON.parse(await readBody(ctx.req, 2048) || '{}'); } catch (_) { b = {}; }
    const sport = b.sport === 'football' ? 'football' : b.sport === 'cricket' ? 'cricket' : '';
    const cat = String(b.cat || '');
    const known = sport === 'cricket' ? livescore.CRICKET_LEAGUES.some(([k]) => k === cat) : livescore.FOOTBALL_LEAGUES.some(([k]) => k === cat);
    if (sport && known) {
      await db.q(`INSERT INTO live_clicks(day, sport, cat, n) VALUES ((now() AT TIME ZONE 'Asia/Dhaka')::date, $1, $2, 1)
        ON CONFLICT (day, sport, cat) DO UPDATE SET n = live_clicks.n + 1`, [sport, cat]);
    }
  } catch (e) {
    console.error('live click', (e as Error).message);
  }
  return nothing();
}

// English version: the visitor's browser sends the texts on the page that are not in the built-in word list; we
// answer with saved translations and translate the new ones once (they are kept for everyone after that).
export async function i18n(ctx: ApiCtx) {
  const settings = ctx.settings;
  if (settings.i18n_on !== '1') return json(404, { error: 'off' });
  if (!(await allow(ctx, 'i18n:', 80, 600))) return tooMany(ctx);
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(await readBody(ctx.req, 96 * 1024) || '{}'); } catch (_) { b = {}; }
  let budget = 40000;
  const texts = arr(b.t).slice(0, 60).map((x) => String(x || '')).filter((x) => {
    if (!x || x.length > translate.MAX_LEN || budget - x.length < 0) return false;
    budget -= x.length;
    return true;
  });
  let m: Record<string, unknown> = {};
  try { m = await translate.lookup(texts, settings, { auto: settings.i18n_auto !== '0', deadline: Date.now() + 9000 }); } catch (e) { console.error('i18n', (e as Error).message); }
  return json(200, { m });
}
// Lines the owner corrected by hand. The URL carries a version number, so it can be cached at the edge.
export async function i18nFix(ctx: ApiCtx) {
  if (ctx.settings.i18n_on !== '1') return json(404, { error: 'off' });
  let m: Record<string, unknown> = {};
  try { m = await translate.manualAll(); } catch (e) { console.error('i18n fix', (e as Error).message); }
  return json(200, { m }, { 'Cache-Control': 'public, max-age=300, s-maxage=86400' });
}

// Incomplete order: what the shopper typed at checkout so far (only with a full BD mobile number).
export async function checkoutDraft(ctx: ApiCtx) {
  if (!(await allow(ctx, 'draft:', 40, 600))) return json(200, {});
  const b = await ctx.body();
  if (ctx.settings.draft_capture_on === '0') return json(200, { off: 1 });
  if (await customers.isBlocked(normalizePhone(b.phone), ctx.ip)) return json(200, {});
  return json(200, await drafts.save({ b, ip: ctx.ip, settings: ctx.settings }));
}

// A customer's review — only from the order page of a DELIVERED order that belongs to this browser
// (the order was placed here, or opened with order number + mobile number on "অর্ডার ট্র্যাক").
export async function review(ctx: ApiCtx) {
  const settings = ctx.settings;
  if (settings.reviews_on === '0') return json(403, { error: 'রিভিউ এখন বন্ধ আছে।' });
  const b = await ctx.body();
  if (b.website) return json(200, { ok: true, message: 'ধন্যবাদ!' }); // a robot filled the hidden box
  const code = str(b.code, 20).toUpperCase();
  if (!code || !myOrders(ctx.req, settings).includes(code)) {
    return json(403, { error: 'রিভিউ দিতে আগে "অর্ডার ট্র্যাক" পেজে অর্ডার নম্বর আর মোবাইল নম্বর দিয়ে অর্ডারটা খুলুন।' });
  }
  if (!(await allow(ctx, 'review:', 10, 3600))) return json(429, { error: 'অনেকগুলো রিভিউ পাঠানো হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
  const R = $models_reviews;
  try {
    const r = await R.submit({ code, productId: b.product, name: b.name, rating: b.rating, body: b.body, ip: ctx.ip, photos: Array.isArray(b.photos) ? b.photos : [] }, settings);
    if (r.status === 'pending') {
      notify.later($services_push.count().then((n) => (n ? $services_push.sendAll({ title: '⭐ নতুন রিভিউ', body: `${r.product}: অনুমোদনের অপেক্ষায়`, url: '/admin/reviews?status=pending', tag: 'review' }) : null)).catch(() => null));
    }
    return json(200, { ok: true, message: r.status === 'approved' ? 'ধন্যবাদ! আপনার রিভিউ যোগ হয়েছে।' : 'ধন্যবাদ! যাচাইয়ের পর আপনার রিভিউ পণ্যের পেজে দেখানো হবে।' });
  } catch (e) {
    if (e instanceof R.ReviewError) return json(400, { error: e.message });
    throw e;
  }
}

// ♡ pressed or un-pressed: the owner sees which products people want most (no personal data is kept).
export async function wish(ctx: ApiCtx) {
  if (ctx.settings.wishlist_on === '0') return json(200, {});
  const b = await ctx.body();
  const id = int(b.id);
  const on = b.on === true || b.on === 1 || b.on === '1';
  if (id > 0 && await security.hit(db, `wish:${ctx.ip}:${id}:${on ? 1 : 0}`, 3, 86400)) {
    await db.q(`UPDATE products SET wish_count = greatest(0, wish_count + $1) WHERE id=$2 AND active`, [on ? 1 : -1, id]);
  }
  return json(200, { ok: true });
}

// Checkout: how many loyalty points this mobile number has (a few lookups per hour per connection).
export async function points(ctx: ApiCtx) {
  const L = $models_loyalty;
  const c = L.cfg(ctx.settings);
  if (!c.on) return json(200, { on: false });
  const b = await ctx.body();
  const phone = normalizePhone(b.phone);
  if (!validPhone(phone)) return json(200, { on: true, points: 0 });
  if (!(await allow(ctx, 'points:', 20, 3600))) return json(429, { on: true, points: 0 });
  const cu = await L.forPhone(phone);
  return json(200, { on: true, points: cu ? cu.points : 0, value: c.value, min: c.min, maxPct: c.maxPct, earnPer: c.earnPer });
}

// 🛡️ the admin's script rule blocked something (lib/security.ts adminCsp): counted on Admin → সার্ভার ও ডাটাবেস,
// so a button that stopped working because of the rule shows up there instead of failing silently.
export async function cspReport(ctx: ApiCtx) {
  if (await allow(ctx, 'csp:', 20, 3600)) {
    const text = await readBody(ctx.req, 16 * 1024).catch(() => '');
    let r: Record<string, unknown> | null = null;
    try { const j = JSON.parse(text) as { 'csp-report'?: unknown; body?: unknown; 0?: { body?: unknown } | null }; r = fields(j['csp-report'] || (Array.isArray(j) ? j[0] && j[0].body : j.body || j)); } catch (_) { r = null; }
    let page = '';
    try { page = new URL(String((r && (r['document-uri'] || r.documentURL)) || ''), 'https://x').pathname; } catch (_) { page = ''; }
    if (r && (page === '/admin' || page.startsWith('/admin/'))) {
      const dir = str(r['violated-directive'] || r.effectiveDirective || '', 60);
      const blocked = str(r['blocked-uri'] || r.blockedURL || 'inline', 120);
      $services_health.logError(new Error(`অ্যাডমিনে স্ক্রিপ্ট আটকানো হয়েছে (${dir}: ${blocked})`), { path: page, method: 'CSP' });
    }
  }
  return new Response(null, { status: 204, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...security.BASE_HEADERS } });
}

// 🙋 POST /api/want — "এই পণ্যটা খুঁজে দিন": a search that found nothing leaves the customer's phone (and name) so the
// shop can bring the product in and call back (Admin → রিপোর্ট → কাস্টমার কী খুঁজছে). A plain form: back to the search
// with a thank-you (#wanted-ok).
export async function want(ctx: ApiCtx) {
  const b = await ctx.body();
  const q = str(b.q, 120).trim();
  const back = (hash: string) => new Response(null, { status: 303, headers: { Location: `/products?q=${encodeURIComponent(q)}${hash}`, 'Cache-Control': 'no-store' } });
  if (!security.sameSite(ctx.req)) return json(403, { error: 'অনুমতি নেই।' });
  if (str(b.website, 50)) return back('#wanted-ok'); // the hidden box only robots fill in
  if (!(await allow(ctx, 'want:', 6, 3600))) return tooMany(ctx);
  const phone = normalizePhone(b.phone);
  if (!q || !validPhone(phone)) return back('#wanted-bad');
  const dup = await db.one('SELECT id FROM product_wants WHERE phone=$1 AND lower(q)=lower($2) AND created_at > now() - interval \'7 days\'', [phone, q]);
  if (!dup) {
    await db.q('INSERT INTO product_wants(q, name, phone, note) VALUES($1, $2, $3, $4)', [q, str(b.name, 80), phone, str(b.note, 300)]);
    notify.later(notify.sendEmail(ctx.settings, `🙋 কাস্টমার একটা পণ্য চাইছে: ${q}`, `"${q}" খুঁজে কিছু পায়নি — ${str(b.name, 80) || 'নাম দেয়নি'}, ${phone}${str(b.note, 300) ? `\nলিখেছে: ${str(b.note, 300)}` : ''}\n\nসব অনুরোধ: Admin → রিপোর্ট → কাস্টমার কী খুঁজছে`).catch(() => {}));
  }
  return back('#wanted-ok');
}

'use strict';
// Orders: create, edit, status changes (with stock), delivery zones, coupons.
const { q, one, tx, jsonSetting } = require('../db');
const { int, str, randomCode, bn, normalizePhone, ymd, amount, round2, money, qtyRule, contact } = require('../util');
const catalog = require('./catalog');
const customers = require('./customers');
const GEO = require('../data/bd-geo.json');

const STATUSES = {
  pending: 'নতুন অর্ডার',
  confirmed: 'কনফার্ম হয়েছে',
  processing: 'প্যাকিং চলছে',
  hold: 'হোল্ডে আছে',
  shipped: 'কুরিয়ারে দেওয়া হয়েছে',
  delivered: 'ডেলিভারি সম্পন্ন',
  returned: 'ফেরত এসেছে',
  cancelled: 'বাতিল',
};
// In these statuses the order's goods are back on the shelf.
const RELEASED = new Set(['cancelled', 'returned']);
const PAYMENT_METHODS = {
  cod: 'ক্যাশ অন ডেলিভারি', bkash: 'বিকাশ (অনলাইন)', ssl: 'কার্ড / মোবাইল ব্যাংকিং (SSLCommerz)',
  manual_bkash: 'বিকাশ (Send Money)', manual_nagad: 'নগদ (Send Money)', manual_rocket: 'রকেট (Send Money)',
  manual_upay: 'উপায় (Send Money)', cash: 'নগদ টাকা (দোকানে)',
};
const PAYMENT_STATUSES = { unpaid: 'বাকি', partial: 'আংশিক পেইড', paid: 'পেইড', refunded: 'রিফান্ড' };

class OrderError extends Error {
  constructor(message, field) { super(message); this.field = field; }
}

// ---------------------------------------------------------------- delivery zones
function dhakaCityAreas(settings) {
  const custom = jsonSetting(settings, 'dhaka_city_areas', null);
  return Array.isArray(custom) && custom.length ? custom : GEO.dhakaCity;
}
function findDistrict(name) {
  const n = String(name || '').trim().toLowerCase();
  return GEO.districts.find((d) => d.en.toLowerCase() === n || d.bn === name) || null;
}
function zoneFor(settings, district, thana) {
  const d = findDistrict(district);
  if (!d || d.en !== 'Dhaka') return 'outside';
  return dhakaCityAreas(settings).includes(thana) ? 'dhaka' : 'outside';
}
function deliveryFee(settings, zone, subtotal) {
  const freeMin = int(settings.free_delivery_min);
  if (freeMin > 0 && subtotal >= freeMin) return 0;
  return zone === 'dhaka' ? int(settings.delivery_dhaka) : int(settings.delivery_outside);
}
// Extra delivery zones the owner made (Admin → সেটিংস → ডেলিভারি জোন), e.g. "ঢাকার আশেপাশে" ৳১০০ for Gazipur, Narayanganj…
function customZones(settings) {
  const z = jsonSetting(settings, 'delivery_zones', []);
  return (Array.isArray(z) ? z : []).filter((x) => x && str(x.name) && Array.isArray(x.districts) && x.districts.length)
    .map((x) => ({ name: str(x.name, 60), fee: Math.max(0, amount(x.fee)), districts: x.districts.map((d) => String(d)) }));
}
// Which zone an address is in, and its charge (before weight and free delivery).
function deliveryZone(settings, district, thana) {
  const d = findDistrict(district);
  const en = d ? d.en : '';
  if (en === 'Dhaka' && dhakaCityAreas(settings).includes(thana)) return { area: 'dhaka', name: 'ঢাকা সিটি', fee: int(settings.delivery_dhaka) };
  for (const z of customZones(settings)) if (z.districts.includes(en)) return { area: 'outside', name: z.name, fee: z.fee };
  return { area: 'outside', name: 'ঢাকার বাইরে', fee: int(settings.delivery_outside) };
}
// Heavy parcels: extra charge per kg above the free kilos (0 = off).
function weightExtra(settings, weightG) {
  const per = amount(settings.delivery_per_kg);
  if (!(per > 0) || !(weightG > 0)) return 0;
  const free = Math.max(0, Number(settings.delivery_free_kg) || 1);
  return Math.max(0, Math.ceil(weightG / 1000 - 1e-9) - free) * per;
}
// The full delivery charge for a cart.
function deliveryFor(settings, { district, thana, subtotal, weightG = 0 }) {
  const z = deliveryZone(settings, district, thana);
  const freeMin = int(settings.free_delivery_min);
  const fee = freeMin > 0 && subtotal >= freeMin ? 0 : round2(z.fee + weightExtra(settings, weightG));
  return { ...z, fee };
}
function areaLabel(order) {
  const d = findDistrict(order.district);
  const a = d && d.areas.find((x) => x[0] === order.thana);
  return [a ? a[1] : order.thana, d ? d.bn : order.district].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------- coupons
// lines: [{ product_id, price, qty }] — needed when the coupon is only for some products / categories.
async function checkCoupon(code, subtotal, phone, lines = null) {
  const c = await one(`SELECT * FROM coupons WHERE upper(code)=upper($1)`, [str(code, 40)]);
  const today = ymd();
  if (!c || !c.active) return { ok: false, message: 'এই কুপন কোডটি সঠিক নয়।' };
  if (c.starts_on && today < c.starts_on) return { ok: false, message: 'এই কুপন এখনো চালু হয়নি।' };
  if (c.ends_on && today > c.ends_on) return { ok: false, message: 'এই কুপনের মেয়াদ শেষ।' };
  if (c.usage_limit > 0 && c.used_count >= c.usage_limit) return { ok: false, message: 'এই কুপন আর ব্যবহার করা যাবে না।' };
  if (c.min_order > 0 && subtotal < c.min_order) {
    return { ok: false, message: `এই কুপন ব্যবহার করতে কমপক্ষে ৳${bn(c.min_order)} এর পণ্য কিনতে হবে।` };
  }
  if (c.per_phone > 0 && phone) {
    const used = await one(`SELECT count(*)::int AS n FROM orders WHERE upper(coupon_code)=upper($1) AND phone=$2 AND status<>'cancelled'`, [c.code, normalizePhone(phone)]);
    if (used.n >= c.per_phone) return { ok: false, message: 'আপনি এই কুপন আগেই ব্যবহার করেছেন।' };
  }
  if (c.first_order) {
    if (!phone) return { ok: false, message: 'এই কুপন শুধু প্রথম অর্ডারে — আগে মোবাইল নম্বর লিখুন, তারপর কুপন দিন।' };
    const before = await one(`SELECT count(*)::int AS n FROM orders WHERE phone=$1 AND status NOT IN ('cancelled')`, [normalizePhone(phone)]);
    if (before.n > 0) return { ok: false, message: 'এই কুপন শুধু প্রথম অর্ডারের জন্য।' };
  }
  // flash-sale lines and gifts never take a coupon (no double discount)
  const noCoupon = Array.isArray(lines) ? round2(lines.filter((l) => l.kind === 'flash' || l.kind === 'gift').reduce((s, l) => s + Number(l.price) * int(l.qty), 0)) : 0;
  // only for some products / categories: the discount counts only those products
  let base = round2(subtotal - noCoupon);
  if (!(base > 0)) return { ok: false, message: 'ফ্ল্যাশ সেল আর অফারের উপহারে কুপন চলে না।' };
  const pids = c.product_ids || [];
  const cids = c.category_ids || [];
  if (pids.length || cids.length) {
    if (!Array.isArray(lines) || !lines.length) return { ok: false, message: 'কার্টে পণ্য নেই।' };
    const inCats = cids.length ? new Set((await q(`WITH RECURSIVE t AS (SELECT id FROM categories WHERE id = ANY($1::int[])
        UNION SELECT c.id FROM categories c JOIN t ON c.parent_id=t.id) SELECT p.id FROM products p WHERE p.category_id IN (SELECT id FROM t)`, [cids])).map((r) => r.id)) : new Set();
    base = round2(lines.filter((l) => l.kind !== 'flash' && l.kind !== 'gift' && (pids.includes(int(l.product_id)) || inCats.has(int(l.product_id))))
      .reduce((s, l) => s + Number(l.price) * int(l.qty), 0));
    if (!(base > 0)) return { ok: false, message: 'এই কুপন আপনার কার্টের পণ্যগুলোতে প্রযোজ্য নয়।' };
  }
  let discount = 0;
  if (c.type === 'percent') discount = Math.floor((base * c.value) / 100);
  else if (c.type === 'fixed') discount = c.value;
  if (c.max_discount > 0) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, base);
  const partial = base !== subtotal;
  return { ok: true, coupon: c, discount, freeDelivery: c.type === 'free_delivery', partial,
    message: !partial ? 'কুপন যোগ হয়েছে।' : noCoupon ? 'কুপন যোগ হয়েছে (ফ্ল্যাশ সেল/উপহার বাদে বাকি পণ্যে)।' : 'কুপন যোগ হয়েছে (নির্দিষ্ট পণ্যে)।' };
}

// ---------------------------------------------------------------- lines & stock
// Turn requested lines into priced lines, taking stock for them. Throws OrderError.
// Prices: an admin may type a price; otherwise the lowest of normal / flash sale / quantity price (services/pricing).
// Web orders also get the "buy X get Y" gift lines (when the gift is in stock).
async function takeLines(t, wanted, { allowPrice = false, refId = null, staffId = null } = {}) {
  const pricing = require('../services/pricing');
  const ids = wanted.map((w) => w.id);
  // one after the other: a transaction's connection runs one query at a time
  const tiers = await pricing.tiersFor(ids, t);
  const flash = await pricing.flashFor(ids, t);
  const lines = [];
  for (const w of wanted) {
    const p = (await t.query(
      `SELECT id, name, sku, price, cost_price, product_type, active, weight_g FROM products WHERE id=$1`, [w.id])).rows[0];
    if (!p || (!p.active && !allowPrice)) throw new OrderError('একটি পণ্য আর পাওয়া যাচ্ছে না। কার্ট থেকে সরিয়ে আবার চেষ্টা করুন।');
    const parts = await catalog.stockParts(t, p.id, w.qty);
    if (p.product_type === 'bundle' && !parts.length) throw new OrderError(`"${p.name}" প্যাকেজে কোনো পণ্য সেট করা নেই।`);
    let cost = p.cost_price;
    for (const part of parts) {
      const ok = await catalog.moveStock(t, part.product_id, -part.qty, 'order', 'order', refId, '', staffId, true);
      if (!ok) {
        const s = (await t.query('SELECT name, stock FROM products WHERE id=$1', [part.product_id])).rows[0];
        const pname = s ? s.name : p.name;
        throw new OrderError(s && s.stock > 0
          ? `"${pname}" স্টকে আছে মাত্র ${bn(s.stock)}টি। পরিমাণ কমিয়ে আবার চেষ্টা করুন।`
          : `"${pname}" এখন স্টকে নেই।`);
      }
    }
    if (p.product_type === 'bundle' && !cost) cost = await bundleCost(t, p.id);
    await t.query('UPDATE products SET sold_count = sold_count + $1 WHERE id=$2', [w.qty, p.id]);
    let lp = { price: Number(p.price), kind: '', note: '', ref_id: null };
    if (allowPrice && w.price !== undefined && w.price !== null && w.price !== '') {
      lp = { price: amount(w.price), kind: w.kind === 'gift' ? 'gift' : '', note: w.kind === 'gift' ? str(w.note, 120) : '', ref_id: null };
    } else {
      lp = pricing.linePrice({ base: p.price, qty: w.qty, flash: flash.get(p.id), tiers: tiers.get(p.id) });
      if (lp.kind === 'flash') {
        // the sale's piece limit is counted here, at the moment of the order (two buyers can't both get the last piece)
        const got = (await t.query('UPDATE flash_items SET sold = sold + $1 WHERE id=$2 AND (max_qty = 0 OR sold + $1 <= max_qty) RETURNING id', [w.qty, lp.ref_id])).rows[0];
        if (!got) lp = pricing.linePrice({ base: p.price, qty: w.qty, flash: null, tiers: tiers.get(p.id) });
      }
    }
    lines.push({ product_id: p.id, name: p.name, sku: p.sku, price: lp.price, cost, qty: w.qty, weight_g: p.weight_g || 0,
      components: p.product_type === 'bundle' ? parts : null, kind: lp.kind, note: lp.note, ref_id: lp.ref_id });
  }
  if (!allowPrice) {
    for (const g of await pricing.giftsFor(lines, t, bn)) {
      const line = await takeGift(t, g, { refId, staffId });
      if (line) lines.push(line);
    }
  }
  return lines;
}
async function bundleCost(t, bundleId) {
  const c = (await t.query(`SELECT coalesce(sum(p.cost_price * bi.qty),0)::numeric(14,2) AS c FROM bundle_items bi JOIN products p ON p.id=bi.product_id WHERE bi.bundle_id=$1`, [bundleId])).rows[0];
  return c.c;
}
// A gift line: taken from stock only if there is enough (a missing gift never stops the order).
async function takeGift(t, g, { refId, staffId }) {
  const p = (await t.query('SELECT id, name, sku, cost_price, product_type, active, weight_g, stock FROM products WHERE id=$1', [g.product_id])).rows[0];
  if (!p || !p.active) return null;
  for (const qty of [...new Set([g.qty, Math.min(g.qty, p.product_type === 'bundle' ? g.qty : p.stock)])]) {
    if (qty < 1) continue;
    await t.query('SAVEPOINT gift');
    const parts = await catalog.stockParts(t, p.id, qty);
    let ok = parts.length > 0;
    for (const part of parts) {
      if (!ok) break;
      ok = !!(await catalog.moveStock(t, part.product_id, -part.qty, 'order', 'order', refId, 'অফারের উপহার', staffId, true));
    }
    if (!ok) { await t.query('ROLLBACK TO SAVEPOINT gift'); continue; }
    await t.query('RELEASE SAVEPOINT gift');
    await t.query('UPDATE products SET sold_count = sold_count + $1 WHERE id=$2', [qty, p.id]);
    const cost = p.product_type === 'bundle' && !Number(p.cost_price) ? await bundleCost(t, p.id) : p.cost_price;
    return { product_id: p.id, name: p.name, sku: p.sku, price: g.price, cost, qty, weight_g: p.weight_g || 0,
      components: p.product_type === 'bundle' ? parts : null, kind: 'gift', note: g.note, ref_id: g.offer.id };
  }
  return null;
}
// Put the stock of saved order items back on the shelf.
async function releaseLines(t, items, reason, refId, staffId) {
  for (const it of items) {
    if (it.kind === 'flash' && it.ref_id) await t.query('UPDATE flash_items SET sold = greatest(0, sold - $1) WHERE id=$2', [it.qty, it.ref_id]);
    if (!it.product_id) continue;
    const parts = it.components && it.components.length ? it.components : [{ product_id: it.product_id, qty: it.qty }];
    for (const part of parts) {
      const exists = (await t.query('SELECT id FROM products WHERE id=$1', [part.product_id])).rows[0];
      if (exists) await catalog.moveStock(t, part.product_id, part.qty, reason, 'order', refId, '', staffId);
    }
    await t.query('UPDATE products SET sold_count = greatest(0, sold_count - $1) WHERE id=$2', [it.qty, it.product_id]);
  }
}
function mergeWanted(items) {
  const wanted = new Map();
  for (const it of items || []) {
    const id = int(it.id || it.product_id);
    const qty = Math.min(int(it.qty), 999);
    const gift = it.kind === 'gift';
    const key = id + (gift ? ':gift' : '');
    if (id > 0 && qty > 0) {
      const prev = wanted.get(key);
      wanted.set(key, { id, qty: (prev ? prev.qty : 0) + qty, price: it.price !== undefined ? it.price : prev && prev.price,
        ...(gift ? { kind: 'gift', note: it.note || (prev && prev.note) || '' } : {}) });
    }
  }
  return [...wanted.values()];
}
async function insertItems(t, orderId, lines) {
  for (const l of lines) {
    await t.query(`INSERT INTO order_items(order_id, product_id, name, sku, price, cost, qty, components, kind, note, ref_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [orderId, l.product_id, l.name, l.sku || '', l.price, l.cost || 0, l.qty, l.components ? JSON.stringify(l.components) : null,
        l.kind || '', l.note || '', l.ref_id || null]);
  }
}

// ---------------------------------------------------------------- create
async function createOrder(input, settings) {
  const wanted = mergeWanted(input.items);
  if (!wanted.length) throw new OrderError('কার্ট খালি। আগে পণ্য যোগ করুন।');
  const isAdmin = input.source === 'admin';
  const phone = normalizePhone(input.phone);
  const zone = input.district ? zoneFor(settings, input.district, input.thana) : (input.area === 'dhaka' ? 'dhaka' : 'outside');
  const dz = input.district ? deliveryZone(settings, input.district, input.thana) : null;

  return tx(async (t) => {
    // The order row comes first so stock movements can point at it.
    const prefix = (settings.order_prefix || 'SM').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'SM';
    let order = null;
    for (let i = 0; i < 6 && !order; i++) {
      order = (await t.query(
        `INSERT INTO orders(code, customer_name, phone, address, area, subtotal, delivery, total)
         VALUES($1,$2,$3,$4,$5,0,0,0) ON CONFLICT (code) DO NOTHING RETURNING id, code`,
        [prefix + randomCode(6), input.name, phone, input.address, zone])).rows[0];
    }
    const lines = await takeLines(t, wanted, { allowPrice: isAdmin, refId: order.id, staffId: input.createdBy || null });
    // Online customers: cheap parts need a minimum amount, and each product has a maximum (Admin → সেটিংস).
    if (!isAdmin) {
      const C = contact(settings);
      const how = [C.phone && `কল করুন ${C.phone}`, C.wa && 'WhatsApp এ মেসেজ দিন'].filter(Boolean).join(' অথবা ');
      for (const l of lines) {
        if (l.kind === 'gift') continue;
        const r = qtyRule(settings, l.price);
        if (l.qty < r.min) {
          throw new OrderError(`"${l.name}" কম দামের পণ্য (প্রতি পিস ${money(l.price)}) — কমপক্ষে ${bn(r.min)}টি নিতে হবে (${money(r.min * l.price)})। কার্টে গিয়ে পরিমাণ বাড়িয়ে নিন।`);
        }
        if (l.qty > r.max) {
          throw new OrderError(`"${l.name}" একসাথে সর্বোচ্চ ${bn(r.max)}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন${how ? ' — ' + how : ''}।`);
        }
      }
    }
    const subtotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
    if (!isAdmin && int(settings.min_order) > 0 && subtotal < int(settings.min_order)) {
      throw new OrderError(`কমপক্ষে ৳${bn(int(settings.min_order))} এর পণ্য অর্ডার করতে হবে।`);
    }
    let discount = 0;
    let couponCode = '';
    let freeDelivery = false;
    if (input.coupon) {
      const c = await checkCoupon(input.coupon, subtotal, phone, lines);
      if (!c.ok) throw new OrderError(c.message, 'coupon');
      discount = c.discount;
      freeDelivery = c.freeDelivery;
      couponCode = c.coupon.code;
      await t.query('UPDATE coupons SET used_count = used_count + 1 WHERE id=$1', [c.coupon.id]);
    }
    if (isAdmin && input.discount !== undefined && input.discount !== '') discount = Math.min(subtotal, amount(input.discount));
    const weightG = lines.reduce((w, l) => w + (l.weight_g || 0) * l.qty, 0);
    let delivery = freeDelivery ? 0 : (input.district ? deliveryFor(settings, { district: input.district, thana: input.thana, subtotal, weightG }).fee : deliveryFee(settings, zone, subtotal));
    if (isAdmin && input.delivery !== undefined && input.delivery !== '') delivery = amount(input.delivery);
    let total = Math.max(0, Math.round(subtotal - discount + delivery)); // whole taka: couriers collect whole taka
    const costTotal = round2(lines.reduce((s, l) => s + (l.cost || 0) * l.qty, 0));
    const customerId = await customers.upsertCustomer(t, {
      name: input.name, phone, email: input.email, address: input.address, district: input.district, thana: input.thana,
    });
    // loyalty points the customer chose to use (web orders; the balance is checked here, inside the order)
    let pts = { points: 0, discount: 0 };
    if (input.usePoints && !isAdmin && settings.loyalty_on === '1') {
      pts = await require('./loyalty').redeem(t, customerId, settings, Math.max(0, subtotal - discount), order.id);
      if (pts.points) total = Math.max(0, Math.round(subtotal - discount - pts.discount + delivery));
    }
    await t.query(
      `UPDATE orders SET email=$1, district=$2, thana=$3, note=$4, subtotal=$5, discount=$6, delivery=$7, total=$8, cost_total=$9,
         payment=$10, payment_status='unpaid', transaction_id=$11, payment_number=$12, coupon_code=$13, ip=$14, source=$15,
         created_by=$16, customer_id=$17, status=$18, admin_note=$19, zone_name=$21, weight_g=$22, points_used=$23, points_discount=$24 WHERE id=$20`,
      [input.email || '', input.district || '', input.thana || '', input.note || '', subtotal, discount, delivery, total, costTotal,
        input.payment || 'cod', input.trxId || '', input.paymentNumber || '', couponCode, input.ip || '', input.source || 'web',
        input.createdBy || null, customerId, input.status && STATUSES[input.status] ? input.status : 'pending',
        input.adminNote || '', order.id, dz ? dz.name : '', weightG, pts.points, pts.discount]);
    await insertItems(t, order.id, lines);
    return { id: order.id, code: order.code, total, lines, pointsUsed: pts.points, pointsDiscount: pts.discount };
  });
}

// ---------------------------------------------------------------- read
async function getOrder({ id, code }) {
  const order = await one(`SELECT o.*, s.name AS created_by_name FROM orders o LEFT JOIN staff s ON s.id=o.created_by
                           WHERE ${id ? 'o.id=$1' : 'o.code=$1'}`, [id || code]);
  if (!order) return null;
  order.items = await q(`SELECT i.*, p.image_id, p.slug, p.emoji FROM order_items i LEFT JOIN products p ON p.id=i.product_id
                         WHERE i.order_id=$1 ORDER BY i.id`, [order.id]);
  return order;
}

function orderWhere({ status, q: search, from, to, courier, payment, paymentStatus, phone, source }, params) {
  const where = [];
  if (status) { params.push(status); where.push(`o.status=$${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(o.code ILIKE $${n} OR o.phone ILIKE $${n} OR o.customer_name ILIKE $${n} OR o.consignment_id ILIKE $${n}
      OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND (i.name ILIKE $${n} OR i.sku ILIKE $${n})))`);
  }
  if (from) { params.push(from); where.push(`(o.created_at AT TIME ZONE 'Asia/Dhaka')::date >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`(o.created_at AT TIME ZONE 'Asia/Dhaka')::date <= $${params.length}::date`); }
  if (courier === 'none') where.push(`o.courier=''`);
  else if (courier) { params.push(courier); where.push(`o.courier=$${params.length}`); }
  if (payment) { params.push(payment); where.push(`o.payment=$${params.length}`); }
  if (paymentStatus) { params.push(paymentStatus); where.push(`o.payment_status=$${params.length}`); }
  if (phone) { params.push(normalizePhone(phone)); where.push(`o.phone=$${params.length}`); }
  if (source) { params.push(source); where.push(`o.source=$${params.length}`); }
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}
async function listOrders(opts = {}) {
  const params = [];
  const where = orderWhere(opts, params);
  params.push(opts.limit || 50, opts.offset || 0);
  return q(`SELECT o.*, (SELECT sum(qty)::int FROM order_items WHERE order_id=o.id) AS item_count,
              (SELECT string_agg(name || ' ×' || qty, ', ' ORDER BY id) FROM order_items WHERE order_id=o.id) AS item_names,
              (SELECT string_agg(NULLIF(sku,''), ', ' ORDER BY id) FROM order_items WHERE order_id=o.id) AS item_skus
            FROM orders o ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countOrders(opts = {}) {
  const params = [];
  const where = orderWhere(opts, params);
  return (await one(`SELECT count(*)::int AS n FROM orders o ${where}`, params)).n;
}
async function statusCounts() {
  const rows = await q('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
  const out = { all: 0 };
  rows.forEach((r) => { out[r.status] = r.n; out.all += r.n; });
  return out;
}

// ---------------------------------------------------------------- change
// opts.damaged: a returned order's goods came back broken — they go to "damaged stock" instead of the shelf.
// Things to do after a status change is saved (customer SMS …) — registered once at start-up.
const statusListeners = [];
function onStatusChange(fn) { statusListeners.push(fn); }
async function setStatus(id, status, staffId, opts = {}) {
  const r = await setStatusTx(id, status, staffId, opts);
  if (r.changed) for (const fn of statusListeners) { try { await fn(id, status, r.prev); } catch (e) { console.error('status listener', e && e.message); } }
  return r;
}
async function setStatusTx(id, status, staffId, opts = {}) {
  if (!STATUSES[status]) throw new OrderError('অজানা অবস্থা।');
  return tx(async (t) => {
    const o = (await t.query('SELECT id, status, payment, payment_status, total, returned_to FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw new OrderError('অর্ডার পাওয়া যায়নি।');
    if (o.status === status) return { changed: false, prev: o.status };
    const items = (await t.query('SELECT * FROM order_items WHERE order_id=$1', [id])).rows;
    const wasReleased = RELEASED.has(o.status);
    const nowReleased = RELEASED.has(status);
    const partsOf = (it) => (it.components && it.components.length ? it.components : [{ product_id: it.product_id, qty: it.qty }]);
    let returnedTo = o.returned_to;
    if (!wasReleased && nowReleased) {
      if (status === 'returned' && opts.damaged) {
        for (const it of items) {
          if (!it.product_id) continue;
          for (const part of partsOf(it)) {
            const exists = (await t.query('SELECT id FROM products WHERE id=$1', [part.product_id])).rows[0];
            if (exists) await catalog.changeDamaged(t, part.product_id, { damaged: part.qty }, 'return_damaged', 'order', id, 'ফেরত আসা অর্ডারের নষ্ট মাল', staffId);
          }
        }
        returnedTo = 'damaged';
      } else {
        await releaseLines(t, items, 'cancel', id, staffId);
        returnedTo = status === 'returned' ? 'stock' : '';
      }
    } else if (wasReleased && !nowReleased) {
      // Taking the goods again: from the shelf, or — if they went to damaged stock — from there.
      const fromDamaged = o.status === 'returned' && o.returned_to === 'damaged';
      for (const it of items) {
        if (!it.product_id) continue;
        for (const part of partsOf(it)) {
          const ok = fromDamaged
            ? await catalog.changeDamaged(t, part.product_id, { damaged: -part.qty }, 'order', 'order', id, 'অর্ডার আবার চালু (নষ্ট স্টক থেকে)', staffId)
            : await catalog.moveStock(t, part.product_id, -part.qty, 'order', 'order', id, 'অর্ডার আবার চালু', staffId, true);
          if (!ok) throw new OrderError(`"${it.name}" এর যথেষ্ট স্টক নেই, তাই অর্ডারটি আবার চালু করা যাচ্ছে না।`);
        }
        await t.query('UPDATE products SET sold_count = sold_count + $1 WHERE id=$2', [it.qty, it.product_id]);
      }
      returnedTo = '';
    } else if (wasReleased && nowReleased && status === 'returned' && opts.damaged && o.returned_to !== 'damaged') {
      // cancelled → returned (broken): the goods already went back on the shelf; move them to damaged now
      for (const it of items) {
        if (!it.product_id) continue;
        for (const part of partsOf(it)) await catalog.changeDamaged(t, part.product_id, { stock: -part.qty, damaged: part.qty }, 'return_damaged', 'order', id, 'ফেরত আসা অর্ডারের নষ্ট মাল', staffId);
      }
      returnedTo = 'damaged';
    }
    let extra = '';
    if (status === 'delivered') {
      extra = ', delivered_at = now()';
      if (o.payment === 'cod' && o.payment_status !== 'paid') extra += ', payment_status = \'paid\', paid_amount = total';
    }
    await t.query(`UPDATE orders SET status=$1, returned_to=$3, updated_at=now() ${extra} WHERE id=$2`, [status, id, returnedTo || '']);
    await require('./loyalty').onStatus(t, id, o.status, status);
    return { changed: true, prev: o.status, returnedTo };
  });
}

// Edit an order's details and (optionally) its items. Stock is kept right.
async function updateOrder(id, data, settings, staffId) {
  return tx(async (t) => {
    const o = (await t.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw new OrderError('অর্ডার পাওয়া যায়নি।');
    const fields = {
      customer_name: str(data.customer_name, 80) || o.customer_name,
      phone: normalizePhone(data.phone) || o.phone,
      email: str(data.email, 120),
      address: str(data.address, 400) || o.address,
      district: str(data.district, 60),
      thana: str(data.thana, 60),
      note: str(data.note, 300),
      admin_note: str(data.admin_note, 1000),
      payment: data.payment && PAYMENT_METHODS[data.payment] ? data.payment : o.payment,
      payment_status: data.payment_status && PAYMENT_STATUSES[data.payment_status] ? data.payment_status : o.payment_status,
      paid_amount: data.paid_amount !== undefined ? amount(data.paid_amount) : o.paid_amount,
      transaction_id: str(data.transaction_id, 80),
      payment_number: str(data.payment_number, 20),
    };
    fields.area = fields.district ? zoneFor(settings, fields.district, fields.thana) : o.area;
    if (fields.district) fields.zone_name = deliveryZone(settings, fields.district, fields.thana).name;

    let subtotal = o.subtotal;
    let costTotal = o.cost_total;
    if (Array.isArray(data.items)) {
      const wanted = mergeWanted(data.items);
      if (!wanted.length) throw new OrderError('অর্ডারে অন্তত একটি পণ্য থাকতে হবে।');
      const oldItems = (await t.query('SELECT * FROM order_items WHERE order_id=$1', [id])).rows;
      const released = RELEASED.has(o.status);
      if (!released) await releaseLines(t, oldItems, 'edit', id, staffId);
      let lines;
      if (released) {
        // Cancelled/returned orders don't hold stock; just price the lines.
        lines = [];
        for (const w of wanted) {
          const p = (await t.query('SELECT id, name, sku, price, cost_price FROM products WHERE id=$1', [w.id])).rows[0];
          if (p) lines.push({ product_id: p.id, name: p.name, sku: p.sku, price: w.price !== undefined && w.price !== '' ? amount(w.price) : Number(p.price), cost: p.cost_price, qty: w.qty, components: null,
            kind: w.kind === 'gift' ? 'gift' : '', note: w.kind === 'gift' ? str(w.note, 120) : '' });
        }
      } else {
        lines = await takeLines(t, wanted, { allowPrice: true, refId: id, staffId });
      }
      await t.query('DELETE FROM order_items WHERE order_id=$1', [id]);
      await insertItems(t, id, lines);
      subtotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
      costTotal = round2(lines.reduce((s, l) => s + (l.cost || 0) * l.qty, 0));
    }
    const discount = data.discount !== undefined ? Math.min(subtotal, amount(data.discount)) : o.discount;
    const delivery = data.delivery !== undefined ? amount(data.delivery) : o.delivery;
    // loyalty points used at checkout stay as they were (never more than the goods)
    const ptsOff = Math.min(Number(o.points_discount || 0), Math.max(0, subtotal - discount));
    const total = Math.max(0, Math.round(subtotal - discount - ptsOff + delivery)); // whole taka: couriers collect whole taka
    if (fields.payment_status === 'paid' && !fields.paid_amount) fields.paid_amount = total;
    if (fields.payment_status === 'unpaid') fields.paid_amount = 0;
    const cols = Object.keys(fields);
    await t.query(`UPDATE orders SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}, subtotal=$${cols.length + 1},
      discount=$${cols.length + 2}, delivery=$${cols.length + 3}, total=$${cols.length + 4}, cost_total=$${cols.length + 5}, updated_at=now()
      WHERE id=$${cols.length + 6}`, [...cols.map((c) => fields[c]), subtotal, discount, delivery, total, costTotal, id]);
    if (fields.phone !== o.phone || fields.customer_name !== o.customer_name) {
      const cid = await customers.upsertCustomer(t, { name: fields.customer_name, phone: fields.phone, email: fields.email,
        address: fields.address, district: fields.district, thana: fields.thana });
      await t.query('UPDATE orders SET customer_id=$1 WHERE id=$2', [cid, id]);
    }
    return { total };
  });
}

async function setCourierInfo(id, info) {
  await q(`UPDATE orders SET courier=$1, consignment_id=$2, tracking_code=$3, courier_status=$4, courier_sent_at=coalesce(courier_sent_at, now()), updated_at=now() WHERE id=$5`,
    [info.courier, String(info.consignment_id || ''), String(info.tracking_code || ''), String(info.status || ''), id]);
}
async function setCourierStatus(id, courierStatus) {
  await q('UPDATE orders SET courier_status=$1, updated_at=now() WHERE id=$2', [String(courierStatus || ''), id]);
}
async function markPaid(id, { amount: amt, trxId, method }) {
  await q(`UPDATE orders SET payment_status = CASE WHEN $1::numeric >= total THEN 'paid' ELSE 'partial' END, paid_amount = $1,
           transaction_id = CASE WHEN $2<>'' THEN $2 ELSE transaction_id END, payment = coalesce($3, payment), updated_at=now() WHERE id=$4`,
    [amount(amt), String(trxId || ''), method || null, id]);
}

module.exports = {
  onStatusChange,
  STATUSES, RELEASED, PAYMENT_METHODS, PAYMENT_STATUSES, OrderError, GEO,
  dhakaCityAreas, findDistrict, zoneFor, deliveryFee, deliveryZone, deliveryFor, customZones, weightExtra, areaLabel, checkCoupon,
  createOrder, getOrder, listOrders, countOrders, statusCounts, setStatus, updateOrder, setCourierInfo, setCourierStatus, markPaid,
};

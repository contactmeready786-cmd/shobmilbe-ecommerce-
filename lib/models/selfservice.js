'use strict';
// 🙋 The customer's own changes to an order, from the order's page (only the browser that placed it, or that opened it
// with the order number + mobile number on "অর্ডার ট্র্যাক"):
//  • ❌ cancel it            — until it is handed to the courier (new / confirmed / packing / on hold)
//  • ✏️ change name, mobile number or address — same rule; a new mobile number must pass the SMS code when
//    চেকআউট OTP is on; the delivery charge is worked out again for the new area.
// The goods go back on the shelf by themselves, the owner gets a phone notification, and the order's inside note
// says what the customer did. A courier booking that already exists is flagged so it can be changed there too.
const db = require('../db');
const O = require('./orders');
const { str, normalizePhone, validPhone } = require('../util');

class SelfError extends Error {}

const OPEN = new Set(['pending', 'confirmed', 'processing', 'hold']);
const REASONS = {
  mind: 'মত বদলেছি / আর লাগবে না',
  wrong: 'ভুল পণ্য বা ভুল পরিমাণ অর্ডার করেছি',
  cheaper: 'অন্য জায়গায় কম দামে পেয়েছি',
  late: 'ডেলিভারি অনেক দেরি হচ্ছে',
  again: 'নতুন করে অর্ডার করব (কিছু বদলাতে চাই)',
  other: 'অন্য কারণ',
};

function canChange(order) {
  if (!order) return { ok: false, why: 'অর্ডারটি পাওয়া যায়নি।' };
  if (order.handed_at || !OPEN.has(order.status)) {
    return { ok: false, why: O.RELEASED.has(order.status) ? 'এই অর্ডারটি আগেই বাতিল/ফেরত হয়েছে।' : 'অর্ডারটি কুরিয়ারে দেওয়া হয়ে গেছে — এখন বদলাতে বা বাতিল করতে আমাদের কল করুন।' };
  }
  return { ok: true };
}
const note = (id, text) => db.q(`UPDATE orders SET admin_note = left(trim(coalesce(admin_note, '') || E'\n' || $1), 1000), updated_at=now() WHERE id=$2`, [text, id]);
function pushOwner(title, body, url) {
  const push = require('../services/push');
  return require('../services/notify').later(push.count().then((n) => (n ? push.sendAll({ title, body, url, tag: 'self-' + Date.now() }) : null)).catch(() => null));
}

async function cancel(order, { reason, details }, settings) {
  const c = canChange(order);
  if (!c.ok) throw new SelfError(c.why);
  const why = REASONS[reason] ? REASONS[reason] : null;
  if (!why) throw new SelfError('বাতিলের কারণ বাছাই করুন।');
  await O.setStatus(order.id, 'cancelled', null);
  const paid = Number(order.paid_amount) || 0;
  const lines = [`❌ কাস্টমার নিজে অর্ডার বাতিল করেছেন — কারণ: ${why}${details ? ` (${str(details, 200)})` : ''}`];
  if (paid > 0) lines.push(`💸 কাস্টমার আগে ৳${Math.round(paid)} দিয়েছিলেন — আইন অনুযায়ী ১০ দিনের মধ্যে ফেরত দিন।`);
  if (order.consignment_id) lines.push(`⚠️ কুরিয়ারে বুকিং আছে (${order.consignment_id}) — কুরিয়ারের প্যানেল থেকেও বাতিল করুন।`);
  await note(order.id, lines.join(' '));
  await pushOwner(`❌ অর্ডার বাতিল — ${order.code}`, `${order.customer_name}: ${why}${paid > 0 ? ` · ৳${Math.round(paid)} ফেরত দিতে হবে` : ''}`, `/admin/orders/${order.id}`);
  const SMS = require('../services/sms');
  if (SMS.ready(settings).ok) {
    await require('../services/notify').later(SMS.send(settings, order.phone, `${settings.store_name || ''}: আপনার অর্ডার ${order.code} বাতিল করা হয়েছে।${paid > 0 ? ' আগে দেওয়া টাকা ১০ দিনের মধ্যে ফেরত দেওয়া হবে।' : ''}`, { kind: 'order_cancel', orderId: order.id }));
  }
  return { paid };
}

// New name / number / address. Returns the new delivery charge and total.
async function change(order, b, { req, settings }) {
  const c = canChange(order);
  if (!c.ok) throw new SelfError(c.why);
  const name = str(b.name, 80).trim();
  const phone = normalizePhone(b.phone);
  const address = str(b.address, 400).trim();
  if (name.length < 2) throw new SelfError('নাম লিখুন।');
  if (!validPhone(phone)) throw new SelfError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
  const dist = O.findDistrict(str(b.district, 60));
  if (!dist) throw new SelfError('জেলা বাছাই করুন।');
  const thana = str(b.thana, 60);
  if (!dist.areas.some((a) => a[0] === thana)) throw new SelfError('থানা / উপজেলা বাছাই করুন।');
  if (address.length < 5) throw new SelfError('পূর্ণ ঠিকানা লিখুন।');
  const phoneChanged = phone !== order.phone;
  if (phoneChanged) {
    if (await require('./customers').isBlocked(phone, '')) throw new SelfError(settings.block_message || 'এই নম্বরে অর্ডার নেওয়া যাচ্ছে না।');
    // চেকআউট OTP on: the new number must be proved with the SMS code, like at checkout
    const otp = await require('./checkoutotp').checkOrder(req, settings, phone, b.otp_token);
    if (!otp.ok) throw new SelfError('নতুন মোবাইল নম্বরটি যাচাই করুন: "OTP পাঠান" চেপে SMS-এ আসা কোড বসান।');
  }
  const same = !phoneChanged && name === order.customer_name && address === order.address && dist.en === order.district && thana === order.thana;
  if (same) throw new SelfError('কিছুই বদলানো হয়নি।');
  // the delivery charge for the new place (a free delivery stays free)
  let delivery = Number(order.delivery) || 0;
  if (delivery > 0) {
    const w = await db.one(`SELECT coalesce(sum(coalesce(p.weight_g, 0) * i.qty), 0)::int AS g FROM order_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.order_id=$1`, [order.id]);
    delivery = O.deliveryFor(settings, { district: dist.en, thana, subtotal: Number(order.subtotal), weightG: w.g }).fee;
  }
  const total = Math.max(0, Math.round(Number(order.subtotal) - Number(order.discount || 0) - Number(order.points_discount || 0) + delivery));
  const area = O.zoneFor(settings, dist.en, thana);
  const zone = O.deliveryZone(settings, dist.en, thana).name;
  await db.q(`UPDATE orders SET customer_name=$1, phone=$2, address=$3, district=$4, thana=$5, area=$6, zone_name=$7, delivery=$8, total=$9,
      phone_check = CASE WHEN $10 THEN '' ELSE phone_check END, updated_at=now() WHERE id=$11`,
  [name, phone, address, dist.en, thana, area, zone, delivery, total, phoneChanged && !(await require('./checkoutotp').on(settings)), order.id]);
  if (phoneChanged) {
    const cid = await db.tx(async (t) => require('./customers').upsertCustomer(t, { name, phone, address, district: dist.en, thana })).catch(() => null);
    if (cid) await db.q('UPDATE orders SET customer_id=$1 WHERE id=$2', [cid, order.id]);
  }
  const before = `${order.customer_name}, ${order.phone}, ${order.address}, ${order.thana}, ${order.district}`;
  const parts = [`✏️ কাস্টমার নিজে তথ্য বদলেছেন। আগে ছিল: ${before}`];
  if (delivery !== Number(order.delivery)) parts.push(`ডেলিভারি চার্জ ৳${Math.round(Number(order.delivery))} → ৳${Math.round(delivery)}, মোট ৳${total}`);
  if (order.consignment_id) parts.push(`⚠️ কুরিয়ারে বুকিং আছে (${order.consignment_id}) — কুরিয়ারের প্যানেলেও ঠিকানা/নম্বর বদলান।`);
  await note(order.id, parts.join(' · '));
  await pushOwner(`✏️ ঠিকানা বদল — ${order.code}`, `${name}: ${address}, ${thana}${phoneChanged ? ` · নতুন নম্বর ${phone}` : ''}`, `/admin/orders/${order.id}`);
  return { delivery, total, oldDelivery: Number(order.delivery), phoneChanged };
}

module.exports = { SelfError, REASONS, canChange, cancel, change };

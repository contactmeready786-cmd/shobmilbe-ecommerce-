// What happens after an order's status changes, wherever the change was made (the admin, a courier's webhook, a
// payment, the robot call, the customer cancelling): the customer's SMS, gift card money back, the referral reward,
// a branch's pieces back on its shelf. lib/models/orders.ts loads this the first time a status changes, so these
// always run — on every server, for every route.
import * as db from '../db';
import * as O from './orders';
import * as notify from '../services/notify';
import * as $services_sms from '../services/sms';
import * as $models_giftcards from './giftcards';

// Customer SMS when an order is confirmed / handed to the courier / delivered (Admin → মার্কেটিং → কাস্টমারকে SMS).
O.onStatusChange(async (id, status) => {
  const ev = { confirmed: 'confirmed', shipped: 'shipped', delivered: 'delivered' }[status];
  if (!ev) return;
  const settings = await db.getSettings();
  if (settings.sms_on !== '1' || settings[`sms_on_${ev}`] !== '1') return;
  const o = await db.one<{ id: number; code: string; phone: string; customer_name: string; total: number; tracking_code: string | null; points_earned: number | null; source: string }>(
    'SELECT id, code, phone, customer_name, total, tracking_code, points_earned, source FROM orders WHERE id=$1', [id]);
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

// ↩️ Profit & loss with a part-return (found in the 2026-11-13 audit): one piece of a delivered order comes back and its
// money is refunded — the order stays "delivered", so the refund must come off the profit and the buying cost of the
// piece that went back on the shelf must be added back. Before, the profit stayed too high by the piece's margin.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as finance from '../lib/models/finance';

after(() => closeConnection());
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test('a refunded part-return lowers the profit by the piece\'s margin only', { skip }, async () => {
  await db.ensureReady();
  const before = await finance.profitLoss(day(-1), day(1));
  const tag = Date.now() % 1e7;
  const order = (await db.one<{ id: number }>(`INSERT INTO orders(code, customer_name, phone, address, area, subtotal, delivery, total, cost_total, status, delivered_at, payment_status, paid_amount)
    VALUES($1,'রিনা','01712000222','ঢাকা','dhaka',300,0,300,200,'delivered',now(),'paid',300) RETURNING id`, [`PR${tag}`]))!.id;
  const item = (await db.one<{ id: number }>(`INSERT INTO order_items(order_id, name, price, cost, qty) VALUES($1,'LED বাল্ব',150,100,2) RETURNING id`, [order]))!.id;
  const mid = await finance.profitLoss(day(-1), day(1));
  assert.equal(Math.round(mid.net - before.net), 100, 'two pieces sold: 300 − 200');
  await db.q(`INSERT INTO return_requests(code, order_id, items, restock, status, received_at, refund_amount, refunded_at)
    VALUES($1,$2,$3::jsonb,$4::jsonb,'refunded',now(),150,now())`,
  [`RT${tag}`, order, JSON.stringify([{ item_id: item, product_id: null, name: 'LED বাল্ব', qty: 1, ordered: 2, price: 150, components: null }]), JSON.stringify([{ item_id: item, how: 'stock' }])]);
  await db.q(`INSERT INTO refunds(order_id, amount, method, note) VALUES($1,150,'bkash','রিটার্ন')`, [order]);
  const p = await finance.profitLoss(day(-1), day(1));
  assert.equal(Math.round(p.returnRefunds - before.returnRefunds), 150);
  assert.equal(Math.round(p.returnedCost - before.returnedCost), 100);
  assert.equal(Math.round(p.net - before.net), 50, 'one piece really sold: 150 − 100');
});

// 📦 Packing costs on real orders (owner, 2026-10-23): written down when the order goes to the courier (once), boxes
// that are shop products come out of their stock, a returned parcel's good packing is "reused" (cost out, box back),
// and profit & loss subtracts what was really spent.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as P from '../lib/models/packing';
import * as O from '../lib/models/orders';
import * as finance from '../lib/models/finance';

let trimmer = 0, box = 0, order = 0;
const stockOf = async (id: number) => (await db.one<{ stock: number }>('SELECT stock FROM products WHERE id=$1', [id]))!.stock;

before(async () => {
  if (skip) return;
  await db.ensureReady();
  trimmer = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, cost_price, stock, active) VALUES('Kemei KM-1550', $1, 1450, 1200, 10, true) RETURNING id", [`km-${Date.now()}`]))!.id;
  box = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, cost_price, stock, active) VALUES('৩ নং বক্স', $1, 18, 12.5, 50, true) RETURNING id", [`box-${Date.now()}`]))!.id;
  const iBox = await P.saveItem({ name: '৩ নং বক্স', buy_price: 12.5, uses: 1, product_id: box });
  const iTape = await P.saveItem({ name: 'টেপ', buy_price: 55, uses: 25 });
  const iSticker = await P.saveItem({ name: 'ইনভয়েস স্টিকার', buy_price: 1, uses: 1 });
  const set = await P.saveSet({ name: '৩ নং বক্স সেট', per: 'piece', items: [{ item_id: iBox, qty: 1 }, { item_id: iTape, qty: 1 }] });
  const once = await P.saveSet({ name: 'প্রতি অর্ডারে', per: 'line', items: [{ item_id: iSticker, qty: 1 }] });
  await db.setSetting('packing_order_set', String(once));
  await db.q('UPDATE products SET packing_set_id=$1 WHERE id=$2', [set, trimmer]);
  order = (await db.one<{ id: number }>(`INSERT INTO orders(code, customer_name, phone, address, area, subtotal, delivery, total, status)
    VALUES($1,'রাফি','01712000111','ঢাকা','dhaka',2900,60,2960,'confirmed') RETURNING id`, [`PK${Date.now() % 1e6}`]))!.id;
  await db.q(`INSERT INTO order_items(order_id, product_id, name, price, qty) VALUES($1,$2,'Kemei KM-1550',1450,2)`, [order, trimmer]);
});
after(() => closeConnection());

test('sent to the courier: packing written down once, boxes from their stock', { skip }, async () => {
  await O.setStatus(order, 'shipped', null);
  const rows = await P.forOrder(order);
  const cost = rows.reduce((s, r) => s + Number(r.cost), 0);
  assert.equal(Math.round(cost * 100) / 100, 2 * 12.5 + 2 * 2.2 + 1); // 2 boxes + 2 tape uses + 1 sticker
  assert.equal(await stockOf(box), 48);
  await O.setStatus(order, 'delivered', null);
  assert.equal((await P.forOrder(order)).length, rows.length, 'not written again');
});

test('profit & loss subtracts the packing', { skip }, async () => {
  // (the shop counts days in Dhaka time — take yesterday … tomorrow so the test machine's own clock doesn't matter)
  const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const p = await finance.profitLoss(day(-1), day(1));
  assert.ok(p.packing.cost >= 30.4);
  assert.equal(Math.round((p.gross + p.otherIncomeTotal - p.expenseTotal - p.packing.cost) * 100), Math.round(p.net * 100));
});

test('returned with the box still good: reused — cost out, boxes back', { skip }, async () => {
  await O.setStatus(order, 'returned', null);
  await db.tx((t) => P.markReused(t, order, null));
  assert.equal(await stockOf(box), 50);
  assert.ok((await P.forOrder(order)).every((r) => r.state === 'reused'));
  // sent again: packed again
  await O.setStatus(order, 'shipped', null);
  assert.equal(await stockOf(box), 48);
});

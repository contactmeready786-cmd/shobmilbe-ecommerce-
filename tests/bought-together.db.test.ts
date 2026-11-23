// 🛒 "একসাথে কেনা হয়" (owner, 2026-11-23): catalog.boughtTogether — what real orders bought with a product
// (at least 2 orders, cancelled/returned orders and gifts left out, most often first), filled with the owner's
// "এর সাথে যা লাগবে" (cross) picks while there are too few orders; only active products in stock.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as catalog from '../lib/models/catalog';

const tag = `fbt-${Date.now()}`;
const ids: Record<string, number> = {};
const product = async (key: string, stock = 20, active = true) => {
  ids[key] = (await db.one<{ id: number }>('INSERT INTO products(name, slug, price, stock, active) VALUES($1, $2, 50, $3, $4) RETURNING id',
    [`${key} ${tag}`, `${key}-${tag}`, stock, active]))!.id;
};
let n = 0;
const order = async (keys: string[], status = 'delivered', gift: string[] = []) => {
  n += 1;
  const o = (await db.one<{ id: number }>(`INSERT INTO orders(code, customer_name, phone, address, area, subtotal, delivery, total, status)
    VALUES($1, 'টেস্ট', '01711000000', 'ঢাকা', 'dhaka', 100, 60, 160, $2) RETURNING id`, [`${tag}-${n}`, status]))!.id;
  for (const k of keys) await db.q("INSERT INTO order_items(order_id, product_id, name, price, qty) VALUES($1, $2, 'x', 50, 1)", [o, ids[k]]);
  for (const k of gift) await db.q("INSERT INTO order_items(order_id, product_id, name, price, qty, kind) VALUES($1, $2, 'x', 0, 1, 'gift')", [o, ids[k]]);
};

before(async () => {
  if (skip) return;
  await db.ensureReady();
  for (const k of ['iron', 'wire', 'flux', 'once', 'gone', 'off', 'gift', 'pick', 'lonely']) await product(k, k === 'gone' ? 0 : 20, k !== 'off');
  await order(['iron', 'wire', 'flux']);
  await order(['iron', 'wire', 'once', 'gone', 'off']);
  await order(['iron', 'wire', 'flux', 'gone', 'off'], 'pending', ['gift']);
  await order(['iron', 'gift'], 'confirmed', ['gift']);
  await order(['iron', 'once'], 'cancelled');
  await order(['iron', 'once'], 'returned');
  await db.q("INSERT INTO product_links(product_id, linked_id, kind, sort) VALUES($1, $2, 'cross', 0)", [ids.lonely, ids.pick]);
});
after(() => { closeConnection(); });

test('most often bought together first; one order, cancelled/returned orders, gifts, out of stock and switched-off products left out', { skip }, async () => {
  const got = (await catalog.boughtTogether(ids.iron, 5)).map((p) => p.id);
  assert.deepEqual(got, [ids.wire, ids.flux]);
});

test('only as many as asked for', { skip }, async () => {
  assert.deepEqual((await catalog.boughtTogether(ids.iron, 1)).map((p) => p.id), [ids.wire]);
});

test('no orders yet: the owner\'s "এর সাথে যা লাগবে" picks fill in; nothing at all → empty', { skip }, async () => {
  assert.deepEqual((await catalog.boughtTogether(ids.lonely, 2)).map((p) => p.id), [ids.pick]);
  assert.deepEqual(await catalog.boughtTogether(ids.pick, 2), []);
});

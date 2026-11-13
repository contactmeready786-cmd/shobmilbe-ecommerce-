// ⏳ Pre-order debt survives new stock (found in the 2026-11-13 audit): with 5 pieces owed (stock −5), a purchase of 3
// must leave −2 — it used to jump to 0, forgetting 2 owed pieces, which were then sold a second time.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as catalog from '../lib/models/catalog';

after(() => closeConnection());

test('adding stock pays owed pre-order pieces first; taking stops at 0', { skip }, async () => {
  await db.ensureReady();
  const id = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, cost_price, stock, active) VALUES('প্রি-অর্ডার পণ্য', $1, 100, 60, -5, true) RETURNING id", [`pre-${Date.now()}`]))!.id;
  const stock = async () => (await db.one<{ stock: number }>('SELECT stock FROM products WHERE id=$1', [id]))!.stock;
  await db.tx((t) => catalog.moveStock(t, id, 3, 'purchase'));
  assert.equal(await stock(), -2);
  await db.tx((t) => catalog.moveStock(t, id, -1, 'adjust'));
  assert.equal(await stock(), -2, 'a loose take never deepens the debt');
  await db.tx((t) => catalog.moveStock(t, id, 6, 'purchase'));
  assert.equal(await stock(), 4);
  await db.tx((t) => catalog.moveStock(t, id, -9, 'adjust'));
  assert.equal(await stock(), 0);
  assert.equal(await db.tx((t) => catalog.moveStock(t, id, -1, 'order', '', null, '', null, true)), null, 'an order needs the piece');
});

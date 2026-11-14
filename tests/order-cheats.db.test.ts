// 🛡️ অফারে চালাকি বন্ধ (owner, 2026-11-15) — on a real throw-away Postgres:
//   • the same product sent twice in one order (or as a forged "gift" line) can't get past its piece limit
//   • a flash sale's "one per customer" holds across separate orders from the same mobile number
//   • the last piece in stock goes to the first order only, even when two orders arrive at the same moment
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as O from '../lib/models/orders';

let base: Record<string, string> = {};
const S = (over: Record<string, string> = {}) => ({
  ...base, min_order: '0', delivery_dhaka: '60', delivery_outside: '110', free_delivery_min: '0', loyalty_on: '0',
  max_qty_per_item: '1', small_qty_on: '0', ...over,
}) as never;
let seq = 0;
async function product(price: number, stock: number): Promise<number> {
  const r = await db.one<{ id: number }>('INSERT INTO products(name, slug, price, stock, active) VALUES($1,$2,$3,$4,true) RETURNING id',
    [`চালাকি টেস্ট ${++seq}`, `cheat-${Date.now()}-${seq}`, price, stock]);
  return r!.id;
}
const order = (items: Record<string, unknown>[], phone = '01710000101') => O.createOrder({
  items: items as never, name: 'টেস্ট কাস্টমার', phone, address: 'বাসা ১, রোড ২', district: 'Dhaka', thana: 'Banani', payment: 'cod', source: 'web', ip: '10.8.8.8',
}, S());
const refused = async (p: Promise<unknown>, re: RegExp) => { await assert.rejects(p, (e: Error) => re.test(e.message)); };

before(async () => {
  if (skip) return;
  await db.ensureReady();
  base = (await db.getSettings()) as never;
});
after(() => closeConnection());

test('the same product twice in one order (or as a "gift" line from the browser) still counts as one product', { skip }, async () => {
  const id = await product(500, 20);
  await refused(order([{ id, qty: 1 }, { id, qty: 1 }]), /সর্বোচ্চ/);
  await refused(order([{ id, qty: 1 }, { id, qty: 1, kind: 'gift', price: 0 }]), /সর্বোচ্চ/);
  const ok = await order([{ id, qty: 1 }]);
  const lines = await db.q<{ qty: number; price: number; kind: string }>('SELECT qty, price, kind FROM order_items WHERE order_id=$1', [ok.id]);
  assert.deepEqual(lines.map((l) => [l.qty, Number(l.price)]), [[1, 500]]);
});

test('a flash sale with "1 per customer": a second order from the same number is refused, another number may buy', { skip }, async () => {
  const id = await product(1500, 20);
  const sale = await db.one<{ id: number }>("INSERT INTO flash_sales(title, starts_at, ends_at, show_home, per_phone) VALUES('১১.১১', now() - interval '1 hour', now() + interval '1 day', true, 1) RETURNING id");
  await db.q('INSERT INTO flash_items(sale_id, product_id, price, max_qty) VALUES($1,$2,11,0)', [sale!.id, id]);
  const first = await order([{ id, qty: 1 }], '01710000202');
  assert.equal(Number(first.total), 11 + 60);
  await refused(order([{ id, qty: 1 }], '01710000202'), /একজন সর্বোচ্চ/);
  const other = await order([{ id, qty: 1 }], '01710000203');
  assert.equal(Number(other.total), 11 + 60);
});

test('two orders for the last piece at the same moment: exactly one gets it, stock never below zero', { skip }, async () => {
  const id = await product(300, 1);
  const results = await Promise.allSettled([order([{ id, qty: 1 }], '01710000301'), order([{ id, qty: 1 }], '01710000302')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(Number((await db.one<{ stock: number }>('SELECT stock FROM products WHERE id=$1', [id]))!.stock), 0);
});

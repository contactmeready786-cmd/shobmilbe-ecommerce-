// 🛒 Placing an order, end to end, on a real (throw-away) Postgres database: prices, the ৳10 minimum, delivery,
// rounding, stock. GitHub runs it on every change (.github/workflows/tests.yml); never on the shop's real database.
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
  ...base, min_order: '10', delivery_dhaka: '60', delivery_outside: '110', free_delivery_min: '0', loyalty_on: '0',
  max_qty_per_item: '10', small_qty_on: '1', small_max_price: '5', small_max_value: '100', ...over,
}) as never;
let seq = 0;
async function product(price: number, stock: number, extra: Record<string, unknown> = {}): Promise<number> {
  const slug = `test-${Date.now()}-${++seq}`;
  const r = await db.one('INSERT INTO products(name, slug, price, stock, active) VALUES($1,$2,$3,$4,true) RETURNING id', [`টেস্ট পণ্য ${seq}`, slug, price, stock]);
  for (const [k, v] of Object.entries(extra)) await db.q(`UPDATE products SET ${k}=$1 WHERE id=$2`, [v, r!.id]);
  return r!.id;
}
const stockOf = async (id: number) => Number((await db.one('SELECT stock FROM products WHERE id=$1', [id]))!.stock);
const order = (items: { id: number; qty: number; price?: number }[], over: Record<string, unknown> = {}) => O.createOrder({
  items, name: 'টেস্ট কাস্টমার', phone: '01710000001', address: 'বাসা ১, রোড ২', district: 'Dhaka', thana: 'Banani', payment: 'cod', source: 'web', ip: '10.9.9.9', ...over,
}, S());

before(async () => {
  if (skip) return;
  await db.ensureReady();
  base = (await db.getSettings()) as never;
});
after(() => closeConnection());

test('Dhaka city order: goods + ৳60, stock goes down, order saved with its lines', { skip }, async () => {
  const id = await product(250, 5);
  const r = await order([{ id, qty: 2 }]);
  assert.equal(r.total, 560);
  assert.equal(await stockOf(id), 3);
  const o = await db.one('SELECT subtotal, delivery, total, status, payment_status FROM orders WHERE id=$1', [r.id]);
  assert.deepEqual({ subtotal: Number(o!.subtotal), delivery: Number(o!.delivery), total: Number(o!.total) }, { subtotal: 500, delivery: 60, total: 560 });
  assert.equal(o!.status, 'pending');
  assert.equal(o!.payment_status, 'unpaid');
  const lines = await db.q('SELECT qty, price FROM order_items WHERE order_id=$1', [r.id]);
  assert.equal(lines.length, 1);
  assert.equal(Number(lines[0].qty), 2);
  assert.equal(Number(lines[0].price), 250);
  // the stock change is written down (for the stock history)
  assert.ok(await db.one("SELECT 1 FROM stock_movements WHERE product_id=$1 AND reason='order' AND ref_id=$2", [id, r.id]));
});

test('outside Dhaka city: ৳110', { skip }, async () => {
  const id = await product(100, 5);
  assert.equal((await order([{ id, qty: 1 }], { district: 'Barisal', thana: 'Sadar' })).total, 210);
  assert.equal((await order([{ id, qty: 1 }], { district: 'Dhaka', thana: 'Savar' })).total, 210);
});

test('the ৳10 minimum is on the whole cart, delivery not counted', { skip }, async () => {
  const cheap = await product(0.5, 1000);
  const other = await product(2.75, 100);
  await assert.rejects(order([{ id: cheap, qty: 19 }]), /কমপক্ষে/); // ৳9.50
  // ৳0.50 × 15 + ৳2.75 × 1 = ৳10.25 → allowed; total = 10.25 + 60 → paisa dropped → ৳70
  const r = await order([{ id: cheap, qty: 15 }, { id: other, qty: 1 }]);
  assert.equal(r.total, 70);
  const o = await db.one('SELECT subtotal FROM orders WHERE id=$1', [r.id]);
  assert.equal(Number(o!.subtotal), 10.25);
});

test('not enough stock: refused, and nothing is taken', { skip }, async () => {
  const id = await product(100, 2);
  await assert.rejects(order([{ id, qty: 3 }]), /স্টকে আছে মাত্র/);
  assert.equal(await stockOf(id), 2);
  const none = await product(100, 0);
  await assert.rejects(order([{ id: none, qty: 1 }]), /স্টকে নেই/);
});

test('one bad line stops the whole order (no half orders, no lost stock)', { skip }, async () => {
  const good = await product(100, 5);
  const bad = await product(100, 0);
  // (only this file's orders are counted: other test files place orders on the same database at the same time)
  const mine = async () => Number((await db.one("SELECT count(*)::int AS n FROM orders WHERE phone='01710000001'"))!.n);
  const before = await mine();
  await assert.rejects(order([{ id: good, qty: 1 }, { id: bad, qty: 1 }]));
  assert.equal(await stockOf(good), 5);
  assert.equal(await mine(), before);
});

test('hidden products and empty carts are refused', { skip }, async () => {
  const hidden = await product(100, 5, { active: false });
  await assert.rejects(order([{ id: hidden, qty: 1 }]), /পাওয়া যাচ্ছে না/);
  await assert.rejects(order([]), /কার্ট খালি/);
  await assert.rejects(order([{ id: 999999999, qty: 1 }]), /পাওয়া যাচ্ছে না/);
});

test('a web customer can not set their own price', { skip }, async () => {
  const id = await product(300, 5);
  const r = await order([{ id, qty: 1, price: 1 }]);
  assert.equal(r.total, 360);
});

test('per-product maximum for online orders', { skip }, async () => {
  const id = await product(100, 50);
  await assert.rejects(order([{ id, qty: 11 }]), /সর্বোচ্চ/);
  const cheap = await product(0.5, 500);
  assert.ok((await order([{ id: cheap, qty: 200 }])).total > 0); // ৳100 worth of a ৳0.50 part is fine
});

test('the same product twice in the cart is one line', { skip }, async () => {
  const id = await product(40, 10);
  const r = await order([{ id, qty: 1 }, { id, qty: 2 }]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 3);
  assert.equal(r.total, 180);
});

test('a deadlock with another order is tried again, other errors are not', { skip }, async () => {
  let n = 0;
  const r = await db.txRetry(async (t) => {
    n++;
    await t.query('SELECT 1');
    if (n === 1) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    return 'done';
  });
  assert.equal(r, 'done');
  assert.equal(n, 2);
  let m = 0;
  await assert.rejects(db.txRetry(async () => { m++; throw Object.assign(new Error('other'), { code: '23505' }); }), /other/);
  assert.equal(m, 1);
});

test('an error thrown on purpose inside a transaction is not run a second time', { skip }, async () => {
  let n = 0;
  await assert.rejects(db.tx(async (t) => { n++; await t.query('SELECT 1'); throw new Error('এখন স্টকে নেই'); }), /স্টকে নেই/);
  assert.equal(n, 1);
});

test('a status change sends the customer\'s SMS wherever it is made (no other file needs to be loaded first)', { skip }, async () => {
  const sms = await import('../lib/services/sms');
  const sent: string[] = [];
  sms.setFakeSender(async (phone, text) => { sent.push(`${phone}: ${text}`); return { ok: true, msg: 'ok' }; });
  for (const [k, v] of Object.entries({ sms_on: '1', sms_provider: 'custom', sms_custom_url: 'https://sms.test/send', sms_on_confirmed: '1' })) await db.setSetting(k, v);
  try {
    const id = await product(120, 5);
    const r = await O.createOrder({ items: [{ id, qty: 1 }], name: 'এসএমএস টেস্ট', phone: '01710000088', address: 'বাসা ৯, রোড ১', district: 'Dhaka', thana: 'Banani', payment: 'cod', source: 'web', ip: '10.9.9.8' }, S());
    // (as on the site: a change runs with fresh reads, lib/cache.ts)
    const cache = await import('../lib/cache');
    await cache.runFresh(() => O.setStatus(r.id, 'confirmed', null));
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((res) => setTimeout(res, 100));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^01710000088: .*কনফার্ম/);
  } finally {
    await db.setSetting('sms_on', '0');
    sms.setFakeSender(null);
  }
});

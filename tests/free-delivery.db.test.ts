// 🚚 Free delivery (owner, 2026-10-22): "৳… বা বেশি কিনলে ডেলিভারি ফ্রি" counts every product EXCEPT those in a category
// switched to "no free delivery" (packaging materials) — also when they are mixed with other products.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import { loadRenderer } from '../lib/react/render';
import { apiRoute } from '../lib/next/api';
import { placeOrder } from '../lib/api/checkout';
import * as sms from '../lib/services/sms';
import * as guard from '../lib/services/guard';

const POST = apiRoute(placeOrder);
let n = 0;
const order = async (items: unknown[]) => {
  n += 1;
  const r = await POST(new Request('http://shop.test/api/orders', {
    method: 'POST',
    body: JSON.stringify({ items, name: 'রাফি হাসান', phone: `0171${String(3000000 + n).slice(-7)}`, district: 'Dhaka', thana: 'Banani', address: 'বাসা ৩, রোড ৫, বনানী', consent: '1', payment: 'cod' }),
    headers: { 'content-type': 'application/json', 'x-real-ip': `10.55.0.${n}`, origin: 'http://shop.test', host: 'shop.test' },
  }));
  assert.equal(r.status, 200);
  const { code } = (await r.json()) as { code: string };
  return (await db.one<{ delivery: number; subtotal: number }>('SELECT delivery, subtotal FROM orders WHERE code=$1', [code]))!;
};
let pack = 0; let normal = 0;

before(async () => {
  if (skip) return;
  sms.setFakeSender(async () => ({ ok: true, msg: 'test' }));
  await loadRenderer();
  await db.ensureReady();
  await db.setMany({ min_order: '10', co_otp_on: '0', free_delivery_min: '500', delivery_outside: '110', delivery_dhaka: '60' });
  const top = (await db.one<{ id: number }>("INSERT INTO categories(name, slug, no_free_delivery) VALUES('প্যাকেজিং ম্যাটেরিয়ালস টেস্ট', $1, true) RETURNING id", [`pk-${Date.now()}`]))!.id;
  const sub = (await db.one<{ id: number }>("INSERT INTO categories(name, slug, parent_id) VALUES('বক্স টেস্ট', $1, $2) RETURNING id", [`bx-${Date.now()}`, top]))!.id;
  pack = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active, category_id) VALUES('বক্স', $1, 600, 50, true, $2) RETURNING id", [`box-${Date.now()}`, sub]))!.id;
  normal = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('সেন্সর', $1, 300, 50, true) RETURNING id", [`sen-${Date.now()}`]))!.id;
});
after(async () => { await guard.settled(); closeConnection(); });

test('packaging (a sub-category of a "no free delivery" category) never makes delivery free', { skip }, async () => {
  const o = await order([{ id: pack, qty: 1, price: 600 }]);
  assert.equal(Number(o.subtotal), 600);
  assert.ok(Number(o.delivery) > 0, '৳600 of boxes still pays delivery');
});

test('other products still get free delivery from the amount', { skip }, async () => {
  assert.equal(Number((await order([{ id: normal, qty: 2, price: 300 }])).delivery), 0);
  // mixed: ৳300 of other products + ৳600 of boxes → only ৳300 counts → delivery is paid
  assert.ok(Number((await order([{ id: normal, qty: 1, price: 300 }, { id: pack, qty: 1, price: 600 }])).delivery) > 0);
});

// 🛒 POST /api/orders as the browser sends it (the Next.js route: lib/api/checkout.ts behind lib/next/api.ts's gate), on a
// real throw-away Postgres: wrong details are refused field by field, a good order is saved with the server's own
// prices, the browser gets its "my orders" cookie, and too many orders from one connection are turned away.
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
let ipSeq = 0;
const send = (body: Record<string, unknown>, ip = `10.77.0.${++ipSeq}`) => POST(new Request('http://shop.test/api/orders', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', 'x-real-ip': ip, origin: 'http://shop.test', host: 'shop.test' },
}));
let pid = 0;
const good = (over: Record<string, unknown> = {}) => ({ items: [{ id: pid, qty: 2, price: 1 }], name: 'রাফি হাসান', phone: '01710000077', district: 'Dhaka', thana: 'Banani',
  address: 'বাসা ৩, রোড ৫, বনানী', consent: '1', payment: 'cod', ...over });

before(async () => {
  if (skip) return;
  sms.setFakeSender(async () => ({ ok: true, msg: 'test' }));
  await loadRenderer();
  await db.ensureReady();
  await db.setSetting('min_order', '10');
  await db.setSetting('co_otp_on', '0');
  const r = await db.one("INSERT INTO products(name, slug, price, stock, active) VALUES('API টেস্ট পণ্য', $1, 300, 50, true) RETURNING id", [`api-test-${Date.now()}`]);
  pid = r!.id;
});
// the shop records some things in the background (the security log after a refused order): let them finish first
after(async () => { await guard.settled(); closeConnection(); });

test('wrong details are refused, each with the field to fix', { skip }, async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ name: 'র' }, 'name'], [{ phone: '123' }, 'phone'], [{ district: 'Nowhere' }, 'district'], [{ thana: 'Nowhere' }, 'thana'],
    [{ address: 'x' }, 'address'], [{ consent: '' }, 'consent'],
  ];
  for (const [over, field] of cases) {
    const r = await send(good(over));
    assert.equal(r.status, 400, field);
    assert.equal((await r.json()).field, field);
  }
});

test('a good order: saved with the shop\'s own price (not the browser\'s), stock down, "my orders" cookie set', { skip }, async () => {
  const r = await send(good());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.code, /^[A-Z0-9]+$/);
  assert.equal(j.redirect, `/order/${j.code}?new=1`);
  assert.match(r.headers.get('set-cookie') || '', /^sm_orders=.+HttpOnly/);
  const o = await db.one('SELECT subtotal, phone FROM orders WHERE code=$1', [j.code]);
  assert.equal(Number(o!.subtotal), 600); // 2 × ৳300, whatever price the browser claimed
  assert.equal(o!.phone, '01710000077');
  assert.equal(Number((await db.one('SELECT stock FROM products WHERE id=$1', [pid]))!.stock), 48);
});

test('at most 10 orders an hour from one connection', { skip }, async () => {
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await send(good({ phone: '0171000' + String(1000 + i) }), '10.88.8.8')).status;
  assert.equal(last, 429);
});

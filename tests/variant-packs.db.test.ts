// 📦🎨 A product with variants sold in packs (owner, 2026-10-22): e.g. a poly in সাদা / সিলভার × Small / Large, every
// variant in 25 / 50 / 100 pieces at its own price per piece. The main product's packs reach every variant, the
// "make all combinations" labels are right, and an order for a variant is taken only in whole packs at that variant's price.
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
import { cart } from '../lib/api/shop-read';
import * as catalog from '../lib/models/catalog';
import * as sms from '../lib/services/sms';
import * as guard from '../lib/services/guard';

const POST = apiRoute(placeOrder);
let ipSeq = 0;
const send = (items: unknown[]) => POST(new Request('http://shop.test/api/orders', {
  method: 'POST',
  body: JSON.stringify({ items, name: 'রাফি হাসান', phone: `0171${String(2000000 + ++ipSeq).slice(-7)}`, district: 'Dhaka', thana: 'Banani', address: 'বাসা ৩, রোড ৫, বনানী', consent: '1', payment: 'cod' }),
  headers: { 'content-type': 'application/json', 'x-real-ip': `10.66.0.${ipSeq}`, origin: 'http://shop.test', host: 'shop.test' },
}));

let parent = 0;
const kids: Record<string, { id: number; price: number; pack_sizes: string }> = {};

before(async () => {
  if (skip) return;
  sms.setFakeSender(async () => ({ ok: true, msg: 'test' }));
  await loadRenderer();
  await db.ensureReady();
  await db.setSetting('min_order', '10');
  await db.setSetting('co_otp_on', '0');
  parent = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active, pack_sizes) VALUES('দারাজ পলি', $1, 2, 0, true, '25,50,100') RETURNING id", [`poly-${Date.now()}`]))!.id;
  await catalog.saveVariants(parent, { title: 'রং / সাইজ', rows: [
    { label: 'সাদা / Small', price: 2, active: true },
    { label: 'সিলভার / Large', price: 3, active: true },
  ] });
  for (const r of await db.q<{ id: number; variant_label: string; price: number; pack_sizes: string }>('SELECT id, variant_label, price, pack_sizes FROM products WHERE parent_id=$1', [parent])) {
    kids[r.variant_label] = { id: r.id, price: Number(r.price), pack_sizes: r.pack_sizes };
  }
  await db.q('UPDATE products SET stock = 500 WHERE parent_id=$1', [parent]);
});
after(async () => { await guard.settled(); closeConnection(); });

test('every variant gets the main product\'s packs, each keeps its own price', { skip }, async () => {
  assert.equal(kids['সাদা / Small'].pack_sizes, '25,50,100');
  assert.equal(kids['সিলভার / Large'].pack_sizes, '25,50,100');
  assert.equal(kids['সিলভার / Large'].price, 3);
  // the owner changes the packs on the main product → the variants follow
  await db.q("UPDATE products SET pack_sizes='50,100' WHERE id=$1", [parent]);
  await db.tx((t) => catalog.syncVariants(t, parent));
  const now = await db.q<{ pack_sizes: string }>('SELECT pack_sizes FROM products WHERE parent_id=$1', [parent]);
  assert.ok(now.length === 2 && now.every((r) => r.pack_sizes === '50,100'));
  await db.q("UPDATE products SET pack_sizes='25,50,100' WHERE id=$1", [parent]);
  await db.tx((t) => catalog.syncVariants(t, parent));
});

test('a variant is ordered only in whole packs, at that variant\'s price', { skip }, async () => {
  const large = kids['সিলভার / Large'];
  const bad = await send([{ id: large.id, qty: 30, price: 3 }]);
  assert.notEqual(bad.status, 200, '30 pieces is not a whole pack of 25');
  const ok = await send([{ id: large.id, qty: 50, price: 1 }]);
  assert.equal(ok.status, 200);
  const j = (await ok.json()) as { code: string };
  const o = await db.one<{ subtotal: number }>('SELECT subtotal FROM orders WHERE code=$1', [j.code]);
  assert.equal(Number(o!.subtotal), 150); // 50 × ৳3 (the variant's own price, not the browser's)
});

test('the cart knows a line\'s other colours/sizes (to switch them in the cart and at checkout)', { skip }, async () => {
  const GET = apiRoute(cart);
  const small = kids['সাদা / Small'];
  const r = await GET(new Request(`http://shop.test/api/cart?ids=${small.id}`, { headers: { 'x-real-ip': '10.66.9.9', host: 'shop.test' } }));
  assert.equal(r.status, 200);
  const j = (await r.json()) as { products: { id: number; vtitle?: string; variants?: { id: number; label: string; price: number }[]; packs?: number[] }[] };
  const line = j.products.find((p) => p.id === small.id)!;
  assert.equal(line.vtitle, 'রং / সাইজ');
  assert.deepEqual(line.variants!.map((v) => v.label).sort(), ['সাদা / Small', 'সিলভার / Large'].sort());
  assert.deepEqual(line.packs, [25, 50, 100]);
});

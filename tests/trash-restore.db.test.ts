// 🗑️ Recycle bin restore (owner, 2026-11-14): a product deleted before a newer column was added to the table comes back
// (missing columns take their defaults), a SKU number taken meanwhile is replaced by the next free one, and a product
// that was added again after deletion is named instead of failing with an error page.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as T from '../lib/models/trash';

const stamp = Date.now();
const newProduct = async (slug: string, sku: string) =>
  (await db.one<{ id: number }>("INSERT INTO products(name, slug, sku, price, stock, active) VALUES($1, $2, $3, 50, 5, true) RETURNING id", [`পরীক্ষা ${slug}`, slug, sku]))!.id;
const binOf = async (refId: number) => (await db.one<{ id: number }>("SELECT id FROM trash WHERE kind='product' AND ref_id=$1", [refId]))!.id;

before(async () => { if (!skip) await db.ensureReady(); });
after(() => closeConnection());

test('an old deleted product (saved before newer columns existed) comes back with their defaults', { skip }, async () => {
  const id = await newProduct(`old-${stamp}`, `T${stamp}a`);
  await T.move('product', id, { name: 'test' });
  const bin = await binOf(id);
  // pretend it was deleted long ago: its saved row has only a few of today's columns
  const e = await T.get(bin);
  const r = e!.data.row as Record<string, unknown>;
  const old = { id: r.id, name: r.name, slug: r.slug, sku: r.sku, price: r.price, stock: r.stock, active: r.active };
  await db.q("UPDATE trash SET data = jsonb_set(data, '{row}', $1::jsonb) WHERE id=$2", [JSON.stringify(old), bin]);
  const res = await T.restore(bin);
  assert.ok(res.ok, JSON.stringify(res));
  const back = await db.one<{ name: string; price: number }>('SELECT name, price FROM products WHERE id=$1', [id]);
  assert.equal(back!.price, 50);
});

test('a SKU number taken meanwhile: the product comes back with a new number, never a duplicate', { skip }, async () => {
  const sku = `T${stamp}b`;
  const id = await newProduct(`sku-${stamp}`, sku);
  await T.move('product', id, { name: 'test' });
  await newProduct(`sku2-${stamp}`, sku); // a new product got the same number
  const res = await T.restore(await binOf(id));
  assert.ok(res.ok, JSON.stringify(res));
  const n = await db.one<{ n: number }>('SELECT count(*)::int AS n FROM products WHERE lower(sku)=lower($1)', [sku]);
  assert.equal(n!.n, 1);
});

test('the same product added again after deletion: a clear message naming it, no error page', { skip }, async () => {
  const slug = `same-${stamp}`;
  const id = await newProduct(slug, `T${stamp}c`);
  await T.move('product', id, { name: 'test' });
  await newProduct(slug, `T${stamp}d`);
  const res = await T.restore(await binOf(id));
  assert.ok(!res.ok && 'error' in res && /দোকানে এখন আছে/.test(String(res.error)), JSON.stringify(res));
});

// ⬜ White background (owner, 2026-10-24): keeping a white copy puts it in the original's place (same spot, cover
// picture too), the original is set aside and never lost, "আসল ছবি ফেরত" puts it back exactly, and a product form
// opened before the swap brings the original back instead of losing the picture.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as W from '../lib/models/whiten';
import * as catalog from '../lib/models/catalog';

// a tiny real JPEG header is enough here: the model does not look inside
const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`white-${n}-${Date.now()}`), Buffer.from([0xff, 0xd9])]);
let product = 0, cover = 0, second = 0;
const pics = async () => (await db.q<{ id: number; wb_from: number | null }>(`SELECT id, wb_from FROM media WHERE owner_type='product' AND owner_id=$1 ORDER BY sort, id`, [product]));
const coverOf = async () => (await db.one<{ image_id: number }>('SELECT image_id FROM products WHERE id=$1', [product]))!.image_id;

before(async () => {
  if (skip) return;
  await db.ensureReady();
  product = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('ElectroX ট্রিমার', $1, 1450, 5, false) RETURNING id", [`wt-${Date.now()}`]))!.id;
  cover = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(1) });
  second = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(2) });
  await db.tx((t) => catalog.attachMedia(t, [cover, second], 'product', product));
  await db.q('UPDATE products SET image_id=$1 WHERE id=$2', [cover, product]);
});
after(() => closeConnection());

test('keep: the white copy takes the original\'s place, the original is set aside', { skip }, async () => {
  const w = await W.keep(cover, JPEG(3), { width: 800, height: 800 });
  assert.notEqual(w, cover);
  assert.deepEqual(await pics(), [{ id: w, wb_from: cover }, { id: second, wb_from: null }]);
  assert.equal(await coverOf(), w);
  const o = await db.one<{ owner_type: string; owner_id: number }>('SELECT owner_type, owner_id FROM media WHERE id=$1', [cover]);
  assert.deepEqual(o, { owner_type: 'wb_orig', owner_id: product });
  assert.deepEqual(await W.progress([product]), { pics: 2, white: 1 });

  // made white again: the new copy replaces the first white one and still points to the real original
  const w2 = await W.keep(w, JPEG(4));
  assert.deepEqual(await pics(), [{ id: w2, wb_from: cover }, { id: second, wb_from: null }]);
  assert.equal(await coverOf(), w2);
  assert.equal(await db.one('SELECT id FROM media WHERE id=$1', [w]), null);

  // undo: the original is back in the same place, the white copy is gone
  assert.equal(await W.undo(w2), cover);
  assert.deepEqual(await pics(), [{ id: cover, wb_from: null }, { id: second, wb_from: null }]);
  assert.equal(await coverOf(), cover);
  assert.equal(await db.one('SELECT id FROM media WHERE id=$1', [w2]), null);
  await assert.rejects(() => W.undo(cover), W.WhitenError);
});

test('only product pictures, and a stale product form brings the original back', { skip }, async () => {
  const loose = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(5) });
  await assert.rejects(() => W.keep(loose, JPEG(6)), W.WhitenError);
  const w = await W.keep(second, JPEG(7));
  // the product form was opened before: it still lists [cover, second]
  await db.tx((t) => catalog.attachMedia(t, [cover, second], 'product', product));
  assert.deepEqual((await pics()).map((p) => p.id), [cover, second]);
  assert.equal(await db.one('SELECT id FROM media WHERE id=$1', [w]), null);
});

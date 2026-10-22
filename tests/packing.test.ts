// 📦 Packing costs (owner, 2026-10-23): one use of a thing = its price ÷ the parcels it does; a set costs its things.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitCost, setCost } from '../lib/models/packing';

test('packing: cost per use', () => {
  assert.equal(unitCost({ buy_price: 12.5, uses: 1 }), 12.5); // ৩ নং বক্স
  assert.equal(unitCost({ buy_price: 55, uses: 25 }), 2.2); // a ৳55 tape roll does 25 boxes
  assert.equal(unitCost({ buy_price: 100, uses: 0 }), 100); // never divided by 0
});

test('packing: a set costs its things', () => {
  const items = new Map([[1, { buy_price: 12.5, uses: 1 }], [2, { buy_price: 55, uses: 25 }], [3, { buy_price: 1, uses: 1 }]]);
  assert.equal(setCost({ items: [{ item_id: 1, qty: 1 }, { item_id: 2, qty: 1 }, { item_id: 3, qty: 1 }] }, items), 15.7);
  assert.equal(setCost({ items: [{ item_id: 2, qty: 2 }, { item_id: 9, qty: 1 }] }, items), 4.4); // a thing no longer there: left out
  assert.equal(setCost(null, items), 0);
});

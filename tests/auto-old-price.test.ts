// 🏷️ The shop's own crossed-out "regular" price (lib/models/catalog.ts autoOldPrice, owner 2026-11-15): always above the
// selling price, a believable discount (never ~90 % on a cheap part), whole taka from ৳10, ৳10 steps from ৳100.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoOldPrice } from '../lib/models/catalog';

test('the examples the owner gave and the cheap-part guard', () => {
  assert.equal(autoOldPrice(1450), 1820);
  assert.equal(autoOldPrice(400), 500);
  assert.equal(autoOldPrice(60), 80);
  assert.equal(autoOldPrice(15), 23);
  assert.equal(autoOldPrice(1), 1.5);
  assert.equal(autoOldPrice(0.5), 0.75);
  assert.equal(autoOldPrice(8), 12);
});

test('always above the price, at most a 35 % discount, whole taka from ৳10', () => {
  for (const p of [0.5, 0.75, 1, 2.5, 5, 6.66, 9.99, 10, 12, 39, 40, 99, 100, 101, 555, 999, 1000, 2000]) {
    const o = autoOldPrice(p);
    assert.ok(o > p, `${p} → ${o}`);
    assert.ok((o - p) / o <= 0.35, `${p} → ${o} is too big a discount`);
    if (o >= 10) assert.equal(o, Math.round(o), `${p} → ${o}`);
  }
});

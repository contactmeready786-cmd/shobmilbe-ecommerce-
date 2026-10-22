// ✏️ Correcting a purchase (owner, 2026-10-22): the buying price is worked out again with the corrected price, and the
// edit history says in plain words what changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctedCost } from '../lib/models/finance';
import { editChanges } from '../lib/admin/inventory';

test('purchase edit: buying price follows the corrected price', () => {
  // only this purchase in stock: 100 at ৳5 → corrected to 100 at ৳4
  assert.equal(correctedCost(100, 5, { qty: 100, value: 500 }, { qty: 100, value: 400 }), 4);
  // 50 older pieces at ৳10 + this purchase 100 at ৳5 (avg ৳6.67) → corrected to ৳4: (500 + 400) / 150 = ৳6
  assert.equal(correctedCost(150, 6.67, { qty: 100, value: 500 }, { qty: 100, value: 400 }), 6);
  // quantity corrected 100 → 80 at the same price
  assert.equal(correctedCost(100, 5, { qty: 100, value: 500 }, { qty: 80, value: 400 }), 5);
  // part of the purchase already sold (stock 30 < 100): the corrected price is used
  assert.equal(correctedCost(30, 5, { qty: 100, value: 500 }, { qty: 100, value: 450 }), 4.5);
  // the product taken out of the purchase, older stock left
  assert.equal(correctedCost(150, 6, { qty: 100, value: 500 }, { qty: 0, value: 0 }), 8);
});

test('purchase edit: history in plain words', () => {
  const before = { supplier_id: 1, purchase_date: '2026-10-20', shipping: 0, total: 500, items: [{ product_id: 7, name: 'LM7805', qty: 100, unit_cost: 5 }, { product_id: 8, name: 'পলি', qty: 10, unit_cost: 2 }] };
  const after = { supplier_id: 2, purchase_date: '2026-10-20', shipping: 120, total: 520, items: [{ product_id: 7, name: 'LM7805', qty: 80, unit_cost: 5 }, { product_id: 9, name: 'বক্স', qty: 5, unit_cost: 4 }] };
  const c = editChanges('purchase', before, after, { suppliers: new Map([[1, 'করিম'], [2, 'রহিম']]) });
  assert.ok(c.includes('সাপ্লায়ার করিম → রহিম'), c.join(' | '));
  assert.ok(c.some((x) => x.startsWith('LM7805: ১০০ → ৮০')), c.join(' | '));
  assert.ok(c.some((x) => x.startsWith('বাদ: পলি')), c.join(' | '));
  assert.ok(c.some((x) => x.startsWith('যোগ: বক্স')), c.join(' | '));
  assert.ok(c.some((x) => x.startsWith('ভাড়া')), c.join(' | '));
  assert.deepEqual(editChanges('payment', { amount: 500, tx_date: '2026-10-20', account_id: 1, note: '' }, { amount: 400, tx_date: '2026-10-20', account_id: 1, note: '' }).length, 1);
});

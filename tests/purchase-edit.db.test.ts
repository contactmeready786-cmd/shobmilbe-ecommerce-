// ✏️ A purchase corrected by the owner (2026-10-22): only the difference goes to the stock, the buying price follows
// the corrected price, pieces already sold can't be taken back (stock never below zero), the supplier's due follows,
// a corrected payment changes the due, and every change is kept.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as finance from '../lib/models/finance';

let pid = 0, sup = 0, sup2 = 0, purchase = 0;
const stock = async () => (await db.one<{ stock: number; cost_price: number }>('SELECT stock, cost_price FROM products WHERE id=$1', [pid]))!;
const due = async (id: number) => finance.supplierDue((await finance.getSupplier(id))!);

before(async () => {
  if (skip) return;
  await db.ensureReady();
  pid = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, cost_price, active) VALUES('LM7805', $1, 10, 0, 0, true) RETURNING id", [`lm-${Date.now()}`]))!.id;
  sup = await finance.saveSupplier({ name: 'করিম ট্রেডার্স', active: true });
  sup2 = await finance.saveSupplier({ name: 'রহিম ইলেকট্রনিক্স', active: true });
  purchase = await finance.savePurchase({ supplier_id: sup, status: 'received', items: [{ product_id: pid, qty: 100, unit_cost: 5 }], paid_now: 200 });
});
after(() => closeConnection());

test('a received purchase corrected: only the difference goes to the stock, the price follows', { skip }, async () => {
  assert.deepEqual([(await stock()).stock, Number((await stock()).cost_price)], [100, 5]);
  assert.equal(await due(sup), 300);
  await finance.editPurchase(purchase, { supplier_id: sup, purchase_date: '2026-10-20', items: [{ product_id: pid, qty: 80, unit_cost: 4 }] }, null);
  const s = await stock();
  assert.equal(s.stock, 80);
  assert.equal(Number(s.cost_price), 4);
  assert.equal(await due(sup), 120); // 320 − 200 paid
  const mv = await db.one<{ change: number }>("SELECT change FROM stock_movements WHERE product_id=$1 AND reason='purchase_edit' ORDER BY id DESC LIMIT 1", [pid]);
  assert.equal(mv!.change, -20);
});

test('pieces already sold cannot be taken back — stock never goes below zero', { skip }, async () => {
  await db.q('UPDATE products SET stock=30 WHERE id=$1', [pid]); // 50 sold
  await assert.rejects(finance.editPurchase(purchase, { supplier_id: sup, items: [{ product_id: pid, qty: 40, unit_cost: 4 }] }, null), /কম করা যাবে না/);
  assert.equal((await stock()).stock, 30);
  await finance.editPurchase(purchase, { supplier_id: sup, items: [{ product_id: pid, qty: 60, unit_cost: 4 }] }, null);
  assert.equal((await stock()).stock, 10);
});

test('the supplier corrected: the purchase and its payment move to the right supplier', { skip }, async () => {
  await finance.editPurchase(purchase, { supplier_id: sup2, items: [{ product_id: pid, qty: 60, unit_cost: 4 }] }, null);
  assert.equal(await due(sup), 0);
  assert.equal(await due(sup2), 40); // 240 − 200
});

test('a payment corrected changes the due; every change is in the history', { skip }, async () => {
  const pay = await db.one<{ id: number }>('SELECT id FROM transactions WHERE purchase_id=$1', [purchase]);
  await finance.editSupplierPayment(pay!.id, { amount: 240, tx_date: '2026-10-21', note: 'ঠিক করা' }, null);
  assert.equal(await due(sup2), 0);
  const h = await finance.purchaseHistory(purchase);
  assert.ok(h.filter((x) => x.kind === 'purchase').length >= 3);
  assert.ok(h.some((x) => x.kind === 'payment'));
  assert.equal((await finance.supplierPaymentHistory(sup2)).length, 1);
});

test('a cancelled purchase cannot be corrected', { skip }, async () => {
  const p2 = await finance.savePurchase({ supplier_id: sup, status: 'ordered', items: [{ product_id: pid, qty: 5, unit_cost: 4 }] });
  await finance.setPurchaseStatus(p2, 'cancelled');
  await assert.rejects(finance.editPurchase(p2, { items: [{ product_id: pid, qty: 6, unit_cost: 4 }] }, null), /বাতিল/);
});

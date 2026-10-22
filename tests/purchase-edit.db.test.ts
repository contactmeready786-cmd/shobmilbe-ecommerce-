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

test('colours / sizes: bought one by one; an old main-product line can be split without touching the stock', { skip }, async () => {
  const parent = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('পলি', $1, 3, 0, true) RETURNING id", [`poly-${Date.now()}`]))!.id;
  // bought before it had colours
  const old = await finance.savePurchase({ supplier_id: sup, status: 'received', items: [{ product_id: parent, qty: 100, unit_cost: 2 }] });
  const catalog = await import('../lib/models/catalog');
  await catalog.saveVariants(parent, { title: 'রং', rows: [{ label: 'সাদা', price: 3, active: true }, { label: 'সিলভার', price: 3, active: true }] });
  const kids = await db.q<{ id: number }>('SELECT id FROM products WHERE parent_id=$1 ORDER BY id', [parent]);
  await db.q('UPDATE products SET stock=50 WHERE parent_id=$1', [parent]); // stock put on the colours by hand
  // a new purchase can't use the main product any more
  await assert.rejects(finance.savePurchase({ supplier_id: sup, items: [{ product_id: parent, qty: 5, unit_cost: 2 }] }), /রং\/সাইজ/);
  // the old purchase split into the colours, record only
  await finance.editPurchase(old, { supplier_id: sup, stock_too: '0', items: [{ product_id: kids[0].id, qty: 50, unit_cost: 2 }, { product_id: kids[1].id, qty: 50, unit_cost: 2 }] }, null);
  const st = await db.q<{ stock: number }>('SELECT stock FROM products WHERE parent_id=$1 ORDER BY id', [parent]);
  assert.deepEqual(st.map((r) => r.stock), [50, 50]);
  const items = await db.q<{ product_id: number }>('SELECT product_id FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [old]);
  assert.deepEqual(items.map((r) => r.product_id), [kids[0].id, kids[1].id]);
});

test('a trial purchase deleted: stock back out, its payment gone with it, due right; restored as cancelled', { skip }, async () => {
  const trash = await import('../lib/models/trash');
  const s0 = (await stock()).stock;
  const before = await due(sup);
  const p = await finance.savePurchase({ supplier_id: sup, status: 'received', items: [{ product_id: pid, qty: 7, unit_cost: 4 }], paid_now: 10 });
  assert.equal((await stock()).stock, s0 + 7);
  await finance.setPurchaseStatus(p, 'cancelled');
  const bin = await trash.move('purchase', p, { name: 'test' });
  assert.ok(bin);
  assert.equal((await stock()).stock, s0);
  assert.equal(await due(sup), before);
  assert.equal((await db.q('SELECT 1 FROM transactions WHERE purchase_id=$1', [p])).length, 0);
  const r = await trash.restore(bin!);
  assert.ok(!('error' in r && r.error), JSON.stringify(r));
  const back = await db.one<{ status: string }>('SELECT status FROM purchases WHERE id=$1', [p]);
  assert.equal(back!.status, 'cancelled');
  assert.equal((await db.q('SELECT 1 FROM purchase_items WHERE purchase_id=$1', [p])).length, 1);
});

// 🏷️ The shop's money rules (owner, Oct 2026) — the checks that run on every change, so a new feature can never
// quietly break them:
//   • products only from ৳0.50 to ৳2000;  • from ৳10 up a price is whole taka (paisa go UP: ৳10.04 → ৳11);
//   • below ৳10 paisa stay (৳0.25, ৳1.75);  • an order total drops its paisa as a rounding discount (never adds);
//   • delivery ৳60 in Dhaka city, ৳110 outside;  • the cheapest price wins (flash sale / buy-more price).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../lib/util';
import * as P from '../lib/services/pricing';
import * as O from '../lib/models/orders';

const S = { delivery_dhaka: '60', delivery_outside: '110', free_delivery_min: '0' } as never;

test('price range: only ৳0.50 – ৳2000', () => {
  assert.equal(U.priceProblem(0.5), null);
  assert.equal(U.priceProblem(1), null);
  assert.equal(U.priceProblem(2000), null);
  assert.match(String(U.priceProblem(0.49)), /কমপক্ষে/);
  assert.match(String(U.priceProblem(2000.01)), /২০০০/);
  assert.match(String(U.priceProblem(2500)), /২০০০/);
  assert.match(String(U.priceProblem(0)), /দাম দিন/);
  assert.match(String(U.priceProblem('abc')), /দাম দিন/);
  assert.match(String(U.priceProblem(-5)), /দাম দিন/);
});

test('shop price: paisa kept below ৳10, rounded UP to whole taka from ৳10', () => {
  assert.equal(U.shopPrice(0.25), 0.25);
  assert.equal(U.shopPrice(1.75), 1.75);
  assert.equal(U.shopPrice(9.99), 9.99);
  assert.equal(U.shopPrice(10), 10);
  assert.equal(U.shopPrice(10.04), 11);
  assert.equal(U.shopPrice(10.5), 11);
  assert.equal(U.shopPrice(199.01), 200);
  assert.equal(U.shopPrice(250), 250);
  assert.equal(U.shopPrice('৳'), 0);
  assert.equal(U.shopPrice(-3), 0);
  // floating point noise must never add a taka: 0.1 + 0.2 style sums
  assert.equal(U.shopPrice(12.000000001), 12);
});

test('order total: paisa are dropped (customer pays less), never added', () => {
  assert.equal(U.wholeTaka(123.5), 123);
  assert.equal(U.wholeTaka(123.99), 123);
  assert.equal(U.wholeTaka(124), 124);
  assert.equal(U.wholeTaka(0.75), 0);
  assert.equal(U.wholeTaka(-10), 0);
  assert.equal(U.wholeTaka('abc'), 0);
  // 3 × ৳0.10 + ... sums that are a hair under a whole number in floating point
  assert.equal(U.wholeTaka(0.1 + 0.2 + 69.7), 70);
  // the rounding line shown on the invoice
  assert.equal(U.roundOff({ total: 123, subtotal: 63.5, discount: 0, delivery: 60 }), -0.5);
  assert.equal(U.roundOff({ total: 170, subtotal: 60, discount: 0, delivery: 110 }), 0);
  assert.match(U.roundOffLabel(-0.5), /ছাড়/);
});

test('typed money amounts: Bangla digits, paisa kept, never negative', () => {
  assert.equal(U.amount('০.২৫'), 0.25);
  assert.equal(U.amount('12.345'), 12.35);
  assert.equal(U.amount('-5'), 0);
  assert.equal(U.amount('abc', 7), 7);
});

test('minimum order is on the whole cart (default ৳10)', () => {
  assert.equal(U.minOrder({ min_order: '10' } as never), 10);
  assert.equal(U.minOrder({} as never), 0);
  assert.equal(U.minOrder(null), 0);
});

test('how many pieces a customer may order', () => {
  const s = { max_qty_per_item: '10', small_qty_on: '1', small_max_price: '5', small_max_value: '100' } as never;
  assert.deepEqual(U.qtyRule(s, 50), { min: 1, max: 10, small: false, cheap: false });
  // a ৳0.50 part: up to ৳100 worth = 200 pieces, still from 1 piece
  assert.deepEqual(U.qtyRule(s, 0.5), { min: 1, max: 200, small: false, cheap: true });
  assert.equal(U.qtyRule(s, 5).max, 20);
  assert.equal(U.qtyRule({ ...(s as object), small_qty_on: '0' } as never, 0.5).max, 10);
});

test('cart line price: the cheapest of normal / flash sale / buy-more price', () => {
  const tiers = [{ min_qty: 10, price: 8 }, { min_qty: 5, price: 9 }] as never;
  assert.deepEqual(P.linePrice({ base: 10, qty: 1, tiers }), { price: 10, kind: '', note: '', ref_id: null });
  assert.equal(P.linePrice({ base: 10, qty: 5, tiers }).price, 9);
  assert.equal(P.linePrice({ base: 10, qty: 12, tiers }).price, 8);
  const flash = { item_id: 3, price: 7, left: 2, title: 'ঈদ সেল', ends_at: new Date() };
  assert.equal(P.linePrice({ base: 10, qty: 2, flash }).kind, 'flash');
  assert.equal(P.linePrice({ base: 10, qty: 2, flash }).price, 7);
  // not enough pieces left in the sale for the whole line → normal price
  assert.equal(P.linePrice({ base: 10, qty: 3, flash }).kind, '');
  // a "buy-more" price that isn't cheaper than normal is ignored
  assert.equal(P.tierPrice([{ min_qty: 2, price: 12 }] as never, 5, 10), null);
});

test('delivery: ৳60 Dhaka city, ৳110 everywhere else', () => {
  assert.equal(O.zoneFor(S, 'Dhaka', 'Banani'), 'dhaka');
  assert.equal(O.zoneFor(S, 'ঢাকা', 'Badda'), 'dhaka');
  assert.equal(O.zoneFor(S, 'Dhaka', 'Savar'), 'outside'); // Dhaka district but outside the city
  assert.equal(O.zoneFor(S, 'Bagerhat', 'Sadar'), 'outside');
  assert.equal(O.zoneFor(S, '', ''), 'outside');
  assert.equal(O.deliveryFee(S, 'dhaka', 100), 60);
  assert.equal(O.deliveryFee(S, 'outside', 100), 110);
  assert.equal(O.deliveryFor(S, { district: 'Dhaka', thana: 'Adabor', subtotal: 50 }).fee, 60);
  assert.equal(O.deliveryFor(S, { district: 'Barisal', thana: 'x', subtotal: 50 }).fee, 110);
  // free delivery above an amount, when the owner sets one
  const free = { ...(S as object), free_delivery_min: '1000' } as never;
  assert.equal(O.deliveryFee(free, 'outside', 1000), 0);
  assert.equal(O.deliveryFee(free, 'outside', 999), 110);
  // heavy parcels: extra per kg above the free kilos (off unless set)
  assert.equal(O.weightExtra(S, 5000), 0);
  assert.equal(O.weightExtra({ delivery_per_kg: '20', delivery_free_kg: '1' } as never, 2500), 40);
});

test('phone numbers: Bangla digits and +880 accepted, wrong numbers refused', () => {
  assert.equal(U.normalizePhone('+8801712345678'), '01712345678');
  assert.equal(U.normalizePhone('০১৭১২৩৪৫৬৭৮'), '01712345678');
  assert.equal(U.normalizePhone('017-1234-5678'), '01712345678');
  assert.equal(U.validPhone('01712345678'), true);
  assert.equal(U.validPhone('01212345678'), false); // no such operator
  assert.equal(U.validPhone('0171234567'), false);
});

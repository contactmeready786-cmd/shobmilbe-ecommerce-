// 🛡️ Order rules (services/orderrules.ts): the numbers the owner sets, with safe defaults and limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limits, evaluate } from '../lib/services/orderrules';
import type { Settings } from '../lib/types';

const S = (x: Record<string, string> = {}): Settings => ({ store_name: 'x', session_secret: 'y', ...x });

test('order rules: off by default, suggested numbers when switched on', () => {
  const L = limits(S());
  assert.equal(L.on, false);
  assert.equal(L.hold, true);
  assert.equal(L.phoneDay, 3);
  assert.equal(L.ipDay, 5);
  assert.equal(L.qtyMax, 0);
  assert.equal(L.minRate, 0);
});

test('order rules: owner numbers are kept, bad ones made safe', () => {
  const L = limits(S({ fr_rules_on: '1', fr_rules_hold: '0', fr_phone_day: '0', fr_ip_day: '-4', fr_qty_max: '250', fr_min_rate: '170' }));
  assert.equal(L.on, true);
  assert.equal(L.hold, false);
  assert.equal(L.phoneDay, 0);
  assert.equal(L.ipDay, 0);
  assert.equal(L.qtyMax, 250);
  assert.equal(L.minRate, 100);
});

test('order rules: nothing is checked while switched off; piece limit needs no database', async () => {
  assert.deepEqual(await evaluate(S(), { orderId: 1, phone: '01700000000', ip: '1.2.3.4', pieces: 9999 }), []);
  const hits = await evaluate(S({ fr_rules_on: '1', fr_phone_day: '0', fr_ip_day: '0', fr_qty_max: '100' }), { orderId: 1, phone: '', ip: '', pieces: 101 });
  assert.equal(hits.length, 1);
  assert.match(hits[0], /101 pieces/);
});

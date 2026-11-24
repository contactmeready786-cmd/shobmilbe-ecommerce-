// ⭐ One-tap review link: only the shop can make a working key, and it belongs to exactly one order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewKey, reviewKeyOk, reviewPath } from '../lib/util';
import { servedByNext } from '../lib/next/routes';

const SECRET = 'test-secret-1234567890';

test('the key opens only its own order, only with the shop secret', () => {
  const k = reviewKey('SM1234', SECRET);
  assert.equal(k.length, 16);
  assert.ok(reviewKeyOk('SM1234', k, SECRET));
  assert.ok(reviewKeyOk('sm1234', k, SECRET), 'order number case does not matter');
  assert.ok(!reviewKeyOk('SM1235', k, SECRET), 'another order');
  assert.ok(!reviewKeyOk('SM1234', k, 'other-secret'), 'another shop secret');
  assert.ok(!reviewKeyOk('SM1234', k.slice(0, 15), SECRET), 'cut key');
  assert.ok(!reviewKeyOk('SM1234', '', SECRET));
  assert.ok(!reviewKeyOk('SM1234', k, ''), 'no secret → never valid');
});

test('the link goes to /track with the key, or the plain order page without a secret', () => {
  assert.equal(reviewPath('SM1234', SECRET), `/track?code=SM1234&k=${reviewKey('SM1234', SECRET)}`);
  assert.equal(reviewPath('SM1234', ''), '/order/SM1234');
});

test('a /track link with a key is checked by the form route, not drawn as the plain page', () => {
  assert.equal(servedByNext('/track', new URLSearchParams('code=SM1234&k=abc'), 'GET'), false);
  assert.equal(servedByNext('/track', new URLSearchParams('code=SM1234&phone=017'), 'GET'), false);
  assert.equal(servedByNext('/track', new URLSearchParams('code=SM1234'), 'GET'), true);
});

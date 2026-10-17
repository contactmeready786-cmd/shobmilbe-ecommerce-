// 🧭 Which addresses Next.js draws, and which still belong to the original code (lib/app.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servedByNext, hasNextPage, servesMore, servesShopRouter, servesForms } from '../lib/next/routes';

const get = (path: string, q = '') => servedByNext(path, new URLSearchParams(q), 'GET');

test('customer pages that moved are drawn by Next.js', () => {
  for (const p of ['/', '/products', '/p/led', '/brand/x', '/blog', '/blog/arduino', '/blog/category/tips', '/page/about',
    '/track', '/live', '/live/cricket', '/live/football', '/cart', '/wishlist', '/compare', '/checkout', '/kits', '/kit/robot', '/order/SM7K2P9Q', '/complaint', '/complaint/status', '/gift-card', '/order/SM1/return', '/account']) {
    assert.ok(get(p), p);
  }
});

test('forms, the order check and everything else stay with the original code', () => {
  assert.equal(get('/track', 'code=SM1&phone=017'), false);
  assert.equal(get('/complaint/status', 'code=C1&phone=017'), false);
  assert.equal(get('/complaint/status', 'code=C1'), true);
  assert.equal(servedByNext('/checkout', new URLSearchParams(), 'POST'), false);
  assert.equal(servedByNext('/cart', new URLSearchParams(), 'HEAD'), true);
  for (const p of ['/admin', '/api/orders', '/order/SM1/invoice', '/order/SM1/cancel', '/live/tennis', '/p/a/b', '/account/code', '/account/profile']) assert.equal(get(p), false, p);
  // a form sent to an address that has a Next.js page goes to the original code (proxy.ts), never to the Next.js page
  assert.ok(hasNextPage('/checkout') && hasNextPage('/track'));
});

test('each moved page has exactly one drawer', () => {
  for (const p of ['/', '/products', '/p/x', '/brand/x']) assert.ok(servesShopRouter(p) && !servesMore(p), p);
  for (const p of ['/live', '/live/cricket', '/cart', '/wishlist', '/compare', '/checkout', '/kits', '/kit/x', '/order/SM1']) assert.ok(servesMore(p) && !servesShopRouter(p) && !servesForms(p), p);
  for (const p of ['/complaint', '/complaint/status', '/gift-card', '/order/SM1/return', '/account']) assert.ok(servesForms(p) && !servesMore(p) && !servesShopRouter(p), p);
});

test('the order page and the old invoice address share one address rule', async () => {
  const { ORDER_PAGE } = await import('../lib/shop/more');
  assert.ok(ORDER_PAGE.test('/order/SM1') && ORDER_PAGE.test('/order/SM1/invoice') && !ORDER_PAGE.test('/order/SM1/return'));
});

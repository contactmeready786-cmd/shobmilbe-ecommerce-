// 🧭 Which addresses the Next.js pages draw, and which go to a route of their own (forms, look-ups, admin files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servedByNext, hasNextPage, servesMore, servesShopRouter, servesForms, formRouteFor } from '../lib/next/routes';

const get = (path: string, q = '') => servedByNext(path, new URLSearchParams(q), 'GET');

test('customer pages that moved are drawn by Next.js', () => {
  for (const p of ['/', '/products', '/p/led', '/brand/x', '/blog', '/blog/arduino', '/blog/category/tips', '/page/about',
    '/track', '/live', '/live/cricket', '/live/football', '/cart', '/wishlist', '/compare', '/checkout', '/kits', '/kit/robot', '/order/SM7K2P9Q', '/complaint', '/complaint/status', '/gift-card', '/order/SM1/return', '/account']) {
    assert.ok(get(p), p);
  }
});

test('forms and look-ups are never drawn by the Next.js pages', () => {
  assert.equal(get('/track', 'code=SM1&phone=017'), false);
  assert.equal(get('/complaint/status', 'code=C1&phone=017'), false);
  assert.equal(get('/complaint/status', 'code=C1'), true);
  assert.equal(servedByNext('/checkout', new URLSearchParams(), 'POST'), false);
  assert.equal(servedByNext('/cart', new URLSearchParams(), 'HEAD'), true);
  for (const p of ['/admin', '/api/orders', '/order/SM1/invoice', '/order/SM1/cancel', '/live/tennis', '/p/a/b', '/account/code', '/account/profile']) assert.equal(get(p), false, p);
  // a form sent to an address that has a Next.js page goes to its own route (proxy.ts), never to the Next.js page
  assert.ok(hasNextPage('/checkout') && hasNextPage('/track'));
});

test('customer forms have Next.js routes of their own (lib/shopx.tsx)', async () => {
  // a form sent to an address that has a page, a look-up with a number + phone, or the page switched off
  assert.equal(formRouteFor('/complaint'), '/api/forms/complaint');
  assert.equal(formRouteFor('/complaint/status'), '/api/forms/complaint');
  assert.equal(formRouteFor('/gift-card'), '/api/forms/gift-card');
  assert.equal(formRouteFor('/account'), '/api/forms/account');
  assert.equal(formRouteFor('/track'), '/api/forms/track');
  assert.equal(formRouteFor('/order/SM1/return'), '/api/forms/return');
  for (const p of ['/', '/checkout', '/cart', '/order/SM1', '/order/SM1/cancel', '/account/code', '/p/x']) assert.equal(formRouteFor(p), null, p);
  // every route file exists and hands its requests to the handler for it
  const { readFileSync } = await import('node:fs');
  const routes: [string, string][] = [
    ['app/api/forms/complaint/route.ts', 'complaint'], ['app/api/forms/gift-card/route.ts', 'giftCard'], ['app/api/forms/account/route.ts', 'account'],
    ['app/api/forms/track/route.ts', 'track'], ['app/api/forms/return/route.ts', 'returnRequest'], ['app/(shop)/account/[...action]/route.ts', 'account'],
    ['app/(shop)/order/[code]/cancel/route.ts', 'orderSelf'], ['app/(shop)/order/[code]/edit/route.ts', 'orderSelf'],
  ];
  const shopx = await import('../lib/shopx');
  for (const [file, fn] of routes) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(`formRoute(${fn})`) && /handle as POST/.test(src) && /handle as GET/.test(src), file);
    assert.equal(typeof (shopx as Record<string, unknown>)[fn], 'function', fn);
  }
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

test('admin pages are drawn by Next.js; forms, files and data go to app/api/admin', async () => {
  const { adminServedByNext } = await import('../lib/next/routes');
  const a = (p: string, q = '', m = 'GET') => adminServedByNext(p, new URLSearchParams(q), m);
  for (const p of ['/admin', '/admin/orders', '/admin/orders/5', '/admin/products', '/admin/settings', '/admin/login']) assert.ok(a(p), p);
  for (const p of ['/admin/api/media', '/admin/orders/export.csv', '/admin/orders/invoice', '/admin/avatar/3', '/admin/pos/memo/4', '/admin/design/documents', '/admin/products/9/active', '/admin/no-such-page']) assert.equal(a(p), false, p);
  assert.equal(a('/admin/orders', '', 'POST'), false);
  assert.equal(a('/admin/orders', '__site=1'), false); // sent back by lib/next/admin.ts: app/api/admin answers
  assert.equal(a('/products'), false);
});

test('lib/next/admin-routes.ts lists today\'s admin pages (run tools/gen-admin-routes.ts after changing admin routes)', async () => {
  const { adminGetRoutes } = await import('./fixtures/admin-routes');
  const { ADMIN_GET_ROUTES } = await import('../lib/next/admin-routes');
  assert.deepEqual(ADMIN_GET_ROUTES.map(String), adminGetRoutes().map(String));
});

test('app/api/admin answers only admin addresses, for every way of asking', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('app/api/admin/route.ts', 'utf8');
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) assert.ok(src.includes(`adminAnswer as ${m}`), m);
  const { adminAnswer, isAdminPath } = await import('../lib/next/admin-route');
  assert.ok(isAdminPath('/admin') && isAdminPath('/admin/orders') && !isAdminPath('/administrator') && !isAdminPath('/api/admin'));
  // opened directly (proxy.ts records /api/admin itself as the address asked for): nothing there
  const r = await adminAnswer(new Request('http://local/api/admin', { headers: { 'x-shop-url': '/api/admin' } }));
  assert.equal(r.status, 404);
});

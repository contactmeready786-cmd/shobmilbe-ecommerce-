// 🚀 Landing pages (/lp/<slug>, owner 2026-11-15): one product with its order form on the same page.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { lines, faqPairs, draftFrom } from '../lib/models/landing';
import { landingPage, defaultFaq, cartProduct } from '../lib/views/landing';
import { renderHtml } from '../lib/react/html';
import { loadRenderer } from '../lib/react/render';
import { hasNextPage, servesMore, servesShopRouter, servesForms } from '../lib/next/routes';
import { ADMIN_GET_ROUTES } from '../lib/next/admin-routes';

before(loadRenderer);

test('benefit lines lose their bullets; questions split at | or ?', () => {
  assert.deepEqual(lines('- ১০ ঘণ্টা চলে\n\n• **পানি** প্রতিরোধী\n✅ ওয়ারেন্টি\n2) হালকা'), ['১০ ঘণ্টা চলে', 'পানি প্রতিরোধী', 'ওয়ারেন্টি', 'হালকা']);
  assert.deepEqual(faqPairs('চার্জ কতক্ষণে হয়? | ২ ঘণ্টায়\nওয়ারেন্টি আছে? হ্যাঁ, ৬ মাস\nশুধু লেখা'), [
    { q: 'চার্জ কতক্ষণে হয়?', a: '২ ঘণ্টায়' }, { q: 'ওয়ারেন্টি আছে?', a: 'হ্যাঁ, ৬ মাস' }]);
});

test('a new page is filled from the product: name, short text, the facts list', () => {
  const d = draftFrom({ name: 'Bluetooth Speaker X1', short_description: '**জোরালো** সাউন্ড, ছোট সাইজ', description: 'ভূমিকা\n### মূল তথ্য\n- ব্যাটারি: 1200mAh\n- ১০ ঘণ্টা চলে\nশেষ' });
  assert.equal(d.headline, 'Bluetooth Speaker X1');
  assert.ok(d.subhead.includes('জোরালো') && !d.subhead.includes('**'), d.subhead);
  assert.equal(d.points, 'ব্যাটারি: 1200mAh\n১০ ঘণ্টা চলে');
});

test('the default questions only say what the shop really offers', () => {
  const s = { delivery_dhaka: '70', delivery_outside: '130', phone: '01700000000' } as never;
  assert.ok(defaultFaq(s, true).some((f) => /ক্যাশ অন ডেলিভারি/.test(f.a)));
  assert.ok(!defaultFaq(s, false).some((f) => /ক্যাশ অন ডেলিভারি/.test(f.a)));
});

const product = {
  id: 7, name: 'Bluetooth Speaker X1', slug: 'bt-speaker-x1', price: 950, old_price: 1200, stock: 20, low_stock: 3, sold_count: 41,
  images: [11, 12], variants: [], pack_sizes: '', description: '- ১০ ঘণ্টা চলে', short_description: '', youtube_url: '', emoji: '🔊', preorder: false,
} as never;
const page = { id: 1, slug: 'speaker', product_id: 7, headline: 'ঘরেই হলের সাউন্ড', subhead: 'ছোট কিন্তু জোরালো', points: '১০ ঘণ্টা চলে\nপানিতে নষ্ট হয় না',
  offer: 'আজ ২০% ছাড়', ends_at: new Date(Date.now() + 86400e3), faq: 'চার্জ কতক্ষণে? | ২ ঘণ্টা', video_url: '', active: true } as never;

test('the page: headline, price, benefits, countdown, questions, the order form and the cart product', () => {
  const html = renderHtml(landingPage({ page, product, settings: { delivery_dhaka: '70', delivery_outside: '130' } as never, reviews: [], reviewStats: { count: 0 },
    checkout: <div id="the-form" /> }));
  for (const want of ['ঘরেই হলের সাউন্ড', 'ছোট কিন্তু জোরালো', 'আজ ২০% ছাড়', 'পানিতে নষ্ট হয় না', 'data-countdown=', 'চার্জ কতক্ষণে?', 'id="the-form"',
    'data-lp-product="7"', 'href="#order"', '/p/bt-speaker-x1', '/media/11']) assert.ok(html.includes(want), want);
  assert.ok(!html.includes('[object Object]'));
});

test('out of stock: no order form, no order buttons', () => {
  const html = renderHtml(landingPage({ page, product: { ...(product as object), stock: 0 } as never, settings: {} as never, reviews: [], reviewStats: { count: 0 }, checkout: <div id="the-form" /> }));
  assert.ok(html.includes('স্টকে নেই') && !html.includes('id="the-form"') && !html.includes('data-lp-bar'));
});

test('a product with colours/sizes puts its first one in stock in the cart', () => {
  const p = { id: 1, stock: 0, variants: [{ id: 2, stock: 0 }, { id: 3, stock: 5 }] } as never;
  assert.equal(cartProduct(p).id, 3);
});

test('addresses: /lp/<slug> is a Next.js page drawn by lib/shop/more.tsx; the admin pages are listed', () => {
  assert.ok(hasNextPage('/lp/speaker') && servesMore('/lp/speaker') && !servesShopRouter('/lp/speaker') && !servesForms('/lp/speaker'));
  assert.ok(!hasNextPage('/lp/a/b'));
  assert.ok(ADMIN_GET_ROUTES.includes('/admin/landing') && ADMIN_GET_ROUTES.some((r) => r instanceof RegExp && r.test('/admin/landing/3')));
});

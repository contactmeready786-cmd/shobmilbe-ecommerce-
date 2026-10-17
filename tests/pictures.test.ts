// 🖼️ Product pictures load fast: the first cards a customer sees load at once (the first two before anything else),
// the rest wait until they scroll into view, and a picture stored on ImageKit is linked straight to ImageKit.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, loadRenderer } from '../lib/react/render';
import * as shop from '../lib/views/shop';
import type { Settings } from '../lib/types';

before(loadRenderer); // the original router's text renderer (lib/react/render.tsx)

const s = { store_name: 'সবমিলবে' } as unknown as Settings;
const product = (i: number, extra: Record<string, unknown> = {}) => ({ id: i, name: `পণ্য ${i}`, slug: `p${i}`, price: 100, stock: 5, image_id: 10 + i, ...extra });
const imgs = (h: string) => h.match(/<img [^>]*>/g) || [];

test('a card on ImageKit links straight to the small ImageKit picture', () => {
  const h = renderHtml(shop.productCard(product(1, { image_ik: 'https://ik.imagekit.io/shop/m1.jpg' }), s));
  assert.match(h, /src="https:\/\/ik\.imagekit\.io\/shop\/m1\.jpg\?tr=w-480,f-auto"/);
  assert.match(h, /loading="lazy"/);
});

test('a card without ImageKit keeps the shop address', () => {
  const h = renderHtml(shop.productCard(product(2), s));
  assert.match(h, /src="\/media\/12\/t"/);
});

test('the listing loads its first four cards at once, the first two first', () => {
  const list = Array.from({ length: 8 }, (_, i) => product(i + 1));
  const h = renderHtml(shop.listing({ products: list, categories: [], category: null, q: '', sort: '', settings: s, total: 8, page: 1, perPage: 24 }));
  const all = imgs(h).filter((t) => t.includes('/media/'));
  assert.equal(all.length, 8);
  all.forEach((t, i) => {
    assert.equal(/loading="lazy"/.test(t), i >= 4, `card ${i + 1} loading`);
    assert.equal(/fetchpriority="high"/i.test(t), i < 2, `card ${i + 1} priority`);
  });
});

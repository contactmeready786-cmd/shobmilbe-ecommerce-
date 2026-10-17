// 🔎 The head tags Next.js writes from lib/next/meta.ts: same information as the shop always sent, and nothing Next.js
// would refuse (an empty Open Graph type crashed product pages once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopMetadata } from '../lib/next/meta';

const s = { store_name: 'সবমিলবে', session_secret: 'x', site_url: 'https://shobmilbe.com/', seo_description: 'দোকানের কথা' } as never;

test('title, description, canonical, image', () => {
  const m = shopMetadata(s, { title: 'Arduino Uno', canonical: '/p/uno', image: '/media/5', description: 'বিবরণ' }) as Record<string, any>;
  assert.deepEqual(m.title, { absolute: 'Arduino Uno | সবমিলবে' });
  assert.equal(m.description, 'বিবরণ');
  assert.deepEqual(m.alternates, { canonical: 'https://shobmilbe.com/p/uno' });
  assert.equal(m.openGraph.images[0].url, 'https://shobmilbe.com/media/5');
  assert.equal(m.openGraph.type, 'website');
});

test('product pages: no Open Graph type key at all (the page writes og:type product itself)', () => {
  const m = shopMetadata(s, { title: 'X', type: 'product' }) as Record<string, any>;
  assert.ok(!('type' in m.openGraph));
  assert.equal((shopMetadata(s, { title: 'X', type: 'article' }) as Record<string, any>).openGraph.type, 'article');
});

test('home title and noindex', () => {
  const m = shopMetadata(s, { noindex: true }) as Record<string, any>;
  assert.match(m.title.absolute, /সবমিলবে/);
  assert.deepEqual(m.robots, { index: false });
  assert.equal(m.description, 'দোকানের কথা');
});

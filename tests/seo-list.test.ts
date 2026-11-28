// 🔎 Category titles (lib/services/seo.ts listSeo, 2026-11-28): brand sub-categories are named with their parent and the
// remote pages carry the English words people search ("walton ac remote price in bangladesh"); the owner's title wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSeo, listName, listTitle } from '../lib/services/seo';

const all = [
  { id: 1, slug: 'remote', name: 'রিমোট কন্ট্রোল', parent_id: null },
  { id: 2, slug: 'ac-remote', name: 'এসি রিমোট', parent_id: 1 },
  { id: 3, slug: 'ac-remote-walton', name: 'Walton', parent_id: 2 },
  { id: 4, slug: 'tv-remote', name: 'টিভি রিমোট', parent_id: 1 },
  { id: 5, slug: 'tv-remote-walton', name: 'Walton', parent_id: 4 },
  { id: 6, slug: 'ac-remote-universal', name: 'ইউনিভার্সাল রিমোট', parent_id: 2 },
  { id: 7, slug: 'hijab', name: 'হিজাব', parent_id: 8 },
];

test('brand remote pages: English search words + full Bangla name, AC and TV no longer the same title', () => {
  const ac = listTitle(listSeo({ ...all[2], seo_title: '' }, all));
  const tv = listTitle(listSeo({ ...all[4], seo_title: '' }, all));
  assert.equal(ac, 'Walton AC Remote Price in BD | Walton এসি রিমোট');
  assert.equal(tv, 'Walton TV Remote Price in BD | Walton টিভি রিমোট');
  assert.equal(listName(all[5], all), 'ইউনিভার্সাল এসি রিমোট');
  assert.equal(listTitle(listSeo({ ...all[1], seo_title: '' }, all)), 'AC Remote Price in BD | এসি রিমোট');
});

test('other categories keep their title; the owner’s own SEO title always wins', () => {
  assert.equal(listTitle(listSeo({ ...all[6], seo_title: '' }, all)), 'হিজাব — দাম ও অনলাইন অর্ডার বাংলাদেশে');
  assert.equal(listTitle(listSeo({ ...all[2], seo_title: 'আমার শিরোনাম' }, all)), 'আমার শিরোনাম');
});

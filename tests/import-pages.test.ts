// 📥 Product import from a shop link (owner, 2026-10-23: a 300-product shop gave only 25): the next page of a list is
// found, and only on the same site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlNextPage } from '../lib/admin/import';

test('import: the next page of a shop list', () => {
  const base = 'https://shop.example.com/shop/';
  assert.equal(htmlNextPage('<link rel="next" href="https://shop.example.com/shop/page/2/">', base), 'https://shop.example.com/shop/page/2/');
  assert.equal(htmlNextPage('<a class="next page-numbers" href="/shop/page/3/">→</a>', base), 'https://shop.example.com/shop/page/3/');
  assert.equal(htmlNextPage('<a href="?page=2&amp;sort=new" rel="next">পরের</a>', base), 'https://shop.example.com/shop/?page=2&sort=new');
  assert.equal(htmlNextPage('<a class="next" href="https://evil.example.org/x">x</a>', base), null); // another site: never
  assert.equal(htmlNextPage('<p>no pages</p>', base), null);
});

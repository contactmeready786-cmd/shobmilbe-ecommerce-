// ⚛️ Pages moved to React must look exactly like before. tests/golden/*.html is what the old html`…` code made for
// the sample data in tests/fixtures (recorded just before each move); the React version must make the same page.
// "The same" = identical for a browser (tools/parity/normalise.mjs → canonicalHtml ignores only spelling such as
// &#x27; vs &#39; and source indentation). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalHtml } from '../tools/parity/normalise.mjs';
import * as V from '../lib/views/shop';
import * as F from './fixtures/shop';

const golden = (name: string) => fs.readFileSync(`tests/golden/${name}.html`, 'utf8');
function same(name: string, made: unknown) {
  const want = canonicalHtml(golden(name));
  const got = canonicalHtml(String(made));
  if (want !== got) {
    let i = 0; while (i < want.length && want[i] === got[i]) i++;
    assert.fail(`${name} differs at ${i}:\n  before: ${want.slice(Math.max(0, i - 80), i + 80)}\n  now:    ${got.slice(Math.max(0, i - 80), i + 80)}`);
  }
}

test('order tracking page', () => {
  same('track-empty', V.trackPage({}));
  same('track-error', V.trackPage({ error: 'অর্ডার পাওয়া যায়নি — "SM12" ভুল?', code: 'SM12<x>', phone: "01712'345678" }));
});
test('page not found', () => same('not-found', V.notFound()));
test("owner's own pages (Markdown)", () => same('static-page', V.staticPage({ page: F.page })));
test('blog list, category, empty', () => {
  same('blog-list', V.blogList({ posts: [F.post, F.post2], categories: F.categories, category: null }));
  same('blog-list-cat', V.blogList({ posts: [F.post], categories: F.categories, category: F.categories[1] }));
  same('blog-list-empty', V.blogList({ posts: [], categories: [], category: null }));
});
test('blog post', () => {
  same('blog-post', V.blogPost({ post: F.post, contentHtml: '<p>ভেতরের <b>HTML</b></p>', related: [F.post2] }));
  same('blog-post-plain', V.blogPost({ post: F.post2, contentHtml: '', related: [] }));
});

// One-off helper while moving pages to React: writes what the OLD html`…` code made for the sample data into
// tests/golden/, so tests/react-views.test.ts can prove the React version makes the same page.
// npx tsx tools/make-golden.ts  (needs the old view copied to lib/views/__old_shop.ts for the run)
import fs from 'node:fs';
import * as OLD from '../lib/views/__old_shop';
import * as F from '../tests/fixtures/shop';

const out: Record<string, string> = {
  'track-empty': String(OLD.trackPage({})),
  'track-error': String(OLD.trackPage({ error: 'অর্ডার পাওয়া যায়নি — "SM12" ভুল?', code: 'SM12<x>', phone: "01712'345678" })),
  'not-found': String(OLD.notFound()),
  'static-page': String(OLD.staticPage({ page: F.page })),
  'blog-list': String(OLD.blogList({ posts: [F.post, F.post2], categories: F.categories, category: null })),
  'blog-list-cat': String(OLD.blogList({ posts: [F.post], categories: F.categories, category: F.categories[1] })),
  'blog-list-empty': String(OLD.blogList({ posts: [], categories: [], category: null })),
  'blog-post': String(OLD.blogPost({ post: F.post, contentHtml: '<p>ভেতরের <b>HTML</b></p>', related: [F.post2] })),
  'blog-post-plain': String(OLD.blogPost({ post: F.post2, contentHtml: '', related: [] })),
};
fs.mkdirSync('tests/golden', { recursive: true });
for (const [k, v] of Object.entries(out)) fs.writeFileSync(`tests/golden/${k}.html`, v);
console.log('golden files:', Object.keys(out).length);

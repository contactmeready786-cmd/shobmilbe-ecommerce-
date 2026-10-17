// Every moved page, with sample data: name → how to make it. tools/make-golden.ts records the OLD code's page for a
// new name (once, just before the move); tests/react-views.test.ts checks the React page against it, forever.
import * as F from './shop';
import * as FC from './complaint';
import type { Loose } from '../../lib/types';

export type Views = { shop: Loose; complaint: Loose };

export const CASES: [string, (v: Views) => unknown][] = [
  // shop: simple pages + blog
  ['track-empty', (v) => v.shop.trackPage({})],
  ['track-error', (v) => v.shop.trackPage({ error: 'অর্ডার পাওয়া যায়নি — "SM12" ভুল?', code: 'SM12<x>', phone: "01712'345678" })],
  ['not-found', (v) => v.shop.notFound()],
  ['static-page', (v) => v.shop.staticPage({ page: F.page })],
  ['blog-list', (v) => v.shop.blogList({ posts: [F.post, F.post2], categories: F.categories, category: null })],
  ['blog-list-cat', (v) => v.shop.blogList({ posts: [F.post], categories: F.categories, category: F.categories[1] })],
  ['blog-list-empty', (v) => v.shop.blogList({ posts: [], categories: [], category: null })],
  ['blog-post', (v) => v.shop.blogPost({ post: F.post, contentHtml: '<p>ভেতরের <b>HTML</b></p>', related: [F.post2] })],
  ['blog-post-plain', (v) => v.shop.blogPost({ post: F.post2, contentHtml: '', related: [] })],
  // complaints
  ['complaint-form', (v) => v.complaint.complaintPage({ settings: FC.settings })],
  ['complaint-form-filled', (v) => v.complaint.complaintPage({ settings: FC.settingsNoPhone, values: FC.values, error: 'মোবাইল নম্বর ঠিক নেই', look: { code: 'C123456' }, lookError: 'পাওয়া যায়নি' })],
  ['complaint-warranty-item', (v) => v.complaint.complaintPage({ settings: FC.settings, values: FC.warrantyOne })],
  ['complaint-warranty-list', (v) => v.complaint.complaintPage({ settings: FC.settings, values: FC.warrantyList })],
  ['complaint-warranty-none', (v) => v.complaint.complaintPage({ settings: FC.settings, values: { topic: 'warranty' } })],
  ['complaint-done', (v) => v.complaint.complaintPage({ settings: FC.settings, done: { code: 'C654321' } })],
  ['complaint-done-nosms', (v) => v.complaint.complaintPage({ settings: { ...FC.settings, complaint_sms_on: '0' }, done: { code: 'C654321' } })],
  ['complaint-status-form', (v) => v.complaint.statusPage({ code: 'C1<2>', error: 'নম্বর মেলেনি' })],
  ['complaint-status-open', (v) => v.complaint.statusPage({ c: FC.open })],
  ['complaint-status-closed', (v) => v.complaint.statusPage({ c: FC.closed })],
];

// Every moved page, with sample data: name → how to make it. tools/make-golden.ts records the OLD code's page for a
// new name (once, just before the move); tests/react-views.test.ts checks the React page against it, forever.
import * as F from './shop';
import * as FC from './complaint';
import * as FA from './account';
import type * as ShopViews from '../../lib/views/shop';
import type * as ComplaintViews from '../../lib/views/complaint';
import type * as AccountViews from '../../lib/views/account';

/** the page functions, called with the sample data below (samples carry only the fields a page reads, so their
 *  arguments are taken as given) */
type Samples<M> = { [K in keyof M]: M[K] extends (...a: infer A) => infer R ? (...a: { [I in keyof A]: unknown }) => R : M[K] };
export type Views = { shop: Samples<typeof ShopViews>; complaint: Samples<typeof ComplaintViews>; account: Samples<typeof AccountViews> };

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
  // customer account: login (e-mail / mobile, every step), dashboard tabs, returns, gift cards
  ['login-phone', (v) => v.account.loginPage({})],
  ['login-none', (v) => v.account.loginPage({ phoneOn: false })],
  ['login-both-email', (v) => v.account.loginPage({ via: 'email', emailOn: true, email: 'a"b@x.com', next: '/checkout?x=1&y=2', info: 'কোড পাঠানো হয়েছে', error: 'ভুল' })],
  ['login-email-empty', (v) => v.account.loginPage({ via: 'email', emailOn: true, phoneOn: false })],
  ['login-email-signup', (v) => v.account.loginPage({ via: 'email', emailOn: true, mode: 'signup', email: 'x@y.com' })],
  ['login-email-reset', (v) => v.account.loginPage({ via: 'email', emailOn: true, mode: 'reset', next: '/a' })],
  ['login-email-code', (v) => v.account.loginPage({ via: 'email', emailOn: true, step: 'code', mode: 'reset', email: 'x@y.com', next: '/b' })],
  ['login-email-code-signup', (v) => v.account.loginPage({ via: 'email', emailOn: true, step: 'code', mode: 'weird', email: 'x@y.com' })],
  ['login-phone-code', (v) => v.account.loginPage({ via: 'phone', emailOn: true, step: 'code', phone: '01712345678', next: '/c' })],
  ['login-phone-start', (v) => v.account.loginPage({ via: 'phone', emailOn: true, phone: '017', next: '/d' })],
  ['acct-orders', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: FA.orders, addresses: [], settings: FA.s, referral: FA.referral, flash: 'সেভ হয়েছে', error: 'একটা ভুল' })],
  ['acct-orders-empty', (v) => v.account.dashboard({ cu: FA.cuEmail, orders: [], addresses: [], settings: FA.sOff })],
  ['acct-addresses', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: FA.addresses, settings: FA.s, tab: 'addresses' })],
  ['acct-addresses-empty', (v) => v.account.dashboard({ cu: FA.cuEmail, orders: [], addresses: [], settings: FA.s, tab: 'addresses' })],
  ['acct-profile-phone', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: [], settings: FA.s, tab: 'profile' })],
  ['acct-profile-email-welcome', (v) => v.account.dashboard({ cu: FA.cuEmail, orders: [], addresses: [], settings: FA.s, tab: 'profile', welcome: true, next: '/checkout' })],
  ['acct-profile-phone-welcome', (v) => v.account.dashboard({ cu: { ...FA.cuPhone, name: '' }, orders: [], addresses: [], settings: FA.s, tab: 'profile', welcome: true })],
  ['acct-refer', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: [], settings: FA.s, tab: 'refer', referral: FA.referral })],
  ['acct-refer-nosite', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: [], settings: FA.sOff, tab: 'refer', referral: { ...FA.referral, friendMin: 0 } })],
  ['acct-gift', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: [], settings: FA.s, tab: 'gift', cards: FA.cards })],
  ['acct-gift-empty', (v) => v.account.dashboard({ cu: FA.cuPhone, orders: [], addresses: [], settings: FA.s, tab: 'gift' })],
  ['return-form', (v) => v.account.returnForm({ order: FA.order, existing: FA.existing, settings: FA.s, error: 'কারণ লিখুন', mine: true })],
  ['return-done', (v) => v.account.returnForm({ order: FA.order, settings: FA.sOff, done: 'R1003', mine: true })],
  ['return-not-mine', (v) => v.account.returnForm({ order: FA.order, settings: FA.s, mine: false })],
  ['return-not-mine-noacct', (v) => v.account.returnForm({ order: FA.order, settings: FA.sOff, mine: false })],
  ['return-not-delivered', (v) => v.account.returnForm({ order: { ...FA.order, status: 'shipped' }, settings: FA.s, mine: true })],
  ['gift-page', (v) => v.account.giftPage({ settings: FA.s, methods: FA.methods })],
  ['gift-page-values', (v) => v.account.giftPage({ settings: FA.s, methods: FA.methods, error: 'TrxID দিন', values: { amount: 'custom', custom_amount: '300', recipient_name: 'মা "আম্মু"', recipient_phone: '017', message: 'শুভ <জন্মদিন>', buyer_name: 'R', buyer_phone: '018', pay_number: '019', trx: 'ABC' } })],
  ['gift-page-amount', (v) => v.account.giftPage({ settings: FA.s, methods: FA.methods, values: { amount: '2000' } })],
  ['gift-page-single', (v) => v.account.giftPage({ settings: FA.sOff, methods: [] })],
  ['gift-page-done', (v) => v.account.giftPage({ settings: FA.s, done: { trx: 'TRX9', to: '01712345678' } })],
];

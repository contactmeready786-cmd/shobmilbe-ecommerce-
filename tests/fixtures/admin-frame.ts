// Sample admin page frames (tests/admin-frame.test.ts): the login-style "bare" page, the owner's dashboard with its
// tabs, a staff member who may only look at a page, a page that is one of a tab set.
import { raw } from '../../lib/util';
import type { Settings, StaffUser } from '../../lib/types';
import type { adminLayout } from '../../lib/admin/layout';

const owner = { id: 1, name: 'রহিম "মালিক"', username: 'owner', role: 'owner', designation: '', photo_id: null, permissions: [] as string[], active: true } as StaffUser;
const staff = { id: 7, name: 'Karim <staff>', username: 'karim', role: 'staff', designation: 'প্যাকিং', photo_id: 12, permissions: ['products', 'orders:view', 'customers'], active: true } as StaffUser;
const s: Settings = { store_name: 'সবমিলবে', session_secret: '', favicon_id: '' };
export const frames: [string, Parameters<typeof adminLayout>[0]][] = [
  ['bare', { settings: s, title: 'লগইন', body: raw('<form id="f">x</form>'), bare: true }],
  ['bare-nolang', { settings: { ...s, admin_i18n_on: '0', favicon_id: '5' }, title: 'রিসেট & <x>', body: raw('<p>y</p>'), bare: true }],
  ['owner-home', { settings: s, user: owner, title: 'ড্যাশবোর্ড', body: raw('<h1>Home</h1>'), active: 'home', path: '/admin' }],
  ['owner-visitors', { settings: { ...s, logo_id: '3' }, user: owner, title: 'ভিজিটর', body: raw('<h1>V</h1>'), active: 'visitors', path: '/admin/marketing/visitors' }],
  ['owner-tabs', { settings: { ...s, store_name: 'My Shop' }, user: owner, title: 'রিটার্ন', body: raw('<h1>R</h1>'), active: 'returns', path: '/admin/returns' }],
  ['staff-readonly', { settings: { ...s, admin_i18n_on: '0' }, user: staff, title: 'পণ্য', body: raw('<h1>P</h1>'), active: 'products', path: '/admin/products', readOnly: true }],
  ['staff-other', { settings: s, user: staff, title: 'Order', body: raw(''), active: 'orders', path: '/admin/orders/5' }],
];

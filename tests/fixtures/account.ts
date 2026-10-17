// Sample data for the customer account pages (lib/views/account.ts → components/shop/Account.tsx).
export const s = { store_name: 'সবমিলবে', session_secret: 'x', site_url: 'https://shobmilbe.com/', gift_on: '1', returns_on: '1', returns_days: '7', acct_on: '1', gift_amounts: '500,1000,2000', gift_min: '200', gift_max: '20000', gift_valid_days: '365', manual_type: 'Personal' };
export const sOff = { store_name: 'সবমিলবে', session_secret: 'x', gift_amounts: '750' };
export const cuPhone = { name: 'রাজন হক', phone: '01712345678', email: 'r@x.com', points: 120 };
export const cuEmail = { name: '', email: 'rajon@gmail.com', email_verified: true, phone: '', contact_phone: '01812345678', points: 0 };
export const orders = [
  { code: 'SMAB12CD', status: 'delivered', created_at: '2026-10-05T06:00:00Z', total: 560, items: [{ id: 1, name: 'Arduino Uno', qty: 1 }, { id: 2, name: 'Jumper "Wire"', qty: 3 }, { id: 3, name: 'LED', qty: 10 }, { id: 4, name: 'Resistor & Co', qty: 5 }] },
  { code: 'SMXY98ZW', status: 'pending', created_at: '2026-10-10T06:00:00Z', total: 170.5, items: [{ id: null, name: 'Gift', qty: 1, kind: 'gift' }] },
];
export const addresses = [
  { id: 5, label: 'বাসা', name: 'রাজন', phone: '01712345678', address: 'বাড়ি ১২, রোড ৩ <A>', district: 'Dhaka', thana: 'Banani', is_default: true },
  { id: 6, label: '', name: '', phone: '', address: 'অফিস', district: 'Barisal', thana: 'Sadar', is_default: false },
];
export const referral = { code: 'RAJON5', friendGets: 50, friendMin: 300, youGet: 100, joined: 3, rewarded: 1 };
export const cards = [
  { code: 'GC-1234', status: 'active', source: 'referral', balance: 50, initial: 100, expires_on: '2027-01-01' },
  { code: 'GC-5678', status: 'pending', source: 'buy', recipient_phone: '01712345678', balance: 500, initial: 500 },
  { code: 'GC-9999', status: 'used', source: 'buy', recipient_phone: '01999999999', recipient_name: 'মা', balance: 0, initial: 1000 },
  { code: 'GC-0000', status: 'weird', source: 'buy', recipient_phone: '01999999999', balance: 10, initial: 10 },
];
export const order = { code: 'SMAB12CD', status: 'delivered', items: [{ id: 11, product_id: 1, name: 'Arduino Uno', qty: 2 }, { id: 12, product_id: null, name: 'Gift', qty: 1 }, { id: 13, product_id: 3, name: 'LED <red>', qty: 10 }] };
export const existing = [
  { code: 'R1001', status: 'approved', created_at: '2026-10-07T06:00:00Z', items: [{ name: 'Arduino Uno', qty: 1 }], reply: 'পণ্য পাঠান <ঠিকানা>', refund_amount: '250' },
  { code: 'R1002', status: 'odd', created_at: '2026-10-08T06:00:00Z', items: [], reply: '', refund_amount: 0 },
];
export const methods = [{ id: 'bkash', label: 'বিকাশ', number: '01712345678' }, { id: 'nagad', label: 'নগদ', number: '01812345678' }];

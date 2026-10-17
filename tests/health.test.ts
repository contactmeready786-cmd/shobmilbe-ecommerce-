// 🩺 Server & database health (lib/services/health.ts): when the owner is warned, and what about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../lib/services/health';

const MB = 1024 * 1024;
const base = (over: Partial<H.Health> = {}): H.Health => ({
  dbBytes: 100 * MB, limitBytes: 500 * MB, share: 0.2, dbLevel: 'ok',
  tables: [{ name: 'page_views', bytes: 40 * MB, rows: 120000 }, { name: 'orders', bytes: 5 * MB, rows: 900 }],
  pingMs: 4, pingLevel: 'ok', connections: 5, maxConnections: 60, connLevel: 'ok',
  backupAt: new Date(), backupDays: 0.3, backupLevel: 'ok', errors24: [], errors7: [], errorLevel: 'ok',
  ik: { bandwidthBytes: 2 * 1024 ** 3, bandwidthLimit: 20 * 1024 ** 3, bwLevel: 'ok', storageBytes: 0.5 * 1024 ** 3, storageLimit: 3 * 1024 ** 3, storageLevel: 'ok', since: '2026-10-01' },
  sms: null, tls: { checked: true, supabase: true, problem: '', at: new Date() }, tlsLevel: 'ok',
  checkedAt: new Date(), ...over,
});

test('limit: Supabase free plan by default, owner can set another', () => {
  assert.equal(H.limitBytes({} as never), 500 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: '8192' } as never), 8192 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: 'abc' } as never), 500 * MB);
  assert.equal(H.limitBytes({ db_limit_mb: '5' } as never), 500 * MB); // nonsense values ignored
});

test('levels: warn at 80 %, bad at 90 %', () => {
  assert.equal(H.levelFor(0.5), 'ok');
  assert.equal(H.levelFor(0.8), 'warn');
  assert.equal(H.levelFor(0.89), 'warn');
  assert.equal(H.levelFor(0.9), 'bad');
});

test('all fine: no warnings', () => {
  assert.deepEqual(H.warnings(base()), []);
});

test('database filling up: one warning naming the biggest tables', () => {
  const w = H.warnings(base({ dbBytes: 420 * MB, share: 0.84, dbLevel: 'warn' }));
  assert.equal(w.length, 1);
  assert.equal(w[0].key, 'db');
  assert.match(w[0].title, /৮৪%/);
  assert.match(w[0].text, /ভিজিটর অ্যানালিটিক্স/);
});

test('no backup for days, and connections nearly used up', () => {
  const w = H.warnings(base({ backupDays: 3.2, backupLevel: 'warn', connections: 57, connLevel: 'bad' }));
  assert.deepEqual(w.map((x) => x.key).sort(), ['backup', 'conn']);
  assert.match(w.find((x) => x.key === 'backup')!.title, /৩|3/);
});

test('MB formatting', () => {
  assert.equal(H.mb(85.4 * MB), '85.4');
  assert.equal(H.mb(512 * MB), '512');
});

test('error log groups the same page and hides personal details', () => {
  assert.equal(H.pagePattern('/admin/orders/123/edit?x=1'), '/admin/orders/:id/edit');
  assert.equal(H.pagePattern('/order/SM8K2Q9X'), '/order/:code');
  assert.equal(H.pagePattern('/p/arduino-uno-r3'), '/p/arduino-uno-r3');
  const t = H.errorText(new Error('order for 01712345678 rahim@example.com failed'));
  assert.ok(!t.includes('01712345678') && !t.includes('rahim@example.com'), t);
  assert.ok(H.errorText('x'.repeat(1000)).length <= 300);
});

test('errors: 5 a day on one page = look at it, 30 = serious', () => {
  assert.equal(H.errorLevel([{ n: 2 }, { n: 3 }]), 'ok');
  assert.equal(H.errorLevel([{ n: 5 }]), 'warn');
  assert.equal(H.errorLevel([{ n: 31 }]), 'bad');
  const w = H.warnings(base({ errors24: [{ path: '/checkout', message: 'TypeError: x', n: 7, last_at: new Date() }], errorLevel: 'warn' }));
  assert.equal(w[0].key, 'errors');
  assert.match(w[0].title, /\/checkout/);
});

test('ImageKit: free plan limits, warning before images stop', () => {
  const l = H.ikLimits({} as never);
  assert.equal(l.bandwidth, 20 * 1024 ** 3);
  assert.equal(l.storage, 3 * 1024 ** 3);
  const w = H.warnings(base({ ik: { bandwidthBytes: 17 * 1024 ** 3, bandwidthLimit: 20 * 1024 ** 3, bwLevel: 'warn', storageBytes: 1, storageLimit: 3 * 1024 ** 3, storageLevel: 'ok', since: '2026-10-01' } }));
  assert.deepEqual(w.map((x) => x.key), ['ik_bw']);
  assert.match(w[0].title, /৮৫%/);
});

test('ImageKit not reachable: no false warning', () => {
  assert.deepEqual(H.warnings(base({ ik: null })), []);
});

// ---- added 2026-10-17: database certificate and the SMS phone ----
const phone = (over: Record<string, unknown> = {}) => ({
  provider: 'textbee', on: true, lastSeen: new Date(), minutesAgo: 5, battery: 80, charging: false, model: 'Samsung A10',
  phoneLevel: 'ok', phoneWhy: '', failed6h: 0, sent6h: 4, lastOk: new Date(), sendLevel: 'ok', ...over,
}) as never;

test('database certificate that failed the check is a red alarm', () => {
  const tls = { checked: false, supabase: true, problem: 'SELF_SIGNED_CERT_IN_CHAIN', at: new Date() };
  assert.equal(H.tlsLevelFor(tls), 'bad');
  assert.equal(H.tlsLevelFor({ ...tls, checked: true, problem: '' }), 'ok');
  const w = H.warnings(base({ tls, tlsLevel: 'bad' }));
  assert.equal(w.length, 1);
  assert.equal(w[0].key, 'db_tls');
  assert.equal(w[0].level, 'bad');
});

test('SMS phone: quiet phone and failing codes are warned about, a healthy phone is not', () => {
  assert.deepEqual(H.warnings(base({ sms: phone() })), []);
  const quiet = H.warnings(base({ sms: phone({ phoneLevel: 'bad', phoneWhy: 'ফোনটা ৫ ঘণ্টা ধরে সাড়া দিচ্ছে না' }) }));
  assert.equal(quiet[0].key, 'sms_phone');
  assert.equal(quiet[0].level, 'bad');
  const failing = H.warnings(base({ sms: phone({ sendLevel: 'bad', failed6h: 3, sent6h: 0 }) }));
  assert.equal(failing[0].key, 'sms_send');
  // SMS switched off: nothing to warn about
  assert.deepEqual(H.warnings(base({ sms: phone({ on: false, phoneLevel: 'bad', sendLevel: 'bad' }) })), []);
});

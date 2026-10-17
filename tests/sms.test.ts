// 📱 SMS rules: when the OTP phone counts as "gone quiet", when failing codes raise the alarm, SMS length,
// and the order-SMS text. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SMS from '../lib/services/sms';

test('the OTP phone: quiet for 1½ hours = warning, 4 hours = alarm, low battery = warning', () => {
  assert.equal(SMS.phoneLevelFor(10, 80, false).level, 'ok');
  assert.equal(SMS.phoneLevelFor(89, 80, false).level, 'ok'); // the app checks in about every 30 minutes
  assert.equal(SMS.phoneLevelFor(91, 80, true).level, 'warn');
  assert.equal(SMS.phoneLevelFor(241, 80, true).level, 'bad');
  assert.equal(SMS.phoneLevelFor(null, null, null).level, 'warn'); // never checked in
  assert.equal(SMS.phoneLevelFor(10, 15, false).level, 'warn');
  assert.equal(SMS.phoneLevelFor(10, 15, true).level, 'ok'); // low but charging
  assert.equal(SMS.phoneLevelFor(10, 80, true, false).level, 'bad'); // switched off in textbee
  assert.match(SMS.phoneLevelFor(300, 80, true).why, /ঘণ্টা/);
});

test('failing codes: 3 failed and none sent in 6 hours = alarm', () => {
  assert.equal(SMS.sendLevelFor(0, 10), 'ok');
  assert.equal(SMS.sendLevelFor(1, 0), 'ok'); // one customer's typo / one hiccup isn't an alarm
  assert.equal(SMS.sendLevelFor(2, 1), 'warn');
  assert.equal(SMS.sendLevelFor(3, 0), 'bad');
  assert.equal(SMS.sendLevelFor(3, 9), 'ok');
});

test('SMS length: Bangla 70 / English 160 characters per part', () => {
  assert.equal(SMS.parts('a'.repeat(160)), 1);
  assert.equal(SMS.parts('a'.repeat(161)), 2);
  assert.equal(SMS.parts('ক'.repeat(70)), 1);
  assert.equal(SMS.parts('ক'.repeat(71)), 2);
  assert.equal(SMS.parts(''), 1);
});

test('order SMS text fills in the order', () => {
  const o = { code: 'SM12AB34', total: 169.5, customer_name: 'রাজন হক', tracking_code: '', points_earned: 0 };
  const t = SMS.fill('{shop}: {name}, অর্ডার {code} মোট {total}। {tracking}', o, { store_name: 'সবমিলবে' } as never, 'https://shobmilbe.com/');
  assert.equal(t, 'সবমিলবে: রাজন, অর্ডার SM12AB34 মোট ৳170। ট্র্যাক করুন: https://shobmilbe.com/order/SM12AB34');
});

test('SMS is "not ready" with a clear reason until it is set up', () => {
  assert.equal(SMS.ready({ sms_on: '0' } as never).ok, false);
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'textbee' } as never).ok, false);
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'textbee', sms_api_key: 'k' } as never).ok, true);
});

// 📱 SMS rules: when the OTP phone counts as "gone quiet", when failing codes raise the alarm, SMS length,
// and the order-SMS text. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SMS from '../lib/services/sms';

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
  // the two ways the shop offers (owner, 2026-11-28): its own phone app, and BulkSMSBD as a spare
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'bulksmsbd' } as never).ok, false);
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'bulksmsbd', sms_api_key: 'k' } as never).ok, false);
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'bulksmsbd', sms_api_key: 'k', sms_sender_id: 's' } as never).ok, true);
  assert.deepEqual(Object.keys(SMS.PROVIDERS).sort(), ['bulksmsbd', 'ownapp']);
  // an old company that is gone (SMS Gate, textbee) counts as the own app — never sends through the old one
  assert.equal(SMS.provider({ sms_provider: 'android' } as never), 'ownapp');
  assert.equal(SMS.provider({ sms_provider: 'textbee' } as never), 'ownapp');
  assert.equal(SMS.ready({ sms_on: '1', sms_provider: 'android', sms_api_key: 'k', sms_sender_id: 's' } as never).ok, false);
});

test('own SMS app: the phone asks every few seconds, so 5 quiet minutes = warning, 30 = alarm', async () => {
  const GW = await import('../lib/services/smsgw');
  assert.equal(GW.levelFor(0.5, 80, false).level, 'ok');
  assert.equal(GW.levelFor(6, 80, true).level, 'warn');
  assert.equal(GW.levelFor(31, 80, true).level, 'bad');
  assert.equal(GW.levelFor(null, null, null).level, 'warn');
  assert.equal(GW.levelFor(1, 15, false).level, 'warn');
  assert.equal(GW.levelFor(1, 15, true).level, 'ok');
});

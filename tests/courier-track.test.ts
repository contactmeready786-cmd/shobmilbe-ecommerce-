// 🛵 পার্সেলের যাত্রা: what a Steadfast webhook push says, and how the steps read for the customer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteadfast, statusText, messageText, courierTime, maskPhones } from '../lib/models/courier-track';

test('Steadfast tracking_update is a journey message with its Dhaka time', () => {
  const ev = parseSteadfast({ notification_type: 'tracking_update', consignment_id: 324643895, invoice: 'SMHZSU4D',
    tracking_message: 'Your parcel has been received at Motijheel hub', updated_at: '2026-11-23 22:26:00' });
  if (!ev) throw new Error('no event');
  assert.equal(ev.kind, 'tracking');
  assert.equal(ev.message, 'Your parcel has been received at Motijheel hub');
  assert.equal(ev.at?.toISOString(), '2026-11-23T16:26:00.000Z');
});

test('delivery_status (and an older push with no type) is a status step', () => {
  assert.equal(parseSteadfast({ notification_type: 'delivery_status', status: 'delivered' })?.kind, 'status');
  assert.equal(parseSteadfast({ consignment_id: 1, invoice: 'X', status: 'cancelled', updated_at: '2026-11-23 10:00:00' })?.status, 'cancelled');
  assert.equal(parseSteadfast({ notification_type: 'payment_request', status: 'paid' }), null);
  assert.equal(parseSteadfast({ notification_type: 'tracking_update' }), null);
});

test('the customer reads the steps in Bangla; unknown words stay as the courier wrote them', () => {
  assert.equal(statusText('delivered'), '✅ ডেলিভারি সম্পন্ন');
  assert.equal(statusText('Partial Delivered'), 'আংশিক ডেলিভারি হয়েছে');
  assert.equal(statusText('unknown'), '');
  assert.equal(statusText('sorting_done'), 'sorting done');
  assert.equal(messageText('Status has been updated as pending'), statusText('pending'));
  assert.equal(messageText('Consignment created by Sender(API).'), statusText('booked'));
  assert.equal(messageText('<b>Reached</b>  Sutrapur hub'), 'Reached Sutrapur hub');
});

test('odd or future times are not trusted', () => {
  assert.equal(courierTime(''), null);
  assert.equal(courierTime('yesterday'), null);
  assert.equal(courierTime('2999-01-01 00:00:00'), null);
});

test('phone numbers in a message are hidden for visitors', () => {
  assert.equal(maskPhones('Rider Karim 01712345678 is on the way'), 'Rider Karim 017•••••678 is on the way');
  assert.equal(maskPhones('+8801912345678'), '019•••••678');
});

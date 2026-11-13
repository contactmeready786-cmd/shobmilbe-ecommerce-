// 📍 "আমার লোকেশন দিয়ে ঠিকানা বসান": only places inside Bangladesh are taken, and OpenStreetMap's answer becomes a
// readable address plus the district as the shop's own list spells it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPoint, readOsm } from '../lib/api/georeverse';

test('only a real place inside Bangladesh is kept', () => {
  assert.deepEqual(cleanPoint('23.780123456', '90.4251', '18.4'), { lat: 23.780123, lng: 90.4251, acc: 18 });
  assert.equal(cleanPoint(51.5, -0.12), null);
  assert.equal(cleanPoint('x', 90), null);
  assert.equal(cleanPoint(23.7, 90.4, -5)!.acc, 0);
});

test('address line and district from the map answer', () => {
  const r = readOsm({ address: { road: 'Post Office Road', suburb: 'Middle Badda', city: 'Dhaka', state_district: 'Dhaka District', state: 'Dhaka Division', country: 'Bangladesh' } });
  assert.equal(r.address, 'Post Office Road, Middle Badda, Dhaka');
  assert.equal(r.district, 'Dhaka');
  assert.deepEqual(readOsm({}), { address: '', district: '' });
});

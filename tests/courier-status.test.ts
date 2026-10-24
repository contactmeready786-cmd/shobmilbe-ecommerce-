// Courier status words → the order's final state (the webhook and the status check must agree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStatus } from '../lib/services/courier';

test('Steadfast: webhook and status-call spellings', () => {
  for (const s of ['delivered', 'Delivered', 'partial_delivered', 'Partial Delivered', 'partial-delivered']) assert.equal(mapStatus('steadfast', s), 'delivered', s);
  for (const s of ['cancelled', 'Cancelled']) assert.equal(mapStatus('steadfast', s), 'returned', s);
  for (const s of ['pending', 'in_review', 'hold', 'Delivered Approval Pending', 'cancelled_approval_pending', 'unknown', '', null]) assert.equal(mapStatus('steadfast', s), null, String(s));
});

test('Pathao and RedX keep their words', () => {
  assert.equal(mapStatus('pathao', 'Partial Delivery'), 'delivered');
  assert.equal(mapStatus('pathao', 'Paid Return'), 'returned');
  assert.equal(mapStatus('pathao', 'Pickup'), null);
  assert.equal(mapStatus('redx', 'delivery-completed'), 'delivered');
  assert.equal(mapStatus('redx', 'returned-to-merchant'), 'returned');
  assert.equal(mapStatus('redx', 'pickup-pending'), null);
});

// ☁️ ব্যাকগ্রাউন্ড সাদা — অনলাইনে: GitHub's computers (any country) must be able to read the waiting list even when the
// shop's country lock is on (owner, 2026-10-24: 11 pictures waited for hours because the list answered {"error":"region"}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PATHS } from '../lib/services/geolock';

test('the cloud worker passes the country lock', () => {
  assert.ok(OPEN_PATHS.test('/api/whiten-jobs'));
  assert.ok(OPEN_PATHS.test('/media/12'));
  assert.ok(!OPEN_PATHS.test('/api/whiten-jobs/x'));
  assert.ok(!OPEN_PATHS.test('/api/products'));
});

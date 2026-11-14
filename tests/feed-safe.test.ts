// 🚫 Google feed (lib/services/feeds.ts safeText): words Google's "Guns and Parts" check reads as weapons never go in
// the feed's title or description (owner, 2026-11-14: a rechargeable torch called "Self Defensive" was refused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeText } from '../lib/services/feeds';

test('weapon-sounding words are left out of the feed text', () => {
  assert.equal(safeText('928 Type Self Defensive Rechargeable LED Flashlight and Torch'), '928 Type Rechargeable LED Flashlight and Torch');
  assert.equal(safeText('928 Type সেলফ ডিফেন্সিভ রিচার্জেবল LED ফ্ল্যাশলাইট'), '928 Type রিচার্জেবল LED ফ্ল্যাশলাইট');
  assert.equal(safeText('a compact USB fast-charging trigger board'), 'a compact USB fast-charging decoy board');
  assert.equal(safeText('Glue Gun 40W'), 'Glue Gun 40W');
});

// oneOf / ifKey (lib/util.ts): an address or form value is used only when it is one of the allowed words, exactly as
// the `list.includes(v) ? v : fallback` / `TABLE[v] ? v : fallback` they replace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneOf, ifKey } from '../lib/util';

test('oneOf: an allowed word is kept, anything else gives the fallback', () => {
  const list = ['day', 'week', 'month'] as const;
  assert.equal(oneOf(list, 'week', 'day'), 'week');
  assert.equal(oneOf(list, 'year', 'day'), 'day');
  assert.equal(oneOf(list, null, 'day'), 'day');
  assert.equal(oneOf(list, undefined, ''), '');
  assert.equal(oneOf(list, 'WEEK', 'day'), 'day'); // exact words only
  assert.equal(oneOf(list, ['week'], 'day'), 'day'); // a repeated field is not a word
});

test('ifKey: a key with a (non-empty) entry is kept, anything else gives the fallback', () => {
  const table: Record<string, string> = { new: 'নতুন', shipped: 'পাঠানো', blank: '' };
  assert.equal(ifKey(table, 'new', ''), 'new');
  assert.equal(ifKey(table, 'lost', ''), '');
  assert.equal(ifKey(table, null, 'all'), 'all');
  assert.equal(ifKey(table, undefined, 'all'), 'all');
  assert.equal(ifKey(table, 'blank', 'all'), 'all'); // an empty entry counts as missing (as `TABLE[v] ? …` did)
  // exactly like `TABLE[v]`: what every object inherits counts too (such a value then only filters to nothing)
  assert.equal(ifKey(table, 'toString', 'all'), 'toString');
});

// 🔀 Products shown in turn (lib/services/rotate.ts, owner 2026-11-15): the home rows mix a bigger pool every half
// hour, in-stock products first, out-of-stock ones only to fill up; one half hour always shows the same mix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, windowKey, rotateOn, ROTATE_MIN } from '../lib/services/rotate';

const pool = Array.from({ length: 96 }, (_, i) => ({ id: i + 1, stock: i % 5 === 0 ? 0 : 3 }));

test('in-stock products only, no repeats, the row size kept', () => {
  const got = mix(pool, 16, 'new', 0);
  assert.equal(got.length, 16);
  assert.equal(new Set(got.map((p) => p.id)).size, 16);
  assert.ok(got.every((p) => p.stock > 0));
});

test('out-of-stock products only fill up, at the end', () => {
  const few = [{ id: 1, stock: 0 }, { id: 2, stock: 4 }, { id: 3, stock: 0 }, { id: 4, stock: 1 }];
  const got = mix(few, 4, 'x', 0);
  assert.deepEqual(got.slice(2).map((p) => p.stock), [0, 0]);
});

test('the same half hour gives the same mix; other half hours bring other products to the front', () => {
  const t = 1_800_000_000_000;
  assert.deepEqual(mix(pool, 16, 'new', t).map((p) => p.id), mix(pool, 16, 'new', t + 60e3).map((p) => p.id));
  assert.equal(windowKey(t), windowKey(t + 60e3));
  const seen = new Set<number>();
  for (let w = 0; w < 12; w++) for (const p of mix(pool, 16, 'new', t + w * ROTATE_MIN * 60e3)) seen.add(p.id);
  assert.ok(seen.size > 40, `only ${seen.size} different products in 6 hours`);
});

test('rows mix differently; the switch is on unless turned off', () => {
  assert.notDeepEqual(mix(pool, 16, 'new', 0).map((p) => p.id), mix(pool, 16, 'offers', 0).map((p) => p.id));
  assert.equal(rotateOn({}), true);
  assert.equal(rotateOn({ ui_rotate: '0' }), false);
});

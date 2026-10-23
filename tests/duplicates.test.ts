// Duplicate guard by name (lib/models/duplicates.ts): model numbers written differently are the same product
// (owner, 2026-10-24: DT9205A was copied in again because "DT-9205A" / "9205A" looked like a different model),
// while a real size / model difference (40W vs 60W) still keeps two products apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, prepName, LEVELS } from '../lib/models/duplicates';

const item = (name: string) => ({ name: prepName(name), images: [], youtube: '' });
const level = (a: string, b: string) => compare(item(a), item(b), LEVELS.normal).level;

test('the same model number written differently is the same product', () => {
  assert.equal(level('DT9205A Digital Multimeter', 'DT-9205A Digital Multimeter'), 'block');
  assert.equal(level('DT 9205A Digital Multimeter', 'Digital Multimeter DT9205A'), 'block');
  assert.equal(level('Digital Multimeter 9205A', 'Digital Multimeter DT-9205A'), 'block');
  assert.equal(level('PAM8403 Amplifier Board', 'PAM-8403 amplifier board'), 'block');
});

test('a different size or model is still a different product', () => {
  assert.equal(level('Soldering Iron 40W', 'Soldering Iron 60W'), null);
  assert.equal(level('DT9205A Digital Multimeter', 'DT830D Digital Multimeter'), null);
  assert.equal(level('১২ ভোল্ট ব্যাটারি', '6V ব্যাটারি'), null);
});

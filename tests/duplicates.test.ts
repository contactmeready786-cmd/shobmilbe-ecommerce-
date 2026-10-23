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

// 🧠 the picture-recognition AI's descriptions (384 bytes each): the same product under another name is caught
const vec = (seed: number, noise = 0, base?: Int8Array) => {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  return Int8Array.from({ length: 384 }, (_, i) => Math.max(-127, Math.min(127, Math.round((base ? base[i] : rnd() * 100) + noise * rnd() * 100))));
};
const pic = (e: Int8Array) => ({ sha: null, h: null, hm: null, e });
const withPic = (name: string, e: Int8Array) => ({ name: prepName(name), images: [pic(e)], youtube: '' });

test('the AI finds the same product photographed differently, even under another name', () => {
  const a = vec(7);
  const sameThing = vec(99, 0.25, a); // the same product, another photo
  const other = vec(12345);
  const r = compare(withPic('ডিজিটাল মিটার', sameThing), withPic('DT9205A Digital Multimeter', a), LEVELS.normal);
  assert.equal(r.level, 'block');
  assert.ok(r.reasons.some((x) => x.includes('AI')));
  assert.equal(compare(withPic('ডিজিটাল মিটার', other), withPic('DT9205A Digital Multimeter', a), LEVELS.normal).level, null);
});

test('look-alike pictures with a different size / model in the name only warn', () => {
  const a = vec(3);
  const r = compare(withPic('Soldering Iron 40W', vec(5, 0.2, a)), withPic('Soldering Iron 60W', a), LEVELS.normal);
  assert.equal(r.level, 'warn');
});

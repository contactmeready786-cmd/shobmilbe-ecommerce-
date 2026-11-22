// 🧩 Merge into variants (owner, 2026-11-22): resistor names are read right — kind, power (the first one written),
// value, pieces in the pack — sets / variable resistors are left alone, and the price per piece never goes below ৳0.50.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, perPiece, ohmLabel, ohmBn, groupNames, groupKey, type Parsed } from '../lib/models/vmerge-parse';

const ok = (name: string): Parsed => {
  const p = parse(name);
  assert.ok(!('reason' in p), `${name}: ${'reason' in p ? p.reason : ''}`);
  return p as Parsed;
};

test('vmerge: Daraz-style resistor names', () => {
  const a = ok('50Pcs- 820K Ohm Resistor 5% 820K Ohm Carbon Film 820K Ohm Resistors 1/4W Resistance 0.25 Watt 5% Tolerance Fixed Resistors 2 Pin Leads');
  assert.deepEqual([a.kind, a.watt, a.ohm, a.pcs, a.tol], ['carbon_film', 0.25, 820000, 50, '5']);
  // "1/2 Watt … 0.25 Watt": the first power written wins
  const b = ok('25Pcs - 1/2 Watt 22 Ohm Resistor 5% 22 Ohm Carbon Film Resistor 1/2W Resistance 0.25 Watt');
  assert.deepEqual([b.kind, b.watt, b.ohm, b.pcs], ['carbon_film', 0.5, 22, 25]);
  assert.equal(groupKey(ok('10Pcs 1W 4.7K Ohm Metal Film Resistor 1%')), 'metal_film|1|');
  assert.equal(ok('20pcs 2W 4K7 Resistor Metal Oxide').ohm, 4700);
  assert.deepEqual([ok('100pcs 0805 SMD Resistor 10K').kind, ok('100pcs 0805 SMD Resistor 10K').pkg], ['smd', '0805']);
  assert.equal(ok('5W 10 Ohm Ceramic Cement Resistor 5W10RJ').kind, 'cement');
  assert.equal(ok('Half Watt 1M Ohm Carbon Film Resistor').watt, 0.5);
});

test('vmerge: not one fixed value → left alone', () => {
  for (const n of ['Resistor- 10Ω, 330Ω, 470Ω, 560Ω, 1kΩ - 100pcs', '10K Ohm Potentiometer Resistor', 'Resistor Kit 1/4W 600pcs', '10 Ohm resistor', 'LED Light 5W']) {
    assert.ok('reason' in parse(n), n);
  }
});

test('vmerge: labels and price per piece', () => {
  assert.equal(ohmLabel(4700), '4.7kΩ');
  assert.equal(ohmLabel(1e6), '1MΩ');
  assert.equal(ohmLabel(22), '22Ω');
  assert.equal(ohmBn(4700), '৪.৭ কিলো ওহম');
  assert.deepEqual(groupNames({ kind: 'carbon_film', watt: 0.25, pkg: '' }), { en: '1/4W Carbon Film Resistor', bn: '১/৪ ওয়াট কার্বন ফিল্ম রেজিস্টর' });
  assert.equal(perPiece(39, 50), 0.78);
  assert.equal(perPiece(39, 25), 1.56); // rounded up, never a loss
  assert.equal(perPiece(10, 50), 0.5); // never below the shop's ৳0.50
  assert.equal(perPiece(12, 1), 12);
  assert.equal(perPiece(500, 20), 25);
});

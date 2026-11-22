// 1️⃣ Packs → single piece (owner, 2026-11-22): the pieces part is read and taken out of the name in the forms the
// copied shops write it; sets and kits stay one item; the Bangla name loses only the same count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPack, cleanBn, cleanText } from '../lib/models/packsingle-parse';

test('packsingle: pieces read and taken out of the name', () => {
  assert.deepEqual(readPack('50Pcs- 100 Ohm Resistor 5% 1/4W'), { pcs: 50, name: '100 Ohm Resistor 5% 1/4W' });
  assert.deepEqual(readPack('10K Ohm Carbon Film Resistor 0.25W – Pack of 20 Pieces'), { pcs: 20, name: '10K Ohm Carbon Film Resistor 0.25W' });
  assert.deepEqual(readPack('5mm Light Dependent Resistor-(LDR)- 10Pcs'), { pcs: 10, name: '5mm Light Dependent Resistor-(LDR)' });
  assert.deepEqual(readPack('LED 5mm Red (10 Pieces)'), { pcs: 10, name: 'LED 5mm Red' });
  assert.deepEqual(readPack('50Pcs- 8mm Bead Diameter WHITE Color 3 Watt COB LED'), { pcs: 50, name: '8mm Bead Diameter WHITE Color 3 Watt COB LED' });
  assert.deepEqual(readPack('50Pcs YELLOW 5mm Plastic LED Holder'), { pcs: 50, name: 'YELLOW 5mm Plastic LED Holder' });
  assert.deepEqual(readPack('10Pcs2Watt 0.33 Ohm Resistor'), { pcs: 10, name: '2Watt 0.33 Ohm Resistor' });
});

test('packsingle: sets, kits and names without a count are left alone', () => {
  for (const n of ['600Pcs Tolerance 1% 30 Values Resistor', 'Screwdriver Set 10pcs', 'Arduino Uno R3', '40pcs Jumper Wire Kit', 'CNC Shield Board V3.0 & 4Pcs A4988 Stepper Motor Driver', 'Precision Cutter Craft Knife With 6 Pieces Blades', '50Watt LED Light Bulbs White SMD LED Light SMD Board 198x34mm 48Pcs 50W', 'AT89C52 89C52 AT89C52-24PI AT89C52-24PU AT89C52-24PC IC DIP-40', 'Lotha Electric Cable Aluminium Core 6pcs Twist 1 Coil', '5mm LED Light 50 Pcs (Mix Color)', '5Pcs Glue Sticks With 60Watt Hot Melt Electric GLUE Gun Machine']) assert.ok('skip' in readPack(n), n);
});

test('packsingle: Bangla name and texts', () => {
  assert.equal(cleanBn('৫০ পিস – তামার রেজিস্টর ২.২ ওহ্ম', 50), 'তামার রেজিস্টর ২.২ ওহ্ম');
  assert.equal(cleanBn('১০ পিস এলইডি', 5), '১০ পিস এলইডি'); // another count: left as it is
  assert.equal(cleanText('Package: 50pcs resistor', 50), 'Package: resistor');
});

// ✍️ Own words (lib/services/ownwords.ts, owner 2026-11-28): other shops' names leave product names; a rewritten
// description goes in by itself only when every fact is kept, nothing is invented and it really is new wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripShopName, factsProblem, copiedShare, numbersIn } from '../lib/services/ownwords';

test('other shops’ names come out of product names, product words stay', () => {
  assert.equal(stripShopName('X-816 Dual Stereo RGB HiFi Wireless Bluetooth Speaker Shopno Sale'), 'X-816 Dual Stereo RGB HiFi Wireless Bluetooth Speaker');
  assert.equal(stripShopName('HOCO HC2 True Wireless Speaker - shopno s'), 'HOCO HC2 True Wireless Speaker');
  assert.equal(stripShopName('LM358 IC (Udvabony BD)'), 'LM358 IC');
  assert.equal(stripShopName('Arduino Uno R3 by creativetrade'), 'Arduino Uno R3');
  assert.equal(stripShopName('Daraz Packaging Poly Courier Bag'), 'Daraz Packaging Poly Courier Bag');
  assert.equal(stripShopName('65mm Robotics Wheels'), '65mm Robotics Wheels');
  // a marketplace's name is a product word (Cart Up / Daraz packaging): it stays, whatever shop it came from
  assert.equal(stripShopName('Cartup Packaging Poly Courier Plastic Bag With Pocket', 'cartup.com#12'), 'Cartup Packaging Poly Courier Plastic Bag With Pocket');
  assert.equal(stripShopName('Packaging Material Daraz/Cartup/non-Brand Box', 'cartup.com.bd#3'), 'Packaging Material Daraz/Cartup/non-Brand Box');
});

const old = { short_description: '5V 1A charging module.', description: 'TP4056 is a 5V 1A lithium charging module. It has 2 LEDs and micro USB input. Size 26 x 17 mm. Package includes 1 x TP4056 module.' };

test('a real rewrite with the same facts is safe', () => {
  const prop = { short_description: 'A TP4056 board for charging one lithium cell at 5V, 1A.',
    description: 'This TP4056 board charges a single lithium cell from a 5V supply at up to 1A. Two LEDs show the state (2 in total), and power comes in through a micro USB port. It measures 26 x 17 mm, and you get 1 x TP4056 module in the box.' };
  assert.deepEqual(factsProblem('TP4056 Module', old, prop), []);
});

test('invented numbers, lost facts, light edits and shop names are caught', () => {
  const invented = factsProblem('TP4056 Module', old, { short_description: 'Charges a lithium cell at 5V, 1A.', description: 'The TP4056 board charges one lithium cell from 5V at 1A with 2 LEDs and a micro USB port, 26 x 17 mm, 1 x TP4056 module included, rated 4.2V and 1000 cycles.' });
  assert.ok(invented.some((w) => /new numbers/.test(w)), invented.join());
  const light = factsProblem('TP4056 Module', old, { short_description: '5V 1A charging module for lithium.', description: old.description + ' Very useful.' });
  assert.ok(light.some((w) => /old wording/.test(w)), light.join());
  const shop = factsProblem('TP4056 Module', old, { short_description: 'From Shopno Sale: charges at 5V 1A.', description: 'Shopno Sale brings the TP4056 board: one lithium cell from 5V at 1A, 2 LEDs, micro USB, 26 x 17 mm, 1 x TP4056 module.' });
  assert.ok(shop.includes('a shop name'), shop.join());
});

test('numbers read the same in Bangla and English digits', () => {
  assert.deepEqual(numbersIn('৫ ভোল্ট, 3.3V, ১০০০mAh'), ['5', '3.3', '1000']);
  assert.equal(copiedShare('a b c d e f g', 'a b c d e f g'), 1);
});

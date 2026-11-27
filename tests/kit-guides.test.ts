// 🧰 Ready-made guides → kits (owner, 2026-11-27): the traffic light kit picked an RS485 module "For Arduino Uno" as the
// Arduino and a 600-piece resistor combo. A part's product must really be that part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestFor } from '../lib/data/guides';

const row = (name: string, stock = 10) => ({ name, stock });

test('an accessory "for" the part is never the part', () => {
  const rows = [row('Serial Port RS485 To TTL Module Based On MAX485 IC For Arduino Uno Electronics Project', 100), row('Arduino Uno R3 (DIP) Development board', 10)];
  assert.equal(bestFor({ find: ['arduino uno'] }, rows)?.name, 'Arduino Uno R3 (DIP) Development board');
  assert.equal(bestFor({ find: ['arduino uno'] }, [rows[0]]), null);
});

test('single pieces before packs and combos, "not" words leave a product out', () => {
  const rows = [row('600Pcs combo 30 Values Resistor Carbon Film Resistor 1/4W', 100), row('1/4W Carbon Film Resistor — 220Ω', 500)];
  assert.equal(bestFor({ find: ['resistor'] }, rows)?.name, '1/4W Carbon Film Resistor — 220Ω');
  const bb = [row('140pcs U Shape Breadboard Jumper Wire Cable Kit', 100), row('400 Points Solderless Mini Breadboard', 0)];
  assert.equal(bestFor({ find: ['breadboard'], not: ['jumper', 'wire'] }, bb)?.name, '400 Points Solderless Mini Breadboard');
});

test('in stock first, then the earlier word of the list', () => {
  const rows = [row('Mini Speaker 8 ohm', 5), row('Speaker 3W 4 ohm', 0)];
  assert.equal(bestFor({ find: ['speaker 3w', 'mini speaker'] }, rows)?.name, 'Mini Speaker 8 ohm');
  assert.equal(bestFor({ find: ['speaker 3w', 'mini speaker'] }, [row('Mini Speaker 8 ohm'), row('Speaker 3W 4 ohm')])?.name, 'Speaker 3W 4 ohm');
});

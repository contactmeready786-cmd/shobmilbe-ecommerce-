// 🏷️ AI product names (lib/data/titlecheck.ts): a new name is only put in by itself when it is still the same product.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partCodes, checkTitle, checkBangla } from '../lib/data/titlecheck';

test('part codes: models stay, sizes do not count', () => {
  assert.deepEqual(partCodes('BC327 BC-327 BC 327 PNP Transistor 45V 800mA TO-92'), ['BC327', 'TO92']);
  assert.deepEqual(partCodes('N20 200RPM GEAR MOTOR DC 3V 6V 12V'), ['N20']);
  assert.ok(partCodes('2 TANK 18650 Battery Holder').includes('18650'));
  assert.deepEqual(partCodes('25mm Black Heat Shrink Tube Φ25mm 1 Gauge'), []);
});

test('a clean rewrite of the same product passes', () => {
  assert.equal(checkTitle('N20 200RPM GEAR MOTOR 200RPM DC 3V 6V 12V N20 Mini Micro Metal Gear Motor High Torque', 'N20 Micro Metal Gear Motor 200RPM (3V–12V DC)').ok, true);
  assert.equal(checkTitle('BC327 BC-327 BC 327 PNP Transistor 45V 800mA BJT PNP TO-92 Package General Purpose', 'BC327 PNP General Purpose Transistor 45V 800mA TO-92').ok, true);
  assert.equal(checkTitle('LM339N LM339 LM 339 Low Power Low Off-set Voltage Qu-ad Com-parator IC DIP 14 Pin', 'LM339N Quad Low-Power Voltage Comparator IC, DIP-14').ok, true);
});

test('a lost model, an invented number or another product is stopped', () => {
  assert.equal(checkTitle('BTA16-600B 16A 600V TRIAC', '16A 600V TRIAC Thyristor').ok, false); // model lost
  assert.equal(checkTitle('N20 Gear Motor 200RPM', 'N20 Gear Motor 300RPM').ok, false); // number changed
  assert.equal(checkTitle('LM324 Quad Op-Amp IC', 'LM358 Dual Op-Amp IC LM324').ok, false); // new code
  assert.equal(checkTitle('A Class CD4049BE Hex Buffer IC', 'A Class CD4049BE Hex Buffer IC Best Quality').ok, false); // filler
  assert.equal(checkTitle('CD4028BE BCD To Decimal Dec-oders IC', 'CD4028BE BCD To Decimal Dec-oders IC').ok, false); // broken word left
  assert.equal(checkTitle('NE555 Timer IC', 'NE555').ok, false); // too short
});

test('allowed hyphens are not broken words', () => {
  assert.equal(checkTitle('2S BMS Module 8A Li-ion Battery Protection Board', '2S 8A Li-ion Battery Protection BMS Board').ok, true);
});

test('Bangla name: only Bangla, digits made Bangla', () => {
  assert.equal(checkBangla('এন20 মাইক্রো মেটাল গিয়ার মোটর'), 'এন২০ মাইক্রো মেটাল গিয়ার মোটর');
  assert.equal(checkBangla('BC327 ট্রানজিস্টর'), null);
  assert.equal(checkBangla(''), null);
});

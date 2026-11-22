// 🧩 Merge into variants — families (owner, 2026-11-22): capacitors, LEDs, zener diodes and trimmers are read like the
// resistors: the same part (kind, voltage, size …) is one group, the value is what the customer picks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, type Item } from '../lib/models/vfamilies';

const ok = (n: string): Item => { const r = read(n); assert.ok(!('reason' in r), n); return r as Item; };

test('vfamilies: capacitors (codes, units, the "224pF" mistake)', () => {
  assert.deepEqual([ok('Ceramic Capacitor 104 100nF 50V Disc').key, ok('Ceramic Capacitor 104 100nF 50V Disc').label], ['cap-ceramic|50', '100nF']);
  assert.equal(ok('Ceramic Capacitor 223 50V Disc Capacitor High Quality').label, '22nF');
  assert.equal(ok('Ceramic Capacitor 224pF 100V Disc Capacitor').label, '220nF');
  assert.equal(ok('Ceramic Capacitor 121 120pF 50V Disc Capacitor').label, '120pF');
  assert.deepEqual([ok('Radial 0.47uF Electrolytic Capacitor 50V').key, ok('Radial 0.47uF Electrolytic Capacitor 50V').label], ['cap-elec|50', '0.47µF']);
  assert.notEqual(ok('47uF 25V Electrolytic Capacitor').key, ok('47uF 50V Electrolytic Capacitor').key);
});

test('vfamilies: LEDs by colour, zener by voltage, trimmers by value', () => {
  const a = ok('Water Clear LED Green 5mm Ultra Bright'); const b = ok('Water Clear LED 5mm Blue LED Light Bulbs Transparent RED LED 5mm');
  assert.equal(a.key, b.key); assert.deepEqual([a.label, b.label], ['সবুজ', 'নীল']);
  assert.notEqual(ok('3mm Colorful RED LED 3mm Round LED').key, a.key);
  assert.notEqual(ok('YELLOW 5mm Plastic LED Holder').key, a.key);
  assert.ok('reason' in read('50Watt LED Light 198x34mm SMD LED Board'));
  assert.deepEqual([ok('Zener Diode 7.5V 500mW').key, ok('Zener Diode 7.5V 500mW').label], ['zener|500', '7.5V']);
  assert.equal(ok('1/2 Watt 24V Zener Diode 0.5W 1/2W 24V 1N4116').key, 'zener|500');
  assert.equal(ok('1Watt 6.8V Zener Diodes 1W 6.8V 1N4736').key, 'zener|1000');
  assert.equal(ok('RM065 RM-065 VR 22K Ohm 223 Potentiometer Trimmer Trim Pot').label, '22kΩ');
  assert.equal(ok('RM065 RM-065 VR 500K 504 Potentiometer 500K Trimpot').label, '500kΩ');
  assert.equal(ok('Trimmer Trim Pot RM065 101 100 ohm Variable Resistor').label, '100Ω');
  assert.equal(ok('3296 203 Square Cermet 20K Ohm 1/2W Vertical Potentiometer 25 Turn').key, 'pot|3296');
});

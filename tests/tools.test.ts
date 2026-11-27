// 🧮 Electronics tools (owner, 2026-11-27): the colour code, SMD and capacitor codes and standard values are right —
// students and technicians rely on these numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandsValue, valueBands, parseOhms, smdValue, capValue, e12Around, fmtOhms, fmtCap, parseCap, num, E96 } from '../client/shop/toolmath';
import { tools, tool, toolsOn, TRANSISTORS } from '../lib/data/tools';

test('colour bands → value (4, 5, 6 bands)', () => {
  assert.deepEqual(bandsValue(['yellow', 'violet', 'red', 'gold']), { ohms: 4700, tol: 5, ppm: null });
  assert.equal(bandsValue(['red', 'red', 'brown', 'gold'])?.ohms, 220);
  assert.equal(bandsValue(['brown', 'black', 'black', 'red', 'brown'])?.ohms, 10000);
  assert.equal(bandsValue(['brown', 'black', 'black', 'red', 'brown'])?.tol, 1);
  assert.equal(bandsValue(['yellow', 'violet', 'black', 'silver', 'brown', 'red'])?.ohms, 4.7);
  assert.equal(bandsValue(['yellow', 'violet', 'black', 'silver', 'brown', 'red'])?.ppm, 50);
  assert.equal(bandsValue(['black', 'violet', 'red', 'gold']), null, 'first band is never black');
  assert.equal(bandsValue(['gold', 'violet', 'red', 'gold']), null);
  assert.deepEqual(bandsValue(['brown', 'black', 'red']), { ohms: 1000, tol: 20, ppm: null }, '3 bands: ±20%');
  assert.deepEqual(bandsValue(['black']), { ohms: 0, tol: null, ppm: null }, 'single black band: 0Ω jumper');
  assert.equal(bandsValue(['red']), null);
  assert.equal(bandsValue(['red', 'red']), null, 'no 2-band resistors');
  assert.equal(bandsValue(['yellow', 'violet', 'red', 'white']), null, 'white is no tolerance');
  assert.equal(bandsValue(['brown', 'black', 'pink', 'gold'])?.ohms, 0.01);
  assert.equal(bandsValue(['brown', 'black', 'black', 'red', 'grey'])?.tol, 0.01);
});

test('value → colour bands, both ways round', () => {
  assert.deepEqual(valueBands(4700, 4), ['yellow', 'violet', 'red']);
  assert.deepEqual(valueBands(220, 4), ['red', 'red', 'brown']);
  assert.deepEqual(valueBands(10000, 5), ['brown', 'black', 'black', 'red']);
  assert.deepEqual(valueBands(0.47, 4), ['yellow', 'violet', 'silver']);
  assert.deepEqual(valueBands(10, 4), ['brown', 'black', 'black']);
  for (const v of [1, 2.2, 47, 330, 1000, 6800, 1e6]) assert.equal(bandsValue([...valueBands(v, 4)!, 'gold'])?.ohms, v);
});

test('typed resistances', () => {
  assert.equal(parseOhms('4.7k'), 4700);
  assert.equal(parseOhms('4k7'), 4700);
  assert.equal(parseOhms('220R'), 220);
  assert.equal(parseOhms('১০০'), 100);
  assert.equal(parseOhms('1M'), 1e6);
  assert.equal(parseOhms('2.2 kΩ'), 2200);
  assert.ok(Number.isNaN(parseOhms('abc')));
});

test('SMD and capacitor codes', () => {
  assert.equal(smdValue('103')?.ohms, 10000);
  assert.equal(smdValue('4R7')?.ohms, 4.7);
  assert.equal(smdValue('1002')?.ohms, 10000);
  assert.equal(smdValue('01C')?.ohms, 10000);
  assert.equal(smdValue('68X')?.ohms, 49.9);
  assert.equal(smdValue('000')?.ohms, 0);
  assert.equal(smdValue('ZZZ'), null);
  assert.equal(E96.length, 96);
  assert.equal(capValue('104')?.pf, 100000);
  assert.equal(capValue('473J')?.pf, 47000);
  assert.equal(capValue('473J')?.tol, '±৫%');
  assert.equal(capValue('2A104K')?.pf, 100000);
  assert.equal(capValue('22')?.pf, 22);
  assert.equal(fmtCap(100000), '100nF');
  assert.equal(fmtCap(2200000), '2.2µF');
  assert.equal(fmtOhms(4700), '4.7kΩ');
  assert.equal(parseCap('100n'), 100000);
  assert.equal(parseCap('0.1uF'), 100000);
  assert.equal(parseCap('22p'), 22);
  assert.equal(parseCap('10'), 10e6);
  assert.equal(num('৪.৫'), 4.5);
});

test('standard values around a sum', () => {
  assert.deepEqual(e12Around(150), { up: 150, down: 150 });
  assert.deepEqual(e12Around(500), { up: 560, down: 470 });
  assert.deepEqual(e12Around(5), { up: 5.6, down: 4.7 });
});

test('every tool is complete and can be switched off', () => {
  const keys = new Set<string>();
  for (const t of tools()) {
    assert.match(t.key, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!keys.has(t.key)); keys.add(t.key);
    assert.ok(t.summary.length > 40 && t.summary.length <= 160, `${t.key} ${t.summary.length}`);
    assert.ok(t.guide.length && t.title);
  }
  assert.equal(tool('ohms-law')?.key, 'ohms-law');
  assert.equal(toolsOn({ tools_on: '0' }).length, 0);
  assert.equal(toolsOn({ tools_off: 'ohms-law, 555-timer' }).length, tools().length - 2);
  for (const t of TRANSISTORS) assert.ok(t.pins.split(' ').length >= 3, t.name);
});

// 📱 App users: the customer app is told apart from browsers, and a phone gets one stable id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApp, deviceId, installOf } from '../lib/services/appdevices';
import { parseUA } from '../lib/services/visitors';

const APP = 'Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 ShobmilbeApp/1.5';
const CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

test('app, mobile browser and laptop are counted apart', () => {
  assert.equal(isApp(APP), true);
  assert.equal(isApp(CHROME), false);
  assert.equal(parseUA(APP).device, 'app');
  assert.equal(parseUA(APP).browser, 'Shobmilbe app');
  assert.equal(parseUA(CHROME).device, 'mobile');
  assert.equal(parseUA(LAPTOP).device, 'desktop');
});

test('a phone id: the install number first, else the visitor id; junk never becomes an id', () => {
  const inst = '3f1c2b9e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
  assert.equal(deviceId(inst, 'abcdefgh123'), 'i:' + inst);
  assert.equal(deviceId('', 'abcdefgh123'), 'v:abcdefgh123');
  assert.equal(deviceId('short', ''), '');
  assert.equal(deviceId("x'; DROP TABLE--", 'a b'), '');
  assert.equal(installOf({ headers: { cookie: `sm_orders=x; sm_app=${inst}` } }), inst);
  assert.equal(installOf({ headers: { cookie: 'sm_app=<script>' } }), '');
  assert.equal(installOf({ headers: {} }), '');
});

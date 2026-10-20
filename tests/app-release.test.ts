// 📱 The Android app offered for download (/app): the page, the browser's invite card and the app's own version agree,
// the signed file is really there, and versions compare the way people read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { APP_RELEASE, appVersionOf, olderVersion } from '../lib/app-release';
import * as client from '../client/app-release';

test('app download: one version everywhere, and the file exists', () => {
  const gradle = readFileSync('android/gradle.properties', 'utf8');
  const built = /^appVersionName=(.+)$/m.exec(gradle)?.[1].trim();
  assert.equal(APP_RELEASE.version, built, 'lib/app-release.ts = android/gradle.properties appVersionName');
  assert.equal(client.APP_VERSION, APP_RELEASE.version, 'client/app-release.ts = lib/app-release.ts');
  assert.ok(APP_RELEASE.file.includes(APP_RELEASE.version), 'a new version gets a new file name');
  const f = 'public' + APP_RELEASE.file;
  assert.ok(existsSync(f), f);
  assert.ok(statSync(f).size > 500_000, 'a real app file');
  // signed (an unsigned app does not install): the signing block sits before the end of the zip
  assert.ok(readFileSync(f).includes(Buffer.from('APK Sig Block 42')), 'signed');
});

test('app download: versions read from the app and compared', () => {
  assert.equal(appVersionOf('Mozilla/5.0 (Linux; Android 14) wv ShobmilbeApp/1.4'), '1.4');
  assert.equal(appVersionOf('Mozilla/5.0 Chrome'), '');
  for (const f of [olderVersion, client.olderVersion]) {
    assert.equal(f('1.3', '1.4'), true);
    assert.equal(f('1.4', '1.4'), false);
    assert.equal(f('1.9', '1.10'), true);
    assert.equal(f('2.0', '1.10'), false);
    assert.equal(f('1.4', '1.4.1'), true);
  }
});

test('app download: who sees the "get the app" card', () => {
  const k = client.inviteKind;
  const phone = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
  const desktopMode = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  assert.equal(k(phone, 5), 'android');
  assert.equal(k(desktopMode, 5), 'android', "an Android phone in Chrome's desktop-site mode");
  assert.equal(k(desktopMode, 0), 'computer', 'a Linux computer');
  assert.equal(k('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 0), 'computer');
  assert.equal(k('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 10), 'computer', 'touch-screen laptop');
  assert.equal(k('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari', 5), null, 'no iPhone app');
  assert.equal(k('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5), null, 'an iPad says Macintosh');
  assert.equal(k('Mozilla/5.0 (Linux; Android 14) wv ShobmilbeApp/' + client.APP_VERSION, 5), null, 'already on the newest app');
  assert.equal(k('Mozilla/5.0 (Linux; Android 14) wv ShobmilbeApp/1.0', 5), 'update');
});

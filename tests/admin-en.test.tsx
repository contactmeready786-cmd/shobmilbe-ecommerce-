// 🇬🇧 The admin is made in English on the server (lib/next/admin-en.ts): words from the dictionary change,
// data marked translate="no" and the code's own attributes don't.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRenderer } from '../lib/react/render';
import { renderHtml } from '../lib/react/html';
import { adminEnglish, adminEnglishHtml, titleEn, tr } from '../lib/next/admin-en';

before(loadRenderer);

test('a known phrase becomes English, digits become 0-9', () => {
  assert.equal(tr('সেটিংস'), 'Settings');
  assert.equal(tr('৳১২৩'), '৳123');
  assert.equal(tr('Already English'), 'Already English');
});

test('page titles: plural, no emoji in front', () => {
  assert.equal(titleEn('কাস্টমার'), 'Customers');
  assert.equal(titleEn('🔑 নিরাপত্তা'), 'Security');
});

test('HTML text: words and hints change, data and code attributes stay', () => {
  const out = adminEnglishHtml('<body class="admin"><h2>সেটিংস</h2><input placeholder="সেটিংস"><span translate="no">সেটিংস</span><div data-side-group="সেটিংস">x</div><script>var a="সেটিংস"</script></body>');
  assert.match(out, /<h2>Settings<\/h2>/);
  assert.match(out, /placeholder="Settings"/);
  assert.match(out, /<span translate="no">সেটিংস<\/span>/);
  assert.match(out, /data-side-group="সেটিংস"/);
  assert.match(out, /var a="সেটিংস"/);
});

test('React tree: components are drawn and translated, translate="no" kept', async () => {
  const Box = ({ label }: { label: string }) => <section><h2>{label}</h2><p translate="no">সেটিংস</p></section>;
  const html = renderHtml(await adminEnglish(<div title="সেটিংস"><Box label="সেটিংস" /></div>));
  assert.match(html, /title="Settings"/);
  assert.match(html, /<h2>Settings<\/h2>/);
  assert.match(html, /<p translate="no">সেটিংস<\/p>/);
});

test('the owner\'s own words come from the shop\'s English version (lead and count kept)', async () => {
  const lookup = async (pairs: [string, string][]) => new Map(pairs.filter(([, o]) => o.includes('সেন্সরঝ')).map(([shown, o]) => [shown, o.replace('সেন্সরঝ', 'Sensorx')]));
  const html = renderHtml(await adminEnglish(<select><option>└ সেন্সরঝ</option></select>, undefined, lookup));
  assert.match(html, /└ Sensorx/);
});

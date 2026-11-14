// 📝 Descriptions copied from other shops (lib/views/md.ts, owner, 2026-11-14): a list mark on its own line with empty
// lines around it is one list point again, so the short description no longer takes a huge space.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../lib/views/md';

test('"-" on its own line + empty lines = one compact list', () => {
  const html = render('-\n\n**Number of Modules:** 37 sensors\n\n-\n\n**Compatibility:** Arduino, ESP32\n\n-\n\n**Power Supply:** 3.3V–5V');
  assert.equal(html, '<ul>\n<li><strong>Number of Modules:</strong> 37 sensors</li>\n<li><strong>Compatibility:</strong> Arduino, ESP32</li>\n<li><strong>Power Supply:</strong> 3.3V–5V</li>\n</ul>');
});

test('normal text and lists are unchanged', () => {
  assert.equal(render('## Title\n\n- a\n- b\n\nText'), '<h2>Title</h2>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p>Text</p>');
  assert.equal(render('- a\n\nPara'), '<ul>\n<li>a</li>\n</ul>\n<p>Para</p>');
});

test('a "//other-site" link is an outside link, not one of the shop\'s own pages', () => {
  const html = render('[x](//evil.example/page) [y](/p/abc)');
  assert.ok(html.includes('href="//evil.example/page" rel="noopener nofollow" target="_blank"'), html);
  assert.ok(html.includes('href="/p/abc">y</a>'), html);
});

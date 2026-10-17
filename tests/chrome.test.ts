// ⚛️ The shop's page frame (header, menus, footer, chat buttons, head tags) is React now (components/shop/chrome).
// It must draw the same page as the old frame did — tests/golden/chrome-*.html, recorded from the old code.
// "The same" is as a browser sees it (tools/parity/normalise.mjs: head tags as a set, spelling differences ignored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalise } from '../tools/parity/normalise.mjs';
import { shopLayout } from '../lib/views/layout';
import { variants } from './fixtures/chrome';

for (const [name, props] of variants) {
  test(`page frame unchanged: ${name}`, () => {
    // the style/script version number changes on purpose with each update
    const clean = (h: string) => normalise(h).replace(/\?v=[\w.«»-]+/g, '?v=');
    const want = clean(fs.readFileSync(`tests/golden/chrome-${name}.html`, 'utf8'));
    const got = clean(String(shopLayout(props)));
    if (want !== got) {
      let i = 0; while (want[i] === got[i]) i++;
      assert.fail(`differs at ${i}:\n  before: ${want.slice(Math.max(0, i - 100), i + 120)}\n  now:    ${got.slice(Math.max(0, i - 100), i + 120)}`);
    }
  });
}

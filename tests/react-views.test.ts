// ⚛️ Pages moved to React must look exactly like before. tests/golden/*.html is what the old html`…` code made for
// the samples in tests/fixtures/cases.ts (recorded just before each move); the React version must make the same page.
// "The same" = identical for a browser (tools/parity/normalise.mjs → canonicalHtml ignores only spelling such as
// &#x27; vs &#39;, attribute order and source indentation). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalHtml } from '../tools/parity/normalise.mjs';
import { CASES, type Views } from './fixtures/cases';
import * as shop from '../lib/views/shop';
import * as complaint from '../lib/views/complaint';

const views: Views = { shop, complaint };

for (const [name, make] of CASES) {
  test(`same page as before: ${name}`, () => {
    const file = `tests/golden/${name}.html`;
    assert.ok(fs.existsSync(file), `no golden file for ${name} — run tools/make-golden.ts before moving the page`);
    const want = canonicalHtml(fs.readFileSync(file, 'utf8'));
    const got = canonicalHtml(String(make(views)));
    if (want !== got) {
      let i = 0; while (i < want.length && want[i] === got[i]) i++;
      assert.fail(`${name} differs at ${i}:\n  before: ${want.slice(Math.max(0, i - 80), i + 100)}\n  now:    ${got.slice(Math.max(0, i - 80), i + 100)}`);
    }
  });
}

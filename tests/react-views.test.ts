// ⚛️ Pages moved to React must look exactly like before. tests/golden/*.html is what the old html`…` code made for
// the samples in tests/fixtures/cases.ts (recorded just before each move); the React version must make the same page.
// "The same" = identical for a browser (tools/parity/normalise → canonicalHtml ignores only spelling such as
// &#x27; vs &#39;, attribute order and source indentation). Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalHtml } from '../tools/parity/normalise';
import { CASES, type Views } from './fixtures/cases';
import * as shop from '../lib/views/shop';
import * as complaint from '../lib/views/complaint';
import * as account from '../lib/views/account';
import { isValidElement } from 'react';
import { renderHtml, loadRenderer } from '../lib/react/render';

before(loadRenderer); // the original router's text renderer (lib/react/render.tsx)

const views: Views = { shop, complaint, account };

for (const [name, make] of CASES) {
  test(`same page as before: ${name}`, () => {
    const file = `tests/golden/${name}.html`;
    assert.ok(fs.existsSync(file), `no golden file for ${name} (tests/golden holds each page as it was before it moved to React)`);
    const want = canonicalHtml(fs.readFileSync(file, 'utf8'));
    const made = make(views);
    const got = canonicalHtml(isValidElement(made) ? renderHtml(made) : String(made));
    if (want !== got) {
      let i = 0; while (i < want.length && want[i] === got[i]) i++;
      assert.fail(`${name} differs at ${i}:\n  before: ${want.slice(Math.max(0, i - 80), i + 100)}\n  now:    ${got.slice(Math.max(0, i - 80), i + 100)}`);
    }
  });
}

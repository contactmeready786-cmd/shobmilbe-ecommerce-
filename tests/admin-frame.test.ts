// ⚛️ The admin page frame (menu, top bar, head tags) is React components now (lib/admin/layout.tsx: AdminHead,
// AdminBody, AdminBare — the same ones the Next.js admin pages use). It must draw the same page as the old frame did:
// tests/golden/admin-frame-*.html, recorded from the old code (tools/make-golden-admin-frame.ts).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalise } from '../tools/parity/normalise';
import { adminLayout } from '../lib/admin/layout';
import { frames } from './fixtures/admin-frame';
import { loadRenderer } from '../lib/react/render';

before(loadRenderer); // the original router's text renderer (lib/react/render.tsx)

for (const [name, props] of frames) {
  test(`admin frame unchanged: ${name}`, () => {
    const clean = (h: string) => normalise(h).replace(/\?v=[\w.«»-]+/g, '?v=').replace(/data-v="[^"]*"/g, 'data-v=""');
    const want = clean(fs.readFileSync(`tests/golden/admin-frame-${name}.html`, 'utf8'));
    const got = clean(String(adminLayout(props)));
    if (want !== got) {
      let i = 0; while (want[i] === got[i]) i++;
      assert.fail(`differs at ${i}:\n  before: ${want.slice(Math.max(0, i - 100), i + 120)}\n  now:    ${got.slice(Math.max(0, i - 100), i + 120)}`);
    }
  });
}

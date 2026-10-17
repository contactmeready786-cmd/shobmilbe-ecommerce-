// 🛡️ The admin's script rule (lib/security.ts → adminCsp): only <script> tags our own templates write may run.
// This check reads every admin template and fails when someone adds
//   • an inline <script> without nonce="${cspNonce()}"  (the browser would silently block it → a dead button)
//   • an inline handler such as onclick="…"             (blocked too — use data-print / data-autosubmit / data-back)
//   • a "javascript:" link
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd(); // npm test runs from the project folder
// the admin templates, plus the page-maker they use
const FILES = [
  ...readdirSync(join(ROOT, 'lib/admin')).filter((f) => /\.tsx?$/.test(f)).map((f) => join('lib/admin', f)),
];
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
// text that is shown as an example to the owner (inside a placeholder), not markup
const EXAMPLE = /placeholder:\s*'<script>…<\/script>'/g;

test('every inline admin <script> carries the page nonce', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    const src = read(f).replace(EXAMPLE, '');
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/<script\b((?:[^>{]|\{[^}]*\})*)>/gi)) {
        const attrs = m[1];
        if (/\bsrc=/.test(attrs) || /type=["']?application\/(ld\+)?json/.test(attrs)) continue; // files from /js/ are allowed by 'self'
        if (!/nonce="\$\{cspNonce\(\)\}"|nonce=\{(attrValue\()?cspNonce\(\)\)?\}/.test(attrs)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(bad, [], 'add nonce="${cspNonce()}" to these <script> tags');
});

test('no inline event handlers or javascript: links in admin pages', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    read(f).split('\n').forEach((line, i) => {
      if (/<[a-z][^>]*\son[a-z]+\s*=\s*["'{]/i.test(line) || /\bon(click|change|input|submit|load|error|focus|blur|keyup|keydown):\s*['"`]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      if (/href=["']\s*javascript:/i.test(line)) bad.push(`${f}:${i + 1}: javascript: link`);
    });
  }
  assert.deepEqual(bad, [], 'use data-print / data-autosubmit / data-back (public/js/page-actions.js) instead');
});

test('the admin scripts the pages load also avoid inline handlers', () => {
  for (const f of ['public/js/admin.js', 'public/js/page-actions.js']) {
    const src = read(f);
    assert.ok(!/\son(click|change|input|submit|load|error)\s*=\s*\\?["']/i.test(src), `${f} writes an inline handler into the page`);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), `${f} uses eval`);
  }
});

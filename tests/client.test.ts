// The browser code is TypeScript in client/ (compiled to public/js by `npm run build:client`).
// These checks keep it that way: no hand-written JavaScript files, no HTML built from strings, no `var`,
// every page loads the compiled modules, and the geo list stays the same as the server's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const f = `${dir}/${name}`;
    if (statSync(join(ROOT, f)).isDirectory()) out.push(...walk(f, keep));
    else if (keep(f)) out.push(f);
  }
  return out;
}
const CLIENT = walk('client', (f) => /\.tsx?$/.test(f));

test('no hand-written JavaScript is kept in git: the browser code is client/*.ts', () => {
  let tracked: string[] = [];
  try { tracked = execFileSync('git', ['ls-files', 'public', 'lib', 'components', 'app'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return; } // not a git checkout
  const js = tracked.filter((f) => /\.(js|mjs|cjs)$/.test(f));
  assert.deepEqual(js, [], 'write it in client/ as TypeScript (public/js is made by npm run build:client)');
});

test('the browser code builds pages with JSX, never with HTML strings', () => {
  const bad: string[] = [];
  for (const f of CLIENT) {
    read(f).split('\n').forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      if (/\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML\(/.test(line) && f !== 'client/jsx.ts') bad.push(`${at}: HTML from a string (use JSX and paint())`);
      if (/^\s*var\s/.test(line) || /[;{(]\s*var\s/.test(line)) bad.push(`${at}: var (use const / let)`);
      if (/\bdocument\.write\(|\beval\(|new Function\(/.test(line)) bad.push(`${at}: eval / document.write`);
    });
  }
  assert.deepEqual(bad, []);
});

test('pages load the compiled modules (type="module"), never the old script files', () => {
  const bad: string[] = [];
  const files = [...walk('lib', (f) => /\.tsx?$/.test(f)), ...walk('components', (f) => /\.tsx?$/.test(f)), ...walk('app', (f) => /\.tsx?$/.test(f))];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/<script\b[^>]*\bsrc=[{"'`][^>]*>/g)) {
        if (!/type="module"/.test(m[0]) && /\/js\//.test(m[0])) bad.push(`${f}:${i + 1}: ${m[0].slice(0, 90)}`);
        if (/\/js\/(shop|admin|i18n|page-actions|scan|pos|stockscan|loginlock|push|admin-i18n|bd-geo)\.js/.test(m[0])) bad.push(`${f}:${i + 1}: old script file ${m[0].slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('the district / thana list in the browser is the same as the server\'s', () => {
  const server = JSON.parse(read('lib/data/bd-geo.json'));
  const src = read('client/geo-data.ts');
  const browser = JSON.parse(src.slice(src.indexOf('= {') + 2, src.lastIndexOf('}') + 1));
  assert.deepEqual(browser, server, 'copy lib/data/bd-geo.json into client/geo-data.ts');
});

test('the boot scripts written into the page are valid modern JavaScript', async () => {
  const boot = await import('../lib/boot-scripts');
  for (const code of [boot.shopLangBoot('bn'), boot.shopLangBoot('en'), boot.adminLangBoot, boot.adminSideBoot, boot.tawkLoader('abc/1', 'default')]) {
    assert.doesNotThrow(() => new Function(code), code.slice(0, 60));
    assert.ok(!/\bvar\s/.test(code), `no var: ${code.slice(0, 60)}`);
  }
});

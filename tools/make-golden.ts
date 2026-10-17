// While moving pages to React: records what the OLD html`…` code makes for each sample in tests/fixtures/cases.ts
// into tests/golden/<name>.html — only for names that have no golden file yet, so recorded pages never change.
// Before moving a view, copy it to lib/views/__old_<file>.ts (git-ignored), add its cases, run:
//   npx tsx tools/make-golden.ts
import fs from 'node:fs';
import { CASES, type Views } from '../tests/fixtures/cases';

function load(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a one-off tool: the old copy may or may not exist
  try { return require(`../lib/views/__old_${name}`); } catch { return require(`../lib/views/${name}`); }
}
const v: Views = { shop: load('shop'), complaint: load('complaint'), account: load('account') };
fs.mkdirSync('tests/golden', { recursive: true });
let n = 0;
for (const [name, make] of CASES) {
  const f = `tests/golden/${name}.html`;
  if (fs.existsSync(f)) continue;
  fs.writeFileSync(f, String(make(v)));
  n++;
}
console.log(`new golden files: ${n}`);

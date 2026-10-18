// After `npm test`: every test written in tests/*.test.ts(x) with a fixed name must appear in the run's output as run
// ("ok …") — a test that was dropped on the way (never started, its file stopped early) proves nothing, and the
// totals alone don't show it. Prints the missing names and exits 1.
//   npx tsx tools/check-test-run.ts <test output file>
import fs from 'node:fs';
import path from 'node:path';

const outFile = process.argv[2];
if (!outFile) { console.error('usage: check-test-run.ts <test output file>'); process.exit(2); }
const out = fs.readFileSync(outFile, 'utf8');
// names as the runner prints them: "ok 12 - name" (TAP) or "✔ name (3ms)" (spec)
const ran = new Set<string>();
for (const line of out.split('\n')) {
  const tap = line.match(/^\s*ok \d+ - (.+?)(?: # SKIP.*)?$/);
  const spec = line.match(/^\s*[✔﹣] (.+?)(?: \([\d.]+m?s\))?(?: # SKIP.*)?$/);
  const name = (tap && tap[1]) || (spec && spec[1]);
  if (name) ran.add(name.trim());
}
const unquote = (s: string) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');
const missing: string[] = [];
let declared = 0;
for (const f of fs.readdirSync('tests').filter((x) => /\.test\.tsx?$/.test(x)).sort()) {
  const src = fs.readFileSync(path.join('tests', f), 'utf8');
  // only fixed names: test('…' or test("…" (names built from a loop or a template are left out)
  for (const m of src.matchAll(/(?:^|\s)test\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
    const name = unquote(m[1] ?? m[2]);
    declared++;
    if (!ran.has(name)) missing.push(`${f}: ${name}`);
  }
}
if (missing.length) {
  for (const m of missing) console.log(`::error title=Test did not run::${m}`);
  console.log(`${missing.length} of ${declared} written tests did not run`);
  process.exit(1);
}
console.log(`all ${declared} written tests ran`);

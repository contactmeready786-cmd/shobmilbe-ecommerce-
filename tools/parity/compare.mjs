#!/usr/bin/env node
// Compares two crawls made by crawl.mjs (old site vs new site) page by page.
//   node tools/parity/compare.mjs <old-dir> <new-dir> [--show N]
// Exit code 0 = every page identical (status, redirect and content), 1 = differences found.
import fs from 'node:fs';
import path from 'node:path';

const [a, b, ...rest] = process.argv.slice(2);
const show = Number(rest[rest.indexOf('--show') + 1]) || 5;
const load = (d) => new Map(JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')).map((e) => [e.path, e]));
const A = load(a), B = load(b);
const problems = [];
for (const [p, ea] of A) {
  const eb = B.get(p);
  if (!eb) { problems.push({ p, why: 'missing in new site' }); continue; }
  if (ea.status !== eb.status) { problems.push({ p, why: `status ${ea.status} -> ${eb.status}` }); continue; }
  if ((ea.type || '') !== (eb.type || '')) { problems.push({ p, why: `type ${ea.type} -> ${eb.type}` }); continue; }
  if (Boolean(ea.bytes) !== Boolean(eb.bytes)) { problems.push({ p, why: 'download empty in one site' }); continue; }
  if ((ea.location || '') !== (eb.location || '')){ problems.push({ p, why: `redirect ${ea.location} -> ${eb.location}` }); continue; }
  const ha = JSON.stringify(ea.headers || {}), hb = JSON.stringify(eb.headers || {});
  if (ha !== hb) { problems.push({ p, why: 'headers differ', old: ha, new: hb }); continue; }
  if (ea.file && eb.file) {
    const ta = fs.readFileSync(path.join(a, ea.file + '.txt'), 'utf8');
    const tb = fs.readFileSync(path.join(b, eb.file + '.txt'), 'utf8');
    if (ta !== tb) {
      let i = 0; while (i < ta.length && ta[i] === tb[i]) i++;
      problems.push({ p, why: 'content differs', at: i, old: ta.slice(Math.max(0, i - 60), i + 120), new: tb.slice(Math.max(0, i - 60), i + 120) });
    }
  }
}
for (const p of B.keys()) if (!A.has(p)) problems.push({ p, why: 'only in new site' });
console.log(`pages compared: ${A.size}, differences: ${problems.length}`);
for (const x of problems.slice(0, show)) {
  console.log(`\n- ${x.p}: ${x.why}`);
  if (x.old !== undefined) console.log(`  old: ${JSON.stringify(x.old)}\n  new: ${JSON.stringify(x.new)}`);
}
process.exit(problems.length ? 1 : 0);

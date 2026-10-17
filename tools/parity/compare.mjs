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
const headOnly = [];
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
      // only the <head> differs? (Next.js writes the title / description tags itself) — listed apart, tag by tag
      const head = (t) => (/<head>([\s\S]*?)<\/head>/.exec(t) || [, ''])[1];
      const rest = (t) => t.replace(/<head>[\s\S]*?<\/head>/, '<head></head>');
      if (rest(ta) === rest(tb)) {
        const tags = (h) => h.match(/<(script|style|title|noscript)\b[^>]*>[\s\S]*?<\/\1>|<(meta|link|base)\b[^>]*>/g) || [];
        const A1 = tags(head(ta)), B1 = tags(head(tb));
        headOnly.push({ p, removed: A1.filter((x) => !B1.includes(x)), added: B1.filter((x) => !A1.includes(x)) });
        continue;
      }
      let i = 0; while (i < ta.length && ta[i] === tb[i]) i++;
      problems.push({ p, why: 'content differs', at: i, old: ta.slice(Math.max(0, i - 60), i + 120), new: tb.slice(Math.max(0, i - 60), i + 120) });
    }
  }
}
for (const p of B.keys()) if (!A.has(p)) problems.push({ p, why: 'only in new site' });
console.log(`pages compared: ${A.size}, differences: ${problems.length}, head tags only: ${headOnly.length}`);
// head-only differences: grouped by the exact tags added / removed, so each kind is read once
const groups = new Map();
for (const h of headOnly) {
  const k = JSON.stringify({ removed: h.removed.map((t) => t.replace(/content="[^"]*"/, 'content="…"')), added: h.added.map((t) => t.replace(/content="[^"]*"/, 'content="…"')) });
  if (!groups.has(k)) groups.set(k, { ...h, pages: [] });
  groups.get(k).pages.push(h.p);
}
for (const g of groups.values()) {
  console.log(`\n~ head tags on ${g.pages.length} page(s) (${g.pages.slice(0, 4).join(', ')}${g.pages.length > 4 ? ' …' : ''}):`);
  for (const t of g.removed) console.log(`    − ${t.slice(0, 220)}`);
  for (const t of g.added) console.log(`    + ${t.slice(0, 220)}`);
}
const kinds = {};
for (const x of problems) kinds[x.why.replace(/\d+/g, 'N')] = (kinds[x.why.replace(/\d+/g, 'N')] || 0) + 1;
for (const [k, n] of Object.entries(kinds)) console.log(`  ${n} × ${k}`);
// every difference, for the saved results (ci-results branch → compare-all.txt), and the first pages in full
if (process.env.RUNNER_TEMP) {
  const dir = path.join(process.env.RUNNER_TEMP, 'diff-pages');
  fs.mkdirSync(dir, { recursive: true });
  problems.filter((x) => x.why === 'content differs').slice(0, 12).forEach((x, i) => {
    const ea = A.get(x.p), eb = B.get(x.p);
    fs.writeFileSync(path.join(dir, `${i}-old.txt`), `${x.p}\n` + fs.readFileSync(path.join(a, ea.file + '.txt'), 'utf8'));
    fs.writeFileSync(path.join(dir, `${i}-new.txt`), `${x.p}\n` + fs.readFileSync(path.join(b, eb.file + '.txt'), 'utf8'));
  });
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'compare-all.txt'), problems.map((x) => `- ${x.p}: ${x.why}${x.old !== undefined ? `\n  old: ${JSON.stringify(x.old)}\n  new: ${JSON.stringify(x.new)}` : ''}`).join('\n'));
}
for (const x of problems.slice(0, show)) {
  console.log(`\n- ${x.p}: ${x.why}`);
  if (x.old !== undefined) console.log(`  old: ${JSON.stringify(x.old)}\n  new: ${JSON.stringify(x.new)}`);
}
process.exit(problems.length ? 1 : 0);

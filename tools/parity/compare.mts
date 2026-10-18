// Compares two crawls made by crawl.mts (old site vs new site) page by page.
//   npx tsx tools/parity/compare.mts <old-dir> <new-dir> [--show N]
// Exit code 0 = every page identical (status, redirect and content), 1 = differences found.
import fs from 'node:fs';
import path from 'node:path';

type Entry = { path: string; status: number | string; type?: string; location?: string; headers?: Record<string, string>; file?: string; bytes?: boolean };
type Problem = { p: string; why: string; at?: number; old?: string; new?: string };

const [a, b, ...rest] = process.argv.slice(2);
const show = Number(rest[rest.indexOf('--show') + 1]) || 5;
const load = (d: string): Map<string, Entry> => new Map((JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')) as Entry[]).map((e) => [e.path, e]));
const A = load(a), B = load(b);
const problems: Problem[] = [];
const headOnly: { p: string; removed: string[]; added: string[] }[] = [];
for (const [p, ea] of A) {
  const eb = B.get(p);
  if (!eb) { problems.push({ p, why: 'missing in new site' }); continue; }
  // The crawler only asks with GET: a "see other" (303, the original code) and a "temporary" (307, Next.js's redirect())
  // to the same address are the same for a browser — the next request is a GET of that address either way.
  const st = (e: Entry) => (e.status === 307 && e.location ? 303 : e.status);
  if (st(ea) !== st(eb)) { problems.push({ p, why: `status ${ea.status} -> ${eb.status}` }); continue; }
  const redirect = st(ea) === 303 && ea.location; // a redirect's own body (and its type) is never shown
  if (!redirect && (ea.type || '') !== (eb.type || '')) { problems.push({ p, why: `type ${ea.type} -> ${eb.type}` }); continue; }
  if (Boolean(ea.bytes) !== Boolean(eb.bytes)) { problems.push({ p, why: 'download empty in one site' }); continue; }
  if ((ea.location || '') !== (eb.location || '')){ problems.push({ p, why: `redirect ${ea.location} -> ${eb.location}` }); continue; }
  // A redirect has no page to protect: the security headers Next.js adds to it (the original code sent none) change
  // nothing; its cookies and caching still must match.
  const pick = (h: Record<string, string>) => (redirect ? { 'cache-control': h['cache-control'], 'set-cookie': h['set-cookie'] } : h);
  const ha = JSON.stringify(pick(ea.headers || {})), hb = JSON.stringify(pick(eb.headers || {}));
  if (ha !== hb) { problems.push({ p, why: 'headers differ', old: ha, new: hb }); continue; }
  if (ea.file && eb.file) {
    const ta = fs.readFileSync(path.join(a, ea.file + '.txt'), 'utf8');
    const tb = fs.readFileSync(path.join(b, eb.file + '.txt'), 'utf8');
    if (ta !== tb) {
      // only the <head> differs? (Next.js writes the title / description tags itself) — listed apart, tag by tag
      const head = (t: string) => (/<head>([\s\S]*?)<\/head>/.exec(t) || [, ''])[1];
      const rest = (t: string) => t.replace(/<head>[\s\S]*?<\/head>/, '<head></head>');
      if (rest(ta) === rest(tb)) {
        const tags = (h: string): string[] => h.match(/<(script|style|title|noscript)\b[^>]*>[\s\S]*?<\/\1>|<(meta|link|base)\b[^>]*>/g) || [];
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
const groups = new Map<string, { p: string; removed: string[]; added: string[]; pages: string[] }>();
for (const h of headOnly) {
  const k = JSON.stringify({ removed: h.removed.map((t) => t.replace(/content="[^"]*"/, 'content="…"')), added: h.added.map((t) => t.replace(/content="[^"]*"/, 'content="…"')) });
  if (!groups.has(k)) groups.set(k, { ...h, pages: [] });
  groups.get(k)!.pages.push(h.p);
}
for (const g of groups.values()) {
  console.log(`\n~ head tags on ${g.pages.length} page(s) (${g.pages.slice(0, 4).join(', ')}${g.pages.length > 4 ? ' …' : ''}):`);
  for (const t of g.removed) console.log(`    − ${t.slice(0, 220)}`);
  for (const t of g.added) console.log(`    + ${t.slice(0, 220)}`);
}
const kinds: Record<string, number> = {};
for (const x of problems) kinds[x.why.replace(/\d+/g, 'N')] = (kinds[x.why.replace(/\d+/g, 'N')] || 0) + 1;
for (const [k, n] of Object.entries(kinds)) console.log(`  ${n} × ${k}`);
// every difference, for the saved results (ci-results branch → compare-all.txt), and the first pages in full
if (process.env.RUNNER_TEMP) {
  const dir = path.join(process.env.RUNNER_TEMP, 'diff-pages');
  fs.mkdirSync(dir, { recursive: true });
  problems.filter((x) => x.why === 'content differs').slice(0, 12).forEach((x, i) => {
    const ea = A.get(x.p)!, eb = B.get(x.p)!;
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

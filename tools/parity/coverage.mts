// Route coverage of a parity crawl: which addresses the shop answers were never visited.
//   npx tsx tools/parity/coverage.mts <crawl-dir> [--seeds out.txt]
// --seeds writes example addresses for the unvisited routes (ids → 1, slugs → test products) to feed the crawler.
// The route lists come straight from the code (tools/parity/routes.ts), loaded by tsx — nothing is bundled first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Route = { method: string; path: string | RegExp };
type Listed = Route & { area: 'admin' | 'shop' };

const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error('usage: coverage.mts <crawl-dir> [--seeds out.txt]'); process.exit(2); }
const seedsOut = rest.includes('--seeds') ? rest[rest.indexOf('--seeds') + 1] : '';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// loading the admin's route tables loads the shop's code; it never connects, but it wants an address to exist
process.env.DATABASE_URL ||= 'postgres://x@127.0.0.1:1/x';
const { adminRoutes, shopRoutes } = (await import('./routes.ts')) as { adminRoutes: () => Route[]; shopRoutes: (root: string) => Route[] };

const visited = (JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as { path: string }[]).map((e) => e.path.split('?')[0]);
const hit = (r: Route) => visited.some((p) => (typeof r.path === 'string' ? p === r.path : r.path.test(p)));
const all: Listed[] = [...adminRoutes().map((r) => ({ ...r, area: 'admin' as const })), ...shopRoutes(root).map((r) => ({ ...r, area: 'shop' as const }))];
const gets = all.filter((r) => r.method !== 'POST');
const missing = gets.filter((r) => !hit(r));
console.log(`GET routes: ${gets.length}, visited: ${gets.length - missing.length}, not visited: ${missing.length}`);
for (const r of missing) console.log('  -', r.area, typeof r.path === 'string' ? r.path : String(r.path));

if (seedsOut) {
  const example = (re: string) => re.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
    .replace(/\(\?:([^)|]+)[^)]*\)\??/g, '$1').replace(/\(([a-z-]+)(\|[a-z-|]+)?\)/g, '$1')
    .replace(/\(\\d\+\)|\\d\+/g, '1').replace(/\(\[\^\/\]\+\)|\[\^\/\]\+|\(\[\\w-\]\+\)|\(\[A-Za-z0-9\]\+\)|\(\[a-z0-9-\]\+\)/gi, 'arduino-uno-r3')
    .replace(/\(\.\+\)|\.\+|\.\*/g, 'x').replace(/[()?]/g, '');
  const seeds = missing.map((r) => (typeof r.path === 'string' ? r.path : example(r.path.source))).filter((s) => s.startsWith('/') && !/[\\[\]{}*+|^$]/.test(s));
  fs.writeFileSync(seedsOut, seeds.join('\n') + '\n');
  console.log(`wrote ${seeds.length} seed addresses to ${seedsOut}`);
}

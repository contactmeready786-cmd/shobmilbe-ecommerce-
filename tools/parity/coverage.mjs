#!/usr/bin/env node
// Route coverage of a parity crawl: which addresses the shop answers were never visited.
//   node tools/parity/coverage.mjs <crawl-dir> [--seeds out.txt]
// --seeds writes example addresses for the unvisited routes (ids → 1, slugs → test products) to feed the crawler.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const [dir, ...rest] = process.argv.slice(2);
const seedsOut = rest.includes('--seeds') ? rest[rest.indexOf('--seeds') + 1] : '';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const esbuild = process.env.ESBUILD || ['node_modules/.bin/esbuild', '/opt/npm-tools/node_modules/esbuild/bin/esbuild'].map((p) => path.resolve(root, p)).find((p) => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
fs.writeFileSync(path.join(tmp, 'entry.ts'), `import { adminRoutes, shopRoutes } from ${JSON.stringify(path.join(root, 'tools/parity/routes.ts'))};
const ser = (r) => ({ method: r.method, path: r.path instanceof RegExp ? { re: r.path.source } : r.path });
console.log(JSON.stringify({ admin: adminRoutes().map(ser), shop: shopRoutes(${JSON.stringify(root)}).map(ser) }));`);
execFileSync(esbuild, [path.join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=cjs', `--alias:@=${root}`, '--external:pg-native', '--external:pg-cloudflare', '--external:cloudflare:sockets', '--log-level=error', '--outfile=' + path.join(tmp, 'out.cjs')]);
const routes = JSON.parse(execFileSync('node', [path.join(tmp, 'out.cjs')], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://x@127.0.0.1:1/x' } }).toString());

const visited = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).map((e) => e.path.split('?')[0]);
const hit = (r) => visited.some((p) => (typeof r.path === 'string' ? p === r.path : new RegExp(r.path.re).test(p)));
const all = [...routes.admin.map((r) => ({ ...r, area: 'admin' })), ...routes.shop.map((r) => ({ ...r, area: 'shop' }))];
const gets = all.filter((r) => r.method !== 'POST');
const missing = gets.filter((r) => !hit(r));
console.log(`GET routes: ${gets.length}, visited: ${gets.length - missing.length}, not visited: ${missing.length}`);
for (const r of missing) console.log('  -', r.area, typeof r.path === 'string' ? r.path : '/' + r.path.re + '/');

if (seedsOut) {
  const example = (re) => re.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
    .replace(/\(\?:([^)|]+)[^)]*\)\??/g, '$1').replace(/\(([a-z-]+)(\|[a-z-|]+)?\)/g, '$1')
    .replace(/\(\\d\+\)|\\d\+/g, '1').replace(/\(\[\^\/\]\+\)|\[\^\/\]\+|\(\[\\w-\]\+\)|\(\[A-Za-z0-9\]\+\)|\(\[a-z0-9-\]\+\)/gi, 'arduino-uno-r3')
    .replace(/\(\.\+\)|\.\+|\.\*/g, 'x').replace(/[()?]/g, '');
  const seeds = missing.map((r) => (typeof r.path === 'string' ? r.path : example(r.path.re))).filter((s) => s.startsWith('/') && !/[\\[\]{}*+|^$]/.test(s));
  fs.writeFileSync(seedsOut, seeds.join('\n') + '\n');
  console.log(`wrote ${seeds.length} seed addresses to ${seedsOut}`);
}

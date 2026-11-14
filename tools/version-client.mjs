// After `tsc` has built the browser code into public/js (npm run build:client): every import between those files gets
// ?v=<build id>, and the build id is written to public/js/version.json for the pages' <script>/<link> tags (lib/asset-version.ts).
// Why (owner, 2026-11-14): Cloudflare keeps /js files for 4 hours whatever the shop says, so after an update a visitor
// could run new pages with old scripts (a new button that did nothing). A new build id = new addresses = always fresh.
// The id is a hash of all browser code and style sheets, so it changes exactly when one of them changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.join(process.cwd(), 'public');
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
}) : []);
const js = walk(path.join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const css = walk(path.join(root, 'css')).filter((f) => f.endsWith('.css')).sort();
const hash = crypto.createHash('sha1');
for (const f of [...js, ...css]) { hash.update(path.relative(root, f)); hash.update(fs.readFileSync(f)); }
const v = hash.digest('hex').slice(0, 10);
const spec = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+?\.js)\2/g;
let n = 0;
for (const f of js) {
  const before = fs.readFileSync(f, 'utf8');
  const after = before.replace(spec, (_m, pre, q, p) => { n++; return `${pre}${q}${p}?v=${v}${q}`; });
  if (after !== before) fs.writeFileSync(f, after);
}
fs.writeFileSync(path.join(root, 'js', 'version.json'), JSON.stringify({ v }) + '\n');
console.log(`browser code version ${v}: ${n} imports in ${js.length} files`);

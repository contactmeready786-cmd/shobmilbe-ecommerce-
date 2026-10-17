// Lists every address the shop answers (admin route tables + the storefront's checks in lib/site.ts),
// so the parity crawl can prove it visited each one. Bundled and run by tools/parity/coverage.mjs.
import fs from 'node:fs';
import path from 'node:path';
import * as admin from '../../lib/admin/index';

type Route = { method: string; path: string | RegExp };

export function adminRoutes(): Route[] {
  const mods = (admin as unknown as { MODULES?: { routes?: Route[] }[] }).MODULES;
  if (!mods) throw new Error('lib/admin/index must export MODULES');
  return mods.flatMap((m) => m.routes || []);
}

export function shopRoutes(root: string): Route[] {
  const out: Route[] = [];
  for (const f of ['lib/site.ts', 'lib/shopx.ts']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/path === '([^']+)'(?:\s*&&\s*method === '([A-Z]+)')?/g)) out.push({ method: m[2] || 'GET', path: m[1] });
    for (const m of src.matchAll(/(\/\^\\\/[^ ]*?\$\/)\.test\(path\)|path\.match\((\/\^\\\/[^ ]*?\$\/)\)/g)) {
      const lit = (m[1] || m[2]).slice(1, -1);
      try { out.push({ method: 'GET', path: new RegExp(lit) }); } catch { /* not a plain regex literal */ }
    }
  }
  return out;
}

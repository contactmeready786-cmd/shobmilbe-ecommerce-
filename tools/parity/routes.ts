// Lists every address the shop answers (admin route tables + the storefront's checks in lib/site.ts),
// so the parity crawl can prove it visited each one. Loaded by tools/parity/coverage.mts and scenarios.mts.
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
  // (a file the shop's code no longer has is skipped: lib/shopx moved from .ts to .tsx, which stopped this list once)
  for (const f of ['lib/site.ts', 'lib/shopx.ts', 'lib/shopx.tsx']) {
    if (!fs.existsSync(path.join(root, f))) continue;
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/path === '([^']+)'(?:\s*&&\s*method === '([A-Z]+)')?/g)) out.push({ method: m[2] || 'GET', path: m[1] });
    for (const m of src.matchAll(/(\/\^\\\/[^ ]*?\$\/)\.test\(path\)|path\.match\((\/\^\\\/[^ ]*?\$\/)\)/g)) {
      const lit = (m[1] || m[2]).slice(1, -1);
      try { out.push({ method: 'GET', path: new RegExp(lit) }); } catch { /* not a plain regex literal */ }
    }
  }
  return out;
}

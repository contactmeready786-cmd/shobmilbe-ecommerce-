// The admin addresses that answer GET (shared by tools/gen-admin-routes.ts and tests/routes.test.ts).
import '../../lib/react/render';
import { MODULES } from '../../lib/admin/index';

// handled in lib/admin/index.tsx itself, before the modules
const AUTH = ['/admin/setup', '/admin/login', '/admin/reset', '/admin/reset/email', '/admin/verify', '/admin/2fa'];

export function adminGetRoutes(): (string | RegExp)[] {
  const out: (string | RegExp)[] = [...AUTH];
  for (const m of MODULES as { routes: { method: string; path: string | RegExp }[] }[]) {
    for (const r of m.routes) if (r.method === 'GET' || r.method === '*') out.push(r.path);
  }
  return out;
}

// A 15-second memory for data every shop page reads the same way (settings, categories, pages, banners).
//
// Without it each page asks the database for these again — 5 of a page's ~15 round trips. With it, a server
// instance asks at most once per 15 seconds. Rules that keep it safe:
//  • Admin pages and every request that changes something (POST, …) always read fresh from the database,
//    so what the owner saves is what the admin shows at once; the shop shows it within 15 seconds.
//  • A request that changes something also empties this instance's memory, before and after it runs.
//  • Callers get their own copy, so changing what they got can't change what the next visitor sees.
//  • SHOP_CACHE=0 in the environment switches it off completely.
import { AsyncLocalStorage } from 'node:async_hooks';

export const TTL_MS = 15_000;

const freshScope = new AsyncLocalStorage<true>();
const store = new Map<string, { at: number; value: Promise<unknown> }>();

/** Run fn with every memo() inside it reading straight from the database. */
export function runFresh<T>(fn: () => T): T { return freshScope.run(true, fn); }
export function clearAll(): void { store.clear(); }
const off = () => process.env.SHOP_CACHE === '0';

function copy<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  return structuredClone(v);
}

export async function memo<T>(key: string, load: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  if (freshScope.getStore() || off() || ttl <= 0) return load();
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl) return copy(await (hit.value as Promise<T>));
  const value = load();
  store.set(key, { at: Date.now(), value });
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key); });
  return copy(await value);
}

/** Wraps the shop's request handler: fresh reads for admin pages and changes, memory cleared around changes. */
export function scoped<Req extends { method?: string; url?: string }, Rest extends unknown[], R>(
  handler: (req: Req, ...rest: Rest) => Promise<R>,
): (req: Req, ...rest: Rest) => Promise<R> {
  return async (req, ...rest) => {
    const method = req.method || 'GET';
    let path = '/';
    try { path = new URL(req.url || '/', 'http://local').pathname; } catch (_) { /* keep / */ }
    const changes = method !== 'GET' && method !== 'HEAD';
    if (!changes && path !== '/admin' && !path.startsWith('/admin/')) return handler(req, ...rest);
    if (changes) clearAll();
    try { return await runFresh(() => handler(req, ...rest)); } finally { if (changes) clearAll(); }
  };
}

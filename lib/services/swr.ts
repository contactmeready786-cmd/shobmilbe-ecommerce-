// ⚡ Heavy admin numbers kept ready (owner, 2026-11-18: "some pages take 5–100 seconds — fix them").
//
// A few admin pages work through the whole catalogue (SEO score of every product, the duplicate scan, both product
// feeds, market research). Their answer is kept here and shown at once; when it is older than its time it is worked
// out again in the background, so the next view is fresh and nobody waits. A form sent in the admin
// (lib/next/admin-route.ts → changed): answers kept for that same page are thrown away (what was just saved there
// shows at once); every other answer is marked old, shown once more and worked out again in the background.
type Entry = { at: number; value?: unknown; ready: boolean; running: Promise<unknown> | null; page: string };
const store = new Map<string, Entry>();
let generation = 0;

function run<T>(key: string, fn: () => Promise<T>, e: Entry): Promise<T> {
  const gen = generation;
  const p = fn().then((v) => {
    if (gen === generation) { e.value = v; e.ready = true; e.at = Date.now(); }
    return v;
  }).finally(() => { e.running = null; });
  e.running = p;
  p.catch(() => { if (!e.ready) store.delete(key); });
  return p;
}

/** The kept answer for `key` (worked out with `fn` the first time); older than `ttlMs` → worked out again in the
 *  background while the kept one is shown. */
export async function ready<T>(key: string, ttlMs: number, fn: () => Promise<T>, page = ''): Promise<T> {
  let e = store.get(key);
  if (!e) { e = { at: 0, ready: false, running: null, page }; store.set(key, e); }
  if (e.ready) {
    if (Date.now() - e.at > ttlMs && !e.running) run(key, fn, e).catch(() => {});
    return e.value as T;
  }
  return (e.running as Promise<T> | null) || run(key, fn, e);
}

/** A form was sent to `path` in the admin. */
export function changed(path: string): void {
  generation++;
  for (const [key, e] of store) {
    if (e.page && path.startsWith(e.page)) store.delete(key);
    else e.at = 0;
  }
}

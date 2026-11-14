// 🔀 পণ্য ঘুরিয়ে দেখানো (owner, 2026-11-15): with 1200+ products the shop showed the same few at the front every time,
// and out-of-stock ones stood among them. Now every row takes a bigger pool and picks a fresh mix every ROTATE_MIN
// minutes: products in stock first, the ones near the top of the row's own order (newest, best selling, biggest
// discount …) a little more likely, out-of-stock ones only when there aren't enough others. The mix stays the same
// within one time window, so the page and the next pages of a list don't jump while someone is browsing.
// Switch: Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে → "🔀 পণ্য ঘুরিয়ে দেখাও" (ui_rotate; missing = on).
import type { Settings } from '../types';

export const ROTATE_MIN = 30;

export const rotateOn = (s: Settings | Record<string, unknown>): boolean => String((s as Record<string, unknown>).ui_rotate ?? '1') !== '0';

/** the current time window, e.g. "985722" (changes every ROTATE_MIN minutes) */
export function windowKey(now = Date.now()): string {
  return String(Math.floor(now / (ROTATE_MIN * 60e3)));
}

// a small seeded random number maker: the same seed gives the same numbers (so a window shows one fixed mix)
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed: string): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `take` products from `pool` (already in the row's own best-first order): in stock first, a weighted random mix
 *  that favours the front of the pool, out-of-stock only to fill up. `row` names the row, so rows mix differently. */
export function mix<P extends { id: number; stock: number; product_type?: string }>(pool: P[], take: number, row: string, now = Date.now()): P[] {
  const seen = new Set<number>();
  const uniq = pool.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const has = (p: P) => p.stock > 0 || p.product_type === 'bundle';
  const rnd = seeded(`${row}:${windowKey(now)}`);
  // weighted random order (Efraimidis–Spirakis): a product's weight falls slowly with its place in the pool
  const order = (list: P[]) => list.map((p, i) => ({ p, k: Math.pow(rnd(), 1 / (1 / (1 + i / 24))) }))
    .sort((a, b) => b.k - a.k).map((x) => x.p);
  const inStock = order(uniq.filter(has));
  const out = uniq.filter((p) => !has(p));
  return [...inStock, ...out].slice(0, take);
}

/** the seed for the shop lists' "no sort chosen" order (Postgres md5 of id + this) */
export function listSeed(now = Date.now()): string {
  return `mix${windowKey(now)}`;
}

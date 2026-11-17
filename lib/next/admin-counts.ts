// 🔢 The three small numbers in the admin's top bar (owner, 2026-11-17 — like the "Veylix" template's
// Orders / Low stock / Delayed chips): orders waiting to be confirmed, products running low, products out of stock.
// One light query, kept for a minute per server so moving between admin pages costs the database nothing extra.
import { one } from '../db';
import type { TopCounts } from '../admin/layout';

const TTL_MS = 60_000;
let kept: { at: number; value: Promise<TopCounts | null> } | null = null;

export function topCounts(): Promise<TopCounts | null> {
  if (kept && Date.now() - kept.at < TTL_MS) return kept.value;
  const value = one<TopCounts>(`SELECT
      (SELECT count(*) FROM orders WHERE status='pending')::int AS pending,
      (SELECT count(*) FROM products WHERE active AND product_type='single' AND stock > 0 AND stock <= low_stock)::int AS low,
      (SELECT count(*) FROM products WHERE active AND product_type='single' AND stock <= 0)::int AS out`)
    .then((r) => r || null)
    .catch(() => null); // the numbers are a help, never a reason for a page to fail
  kept = { at: Date.now(), value };
  return value;
}

// 🛡️ Checkout rules (owner, 2026-11-27 — the ideas from StoreX's "Fraud Guard", built the free way):
// a new website order that looks fake goes on "Hold" with a note saying why, and the owner's phone is told.
// The order is never refused — a real customer who orders a lot or twice in a day still gets through; the owner
// just calls before it goes to the courier.
//
// Rules (Admin → Fraud check → Order rules), each can be switched off by setting it to 0:
//   • the same phone number placed more than N orders in the last 24 hours   (fr_phone_day, default 3)
//   • the same internet address (IP) placed more than N orders in 24 hours   (fr_ip_day, default 5)
//   • one order has more than N pieces in total                              (fr_qty_max, default 0 = off)
// The courier-record rule ("success rate below X%") lives with the existing fraud check (checkout.ts, fr_min_rate).
import * as db from '../db';
import { int } from '../util';
import type { Settings } from '../types';

export type RuleInput = { orderId: number; phone: string; ip: string; pieces: number };

/** Numbers the rules use (0 = that rule is off). */
export function limits(s: Settings) {
  const n = (v: unknown, dflt: number) => Math.max(0, Math.min(1000000, int(v === undefined || v === null || v === '' ? dflt : v, dflt)));
  return {
    on: s.fr_rules_on === '1',
    hold: s.fr_rules_hold !== '0',
    phoneDay: n(s.fr_phone_day, 3),
    ipDay: n(s.fr_ip_day, 5),
    qtyMax: n(s.fr_qty_max, 0),
    minRate: Math.min(100, n(s.fr_min_rate, 0)),
  };
}

/** Which rules this order breaks (English sentences for the order note). Empty when the rules are off or all is fine. */
export async function evaluate(s: Settings, o: RuleInput): Promise<string[]> {
  const L = limits(s);
  if (!L.on) return [];
  const hits: string[] = [];
  if (L.phoneDay > 0 && o.phone) {
    const r = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE phone=$1 AND created_at > now() - interval '24 hours'`, [o.phone]);
    if (r && r.n > L.phoneDay) hits.push(`${r.n} orders from this phone in 24 hours (limit ${L.phoneDay})`);
  }
  if (L.ipDay > 0 && o.ip && o.ip !== 'unknown') {
    const r = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE ip=$1 AND created_at > now() - interval '24 hours'`, [o.ip]);
    if (r && r.n > L.ipDay) hits.push(`${r.n} orders from this internet address in 24 hours (limit ${L.ipDay})`);
  }
  if (L.qtyMax > 0 && o.pieces > L.qtyMax) hits.push(`${o.pieces} pieces in one order (limit ${L.qtyMax})`);
  return hits;
}

/** Writes the note, puts the order on Hold (when chosen) and returns true when something was found. */
export async function applyTo(s: Settings, o: RuleInput, setHold: (id: number) => Promise<unknown>): Promise<string[]> {
  const hits = await evaluate(s, o);
  if (!hits.length) return hits;
  await db.q(`UPDATE orders SET admin_note = left(trim(coalesce(admin_note, '') || E'\\n' || $1), 1000) WHERE id=$2`,
    [`⛔ Order rules: ${hits.join('; ')}. Call to confirm before sending.`, o.orderId]);
  if (limits(s).hold) await setHold(o.orderId).catch(() => {});
  return hits;
}

// 🛵 Courier automation outside the admin pages (owner, 2026-11-17: "order → packing → courier must run by itself").
//  • bookConfirmed: an order confirmed by the automatic call (customer pressed 1) is booked with the default courier,
//    exactly like an order the owner confirms by hand (when "অটো পাঠান" is on) — it used to stay unbooked.
//  • syncParcels: every ~30 minutes the status of booked parcels is asked from the courier, so "delivered" /
//    "returned" come by themselves even when the courier's webhook isn't set up (it used to need the 🔄 button).
import * as db from '../db';
import * as courier from './courier';
import type { AdminCtx, Settings } from '../types';

/** The few parts of an admin request the booking code uses, for work the shop does by itself (no staff member). */
function systemCtx(settings: Settings): AdminCtx {
  return {
    settings,
    user: { id: null, role: 'system', name: 'সিস্টেম' },
    log: (action: string, entity?: string, entityId?: number | string | null, detail?: unknown) => db.logActivity(null, action, entity, entityId ?? null, detail),
  } as unknown as AdminCtx;
}

export async function bookConfirmed(settings: Settings, orderId: number): Promise<void> {
  if (settings.courier_auto_send !== '1' || !settings.courier_default || !courier.configured(settings, settings.courier_default)) return;
  const $orders = await import('../admin/orders');
  await $orders.autoSend(systemCtx(settings), orderId);
}

let lastSync = 0;
const EVERY_MS = 30 * 60 * 1000;
export async function syncParcels(settings: Settings, max = 40): Promise<{ checked: number; changed: number } | null> {
  if (Date.now() - lastSync < EVERY_MS) return null;
  if (!courier.available(settings).length) return null;
  lastSync = Date.now();
  // parcels with one of the connected couriers, still on their way (booked, handed over), sent within 45 days;
  // the ones asked about longest ago first, so every parcel gets its turn
  const rows = await db.q<{ id: number }>(`SELECT id FROM orders
    WHERE status IN ('processing','shipped') AND consignment_id<>'' AND courier = ANY($1::text[])
      AND coalesce(courier_sent_at, created_at) > now() - interval '45 days'
    ORDER BY coalesce(courier_checked_at, 'epoch'::timestamptz), id LIMIT $2`, [courier.available(settings), max]);
  if (!rows.length) return { checked: 0, changed: 0 };
  const $orders = await import('../admin/orders');
  const O = await import('../models/orders');
  const ctx = systemCtx(settings);
  let changed = 0;
  for (const r of rows) {
    await db.q('UPDATE orders SET courier_checked_at=now() WHERE id=$1', [r.id]);
    const o = await O.getOrder({ id: r.id });
    if (!o) continue;
    const before = o.status;
    const res = await $orders.syncOne(ctx, o);
    if (res.ok) {
      const after = await db.one<{ status: string }>('SELECT status FROM orders WHERE id=$1', [r.id]);
      if (after && after.status !== before) changed++;
    }
  }
  return { checked: rows.length, changed };
}

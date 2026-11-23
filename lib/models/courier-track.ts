// 🛵 পার্সেলের যাত্রা (owner, 2026-11-23): every step the courier reports for a parcel — its status changes
// (in review → pending → delivered …) and Steadfast's "tracking_update" messages (hub received, sent to the
// destination hub, rider assigned …) — kept with their time, so the customer sees the parcel's journey on the
// shop's own order page (and the staff on the admin order page) instead of only on the courier's site.
// Status steps come from orders.setCourierInfo / setCourierStatus (webhook, the 30-minute check, the sync button);
// tracking messages from the Steadfast webhook (lib/api/payments.ts).
import { q } from '../db';

export type TrackEvent = { kind: 'status' | 'tracking'; status: string; message: string; at: Date | null };
export type TrackRow = { id: number; kind: string; status: string; message: string; event_at: string | Date };
export type TrackLine = { kind: string; text: string; raw: string; at: string | Date };

const key = (s: unknown) => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// The courier's status words in plain Bangla for the customer (Steadfast first; Pathao / RedX / Carrybee words that
// mean the same are listed too). A word not listed is shown as the courier wrote it.
const STATUS_BN: Record<string, string> = {
  booked: 'পার্সেল কুরিয়ারে বুক করা হয়েছে',
  in_review: 'কুরিয়ার পার্সেলটি যাচাই করছে',
  pending: 'কুরিয়ার পার্সেলটি গ্রহণ করেছে — ডেলিভারির প্রক্রিয়া চলছে',
  pickup_pending: 'কুরিয়ার পার্সেল নিতে আসবে',
  pickup_requested: 'কুরিয়ার পার্সেল নিতে আসবে',
  pickup: 'কুরিয়ার পার্সেলটি নিয়ে গেছে',
  picked: 'কুরিয়ার পার্সেলটি নিয়ে গেছে',
  at_the_sorting_hub: 'পার্সেল কুরিয়ারের হাবে পৌঁছেছে',
  in_transit: 'পার্সেল গন্তব্যের পথে',
  received_at_last_mile_hub: 'পার্সেল আপনার এলাকার হাবে পৌঁছেছে',
  assigned_for_delivery: 'ডেলিভারিম্যান পার্সেলটি নিয়ে আপনার কাছে আসছেন',
  out_for_delivery: 'ডেলিভারিম্যান পার্সেলটি নিয়ে আপনার কাছে আসছেন',
  hold: 'পার্সেল সাময়িকভাবে হোল্ডে আছে',
  on_hold: 'পার্সেল সাময়িকভাবে হোল্ডে আছে',
  delivered_approval_pending: 'ডেলিভারি হয়েছে — কুরিয়ার নিশ্চিত করছে',
  partial_delivered_approval_pending: 'আংশিক ডেলিভারি হয়েছে — কুরিয়ার নিশ্চিত করছে',
  cancelled_approval_pending: 'ডেলিভারি হয়নি — কুরিয়ার নিশ্চিত করছে',
  unknown_approval_pending: 'কুরিয়ার অবস্থা যাচাই করছে',
  delivered: '✅ ডেলিভারি সম্পন্ন',
  delivery_completed: '✅ ডেলিভারি সম্পন্ন',
  partial_delivered: 'আংশিক ডেলিভারি হয়েছে',
  partial_delivery: 'আংশিক ডেলিভারি হয়েছে',
  cancelled: 'ডেলিভারি বাতিল — পার্সেল ফেরত যাচ্ছে',
  return: 'পার্সেল ফেরত যাচ্ছে',
  returned: 'পার্সেল ফেরত গেছে',
  paid_return: 'পার্সেল ফেরত গেছে',
};

/** The courier's status word as the customer reads it ('' = nothing worth showing). */
export function statusText(status: unknown): string {
  const k = key(status);
  if (!k || k === 'unknown') return '';
  return STATUS_BN[k] || String(status).replace(/[_-]+/g, ' ').trim();
}

/** A tracking message as the customer reads it: the two fixed sentences Steadfast writes are put in Bangla. */
export function messageText(msg: unknown): string {
  const m = clean(msg);
  if (!m) return '';
  const st = /^status (?:has been )?updated (?:as|to) ([a-z _-]+)\.?$/i.exec(m);
  if (st) return statusText(st[1]) || m;
  if (/^consignment (?:has been )?created\b/i.test(m)) return STATUS_BN.booked;
  return m;
}

function clean(v: unknown): string {
  return String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Steadfast sends "2026-11-23 18:08:00" (Dhaka time) or an ISO time; anything odd or in the future = now. */
export function courierTime(v: unknown): Date | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const d = new Date(local ? `${local[1]}T${local[2].length === 5 ? `${local[2]}:00` : local[2]}+06:00` : s);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60_000) return null;
  return d;
}

/** What a Steadfast webhook push says, or null when it says nothing about the parcel's journey. Steadfast's panel
 *  sends notification_type "delivery_status" / "tracking_update"; an older push has no type (then it is a status). */
export function parseSteadfast(b: Record<string, unknown>): TrackEvent | null {
  const type = key(b.notification_type);
  const message = clean(b.tracking_message ?? b.message ?? b.tracking_status ?? '');
  const status = clean(b.status ?? b.delivery_status ?? '');
  const at = courierTime(b.updated_at ?? b.timestamp ?? b.created_at);
  if (type === 'tracking_update' || (!type && message && !status)) return message ? { kind: 'tracking', status, message, at } : null;
  if (!type || type === 'delivery_status') return status ? { kind: 'status', status, message, at } : null;
  return null; // payment_request, user_update … are not about this parcel's journey
}

/** Keep one step (the same step at the same time is kept once, however often the courier repeats it). */
export async function add(orderId: number, courier: string, ev: TrackEvent): Promise<void> {
  if (!orderId || (!ev.status && !ev.message)) return;
  const at = ev.at || new Date();
  await q(`INSERT INTO courier_track(order_id, courier, kind, status, message, event_at)
    SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM courier_track WHERE order_id=$1 AND kind=$3 AND status=$4 AND message=$5
      AND abs(extract(epoch FROM event_at - $6::timestamptz)) < 120)`,
    [orderId, String(courier || ''), ev.kind, ev.status.slice(0, 80), ev.message.slice(0, 300), at]);
}

/** The parcel's journey, newest first, ready to show. `maskPhones` hides phone numbers (rider's or anyone's) for a
 *  visitor who only has the order number. */
export async function list(orderId: number, opts: { limit?: number; maskPhones?: boolean } = {}): Promise<TrackLine[]> {
  const rows = await q<TrackRow>(`SELECT id, kind, status, message, event_at FROM courier_track WHERE order_id=$1
    ORDER BY event_at DESC, id DESC LIMIT $2`, [orderId, Math.min(Math.max(opts.limit || 15, 1), 50)]);
  const out: TrackLine[] = [];
  for (const r of rows) {
    let text = r.kind === 'tracking' ? messageText(r.message) : statusText(r.status);
    if (!text) continue;
    if (opts.maskPhones) text = maskPhones(text);
    // the same step said twice (a status and Steadfast's "Status has been updated as …" message) is shown once
    const t = new Date(r.event_at).getTime();
    if (out.some((o) => o.text === text && Math.abs(new Date(o.at).getTime() - t) < 30 * 60_000)) continue;
    out.push({ kind: r.kind, text, raw: r.message || r.status, at: r.event_at });
  }
  return out;
}

export function maskPhones(t: string): string {
  return t.replace(/(?:\+?88)?(01\d)(\d{5})(\d{3})/g, (_m, a: string, b: string, c: string) => `${a}${'•'.repeat(b.length)}${c}`);
}

// 🎤 Voice & calls (owner, 2026-11-23: "customers don't like typing — let them send a voice message, and let me hear
// the shop phone's calls in the admin"). One list for both:
//  • 'message' — a customer records a voice message on the shop (help button) and leaves a mobile number
//  • 'call'    — a call recording from the shop phone (Google Phone app → Share → সবমিলবে Admin, or picked as a file)
// The sound stays in this table only (private, never on ImageKit), is served to logged-in staff only, and is removed
// for good after the owner's number of days (voice_keep_days, default 90). Deleting by hand goes to the recycle bin.
import * as db from '../db';
import { int, normalizePhone, validPhone } from '../util';
import type { Settings } from '../types';

export const MAX_BYTES = 6 * 1024 * 1024; // a call can be long; a customer message is cut at 2 minutes in the browser
export const MSG_MAX_BYTES = 1.5 * 1024 * 1024;
export const STATUS: Record<string, [string, string]> = { new: ['🔴', 'New'], heard: ['👂', 'Heard'], done: ['✅', 'Done'] };

export type VoiceRow = {
  id: number; kind: string; direction: string; phone: string; name: string; order_code: string; page: string; mime: string;
  bytes: number; seconds: number; status: string; note: string; staff_id: number | null; handled_by: number | null;
  handled_at: Date | null; call_at: Date | null; created_at: Date; staff_name?: string | null; handler_name?: string | null;
  customer_id?: number | null; customer_name?: string | null; orders?: number;
};

export class VoiceError extends Error {}

/** what kind of sound file the bytes are (by their first bytes — never by what the browser claims) */
export function audioKind(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  if (b.toString('latin1', 0, 5) === '#!AMR') return 'audio/amr';
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';
  return null;
}

/** "data:audio/webm;base64,…" (or plain base64) → the bytes, checked */
export function decode(dataUrl: unknown, max: number): { audio: Buffer; mime: string } {
  const m = /^(?:data:[\w/.+-]+(?:;[\w=.-]+)*;base64,)?([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new VoiceError('রেকর্ডিং পাওয়া যায়নি।');
  const audio = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if (audio.length < 800) throw new VoiceError('রেকর্ডিং খুব ছোট — আবার রেকর্ড করুন।');
  if (audio.length > max) throw new VoiceError('রেকর্ডিং অনেক বড়।');
  const mime = audioKind(audio);
  if (!mime) throw new VoiceError('এই ধরনের ফাইল নেওয়া যায় না — শুধু অডিও।');
  return { audio, mime };
}

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** a customer's voice message from the shop */
export async function addMessage(o: { data: unknown; phone: unknown; name?: unknown; orderCode?: unknown; page?: unknown; seconds?: unknown; ip: string }) {
  const phone = normalizePhone(o.phone);
  if (!validPhone(phone)) throw new VoiceError('সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮), যাতে আমরা আপনাকে ফোন করতে পারি।');
  const { audio, mime } = decode(o.data, MSG_MAX_BYTES);
  const r = await db.one<{ id: number }>(`INSERT INTO voice_notes(kind, phone, name, order_code, page, mime, audio, bytes, seconds, ip)
    VALUES('message',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
  [phone, clip(o.name, 60), clip(o.orderCode, 20).toUpperCase(), clip(o.page, 200), mime, audio, audio.length, Math.max(0, Math.min(600, int(o.seconds))), o.ip]);
  return r!.id;
}

/** a call recording added by staff */
export async function addCall(o: { data: unknown; phone?: unknown; direction?: unknown; note?: unknown; callAt?: Date | null; staffId?: number | null; name?: unknown }) {
  const { audio, mime } = decode(o.data, MAX_BYTES);
  const phone = normalizePhone(o.phone);
  const r = await db.one<{ id: number }>(`INSERT INTO voice_notes(kind, direction, phone, name, mime, audio, bytes, note, staff_id, call_at, status)
    VALUES('call',$1,$2,$3,$4,$5,$6,$7,$8,$9,'heard') RETURNING id`,
  [o.direction === 'out' ? 'out' : o.direction === 'in' ? 'in' : '', validPhone(phone) ? phone : '', clip(o.name, 60), mime, audio, audio.length, clip(o.note, 500), o.staffId ?? null,
    o.callAt && !Number.isNaN(o.callAt.getTime()) ? o.callAt : null]);
  return r!.id;
}

export type ListOpts = { kind?: string; status?: string; q?: string; limit?: number; offset?: number };
export async function list({ kind = '', status = '', q = '', limit = 50, offset = 0 }: ListOpts = {}) {
  const where: string[] = []; const args: unknown[] = [];
  if (kind === 'message' || kind === 'call') { args.push(kind); where.push(`v.kind=$${args.length}`); }
  if (STATUS[status]) { args.push(status); where.push(`v.status=$${args.length}`); }
  const phone = normalizePhone(q);
  if (q) {
    args.push(`%${phone.length >= 4 ? phone : q}%`);
    where.push(`(v.phone LIKE $${args.length} OR v.name ILIKE $${args.length} OR v.note ILIKE $${args.length} OR v.order_code ILIKE $${args.length})`);
  }
  args.push(limit, offset);
  return db.q<VoiceRow>(`SELECT v.id, v.kind, v.direction, v.phone, v.name, v.order_code, v.page, v.mime, v.bytes, v.seconds, v.status, v.note,
      v.staff_id, v.handled_by, v.handled_at, v.call_at, v.created_at, s.name AS staff_name, h.name AS handler_name,
      c.id AS customer_id, c.name AS customer_name,
      (SELECT count(*)::int FROM orders o WHERE o.phone = v.phone AND v.phone <> '') AS orders
    FROM voice_notes v LEFT JOIN staff s ON s.id=v.staff_id LEFT JOIN staff h ON h.id=v.handled_by
      LEFT JOIN LATERAL (SELECT c1.id, c1.name FROM customers c1 WHERE c1.phone = v.phone AND v.phone <> '' ORDER BY c1.id LIMIT 1) c ON true
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
}

export async function counts() {
  return (await db.one<{ all: number; new: number; message: number; call: number }>(`SELECT count(*)::int AS all, count(*) FILTER (WHERE status='new')::int AS new,
    count(*) FILTER (WHERE kind='message')::int AS message, count(*) FILTER (WHERE kind='call')::int AS call FROM voice_notes`))!;
}

export async function audio(id: number) {
  return db.one<{ mime: string; audio: Buffer }>('SELECT mime, audio FROM voice_notes WHERE id=$1', [id]);
}

export async function setStatus(id: number, status: string, staffId: number | null) {
  if (!STATUS[status]) return;
  await db.q(`UPDATE voice_notes SET status=$2, handled_by=CASE WHEN $2='new' THEN NULL ELSE $3 END, handled_at=CASE WHEN $2='new' THEN NULL ELSE now() END WHERE id=$1`, [id, status, staffId]);
}

/** heard once by staff: a new message becomes "heard" (keeps "done") */
export async function markHeard(id: number, staffId: number | null) {
  await db.q(`UPDATE voice_notes SET status='heard', handled_by=$2, handled_at=now() WHERE id=$1 AND status='new'`, [id, staffId]);
}

export async function saveNote(id: number, o: { note?: unknown; phone?: unknown; name?: unknown }) {
  const phone = normalizePhone(o.phone);
  await db.q('UPDATE voice_notes SET note=$2, phone=$3, name=$4 WHERE id=$1', [id, clip(o.note, 500), validPhone(phone) ? phone : '', clip(o.name, 60)]);
}

/** the owner's keeping time: older recordings go for good (the 5-minute timer, at most once an hour) */
export async function purgeOld(s: Settings) {
  const days = Math.max(7, Math.min(3650, int(s.voice_keep_days) || 90));
  const r = await db.q<{ id: number }>(`DELETE FROM voice_notes WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [String(days)]);
  return { removed: r.length };
}

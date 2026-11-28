// 📱 সবমিলবে SMS অ্যাপ — the shop's OWN phone gateway (owner, 2026-11-28).
// The owner's Android phone runs our own app (android-sms/). Nothing sits in between: the shop keeps each SMS in
// sms_outbox, the phone asks the shop for work (/api/smsgw/pull, held open up to 25 s so a code goes out at once),
// sends it from its SIM and reports back (/api/smsgw/report). The old "SMS Gate" app went through someone else's
// cloud and often lost codes — that is why this exists.
//
//   pending  → the phone hasn't taken it yet
//   taken    → the phone has it (not reported within 3 minutes → back to pending, at most 3 tries, never sent twice:
//              the app remembers what it already sent and only reports it again)
//   sent / delivered / failed   → what the phone said
//   expired  → the phone didn't take it within 10 minutes (an old code is no use to the customer any more)
//
// Pairing: Admin → SMS shows a 6-digit code (15 minutes); the app sends it once and gets its own long key back.
// Only the key's sha256 is kept (settings smsgw_token_hash), so the key can't be read from the database.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as db from '../db';
import * as cache from '../cache';
import { str } from '../util';
import type { Settings } from '../types';

export const PAIR_MINUTES = 15;
export const EXPIRE_MINUTES = 10;
export const RETAKE_SECONDS = 180;
export const MAX_TRIES = 3;
const WAIT_MS = 25_000;
const BATCH = 10;

const wake = new EventEmitter();
wake.setMaxListeners(50);

export const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
function same(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Is a phone paired? */
export const paired = (s: Settings) => /^[0-9a-f]{64}$/.test(String(s.smsgw_token_hash || ''));

/** The key the app sends (Authorization: Bearer …) — right for this shop? */
export function keyOk(s: Settings, key: unknown): boolean {
  const k = String(key || '');
  return paired(s) && k.length >= 32 && k.length <= 200 && same(sha(k), String(s.smsgw_token_hash));
}

/** Admin: a new 6-digit pairing code for 15 minutes (only its hash is saved). */
export async function newPairCode(): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.setMany({ smsgw_pair: `${sha('pair:' + code)}|${Date.now() + PAIR_MINUTES * 60e3}` });
  cache.clearAll();
  return code;
}

/** The app sends the code once → its own key (the old phone, if any, stops working). null = wrong / too late. */
export async function pair(code: unknown, model: unknown): Promise<string | null> {
  // read straight from the table (never the 15-second memory): a code must work exactly once
  const row = await db.one<{ value: string }>("SELECT value FROM settings WHERE key='smsgw_pair'");
  const [hash, until] = String(row?.value || '').split('|');
  const c = String(code || '').replace(/\D/g, '');
  if (!hash || !(Number(until) > Date.now()) || c.length !== 6 || !same(sha('pair:' + c), hash)) return null;
  const key = crypto.randomBytes(32).toString('base64url');
  const used = await db.q("UPDATE settings SET value='' WHERE key='smsgw_pair' AND value=$1 RETURNING key", [row!.value]);
  if (!used.length) return null; // the same code sent twice at the same moment: only one wins
  // the phone's row first, the key last: if anything fails on the way, no half-paired shop is left behind
  await db.q(`INSERT INTO sms_phone(id, model, paired_at, last_seen) VALUES(1, $1, now(), now())
    ON CONFLICT (id) DO UPDATE SET model=EXCLUDED.model, paired_at=now(), last_seen=now(), battery=NULL, charging=NULL`, [str(model, 80)]);
  await db.setMany({ smsgw_token_hash: sha(key) });
  cache.clearAll();
  return key;
}

/** All pairing tries together (every connection): at most 60 per 15 minutes. */
export async function pairBudget(): Promise<boolean> {
  const { hit } = await import('../security');
  return hit(db, 'smsgw-pair-all', 60, 900);
}

/** Admin: forget the phone (its key stops working at once). */
export async function unpair(): Promise<void> {
  await db.setMany({ smsgw_token_hash: '', smsgw_pair: '' });
  await db.q('DELETE FROM sms_phone').catch(() => {});
  cache.clearAll();
}

/** The shop hands one SMS to the phone → its id. */
export async function enqueue(phoneIntl: string, body: string): Promise<string> {
  const id = crypto.randomBytes(9).toString('base64url');
  await db.q('INSERT INTO sms_outbox(id, phone, body) VALUES($1,$2,$3)', [id, phoneIntl, body]);
  wake.emit('sms');
  return id;
}

type Out = { id: string; phone: string; body: string };
/** Old work tidied, then up to 10 waiting SMS marked "taken" for the phone. */
/** Old work tidied: too old to send → expired; taken but never reported → tried again or failed (also from the
 * 5-minute job, so a phone that is off for long still gets its SMS marked in the log). */
export async function sweep(): Promise<void> {
  // the log line said "handed to the phone" (ok): an SMS that in the end never left the phone is marked failed there too
  const gone = await db.q<{ log_id: number | null; error: string }>(`UPDATE sms_outbox SET status='expired', error='ফোন ${EXPIRE_MINUTES} মিনিটে নেয়নি', done_at=now()
    WHERE status='pending' AND created_at < now() - make_interval(mins => $1) RETURNING log_id, error`, [EXPIRE_MINUTES]);
  const dead = await db.q<{ log_id: number | null; error: string; status: string }>(`UPDATE sms_outbox SET status=CASE WHEN tries >= $2 THEN 'failed' ELSE 'pending' END,
      error=CASE WHEN tries >= $2 THEN 'ফোন জানায়নি পাঠানো হলো কি না' ELSE error END,
      done_at=CASE WHEN tries >= $2 THEN now() ELSE NULL END
    WHERE status='taken' AND taken_at < now() - make_interval(secs => $1) RETURNING log_id, error, status`, [RETAKE_SECONDS, MAX_TRIES]);
  for (const r of [...gone, ...dead.filter((d) => d.status === 'failed')]) {
    if (r.log_id) await db.q('UPDATE sms_log SET ok=false, detail=$2 WHERE id=$1', [r.log_id, '❌ ' + r.error]).catch(() => {});
  }
}
async function claim(): Promise<Out[]> {
  await sweep();
  return db.q<Out>(`UPDATE sms_outbox SET status='taken', taken_at=now(), tries=tries+1
    WHERE id IN (SELECT id FROM sms_outbox WHERE status='pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING id, phone, body`, [BATCH]);
}

export type PhoneInfo = { battery?: unknown; charging?: unknown; model?: unknown; app?: unknown };
/** The phone asks for work: notes it is alive, then waits (up to 25 s) until something is there. */
export async function pull(info: PhoneInfo, waitMs = WAIT_MS): Promise<Out[]> {
  const b = Number(info.battery);
  await db.q(`INSERT INTO sms_phone(id, model, app, battery, charging, last_seen) VALUES(1,$1,$2,$3,$4,now())
    ON CONFLICT (id) DO UPDATE SET model=coalesce(nullif(EXCLUDED.model,''), sms_phone.model), app=EXCLUDED.app,
      battery=EXCLUDED.battery, charging=EXCLUDED.charging, last_seen=now()`,
  [str(info.model, 80), str(info.app, 20), Number.isFinite(b) && b >= 0 && b <= 100 ? Math.round(b) : null,
    typeof info.charging === 'boolean' ? info.charging : null]);
  let got = await claim();
  if (got.length || waitMs <= 0) return got;
  const until = Date.now() + waitMs;
  while (!got.length && Date.now() < until) {
    // woken at once by a new SMS on this server; every 5 s anyway (just in case another process added it)
    await new Promise<void>((done) => {
      const t = setTimeout(finish, Math.min(5000, until - Date.now()));
      function finish() { clearTimeout(t); wake.off('sms', finish); done(); }
      wake.once('sms', finish);
    });
    got = await claim();
  }
  return got;
}

const STATES = new Set(['sent', 'delivered', 'failed']);
/** What the phone did with each SMS. Delivered never turns back into sent; a finished SMS can't be failed later. */
export async function report(items: unknown): Promise<number> {
  const list = Array.isArray(items) ? items.slice(0, 50) : [];
  let n = 0;
  for (const it of list as { id?: unknown; state?: unknown; error?: unknown }[]) {
    const id = str(it?.id, 40); const st = String(it?.state || '');
    if (!id || !STATES.has(st)) continue;
    const r = await db.q(`UPDATE sms_outbox SET status=$2, error=$3, done_at=now()
      WHERE id=$1 AND status NOT IN ('delivered','expired') AND NOT (status='sent' AND $2='failed') RETURNING log_id`,
    [id, st, st === 'failed' ? str(it.error, 150) || 'ফোন পাঠাতে পারেনি' : '']);
    if (r.length) n += 1;
    const logId = (r[0] as { log_id?: number } | undefined)?.log_id;
    if (logId && st === 'failed') await db.q('UPDATE sms_log SET ok=false, detail=$2 WHERE id=$1', [logId, '❌ ' + (str(it.error, 150) || 'ফোন পাঠাতে পারেনি')]).catch(() => {});
    if (logId && st !== 'failed') await db.q('UPDATE sms_log SET detail=$2 WHERE id=$1', [logId, st === 'delivered' ? '✅ কাস্টমারের ফোনে পৌঁছেছে' : '✅ ফোন থেকে গেছে']).catch(() => {});
  }
  return n;
}

/** Same words the checkout watch already uses for the old app (checkoutotp.ts STATE_BN). */
const STATE_EN: Record<string, string> = { pending: 'Pending', taken: 'Processed', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', expired: 'Failed' };
export async function state(id: string): Promise<{ state: string; error: string } | null> {
  const r = await db.one<{ status: string; error: string }>('SELECT status, error FROM sms_outbox WHERE id=$1', [str(id, 40)]);
  return r ? { state: STATE_EN[r.status] || '', error: r.error || '' } : null;
}

export type PhoneRow = { model: string; app: string; battery: number | null; charging: boolean | null; last_seen: Date | null; paired_at: Date | null };
export async function phone(): Promise<PhoneRow | null> {
  return db.one<PhoneRow>('SELECT model, app, battery, charging, last_seen, paired_at FROM sms_phone WHERE id=1').catch(() => null);
}

/** The app asks every few seconds, so quiet for 5 minutes is already worth a look; 30 minutes = it is off. */
export function levelFor(minutes: number | null, battery: number | null, charging: boolean | null): { level: 'ok' | 'warn' | 'bad'; why: string } {
  if (minutes === null) return { level: 'warn', why: 'ফোনটা এখনো যুক্ত হয়নি' };
  if (minutes > 30) return { level: 'bad', why: `ফোনটা ${Math.round(minutes)} মিনিট ধরে সাড়া দিচ্ছে না — অ্যাপ খোলা আছে আর ইন্টারনেট আছে কি না দেখুন` };
  if (minutes > 5) return { level: 'warn', why: `ফোনটা ${Math.round(minutes)} মিনিট ধরে সাড়া দিচ্ছে না` };
  if (battery !== null && battery <= 20 && charging === false) return { level: 'warn', why: `ফোনের চার্জ ${battery}% — চার্জারে লাগান` };
  return { level: 'ok', why: '' };
}

/** Keep the outbox small: finished SMS older than 30 days go (sms_log keeps the history). */
export async function tidy(): Promise<void> {
  await sweep();
  await db.q("DELETE FROM sms_outbox WHERE created_at < now() - interval '30 days'");
}

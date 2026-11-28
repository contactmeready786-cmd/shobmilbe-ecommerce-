// 📱 সবমিলবে SMS অ্যাপ — the shop's OWN phone gateway (owner, 2026-11-28).
// The owner's Android phones run our own app (android-sms/). Nothing sits in between: the shop keeps each SMS in
// sms_outbox, each phone asks the shop for work (/api/smsgw/pull, held open up to 25 s so a code goes out at once),
// sends it from its SIM and reports back (/api/smsgw/report). The old "SMS Gate" app went through someone else's
// cloud and often lost codes — that is why this exists.
//
// Main phone + backup (owner, 2026-11-28): up to 3 phones can be connected; the owner picks the MAIN one in the admin.
//   - Everything goes from the main phone while it is there, so customers get their code from one number.
//   - Main phone not connected right now (no word for 35 s) → a backup phone takes the SMS at once.
//   - Main phone connected but the SMS still waits 8 s (phone stuck, app frozen) → a backup takes it.
//   - A phone that could not send (no balance, no signal) → once more from another phone, if one is there.
//
//   pending  → no phone has taken it yet
//   taken    → a phone has it (not reported within 3 minutes → back to pending, at most 3 tries; the app remembers
//              what it already sent, so it never sends the same SMS twice)
//   sent / delivered / failed   → what the phone said
//   expired  → no phone took it within 10 minutes (an old code is no use to the customer any more)
//
// Pairing: Admin → SMS shows a 6-digit code (15 minutes); the app trades it once for its own long key.
// Only the key's sha256 is kept (sms_phones.key_hash), so the key can't be read from the database.
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
export const MAX_PHONES = 3;
/** a backup phone takes an SMS the main phone hasn't taken within this time */
export const BACKUP_AFTER_SECONDS = 8;
/** the main phone counts as connected when it asked the shop within this time (it asks again right after each answer) */
export const ONLINE_SECONDS = 35;
const WAIT_MS = 25_000;
const BATCH = 10;

const wake = new EventEmitter();
wake.setMaxListeners(50);

export const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
function same(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export type PhoneRow = { id: number; model: string; app: string; battery: number | null; charging: boolean | null; last_seen: Date | null; paired_at: Date | null };

/** Is at least one phone connected? (settings.smsgw_phones is kept up to date as a count, so this needs no query) */
export const paired = (s: Settings) => Number(s.smsgw_phones || 0) > 0;
async function recount(): Promise<void> {
  const r = await db.one<{ n: number; first: number | null }>('SELECT count(*)::int AS n, min(id) AS first FROM sms_phones');
  const main = await db.one<{ value: string }>("SELECT value FROM settings WHERE key='smsgw_main'");
  const mainOk = main?.value ? await db.one('SELECT 1 FROM sms_phones WHERE id=$1', [Number(main.value) || 0]) : null;
  // the main phone was removed (or none chosen yet) → the oldest one left becomes the main phone
  await db.setMany({ smsgw_phones: String(r?.n || 0), ...(mainOk ? {} : { smsgw_main: r?.first ? String(r.first) : '' }) });
  cache.clearAll();
}

/** The key the app sends (Authorization: Bearer …) → that phone's id, or null. */
export async function phoneFor(key: unknown): Promise<number | null> {
  const k = String(key || '');
  if (k.length < 32 || k.length > 200) return null;
  const h = sha(k);
  const r = await db.one<{ id: number; key_hash: string }>('SELECT id, key_hash FROM sms_phones WHERE key_hash=$1', [h]);
  return r && same(r.key_hash, h) ? r.id : null;
}

/** Admin: a new 6-digit pairing code for 15 minutes (only its hash is saved). */
export async function newPairCode(): Promise<string> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.setMany({ smsgw_pair: `${sha('pair:' + code)}|${Date.now() + PAIR_MINUTES * 60e3}` });
  cache.clearAll();
  return code;
}

/** All pairing tries together (every connection): at most 60 per 15 minutes. */
export async function pairBudget(): Promise<boolean> {
  const { hit } = await import('../security');
  return hit(db, 'smsgw-pair-all', 60, 900);
}

/** The app sends the code once → its own key; the phone is added (the first one becomes the main phone).
 * null = wrong / too late / already 3 phones. */
export async function pair(code: unknown, model: unknown): Promise<string | null> {
  // read straight from the table (never the 15-second memory): a code must work exactly once
  const row = await db.one<{ value: string }>("SELECT value FROM settings WHERE key='smsgw_pair'");
  const [hash, until] = String(row?.value || '').split('|');
  const c = String(code || '').replace(/\D/g, '');
  if (!hash || !(Number(until) > Date.now()) || c.length !== 6 || !same(sha('pair:' + c), hash)) return null;
  const count = await db.one<{ n: number }>('SELECT count(*)::int AS n FROM sms_phones');
  if ((count?.n || 0) >= MAX_PHONES) return null;
  const used = await db.q("UPDATE settings SET value='' WHERE key='smsgw_pair' AND value=$1 RETURNING key", [row!.value]);
  if (!used.length) return null; // the same code sent twice at the same moment: only one wins
  const key = crypto.randomBytes(32).toString('base64url');
  await db.q('INSERT INTO sms_phones(key_hash, model, paired_at, last_seen) VALUES($1, $2, now(), now())', [sha(key), str(model, 80)]);
  await recount();
  return key;
}

/** Admin: forget one phone (its key stops working at once), or every phone. */
export async function unpair(id?: number): Promise<void> {
  if (id) await db.q('DELETE FROM sms_phones WHERE id=$1', [id]);
  else { await db.q('DELETE FROM sms_phones'); await db.setMany({ smsgw_pair: '' }); }
  await recount();
}

/** Admin: this phone becomes the main phone. */
export async function setMain(id: number): Promise<boolean> {
  if (!(await db.one('SELECT 1 FROM sms_phones WHERE id=$1', [id]))) return false;
  await db.setMany({ smsgw_main: String(id) });
  cache.clearAll();
  return true;
}

export async function phones(): Promise<PhoneRow[]> {
  return db.q<PhoneRow>('SELECT id, model, app, battery, charging, last_seen, paired_at FROM sms_phones ORDER BY id').catch(() => []);
}

/** The shop hands one SMS to the phones → its id. */
export async function enqueue(phoneIntl: string, body: string): Promise<string> {
  const id = crypto.randomBytes(9).toString('base64url');
  await db.q('INSERT INTO sms_outbox(id, phone, body) VALUES($1,$2,$3)', [id, phoneIntl, body]);
  wake.emit('sms');
  return id;
}

/** Old work tidied: too old to send → expired; taken but never reported → tried again or failed (also from the
 * 5-minute job, so with every phone off the log still shows the truth). */
export async function sweep(): Promise<void> {
  // the log line said "handed to the phone" (ok): an SMS that in the end never left a phone is marked failed there too
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

type Out = { id: string; phone: string; body: string };
/** Is this phone the main one, and is the main phone connected right now? */
async function role(phoneId: number): Promise<{ main: boolean; mainOnline: boolean }> {
  const m = await db.one<{ value: string }>("SELECT value FROM settings WHERE key='smsgw_main'");
  const mainId = Number(m?.value || 0);
  // no main phone chosen (or it was removed): every phone counts as main
  if (!mainId || mainId === phoneId) return { main: true, mainOnline: true };
  const on = await db.one<{ on: boolean }>('SELECT last_seen > now() - make_interval(secs => $2) AS on FROM sms_phones WHERE id=$1', [mainId, ONLINE_SECONDS]);
  return { main: false, mainOnline: !!on?.on };
}
/** Up to 10 waiting SMS this phone may take now, marked "taken" by it. The main phone takes everything; a backup
 * only what waited 8 s, or everything while the main phone is away; never one it already failed to send. */
async function claim(phoneId: number): Promise<{ got: Out[]; nextMs: number }> {
  await sweep();
  const { main, mainOnline } = await role(phoneId);
  const wait = main || !mainOnline ? 0 : BACKUP_AFTER_SECONDS;
  const got = await db.q<Out>(`UPDATE sms_outbox SET status='taken', taken_at=now(), tries=tries+1, phone_id=$3
    WHERE id IN (SELECT id FROM sms_outbox WHERE status='pending' AND coalesce(avoid_phone, 0) <> $3
      AND created_at <= now() - make_interval(secs => $2) ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING id, phone, body`, [BATCH, wait, phoneId]);
  if (got.length || !wait) return { got, nextMs: 5000 };
  // a backup: when does the next waiting SMS become its turn?
  const next = await db.one<{ ms: number | null }>(`SELECT (extract(epoch FROM (min(created_at) + make_interval(secs => $1) - now())) * 1000)::int AS ms
    FROM sms_outbox WHERE status='pending' AND coalesce(avoid_phone, 0) <> $2`, [wait, phoneId]);
  const ms = next?.ms;
  return { got, nextMs: ms !== null && ms !== undefined ? Math.max(200, Math.min(5000, ms + 100)) : 5000 };
}

export type PhoneInfo = { battery?: unknown; charging?: unknown; model?: unknown; app?: unknown };
async function seen(phoneId: number, info: PhoneInfo): Promise<void> {
  const b = Number(info.battery);
  await db.q(`UPDATE sms_phones SET model=coalesce(nullif($2,''), model), app=$3, battery=$4, charging=$5, last_seen=now() WHERE id=$1`,
    [phoneId, str(info.model, 80), str(info.app, 20), Number.isFinite(b) && b >= 0 && b <= 100 ? Math.round(b) : null,
      typeof info.charging === 'boolean' ? info.charging : null]);
}
/** A phone asks for work: notes it is alive, then waits (up to 25 s) until something is there for it. */
export async function pull(phoneId: number, info: PhoneInfo, waitMs = WAIT_MS): Promise<Out[]> {
  await seen(phoneId, info);
  let { got, nextMs } = await claim(phoneId);
  if (got.length || waitMs <= 0) return got;
  const until = Date.now() + waitMs;
  while (!got.length && Date.now() < until) {
    // woken at once by a new SMS on this server; anyway when a backup's turn comes, or every 5 s
    await new Promise<void>((done) => {
      const t = setTimeout(finish, Math.max(50, Math.min(nextMs, until - Date.now())));
      function finish() { clearTimeout(t); wake.off('sms', finish); done(); }
      wake.once('sms', finish);
    });
    ({ got, nextMs } = await claim(phoneId));
  }
  await seen(phoneId, info); // still here at the end of the wait: the main phone stays "connected"
  return got;
}

const STATES = new Set(['sent', 'delivered', 'failed']);
/** What a phone did with each SMS. Delivered never turns back into sent; a finished SMS can't be failed later.
 * A phone that couldn't send → once more from another connected phone (before the customer gives up). */
export async function report(phoneId: number, items: unknown): Promise<number> {
  const list = Array.isArray(items) ? items.slice(0, 50) : [];
  const model = (await db.one<{ model: string }>('SELECT model FROM sms_phones WHERE id=$1', [phoneId]))?.model || 'ফোন';
  let n = 0;
  for (const it of list as { id?: unknown; state?: unknown; error?: unknown }[]) {
    const id = str(it?.id, 40); const st = String(it?.state || '');
    if (!id || !STATES.has(st)) continue;
    const err = st === 'failed' ? str(it.error, 150) || 'ফোন পাঠাতে পারেনি' : '';
    if (st === 'failed') {
      // another phone connected (asked within the last 2 minutes) → back in the queue for it — once only (avoid_phone set)
      const again = await db.q(`UPDATE sms_outbox o SET status='pending', avoid_phone=$2, error=$3, taken_at=NULL
        WHERE o.id=$1 AND o.status='taken' AND o.phone_id=$2 AND o.avoid_phone IS NULL AND o.tries < $4 AND o.created_at > now() - make_interval(mins => $5)
          AND EXISTS (SELECT 1 FROM sms_phones p WHERE p.id <> $2 AND p.last_seen > now() - interval '2 minutes') RETURNING o.id`,
      [id, phoneId, err, MAX_TRIES, EXPIRE_MINUTES]);
      if (again.length) { n += 1; wake.emit('sms'); continue; }
    }
    const r = await db.q<{ log_id: number | null }>(`UPDATE sms_outbox SET status=$2, error=$3, done_at=now(), phone_id=$4
      WHERE id=$1 AND status NOT IN ('delivered','expired') AND NOT (status='sent' AND $2='failed') RETURNING log_id`,
    [id, st, err, phoneId]);
    if (r.length) n += 1;
    const logId = r[0]?.log_id;
    const from = ` (${model})`;
    if (logId && st === 'failed') await db.q('UPDATE sms_log SET ok=false, detail=$2 WHERE id=$1', [logId, '❌ ' + err + from]).catch(() => {});
    if (logId && st !== 'failed') await db.q('UPDATE sms_log SET detail=$2 WHERE id=$1', [logId, (st === 'delivered' ? '✅ কাস্টমারের ফোনে পৌঁছেছে' : '✅ ফোন থেকে গেছে') + from]).catch(() => {});
  }
  return n;
}

/** Same words the checkout watch already uses (checkoutotp.ts STATE_BN). */
const STATE_EN: Record<string, string> = { pending: 'Pending', taken: 'Processed', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', expired: 'Failed' };
export async function state(id: string): Promise<{ state: string; error: string } | null> {
  const r = await db.one<{ status: string; error: string }>('SELECT status, error FROM sms_outbox WHERE id=$1', [str(id, 40)]);
  return r ? { state: STATE_EN[r.status] || '', error: r.error || '' } : null;
}

/** The app asks every few seconds, so quiet for 5 minutes is already worth a look; 30 minutes = it is off. */
export function levelFor(minutes: number | null, battery: number | null, charging: boolean | null): { level: 'ok' | 'warn' | 'bad'; why: string } {
  if (minutes === null) return { level: 'warn', why: 'ফোনটা এখনো যুক্ত হয়নি' };
  if (minutes > 30) return { level: 'bad', why: `ফোনটা ${Math.round(minutes)} মিনিট ধরে সাড়া দিচ্ছে না — অ্যাপ খোলা আছে আর ইন্টারনেট আছে কি না দেখুন` };
  if (minutes > 5) return { level: 'warn', why: `ফোনটা ${Math.round(minutes)} মিনিট ধরে সাড়া দিচ্ছে না` };
  if (battery !== null && battery <= 20 && charging === false) return { level: 'warn', why: `ফোনের চার্জ ${battery}% — চার্জারে লাগান` };
  return { level: 'ok', why: '' };
}
export const minutesAgo = (d: Date | null | undefined) => (d ? Math.max(0, (Date.now() - new Date(d).getTime()) / 60e3) : null);

/** Keep the outbox small: finished SMS older than 30 days go (sms_log keeps the history). */
export async function tidy(): Promise<void> {
  await sweep();
  await db.q("DELETE FROM sms_outbox WHERE created_at < now() - interval '30 days'");
}

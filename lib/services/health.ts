// 🩺 সার্ভার ও ডাটাবেস: what the owner would otherwise have to log into Supabase / Vercel to see, measured by the
// site itself — database space used against the plan's limit, the biggest tables, how fast the database answers,
// open connections, the last good backup — plus an e-mail BEFORE something runs out.
//
// Shown on Admin → সংযোগের অবস্থা (and a warning line on the dashboard). Warnings go to the shop's one Gmail
// (আমার নোটিফিকেশন) at most once a day per problem, again when it gets worse.
import * as db from '../db';
import * as N from './notify';
import * as security from '../security';
import { bn } from '../util';
import * as ik from './imagekit';
import * as SMS from './sms';
import { databaseTls, type TlsState } from '../pg';
import type { Settings } from '../types';

export const DEFAULT_LIMIT_MB = 500; // Supabase free plan
const WARN_AT = 0.8;
const BAD_AT = 0.9;
const BACKUP_WARN_DAYS = 2;

export type Level = 'ok' | 'warn' | 'bad';
export type Health = {
  dbBytes: number; limitBytes: number; share: number; dbLevel: Level;
  tables: { name: string; bytes: number; rows: number }[];
  pingMs: number | null; pingLevel: Level;
  connections: number | null; maxConnections: number | null; connLevel: Level;
  backupAt: Date | null; backupDays: number | null; backupLevel: Level;
  errors24: ErrorRow[]; errors7: ErrorRow[]; errorLevel: Level;
  sms: SMS.PhoneStatus | null;
  tls: TlsState; tlsLevel: Level;
  ik: null | { bandwidthBytes: number; bandwidthLimit: number; bwLevel: Level; storageBytes: number; storageLimit: number; storageLevel: Level; since: string };
  checkedAt: Date;
};

export function limitBytes(settings: Settings): number {
  const mb = Number(settings.db_limit_mb);
  return (Number.isFinite(mb) && mb >= 100 && mb <= 1_000_000 ? mb : DEFAULT_LIMIT_MB) * 1024 * 1024;
}
const GB = 1024 ** 3;
// ImageKit free plan: 20 GB bandwidth a month, 3 GB storage (ik_bw_limit_gb / ik_storage_limit_gb to change)
export function ikLimits(settings: Settings): { bandwidth: number; storage: number } {
  const n = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) && x >= 1 && x <= 100000 ? x : d; };
  return { bandwidth: n(settings.ik_bw_limit_gb, 20) * GB, storage: n(settings.ik_storage_limit_gb, 3) * GB };
}
/** Errors per page: 5 in a day is worth a look, 30 is serious. */
export function errorLevel(rows: { n: number }[]): Level {
  const top = rows.reduce((m, r) => Math.max(m, Number(r.n) || 0), 0);
  return top >= 30 ? 'bad' : top >= 5 ? 'warn' : 'ok';
}
/** The database connection's certificate: checked = ok; a Supabase certificate that failed the check = bad. */
export function tlsLevelFor(t: TlsState): Level { return t.problem ? 'bad' : 'ok'; }
export function levelFor(share: number): Level { return share >= BAD_AT ? 'bad' : share >= WARN_AT ? 'warn' : 'ok'; }

async function ping(): Promise<number | null> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    try { await db.q('SELECT 1'); } catch { return null; }
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[1]);
}

async function load(settings: Settings): Promise<Health> {
  const [size, tables, conn, backup, pingMs] = await Promise.all([
    db.one(`SELECT pg_database_size(current_database())::bigint AS bytes`).catch(() => null),
    db.q(`SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, greatest(c.reltuples, 0)::bigint AS rows
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 6`).catch(() => []),
    db.one(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS n,
                   current_setting('max_connections')::int AS max`).catch(() => null),
    db.one(`SELECT created_at FROM backups WHERE ok ORDER BY created_at DESC LIMIT 1`).catch(() => null),
    ping(),
  ]);
  const [errors24, errors7, ikUse] = await Promise.all([
    db.q(`SELECT path, message, sum(n)::int AS n, max(last_at) AS last_at FROM error_log WHERE last_at > now() - interval '24 hours'
          GROUP BY path, message ORDER BY 3 DESC LIMIT 10`).catch(() => []),
    db.q(`SELECT path, message, sum(n)::int AS n, max(last_at) AS last_at FROM error_log WHERE day > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7
          GROUP BY path, message ORDER BY 3 DESC LIMIT 10`).catch(() => []),
    ik.usage().catch(() => null),
  ]);
  const sms = await SMS.phoneStatus(settings).catch(() => null);
  const lims = ikLimits(settings);
  const dbBytes = Number(size?.bytes || 0);
  const lim = limitBytes(settings);
  const share = lim ? dbBytes / lim : 0;
  const backupAt = backup?.created_at ? new Date(backup.created_at) : null;
  const backupDays = backupAt ? (Date.now() - backupAt.getTime()) / 864e5 : null;
  const connections = conn ? Number(conn.n) : null;
  const maxConnections = conn ? Number(conn.max) : null;
  return {
    dbBytes, limitBytes: lim, share, dbLevel: size ? levelFor(share) : 'warn',
    tables: tables.map((t) => ({ name: String(t.name), bytes: Number(t.bytes), rows: Number(t.rows) })),
    pingMs, pingLevel: pingMs === null ? 'bad' : pingMs > 400 ? 'bad' : pingMs > 150 ? 'warn' : 'ok',
    connections, maxConnections,
    connLevel: connections !== null && maxConnections ? levelFor(connections / maxConnections) : 'ok',
    backupAt, backupDays, backupLevel: backupDays === null ? 'bad' : backupDays > BACKUP_WARN_DAYS ? 'warn' : 'ok',
    errors24: errors24 as ErrorRow[], errors7: errors7 as ErrorRow[], errorLevel: errorLevel(errors24 as ErrorRow[]),
    sms,
    tls: databaseTls(), tlsLevel: tlsLevelFor(databaseTls()),
    ik: ikUse ? {
      bandwidthBytes: ikUse.bandwidthBytes, bandwidthLimit: lims.bandwidth, bwLevel: levelFor(ikUse.bandwidthBytes / lims.bandwidth),
      storageBytes: ikUse.storageBytes, storageLimit: lims.storage, storageLevel: levelFor(ikUse.storageBytes / lims.storage), since: ikUse.since,
    } : null,
    checkedAt: new Date(),
  };
}

// Measured at most every 5 minutes per server (the size queries are not free) — also on admin pages, where
// lib/cache.ts reads everything fresh: a few minutes' delay doesn't matter here.
let last: { at: number; value: Promise<Health> } | null = null;
export function measure(settings: Settings): Promise<Health> {
  if (last && Date.now() - last.at < 5 * 60e3) return last.value;
  const value = load(settings);
  last = { at: Date.now(), value };
  value.catch(() => { last = null; });
  return value;
}
export function forget(): void { last = null; }

export function mb(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

// what each big table is, and where the owner can make it smaller
export const TABLE_HELP: Record<string, [string, string?]> = {
  page_views: ['ভিজিটর অ্যানালিটিক্স (পেজ দেখা)', '/admin/marketing/visitors?tab=settings'],
  visit_sessions: ['ভিজিটর অ্যানালিটিক্স (ভিজিট)', '/admin/marketing/visitors?tab=settings'],
  visit_events: ['ভিজিটর অ্যানালিটিক্স (ক্লিক)', '/admin/marketing/visitors?tab=settings'],
  visitors: ['ভিজিটর অ্যানালিটিক্স (ভিজিটর)', '/admin/marketing/visitors?tab=settings'],
  activity_log: ['অডিট লগ (কে কী বদলেছে)', '/admin/security/audit'],
  media: ['ছবি (ImageKit-এ যায়নি এমন)'],
  orders: ['অর্ডার'], order_items: ['অর্ডারের পণ্য'], products: ['পণ্য'], customers: ['কাস্টমার'],
  trash: ['রিসাইকেল বিন', '/admin/trash'], backups: ['ব্যাকআপের তালিকা', '/admin/backup'],
  research_products: ['মার্কেট রিসার্চ'], market_items: ['মার্কেট রিসার্চ'],
};

// ---------------------------------------------------------------- the site's own error log
// Ids, codes and long numbers in an address become ':' so the same page's errors are counted together.
export function pagePattern(path: unknown): string {
  return String(path || '/').split('?')[0].slice(0, 200)
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/(SM|TEST)[A-Z0-9]{4,}(?=\/|$)/g, '/:code')
    .replace(/\/[a-f0-9]{16,}(?=\/|$)/gi, '/:key');
}
export function errorText(e: unknown): string {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  // personal details never go into the log: phone numbers and e-mail addresses are blanked
  return m.replace(/01[3-9]\d{8}/g, '01•••••••••').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••@•••').slice(0, 300);
}
/** Counts one error for its page (one row per day + page + message). Never throws, never waits long. */
export function logError(e: unknown, context?: Record<string, unknown>): void {
  const path = pagePattern(context?.path);
  const method = String(context?.method || '').slice(0, 10);
  db.q(`INSERT INTO error_log(day, path, message, method) VALUES((now() AT TIME ZONE 'Asia/Dhaka')::date, $1, $2, $3)
        ON CONFLICT (day, path, message) DO UPDATE SET n = error_log.n + 1, last_at = now()`, [path, errorText(e), method]).catch(() => {});
  if (Math.random() < 0.02) db.q(`DELETE FROM error_log WHERE day < (now() AT TIME ZONE 'Asia/Dhaka')::date - 30`).catch(() => {});
}
export type ErrorRow = { path: string; message: string; n: number; last_at: Date };

type Warning = { key: string; level: Level; title: string; text: string };
export function warnings(h: Health): Warning[] {
  const out: Warning[] = [];
  if (h.dbLevel !== 'ok') out.push({ key: 'db', level: h.dbLevel, title: `ডাটাবেস ${bn(Math.round(h.share * 100))}% ভরে গেছে`,
    text: `ডাটাবেসে ${bn(mb(h.dbBytes))} MB / ${bn(mb(h.limitBytes))} MB ব্যবহার হয়েছে। পুরো ভরে গেলে নতুন অর্ডার সেভ হবে না।\nসবচেয়ে বড়: ${h.tables.slice(0, 3).map((t) => `${(TABLE_HELP[t.name] || [t.name])[0]} ${bn(mb(t.bytes))} MB`).join(', ')}।\nকরণীয়: ভিজিটর অ্যানালিটিক্সের তথ্য কম দিন রাখুন, বা Supabase-এর প্ল্যান বাড়ান।` });
  if (h.connLevel !== 'ok') out.push({ key: 'conn', level: h.connLevel, title: 'ডাটাবেসে সংযোগ প্রায় শেষ',
    text: `${bn(h.connections)} / ${bn(h.maxConnections)} সংযোগ খোলা। সব শেষ হলে সাইট খুলবে না।` });
  if (h.backupLevel !== 'ok') out.push({ key: 'backup', level: h.backupLevel, title: h.backupAt ? `${bn(Math.floor(h.backupDays!))} দিন ধরে ব্যাকআপ হয়নি` : 'কোনো ব্যাকআপ নেই',
    text: 'প্রতিদিন রাতে নিজে থেকে ব্যাকআপ হওয়ার কথা। Admin → ব্যাকআপ পেজে দেখুন।' });
  if (h.errorLevel !== 'ok') {
    const top = h.errors24.slice(0, 3);
    out.push({ key: 'errors', level: h.errorLevel, title: `${top[0]?.path || 'একটা পেজ'}-এ বারবার এরর হচ্ছে (২৪ ঘণ্টায় ${bn(top[0]?.n || 0)} বার)`,
      text: `যেসব পেজে কাস্টমার "একটা সমস্যা হয়েছে" দেখছেন:\n${top.map((r) => `• ${r.path} — ${bn(r.n)} বার: ${r.message}`).join('\n')}\nClaude-কে এই লেখাটা দেখালেই ঠিক করে দিতে পারবে।` });
  }
  if (h.tlsLevel === 'bad') out.push({ key: 'db_tls', level: 'bad', title: 'ডাটাবেসের সার্টিফিকেট যাচাইয়ে মিলছে না',
    text: `দোকান ডাটাবেসের সাথে এনক্রিপ্ট করেই কথা বলছে, কিন্তু অপর পাশে যে আসল Supabase, সেটা প্রমাণ হয়নি (${h.tls.problem})।\nসাধারণত এর মানে Supabase তাদের সার্টিফিকেট বদলেছে — তবে কেউ মাঝখানে বসার চেষ্টা করলেও এমন হয়।\nকরণীয়: Claude-কে এই ইমেইলটা দেখান; ততক্ষণ দোকান স্বাভাবিকভাবে চলবে।` });
  if (h.sms && h.sms.on && (h.sms.phoneLevel === 'warn' || h.sms.phoneLevel === 'bad')) out.push({ key: 'sms_phone', level: h.sms.phoneLevel,
    title: `SMS পাঠানোর ফোন: ${h.sms.phoneWhy}`,
    text: 'এই ফোন থেকেই কাস্টমারের চেকআউট কোড (OTP) যায়। ফোন বন্ধ থাকলে গেস্ট কাস্টমার অর্ডার শেষ করতে পারবেন না।\nকরণীয়: ফোনটা চালু আছে কিনা, WiFi আছে কিনা, চার্জে আছে কিনা দেখুন, আর textbee অ্যাপটা একবার খুলুন।' });
  if (h.sms && h.sms.on && h.sms.sendLevel !== 'ok') out.push({ key: 'sms_send', level: h.sms.sendLevel,
    title: `গত ৬ ঘণ্টায় ${bn(h.sms.failed6h)}টা SMS যায়নি`,
    text: `সফল: ${bn(h.sms.sent6h)}টা, ব্যর্থ: ${bn(h.sms.failed6h)}টা। চেকআউটের কোড না গেলে কাস্টমার অর্ডার করতে পারবেন না।\nকারণ দেখুন: Admin → মার্কেটিং → কাস্টমারকে মেসেজ → SMS (লগ)। ফোনের ব্যালেন্সও দেখুন।` });
  if (h.ik && h.ik.bwLevel !== 'ok') out.push({ key: 'ik_bw', level: h.ik.bwLevel, title: `ছবির ব্যান্ডউইথ এই মাসে ${bn(Math.round(100 * h.ik.bandwidthBytes / h.ik.bandwidthLimit))}% শেষ`,
    text: `ImageKit-এ এই মাসে ${bn(gb(h.ik.bandwidthBytes))} GB / ${bn(gb(h.ik.bandwidthLimit))} GB খরচ হয়েছে। শেষ হয়ে গেলে মাসের বাকি সময় ছবি না-ও দেখাতে পারে।` });
  if (h.ik && h.ik.storageLevel !== 'ok') out.push({ key: 'ik_storage', level: h.ik.storageLevel, title: `ImageKit-এর জায়গা ${bn(Math.round(100 * h.ik.storageBytes / h.ik.storageLimit))}% ভরা`,
    text: `ছবি রাখার জায়গা ${bn(gb(h.ik.storageBytes))} GB / ${bn(gb(h.ik.storageLimit))} GB। ভরে গেলে নতুন ছবি আপলোড হবে না। রিসাইকেল বিন খালি করলে জায়গা ফেরত আসে।` });
  return out;
}
export function gb(bytes: number): string { return (bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 2); }

/**
 * Called now and then (background tick, daily job). E-mails the owner about each problem at most once a day,
 * and at once when it gets worse (warn → bad). Never throws.
 */
export async function checkAndAlert(settings: Settings): Promise<number> {
  try {
    if (settings.health_alerts === '0' || !N.emailConfig(settings).ready) return 0;
    if (!(await security.hit(db, 'health:check', 1, 1800))) return 0; // all servers together: every 30 minutes
    const h = await load(settings);
    let sent = 0;
    for (const w of warnings(h)) {
      const worse = w.level === 'bad' && (await security.hit(db, `health:bad:${w.key}`, 1, 86400));
      const daily = await security.hit(db, `health:${w.key}`, 1, 86400);
      if (!worse && !daily) continue;
      await N.sendEmail(settings, `${w.level === 'bad' ? '🚨' : '⚠️'} ${settings.store_name}: ${w.title}`,
        `${w.text}\n\nবিস্তারিত: Admin → সংযোগের অবস্থা → 🩺 সার্ভার ও ডাটাবেস`);
      sent++;
    }
    return sent;
  } catch (e) {
    console.error('health check failed', e);
    return 0;
  }
}

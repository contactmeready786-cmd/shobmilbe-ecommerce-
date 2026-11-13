// The shop backs itself up once a day — no setup needed.
//  - Everything in the database (pictures' addresses included; the pictures themselves are on ImageKit),
//    locked with a password (AES-256-GCM), uploaded to ImageKit under /shobmilbe/backups with a random name.
//  - Started by the daily Vercel cron and, as a spare, by the hourly market-research tick; it only runs when
//    the last good automatic backup is more than 20 hours old.
//  - Owner, 2026-11-13: only the running day's and the day before's are kept (the newest 2); older ones are removed
//    from ImageKit — and the server's own nightly copies (/var/backups/shobmilbe) are cut to the newest 2 too.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as db from '../db';
import * as backup from './backup';
import * as imagekit from './imagekit';
import type { Body, Caught } from '../types';
import type { BackupsRow, SettingsRow } from '../data/rows';

const KEEP = 2;
export const LOCAL_DIR = '/var/backups/shobmilbe';

// The password that locks the files. From Vercel (BACKUP_PASSWORD, or made from ENCRYPTION_KEY) when there,
// so it survives even if the database is lost; otherwise one made once and kept in the settings.
async function password() {
  const env = String(process.env.BACKUP_PASSWORD || '').trim();
  if (env.length >= 12) return { pw: env, from: 'vercel' };
  const k = String(process.env.ENCRYPTION_KEY || '').trim();
  if (k.length >= 16) return { pw: 'sm-' + crypto.createHmac('sha256', k).update('shobmilbe-backup').digest('base64url').slice(0, 24), from: 'key' };
  const s = await db.getSettings();
  if (s.auto_backup_password && s.auto_backup_password.length >= 12) return { pw: s.auto_backup_password, from: 'settings' };
  const pw = 'sm-' + crypto.randomBytes(18).toString('base64url');
  await db.setSetting('auto_backup_password', pw);
  return { pw, from: 'settings' };
}

async function due() {
  const last = await db.one<Pick<BackupsRow, 'created_at'>>(`SELECT created_at FROM backups WHERE kind='auto' AND ok ORDER BY created_at DESC LIMIT 1`).catch(() => null);
  return !last || Date.now() - new Date(last.created_at).getTime() > 20 * 3600 * 1000;
}

type RunOpts = {
  force?: boolean;
};
async function run({ force = false }: RunOpts = {}) {
  if (!imagekit.configured()) return { skipped: 'no-imagekit' };
  if (!force && !(await due())) return { skipped: 'not-due' };
  // one at a time across all running copies of the site
  const lease = await db.one<Pick<SettingsRow, 'key'>>(`INSERT INTO settings(key, value) VALUES('auto_backup_lease', $1)
    ON CONFLICT (key) DO UPDATE SET value=$1 WHERE settings.value IS NULL OR settings.value < $2 RETURNING key`,
  [String(Date.now() + 120000), String(Date.now())]);
  if (!lease) return { skipped: 'busy' };
  try {
    const { pw } = await password();
    const r = await backup.dump(db, { withImages: true, withAnalytics: false, password: pw });
    const day = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `shobmilbe-backup-${day}-${crypto.randomBytes(6).toString('hex')}.smbk`;
    const up = await imagekit.upload(r.buffer, 'application/octet-stream', name, 'backups', name);
    await db.q(`INSERT INTO backups(kind, ok, size_bytes, tables, rows_count, with_images, encrypted, note, ik_id, ik_url)
      VALUES('auto', true, $1, $2, $3, true, true, 'ImageKit', $4, $5)`, [r.buffer.length, r.tables, r.rows, up.fileId, up.url]);
    await pruneRemote();
    pruneLocal();
    return { ok: true, size: r.buffer.length, rows: r.rows };
  } catch (caught) { const e = caught as Caught;
    await db.q(`INSERT INTO backups(kind, ok, note) VALUES('auto', false, $1)`, [String(e.message).slice(0, 300)]).catch(() => {});
    return { ok: false, error: e.message };
  } finally {
    await db.q(`UPDATE settings SET value=NULL WHERE key='auto_backup_lease'`).catch(() => {});
  }
}

/** ImageKit: keep the newest KEEP automatic backups, remove the older files (their rows stay, marked as removed) */
export async function pruneRemote(): Promise<number> {
  const old = await db.q<Pick<BackupsRow, 'id' | 'ik_id'>>(`SELECT id, ik_id FROM backups WHERE kind='auto' AND ok AND ik_id IS NOT NULL ORDER BY created_at DESC OFFSET ${KEEP}`).catch(() => []);
  let n = 0;
  for (const o of old) {
    try { if (await imagekit.remove(o.ik_id)) { await db.q('UPDATE backups SET ik_id=NULL, ik_url=NULL, note=$1 WHERE id=$2', ['পুরনো, মুছে ফেলা হয়েছে', o.id]); n++; } } catch (_) { /* next time */ }
  }
  return n;
}
/** the server's own nightly database copies (cron pg_dump): keep the newest KEEP, delete the rest. Answers how many
 *  were deleted, or -1 when the folder can't be changed from the website (then the server's cron keeps its own count). */
export function pruneLocal(dir = LOCAL_DIR): number {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^db-.*\.dump$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    let n = 0;
    for (const x of files.slice(KEEP)) { fs.unlinkSync(path.join(dir, x.f)); n++; }
    return n;
  } catch { return -1; }
}

export { run, password, due, KEEP };

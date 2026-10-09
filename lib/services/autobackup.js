'use strict';
// The shop backs itself up once a day — no setup needed.
//  - Everything in the database (pictures' addresses included; the pictures themselves are on ImageKit),
//    locked with a password (AES-256-GCM), uploaded to ImageKit under /shobmilbe/backups with a random name.
//  - Started by the daily Vercel cron and, as a spare, by the hourly market-research tick; it only runs when
//    the last good automatic backup is more than 20 hours old.
//  - The newest 30 are kept; older ones are removed from ImageKit.
const crypto = require('crypto');
const db = require('../db');
const backup = require('./backup');
const imagekit = require('./imagekit');

const KEEP = 30;

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
  const last = await db.one(`SELECT created_at FROM backups WHERE kind='auto' AND ok ORDER BY created_at DESC LIMIT 1`).catch(() => null);
  return !last || Date.now() - new Date(last.created_at).getTime() > 20 * 3600 * 1000;
}

async function run({ force = false } = {}) {
  if (!imagekit.configured()) return { skipped: 'no-imagekit' };
  if (!force && !(await due())) return { skipped: 'not-due' };
  // one at a time across all running copies of the site
  const lease = await db.one(`INSERT INTO settings(key, value) VALUES('auto_backup_lease', $1)
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
    // keep the newest KEEP automatic backups
    const old = await db.q(`SELECT id, ik_id FROM backups WHERE kind='auto' AND ik_id IS NOT NULL ORDER BY created_at DESC OFFSET ${KEEP}`);
    for (const o of old) {
      try { if (await imagekit.remove(o.ik_id)) await db.q('UPDATE backups SET ik_id=NULL, ik_url=NULL, note=$1 WHERE id=$2', ['পুরনো, মুছে ফেলা হয়েছে', o.id]); } catch (_) { /* next time */ }
    }
    return { ok: true, size: r.buffer.length, rows: r.rows };
  } catch (e) {
    await db.q(`INSERT INTO backups(kind, ok, note) VALUES('auto', false, $1)`, [String(e.message).slice(0, 300)]).catch(() => {});
    return { ok: false, error: e.message };
  } finally {
    await db.q(`UPDATE settings SET value=NULL WHERE key='auto_backup_lease'`).catch(() => {});
  }
}

module.exports = { run, password, due, KEEP };

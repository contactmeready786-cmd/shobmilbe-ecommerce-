#!/usr/bin/env node
'use strict';
// Full database backup (with pictures) — run every night by GitHub Actions (.github/workflows/backup.yml).
//   DATABASE_URL=... BACKUP_PASSWORD=... node tools/backup.js [out-folder]
// The file is always locked with BACKUP_PASSWORD (it holds customers' details); without a password it refuses to run.
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const backup = require('../lib/services/backup');

(async () => {
  const password = String(process.env.BACKUP_PASSWORD || '');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (password.length < 12) throw new Error('BACKUP_PASSWORD must be at least 12 characters (backups hold customer data)');
  await db.ensureReady();
  const out = process.argv[2] || 'backups';
  fs.mkdirSync(out, { recursive: true });
  const r = await backup.dump(db, { withImages: process.env.BACKUP_IMAGES !== '0', withAnalytics: process.env.BACKUP_ANALYTICS === '1', password });
  const name = `shobmilbe-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.smbk`;
  fs.writeFileSync(path.join(out, name), r.buffer);
  await db.q(`INSERT INTO backups(kind, ok, size_bytes, tables, rows_count, with_images, encrypted, note) VALUES('auto', true, $1, $2, $3, $4, true, $5)`,
    [r.buffer.length, r.tables, r.rows, process.env.BACKUP_IMAGES !== '0', `GitHub Actions${process.env.GITHUB_RUN_ID ? ' #' + process.env.GITHUB_RUN_ID : ''}`]).catch(() => {});
  console.log(`OK ${name} ${(r.buffer.length / 1048576).toFixed(1)} MB, ${r.tables} tables, ${r.rows} rows`);
  process.exit(0);
})().catch(async (e) => {
  console.error('BACKUP FAILED:', e.message);
  await db.q(`INSERT INTO backups(kind, ok, note) VALUES('auto', false, $1)`, [String(e.message).slice(0, 300)]).catch(() => {});
  process.exit(1);
});

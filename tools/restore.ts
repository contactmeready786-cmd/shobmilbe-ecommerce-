#!/usr/bin/env node
// Put a backup back into a database.
//   DATABASE_URL=<where to restore> npx tsx tools/restore.ts <backup file> [--password=...] --yes
// Every table that is in the backup is EMPTIED and refilled from the backup. Safest: restore into a NEW Neon branch first,
// check the shop there, then switch the live site over (see Admin → ব্যাকআপ ও রিস্টোর).
import * as fs from 'node:fs';
import * as db from '../lib/db';
import * as backup from '../lib/services/backup';
import type { Loose } from '../lib/types';

(async () => {
  const file = process.argv[2];
  const yes = process.argv.includes('--yes');
  const pw = (process.argv.find((a) => a.startsWith('--password=')) || '').slice(11) || process.env.BACKUP_PASSWORD || '';
  if (!file || !fs.existsSync(file)) throw new Error('usage: npx tsx tools/restore.ts <backup file> [--password=...] --yes');
  const data = backup.read(fs.readFileSync(file), pw);
  const n = Object.values<Loose>(data.tables).reduce((s: number, t) => s + t.rows.length, 0);
  console.log(`Backup from ${data.created_at}: ${Object.keys(data.tables).length} tables, ${n} rows, pictures: ${data.with_images ? 'yes' : 'no'}`);
  if (!yes) { console.log('Nothing changed. Add --yes to restore into', (process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@')); process.exit(0); }
  await db.ensureReady(); // the database gets every table first (new branch / new database)
  const r = await backup.restore(db, data, { log: (m: Loose) => console.log('  ' + m) });
  console.log(`RESTORED ${r.tables} tables, ${r.rows} rows`);
  process.exit(0);
})().catch((e) => { console.error('RESTORE FAILED:', e.message); process.exit(1); });

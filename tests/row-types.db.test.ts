// 🗂️ lib/data/rows.ts (one type per table, made from the layout written in lib/db.ts) must say exactly what the real
// database has after the shop sets it up: every table, every column, its type and whether it can be empty (a column
// is "present" when it is NOT NULL or has a DEFAULT). Runs on the throw-away test database only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';

// how lib/pg hands each Postgres type to the code (lib/pg.ts TYPE_PARSERS); everything else arrives as text
const AS: Record<number, string> = {
  16: 'boolean', 17: 'Buffer', 1000: 'boolean[]', 1007: 'number[]', 1016: 'number[]', 1009: 'string[]', 20: 'number', 21: 'number',
  23: 'number', 700: 'number', 701: 'number', 1700: 'number', 114: 'unknown', 3802: 'unknown', 1114: 'Date', 1184: 'Date',
};

before(async () => { if (!skip) await db.ensureReady(); });
after(() => closeConnection());

test('every table and column in lib/data/rows.ts matches the real database', { skip }, async () => {
  const cols = await db.q<{ t: string; c: string; present: boolean; oid: number }>(`SELECT c.relname AS t, a.attname AS c,
      (a.attnotnull OR a.atthasdef) AS present, a.atttypid::int AS oid
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relname NOT LIKE '\\_%'
    ORDER BY 1, a.attnum`);
  const written = new Map<string, string>();
  const src = fs.readFileSync('lib/data/rows.ts', 'utf8');
  for (const m of src.matchAll(/\/\*\* A row of (\w+)\. \*\/\nexport type \w+ = \{\n([\s\S]*?)\n\};/g)) {
    for (const line of m[2].split('\n')) { const [k, v] = line.trim().replace(/;$/, '').split(': '); written.set(`${m[1]}.${k}`, v); }
  }
  const wrong: string[] = [];
  const inDb = new Set<string>();
  for (const r of cols) {
    const key = `${r.t}.${r.c}`; inDb.add(key);
    const ty = AS[r.oid] || 'string';
    const want = ty === 'unknown' ? 'unknown' : r.present ? ty : `${ty} | null`;
    if (written.get(key) !== want) wrong.push(`${key}: database ${want}, rows.ts ${written.get(key) ?? '(missing)'}`);
  }
  for (const key of written.keys()) if (!inDb.has(key)) wrong.push(`${key}: in rows.ts but not in the database`);
  assert.ok(cols.length > 500, 'the shop\'s tables are there');
  assert.deepEqual(wrong, [], 'run: npx tsx tools/gen-row-types.ts (and check the layout in lib/db.ts)');
});

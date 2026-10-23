// 🍃 The shop's backup file → a MongoDB copy, ready to load (owner, 2026-10-23: an experimental MongoDB home for the
// data, not connected to the live shop).
//
//   npx tsx tools/mongo/convert.ts <backup.smbk | backup.json.gz> <out-folder> [--password=…]
//
// Writes one file per collection (<name>.json — a JSON array in MongoDB Extended JSON: exact money as Decimal128,
// dates as dates, pictures as binary) plus _plan.json (indexes, id counters, what couldn't be copied one-to-one).
// tools/mongo/load.ts puts the folder into a MongoDB database (Atlas or your own); tools/mongo/verify.ts checks it
// against the PostgreSQL database row by row. Needs no MongoDB package itself.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { read } from '../../lib/services/backup';
import { planOf, type CollectionPlan, type Kind } from './schema';

export type Converted = { collections: Record<string, { file: string; count: number }>; counters: Record<string, number>; skipped: string[] };

/** one value in Extended JSON */
export function ejson(v: unknown, kind: Kind | undefined): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'decimal': return { $numberDecimal: String(v) };
    case 'int': return typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
    case 'float': return Number(v);
    case 'date': { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : { $date: d.toISOString() }; }
    case 'day': return String(v).slice(0, 10);
    case 'bool': return v === true || v === 't' || v === 'true';
    case 'binary': return { $binary: { base64: String(v), subType: '00' } };
    case 'json': return typeof v === 'string' ? safeJson(v) : v;
    default: return v;
  }
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch (_) { return s; } };

/** a table's rows → documents (the single primary key becomes _id; every column is kept under its own name too) */
export function documents(columns: string[], rows: unknown[][], plan: CollectionPlan | undefined): Record<string, unknown>[] {
  return rows.map((r) => {
    const doc: Record<string, unknown> = {};
    if (plan?.idColumn) {
      const i = columns.indexOf(plan.idColumn);
      if (i >= 0 && r[i] !== null && r[i] !== undefined) doc._id = ejson(r[i], plan.kinds[plan.idColumn]);
    }
    columns.forEach((c, i) => { doc[c] = ejson(r[i], plan?.kinds[c]); });
    return doc;
  });
}

export function convert(buf: Buffer, outDir: string, { password = '', dbTs = fs.readFileSync('lib/db.ts', 'utf8') } = {}): Converted {
  const data = read(buf, password);
  const plan = planOf(dbTs);
  fs.mkdirSync(outDir, { recursive: true });
  const out: Converted = { collections: {}, counters: {}, skipped: [...plan.skipped] };
  for (const [name, t] of Object.entries(data.tables)) {
    const p = plan.collections.get(name);
    if (!p) out.skipped.push(`${name}: lib/db.ts-এ এই টেবিল নেই — তবু কপি হলো, ধরন অনুমান করে`);
    const docs = documents(t.columns, t.rows, p);
    const file = `${name}.json`;
    fs.writeFileSync(path.join(outDir, file), JSON.stringify(docs));
    out.collections[name] = { file, count: docs.length };
    // the next number for an auto-numbered id (serial) — MongoDB has none of its own
    if (p?.serial) {
      const i = t.columns.indexOf(p.serial);
      out.counters[name] = t.rows.reduce((m: number, r) => Math.max(m, Number(r[i]) || 0), 0);
    }
  }
  const indexes = Object.fromEntries([...plan.collections.values()].map((c) => [c.name, c.indexes]));
  fs.writeFileSync(path.join(outDir, '_plan.json'), JSON.stringify({ created_from: data.created_at, schema_version: data.schema_version, indexes, counters: out.counters, skipped: out.skipped }, null, 1));
  return out;
}

if (process.argv[1] && /convert\.ts$/.test(process.argv[1])) {
  const [file, outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const pw = (process.argv.find((a) => a.startsWith('--password=')) || '').slice(11) || process.env.BACKUP_PASSWORD || '';
  if (!file || !outDir) { console.error('usage: npx tsx tools/mongo/convert.ts <backup file> <out folder> [--password=…]'); process.exit(2); }
  const r = convert(fs.readFileSync(file), outDir, { password: pw });
  const n = Object.values(r.collections).reduce((s, c) => s + c.count, 0);
  console.log(`OK ${Object.keys(r.collections).length} collections, ${n} documents → ${outDir}`);
  for (const s of r.skipped) console.log('  ⚠️ ' + s);
}

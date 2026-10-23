// 🍃 Is the MongoDB copy the same as the PostgreSQL database? For every collection made by tools/mongo/convert.ts:
//   • the number of documents = the number of rows,
//   • every money / numeric column adds up to exactly the same total (to the paisa),
//   • the first rows, column by column, hold the same values.
//   DATABASE_URL=postgres://… MONGODB_URI=… MONGODB_DB=shobmilbe npx tsx tools/mongo/verify.ts <folder>
// Prints a table (also to the GitHub job summary) and fails when anything differs.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MongoClient, BSON } from 'mongodb';

const { Decimal128, Binary } = BSON;
import * as db from '../../lib/db';
import { planOf } from './schema';

const qi = (n: string) => '"' + n.replace(/"/g, '""') + '"';
/** one value as plain comparable text, whichever database it came from */
function norm(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Decimal128) return Math.round(Number(v.toString()) * 10000) / 10000;
  if (v instanceof Binary) return Buffer.from(v.buffer).toString('base64');
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Math.round(v * 10000) / 10000;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !process.env.DATABASE_URL || !process.env.MONGODB_URI) { console.error('usage: DATABASE_URL=… MONGODB_URI=… npx tsx tools/mongo/verify.ts <folder>'); process.exit(2); }
  const plan = planOf(fs.readFileSync('lib/db.ts', 'utf8'));
  const names = fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_')).map((x) => x.replace(/\.json$/, '')).sort();
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const mdb = client.db(process.env.MONGODB_DB || 'shobmilbe');
  const lines: string[] = ['| collection | rows (Postgres) | documents (MongoDB) | money columns | sample rows | |', '|---|---:|---:|---|---|---|'];
  let bad = 0;
  for (const name of names) {
    const p = plan.collections.get(name);
    const col = mdb.collection(name);
    const rows = Number((await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${qi(name)}`))!.n);
    const docs = await col.countDocuments();
    const problems: string[] = [];
    if (rows !== docs) problems.push(`count ${rows} ≠ ${docs}`);
    const decs = p ? Object.entries(p.kinds).filter(([, k]) => k === 'decimal').map(([c]) => c) : [];
    for (const c of decs) {
      const pg = Number((await db.one<{ s: string | null }>(`SELECT coalesce(sum(${qi(c)}),0)::text AS s FROM ${qi(name)}`))!.s);
      const mg = await col.aggregate([{ $group: { _id: null, s: { $sum: `$${c}` } } }]).toArray();
      const m = mg.length ? Number(String(mg[0].s)) : 0;
      if (Math.round(pg * 100) !== Math.round(m * 100)) problems.push(`${c}: ${pg} ≠ ${m}`);
    }
    let sampled = 0;
    if (p?.idColumn) {
      const sample = await db.q<Record<string, unknown>>(`SELECT * FROM ${qi(name)} ORDER BY ${qi(p.idColumn)} LIMIT 5`);
      for (const r of sample) {
        const d = await col.findOne({ _id: r[p.idColumn] as never });
        if (!d) { problems.push(`${p.idColumn}=${String(r[p.idColumn])} missing`); continue; }
        for (const [k, v] of Object.entries(r)) {
          if (p.kinds[k] === 'binary') continue; // pictures: compared by count only (they are big)
          const a = JSON.stringify(norm(v)); const b = JSON.stringify(norm(d[k]));
          if (a !== b) { problems.push(`${p.idColumn}=${String(r[p.idColumn])}.${k}: ${a.slice(0, 40)} ≠ ${b.slice(0, 40)}`); break; }
        }
        sampled++;
      }
    }
    if (problems.length) bad++;
    lines.push(`| ${name} | ${rows} | ${docs} | ${decs.length ? decs.length + ' ✓' : '—'} | ${sampled || '—'} | ${problems.length ? '❌ ' + problems.slice(0, 3).join('; ') : '✅'} |`);
  }
  await client.close();
  const summary = `${bad ? `❌ ${bad} collection(s) differ` : `✅ all ${names.length} collections match`}\n\n${lines.join('\n')}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## 🍃 MongoDB copy vs PostgreSQL\n\n' + summary);
  fs.writeFileSync(path.join(dir, '_verify.md'), summary);
  const docsTotal = lines.slice(2).reduce((t, l) => t + (Number(l.split('|')[3]) || 0), 0);
  console.log(`::notice title=MongoDB copy::${bad ? bad + ' collection(s) differ' : `all ${names.length} collections match`} — ${docsTotal} documents`);
  if (bad) for (const l of lines.filter((x) => x.includes('❌'))) console.log(`::error title=MongoDB differs::${l.slice(0, 900)}`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log(`::error title=MongoDB verify failed::${String(e && e.stack || e).slice(0, 1500).replace(/\n/g, ' | ')}`); process.exit(1); });

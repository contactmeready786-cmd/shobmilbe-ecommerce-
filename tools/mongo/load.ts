// 🍃 Puts a folder made by tools/mongo/convert.ts into a MongoDB database (Atlas or your own).
//   MONGODB_URI=mongodb+srv://… MONGODB_DB=shobmilbe npx tsx tools/mongo/load.ts <folder> [--fresh]
// --fresh empties each collection first. Then the indexes (unique rules included) and the id counters
// (collection "counters": { _id: <table>, seq: <last id> }) are made. Needs the "mongodb" package
// (CI installs it on the fly: npm i --no-save mongodb).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MongoClient, EJSON } from 'mongodb';
import type { IndexPlan } from './schema';

const NON_NULL = ['string', 'int', 'long', 'double', 'decimal', 'date', 'bool', 'objectId', 'object', 'array', 'binData'];

export async function load(dir: string, uri: string, dbName: string, { fresh = false, log = console.log } = {}) {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '_plan.json'), 'utf8')) as { indexes: Record<string, IndexPlan[]>; counters: Record<string, number> };
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    let total = 0;
    const problems: string[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
      const name = f.replace(/\.json$/, '');
      const docs = EJSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'), { relaxed: false }) as Record<string, unknown>[];
      const col = db.collection(name);
      if (fresh) await col.deleteMany({});
      try {
        for (let i = 0; i < docs.length; i += 1000) await col.insertMany(docs.slice(i, i + 1000), { ordered: true });
      } catch (e) { problems.push(`${name}: ${(e as Error).message}`); continue; }
      for (const ix of plan.indexes[name] || []) {
        // PostgreSQL lets many rows leave a UNIQUE column empty (NULL); MongoDB counts empty as a value — so a unique
        // rule only covers documents where the columns are filled in (the same rule as PostgreSQL's)
        const partial = ix.partial || (ix.unique ? Object.fromEntries(Object.keys(ix.keys).map((k) => [k, { $type: NON_NULL }])) : undefined);
        try {
          await col.createIndex(ix.keys, {
            name: ix.name, unique: ix.unique,
            ...(partial ? { partialFilterExpression: partial } : {}),
            ...(ix.caseInsensitive ? { collation: { locale: 'en', strength: 2 } } : {}),
          });
        } catch (e) { problems.push(`${name} index ${ix.name}: ${(e as Error).message}`); }
      }
      total += docs.length;
      log(`${name}: ${docs.length}`);
    }
    const counters = db.collection<{ _id: string; seq: number }>('counters');
    for (const [name, seq] of Object.entries(plan.counters)) await counters.updateOne({ _id: name }, { $set: { seq } }, { upsert: true });
    for (const p of problems) console.log(`::error title=MongoDB load::${p.slice(0, 900)}`);
    if (problems.length) throw new Error(`${problems.length} problem(s): ${problems[0]}`);
    log(`OK ${total} documents`);
    return total;
  } finally { await client.close(); }
}

if (process.argv[1] && /load\.ts$/.test(process.argv[1])) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const uri = process.env.MONGODB_URI || '';
  if (!dir || !uri) { console.error('usage: MONGODB_URI=… [MONGODB_DB=shobmilbe] npx tsx tools/mongo/load.ts <folder> [--fresh]'); process.exit(2); }
  load(dir, uri, process.env.MONGODB_DB || 'shobmilbe', { fresh: process.argv.includes('--fresh') }).then(() => process.exit(0), (e) => { console.log(`::error title=MongoDB load failed::${String(e && e.stack || e).slice(0, 1500).replace(/\n/g, ' | ')}`); process.exit(1); });
}

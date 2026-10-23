// 🍃 Puts a folder made by tools/mongo/convert.ts into a MongoDB database (Atlas or your own).
//   MONGODB_URI=mongodb+srv://… MONGODB_DB=shobmilbe npx tsx tools/mongo/load.ts <folder> [--fresh]
// --fresh empties each collection first. Then the indexes (unique rules included) and the id counters
// (collection "counters": { _id: <table>, seq: <last id> }) are made. Needs the "mongodb" package
// (CI installs it on the fly: npm i --no-save mongodb).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MongoClient, EJSON } from 'mongodb';
import type { IndexPlan } from './schema';

export async function load(dir: string, uri: string, dbName: string, { fresh = false, log = console.log } = {}) {
  const plan = JSON.parse(fs.readFileSync(path.join(dir, '_plan.json'), 'utf8')) as { indexes: Record<string, IndexPlan[]>; counters: Record<string, number> };
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    let total = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_')).sort()) {
      const name = f.replace(/\.json$/, '');
      const docs = EJSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'), { relaxed: false }) as Record<string, unknown>[];
      const col = db.collection(name);
      if (fresh) await col.deleteMany({});
      for (let i = 0; i < docs.length; i += 1000) await col.insertMany(docs.slice(i, i + 1000), { ordered: true });
      for (const ix of plan.indexes[name] || []) {
        await col.createIndex(ix.keys, {
          name: ix.name, unique: ix.unique,
          ...(ix.partial ? { partialFilterExpression: ix.partial } : {}),
          ...(ix.caseInsensitive ? { collation: { locale: 'en', strength: 2 } } : {}),
        });
      }
      total += docs.length;
      log(`${name}: ${docs.length}`);
    }
    const counters = db.collection<{ _id: string; seq: number }>('counters');
    for (const [name, seq] of Object.entries(plan.counters)) await counters.updateOne({ _id: name }, { $set: { seq } }, { upsert: true });
    log(`OK ${total} documents`);
    return total;
  } finally { await client.close(); }
}

if (process.argv[1] && /load\.ts$/.test(process.argv[1])) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const uri = process.env.MONGODB_URI || '';
  if (!dir || !uri) { console.error('usage: MONGODB_URI=… [MONGODB_DB=shobmilbe] npx tsx tools/mongo/load.ts <folder> [--fresh]'); process.exit(2); }
  load(dir, uri, process.env.MONGODB_DB || 'shobmilbe', { fresh: process.argv.includes('--fresh') }).then(() => process.exit(0), (e) => { console.error('LOAD FAILED:', e.message); process.exit(1); });
}

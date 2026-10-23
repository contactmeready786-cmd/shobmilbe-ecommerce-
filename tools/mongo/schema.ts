// 🍃 MongoDB copy of the shop's database (owner, 2026-10-23 — an experimental second home for the data, not connected
// to the live shop). This reads the database layout in lib/db.ts and works out, for every table:
//   • the collection (same name), and which column becomes MongoDB's own `_id` (the table's single primary key);
//   • how each column is stored: money / numeric → Decimal128 (exact paisa, never 0.1 + 0.2 trouble), whole numbers →
//     numbers, timestamps → dates, pictures (bytea) → binary, json → as it is, the rest as text;
//   • the indexes: every UNIQUE rule (column, table-level, composite primary key, CREATE UNIQUE INDEX) and the plain
//     indexes on columns. Indexes on expressions or with a WHERE part can't be copied one-to-one and are listed in `skipped`.
import { tablesOf, splitTop, bracketed } from '../rowtypes';

export type Kind = 'decimal' | 'int' | 'float' | 'date' | 'day' | 'bool' | 'json' | 'binary' | 'text' | 'array';
export type IndexPlan = { name: string; keys: Record<string, 1 | -1>; unique: boolean; partial?: Record<string, unknown>; caseInsensitive?: boolean };
export type CollectionPlan = { name: string; idColumn: string | null; serial: string | null; kinds: Record<string, Kind>; indexes: IndexPlan[] };
export type Plan = { collections: Map<string, CollectionPlan>; skipped: string[] };

export function kindOf(sql = ''): Kind {
  const t = sql.toLowerCase().trim();
  if (/\[\]$/.test(t)) return 'array';
  const base = t.replace(/\(.*\)$/, '').trim();
  if (/^(numeric|decimal)$/.test(base)) return 'decimal';
  if (/^(small|big)?serial$|^(int|integer|smallint|bigint|int2|int4|int8)$/.test(base)) return 'int';
  if (/^(real|float4|float8|double precision)$/.test(base)) return 'float';
  if (/^timestamp/.test(base)) return 'date';
  if (base === 'date') return 'day';
  if (/^bool(ean)?$/.test(base)) return 'bool';
  if (/^jsonb?$/.test(base)) return 'json';
  if (base === 'bytea') return 'binary';
  return 'text';
}

const cols = (list: string) => list.split(',').map((c) => c.trim().replace(/"/g, ''));
const simpleKey = (c: string) => /^[a-z_][a-z0-9_]*(\s+(asc|desc))?(\s+nulls\s+(first|last))?$/i.test(c);
const keyOf = (list: string[]): Record<string, 1 | -1> => Object.fromEntries(list.map((c) => [c.split(/\s+/)[0], /\sdesc\b/i.test(c) ? -1 : 1]));

export function planOf(dbTs: string): Plan {
  const src = dbTs.replace(/--[^\n]*/g, '');
  const tables = tablesOf(dbTs);
  const collections = new Map<string, CollectionPlan>();
  const skipped: string[] = [];
  for (const t of tables.values()) {
    const kinds: Record<string, Kind> = {};
    for (const c of t.columns.values()) kinds[c.name] = kindOf(c.sql);
    collections.set(t.name, { name: t.name, idColumn: null, serial: null, kinds, indexes: [] });
  }
  const addIndex = (table: string, ix: IndexPlan) => {
    const c = collections.get(table);
    if (!c) return;
    const sig = JSON.stringify(ix.keys);
    const same = c.indexes.find((x) => JSON.stringify(x.keys) === sig);
    if (same) { same.unique = same.unique || ix.unique; return; }
    c.indexes.push(ix);
  };
  // keys and UNIQUE rules written inside CREATE TABLE … ( … ) and ADD COLUMN … UNIQUE
  const tre = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/gi;
  for (let m: RegExpExecArray | null; (m = tre.exec(src));) {
    const table = m[1];
    const c = collections.get(table)!;
    for (const def of splitTop(bracketed(src, m.index + m[0].length - 1))) {
      const pk = def.match(/^PRIMARY KEY\s*\(([^)]+)\)/i);
      if (pk) { addIndex(table, { name: `${table}_pkey`, keys: keyOf(cols(pk[1])), unique: true }); continue; }
      const un = def.match(/^(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(([^)]+)\)/i);
      if (un) { addIndex(table, { name: `${table}_${cols(un[1]).join('_')}_key`, keys: keyOf(cols(un[1])), unique: true }); continue; }
      const name = def.trim().split(/\s+/)[0].replace(/"/g, '');
      if (/\bprimary key\b/i.test(def)) { c.idColumn = name; if (/serial/i.test(def)) c.serial = name; continue; }
      if (/\bunique\b/i.test(def)) addIndex(table, { name: `${table}_${name}_key`, keys: { [name]: 1 }, unique: true });
    }
  }
  const are = /ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)([^;,]*\bUNIQUE\b)/gi;
  for (let m: RegExpExecArray | null; (m = are.exec(src));) addIndex(m[1], { name: `${m[1]}_${m[2]}_key`, keys: { [m[2]]: 1 }, unique: true });
  // CREATE [UNIQUE] INDEX … ON table (…) [WHERE …]
  const ire = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*(?:USING\s+\w+\s*)?\(([^;]*?)\)\s*(WHERE[^;]*)?;/gi;
  for (let m: RegExpExecArray | null; (m = ire.exec(src));) {
    const [, uniq, name, table, list, where] = m;
    let parts = splitTop(list);
    // lower(email) / upper(code): the same in MongoDB with a case-blind index
    let caseInsensitive = false;
    if (parts.length === 1 && /^(lower|upper)\(\s*(\w+)\s*\)$/i.test(parts[0])) { parts = [parts[0].replace(/^(lower|upper)\(\s*(\w+)\s*\)$/i, '$2')]; caseInsensitive = true; }
    if (!parts.every(simpleKey)) { skipped.push(`${name} (${table}): হিসাব দিয়ে বানানো index — MongoDB-তে কোডে মিলিয়ে দেখতে হবে`); continue; }
    // WHERE x <> '' / x IS NOT NULL / a yes-no column → MongoDB's "partial" index (the same rule)
    let partial: Record<string, unknown> | undefined;
    if (where) {
      const w = where.replace(/^WHERE\s+/i, '').trim();
      let p: RegExpMatchArray | null;
      if ((p = w.match(/^(\w+)\s*<>\s*''$/))) partial = { [p[1]]: { $gt: '' } };
      else if ((p = w.match(/^(\w+)\s+IS NOT NULL$/i))) partial = { [p[1]]: { $type: ['string', 'int', 'long', 'double', 'decimal', 'date', 'bool', 'objectId'] } };
      else if ((p = w.match(/^(\w+)$/))) partial = { [p[1]]: true };
      else skipped.push(`${name} (${table}): শর্ত "${w}" — সাধারণ index হিসেবে নেওয়া হলো, নিয়মটা কোডে রাখতে হবে`);
    }
    addIndex(table, { name, keys: keyOf(parts), unique: !!uniq && (!where || !!partial), ...(partial ? { partial } : {}), ...(caseInsensitive ? { caseInsensitive } : {}) });
  }
  return { collections, skipped };
}

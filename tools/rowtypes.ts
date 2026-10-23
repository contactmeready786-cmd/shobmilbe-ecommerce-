// Reads the shop's database layout (the CREATE TABLE / ALTER TABLE statements in lib/db.ts) and writes one TypeScript
// type per table: the row as lib/pg hands it over. Used by tools/gen-row-types.ts (writes lib/data/rows.ts) and by
// tests/row-types.test.ts (fails when the file is out of date, so a new column can't be forgotten).
//
// How a column's SQL type arrives in JavaScript (lib/pg.ts TYPE_PARSERS): whole numbers, numeric and float → number;
// boolean → boolean; timestamp / timestamptz → Date; json / jsonb → whatever was stored (unknown); bytea → Buffer;
// int[] / text[] / bool[] → arrays. Everything else (text, date, time, uuid …) arrives as text.

// A column is "present" (no `| null`) when it is NOT NULL or has a DEFAULT: the shop never writes NULL into a column
// that has a default, so such a column is always filled in practice.
export type Column = { name: string; ts: string; notNull: boolean; hasDefault: boolean; nullable: boolean; /** the SQL type as written (for tools/mongo) */ sql?: string };
const settle = (c: Column) => { c.nullable = !(c.notNull || c.hasDefault); };
export type Table = { name: string; columns: Map<string, Column> };

/** The JavaScript type a SQL type arrives as. */
export function tsType(sqlType: string): string {
  const t = sqlType.toLowerCase().replace(/\s+/g, ' ').trim();
  const array = /\[\]$/.test(t);
  const base = t.replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim();
  const scalar = /^(small|big)?serial$|^(int|integer|smallint|bigint|int2|int4|int8|numeric|decimal|real|float4|float8|double precision)$/.test(base) ? 'number'
    : /^(boolean|bool)$/.test(base) ? 'boolean'
      : /^timestamp(tz| with time zone| without time zone)?$/.test(base) ? 'Date'
        : /^jsonb?$/.test(base) ? 'unknown'
          : base === 'bytea' ? 'Buffer'
            : /^(text|varchar|character varying|char|character|citext|uuid|inet|date|time|interval)$/.test(base) ? 'string'
              : 'unknown';
  if (!array) return scalar;
  // only these arrays are read into JavaScript arrays (lib/pg); any other array type arrives as its text
  return scalar === 'number' && /^(int|integer|int4|int8|bigint)$/.test(base) ? 'number[]'
    : base === 'text' ? 'string[]' : scalar === 'boolean' ? 'boolean[]' : 'string';
}

/** Splits at commas that are not inside brackets or quotes. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ''; let cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const STOP = /^(not|null|default|primary|references|unique|check|generated|collate|constraint)$/i;
/** "price numeric(14,2) NOT NULL DEFAULT 0" → the column, or null for a table constraint. */
function columnOf(def: string): Column | null {
  const words = def.replace(/\s+/g, ' ').trim().split(' ');
  const name = words[0].replace(/"/g, '');
  if (!/^[a-z_][a-z0-9_]*$/i.test(name) || /^(primary|unique|foreign|check|constraint|exclude)$/i.test(name)) return null;
  const typeWords: string[] = [];
  for (const w of words.slice(1)) { if (STOP.test(w)) break; typeWords.push(w); }
  const sqlType = typeWords.join(' ');
  const rest = def.slice(def.indexOf(words[0]) + words[0].length);
  const notNull = /\bnot null\b/i.test(rest) || /\bprimary key\b/i.test(rest) || /serial/i.test(sqlType);
  const hasDefault = /\bdefault\b/i.test(rest) && !/\bdefault\s+null\b/i.test(rest);
  const c: Column = { name, ts: tsType(sqlType), notNull, hasDefault, nullable: true, sql: sqlType.toLowerCase() };
  settle(c);
  return c;
}

/** The body between the brackets that open at `start` (index of "("). */
export function bracketed(s: string, start: number): string {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s.slice(start + 1, i);
  }
  return s.slice(start + 1);
}

/** Every table and its columns, after all of lib/db.ts's statements, in file order. */
export function tablesOf(dbTs: string): Map<string, Table> {
  const sql = dbTs.replace(/--[^\n]*/g, '');
  const tables = new Map<string, Table>();
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(|ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)\s+((?:[^;`'"]|'[^']*')*)/gi;
  for (let m: RegExpExecArray | null; (m = re.exec(sql));) {
    if (m[1]) {
      const name = m[1];
      const body = bracketed(sql, m.index + m[0].length - 1);
      const t: Table = tables.get(name) || { name, columns: new Map() };
      for (const def of splitTop(body)) { const c = columnOf(def); if (c && !t.columns.has(c.name)) t.columns.set(c.name, c); }
      tables.set(name, t);
      continue;
    }
    const t = tables.get(m[2]);
    if (!t) continue;
    for (const action of splitTop(m[3])) {
      let a: RegExpMatchArray | null;
      if ((a = action.match(/^ADD COLUMN (?:IF NOT EXISTS )?([\s\S]+)$/i))) {
        const c = columnOf(a[1]);
        if (c && !t.columns.has(c.name)) t.columns.set(c.name, c);
      } else if ((a = action.match(/^ALTER COLUMN (\w+) (?:SET DATA )?TYPE ([\w\s(),[\]]+?)(?: USING [\s\S]*)?$/i))) {
        const c = t.columns.get(a[1]);
        if (c) { c.ts = tsType(a[2]); c.sql = a[2].trim().toLowerCase(); }
      } else if ((a = action.match(/^ALTER COLUMN (\w+) DROP NOT NULL$/i))) {
        const c = t.columns.get(a[1]); if (c) { c.notNull = false; settle(c); }
      } else if ((a = action.match(/^ALTER COLUMN (\w+) SET NOT NULL$/i))) {
        const c = t.columns.get(a[1]); if (c) { c.notNull = true; settle(c); }
      } else if ((a = action.match(/^ALTER COLUMN (\w+) SET DEFAULT ([\s\S]+)$/i))) {
        const c = t.columns.get(a[1]); if (c) { c.hasDefault = !/^null$/i.test(a[2].trim()); settle(c); }
      } else if ((a = action.match(/^ALTER COLUMN (\w+) DROP DEFAULT$/i))) {
        const c = t.columns.get(a[1]); if (c) { c.hasDefault = false; settle(c); }
      } else if ((a = action.match(/^DROP COLUMN (?:IF EXISTS )?(\w+)/i))) {
        t.columns.delete(a[1]);
      } else if ((a = action.match(/^RENAME COLUMN (\w+) TO (\w+)$/i))) {
        const c = t.columns.get(a[1]);
        if (c) { t.columns.delete(a[1]); t.columns.set(a[2], { ...c, name: a[2] }); }
      }
    }
  }
  return tables;
}

/** orders → OrdersRow, order_items → OrderItemsRow */
export const typeName = (table: string) => table.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') + 'Row';

/** The text of lib/data/rows.ts. */
export function rowTypesSource(dbTs: string): string {
  const tables = [...tablesOf(dbTs).values()].filter((t) => !t.name.startsWith('_')).sort((a, b) => a.name.localeCompare(b.name));
  const blocks = tables.map((t) => {
    const cols = [...t.columns.values()].map((c) => `  ${c.name}: ${c.ts}${c.nullable && c.ts !== 'unknown' ? ' | null' : ''};`);
    return `/** A row of ${t.name}. */\nexport type ${typeName(t.name)} = {\n${cols.join('\n')}\n};`;
  });
  return `// Made by tools/gen-row-types.ts from the database layout in lib/db.ts — don't edit by hand.
// One type per table: a row as lib/pg hands it over (numbers for whole numbers and money, Date for times, text for
// dates, null where the column allows it). A query that adds joined or computed columns can extend these:
//   db.q<OrdersRow & { item_count: number }>(…)
// After changing the database layout run: npx tsx tools/gen-row-types.ts (tests/row-types.test.ts checks it).

${blocks.join('\n\n')}

/** Every table's row type by table name. */
export type Tables = {
${tables.map((t) => `  ${t.name}: ${typeName(t.name)};`).join('\n')}
};
`;
}

// Writes lib/data/rows.ts: one type per database table, read from the database layout in lib/db.ts (tools/rowtypes.ts).
// Run after changing the database layout: npx tsx tools/gen-row-types.ts (tests/row-types.test.ts checks it).
import fs from 'node:fs';
import { rowTypesSource, tablesOf } from './rowtypes';

const src = fs.readFileSync('lib/db.ts', 'utf8');
fs.writeFileSync('lib/data/rows.ts', rowTypesSource(src));
console.log(`row types: ${tablesOf(src).size} tables`);

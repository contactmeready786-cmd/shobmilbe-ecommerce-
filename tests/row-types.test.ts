// 🗄️ lib/data/rows.ts (one type per database table) must match the database layout in lib/db.ts.
// After changing the layout run: npx tsx tools/gen-row-types.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowTypesSource, tablesOf, tsType } from '../tools/rowtypes';

test('lib/data/rows.ts is up to date with lib/db.ts', () => {
  assert.equal(readFileSync('lib/data/rows.ts', 'utf8'), rowTypesSource(readFileSync('lib/db.ts', 'utf8')),
    'run: npx tsx tools/gen-row-types.ts');
});

test('SQL types arrive as the JavaScript types lib/pg reads them into', () => {
  assert.equal(tsType('numeric(14,2)'), 'number');
  assert.equal(tsType('serial'), 'number');
  assert.equal(tsType('timestamptz'), 'Date');
  assert.equal(tsType('date'), 'string');
  assert.equal(tsType('boolean'), 'boolean');
  assert.equal(tsType('jsonb'), 'unknown');
  assert.equal(tsType('int[]'), 'number[]');
  assert.equal(tsType('text[]'), 'string[]');
});

test('the layout is read through every change: added columns, new types, dropped NOT NULL', () => {
  const t = tablesOf(`CREATE TABLE IF NOT EXISTS shop (id serial PRIMARY KEY, name text NOT NULL, price int, UNIQUE(name));
    ALTER TABLE shop ADD COLUMN IF NOT EXISTS note text DEFAULT '', ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
    ALTER TABLE shop ALTER COLUMN price TYPE numeric(14,2);
    ALTER TABLE shop ALTER COLUMN name DROP NOT NULL;`).get('shop')!;
  assert.deepEqual([...t.columns.keys()], ['id', 'name', 'price', 'note', 'tags']);
  assert.equal(t.columns.get('price')!.ts, 'number');
  assert.equal(t.columns.get('name')!.nullable, true);
  assert.equal(t.columns.get('id')!.nullable, false);
  assert.equal(t.columns.get('tags')!.ts, 'string[]');
});

test('the main tables are there with their key columns', () => {
  const tables = tablesOf(readFileSync('lib/db.ts', 'utf8'));
  for (const [table, cols] of Object.entries({ orders: ['id', 'code', 'total', 'paid_amount', 'status'], order_items: ['order_id', 'price', 'qty'],
    products: ['id', 'slug', 'price', 'stock', 'cost_price'], customers: ['id', 'phone', 'email_verified'], staff: ['id', 'username', 'role'] })) {
    const t = tables.get(table);
    assert.ok(t, table);
    for (const c of cols) assert.ok(t.columns.has(c), `${table}.${c}`);
  }
});

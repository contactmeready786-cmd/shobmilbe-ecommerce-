// 🍃 The MongoDB copy (owner, 2026-10-23 — experimental, not connected to the live shop): the layout is read right
// (ids, exact money, dates, unique rules) and a backup file turns into documents with the same values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { planOf, kindOf } from '../tools/mongo/schema';
import { convert, ejson } from '../tools/mongo/convert';

test('mongo: column kinds', () => {
  assert.equal(kindOf('numeric(14,2)'), 'decimal');
  assert.equal(kindOf('serial'), 'int');
  assert.equal(kindOf('timestamptz'), 'date');
  assert.equal(kindOf('date'), 'day');
  assert.equal(kindOf('jsonb'), 'json');
  assert.equal(kindOf('bytea'), 'binary');
  assert.equal(kindOf('text[]'), 'array');
  assert.equal(kindOf('text'), 'text');
});

test('mongo: the shop layout — ids, money, unique rules', () => {
  const p = planOf(fs.readFileSync('lib/db.ts', 'utf8'));
  assert.equal(p.collections.size >= 90, true);
  const orders = p.collections.get('orders')!;
  assert.equal(orders.idColumn, 'id');
  assert.equal(orders.kinds.total, 'decimal');
  assert.equal(orders.kinds.created_at, 'date');
  assert.ok(orders.indexes.some((i) => i.unique && i.keys.code === 1), 'order code stays unique');
  assert.equal(p.collections.get('settings')!.idColumn, 'key');
  assert.ok(p.collections.get('warehouse_stock')!.indexes.some((i) => i.unique && i.keys.warehouse_id === 1 && i.keys.product_id === 1));
  const bc = p.collections.get('products')!.indexes.find((i) => i.name === 'products_barcode_uq')!;
  assert.deepEqual([bc.unique, bc.partial], [true, { barcode: { $gt: '' } }]);
  assert.equal(p.collections.get('customers')!.indexes.find((i) => i.name === 'customers_vemail_uq')!.caseInsensitive, true);
});

test('mongo: values in Extended JSON', () => {
  assert.deepEqual(ejson(12.5, 'decimal'), { $numberDecimal: '12.5' });
  assert.deepEqual(ejson('2026-10-23T10:00:00.000Z', 'date'), { $date: '2026-10-23T10:00:00.000Z' });
  assert.equal(ejson('2026-10-23', 'day'), '2026-10-23');
  assert.deepEqual(ejson('{"a":1}', 'json'), { a: 1 });
  assert.equal(ejson(null, 'decimal'), null);
});

test('mongo: a backup file → one file per collection, ids and counters', () => {
  const backup = { app: 'shobmilbe', format: 1, schema_version: 1, created_at: '2026-10-23T00:00:00Z', with_images: false, tables: {
    orders: { columns: ['id', 'code', 'total', 'created_at'], rows: [[1, 'SM1', 1450.5, '2026-10-22T08:00:00.000Z'], [7, 'SM7', 300, '2026-10-23T08:00:00.000Z']] },
    settings: { columns: ['key', 'value'], rows: [['store_name', 'সবমিলবে']] },
  } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongo-'));
  const r = convert(zlib.gzipSync(Buffer.from(JSON.stringify(backup))), dir);
  assert.equal(r.collections.orders.count, 2);
  assert.equal(r.counters.orders, 7);
  const docs = JSON.parse(fs.readFileSync(path.join(dir, 'orders.json'), 'utf8'));
  assert.deepEqual(docs[0], { _id: 1, id: 1, code: 'SM1', total: { $numberDecimal: '1450.5' }, created_at: { $date: '2026-10-22T08:00:00.000Z' } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))[0]._id, 'store_name');
  assert.ok(fs.existsSync(path.join(dir, '_plan.json')));
});

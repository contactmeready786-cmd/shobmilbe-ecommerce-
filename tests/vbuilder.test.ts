// 🎨 রং / সাইজ table in the product form (lib/admin/products.tsx): the rows the form sends are read in order, cleaned,
// and an empty row is dropped — so every colour × size gets its own price, buying price, stock and photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vbRowsFromBody } from '../lib/admin/products';

test('variant table: rows read from the form in order', () => {
  const rows = vbRowsFromBody({
    vb_id: ['', '12', ''], vb_color: ['সাদা', 'সাদা', ''], vb_size: ['Small', 'Large / XL', ''],
    vb_price: ['2', '3.5', ''], vb_cost: ['1.2', '', ''], vb_stock: ['500', '', ''], vb_img: ['1', '1', ''], vb_on: ['1', '0', '1'],
  });
  assert.deepEqual(rows, [
    { id: 0, color: 'সাদা', size: 'Small', price: '2', cost: '1.2', stock: '500', img: '1', on: true },
    { id: 12, color: 'সাদা', size: 'Large - XL', price: '3.5', cost: '', stock: '', img: '1', on: false }, // "/" can't break the label
  ]);
  // one row only (the form sends single values, not lists)
  assert.deepEqual(vbRowsFromBody({ vb_id: '', vb_color: 'সিলভার', vb_size: '', vb_price: '4', vb_stock: '', vb_img: '', vb_on: '1' }),
    [{ id: 0, color: 'সিলভার', size: '', price: '4', cost: '', stock: '', img: '', on: true }]);
  assert.deepEqual(vbRowsFromBody({}), []);
});

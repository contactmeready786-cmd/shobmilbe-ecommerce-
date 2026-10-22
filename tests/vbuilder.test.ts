// 🎨 রং / সাইজ table in the product form (lib/admin/products.tsx): the rows the form sends are read in order, cleaned,
// and an empty row is dropped — so every colour × size gets its own price, buying price, stock and photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vbRowsFromBody, dimsText } from '../lib/admin/products';

test('variant table: rows read from the form in order', () => {
  const rows = vbRowsFromBody({
    vb_id: ['', '12', ''], vb_color: ['সাদা', 'সাদা', ''], vb_size: ['Small', 'Large / XL', ''],
    vb_price: ['2', '3.5', ''], vb_cost: ['1.2', '', ''], vb_stock: ['500', '', ''], vb_img: ['1', '1', ''], vb_on: ['1', '0', '1'], vb_del: ['1', '0', '0'],
  });
  assert.deepEqual(rows, [
    { id: 0, color: 'সাদা', size: 'Small', price: '2', cost: '1.2', stock: '500', img: '1', on: true, del: false, dl: '', dw: '', dh: '' }, // (a new row can't be 'deleted')
    { id: 12, color: 'সাদা', size: 'Large - XL', price: '3.5', cost: '', stock: '', img: '1', on: false, del: false, dl: '', dw: '', dh: '' }, // "/" can't break the label
  ]);
  // one row only (the form sends single values, not lists)
  assert.deepEqual(vbRowsFromBody({ vb_id: '', vb_color: 'সিলভার', vb_size: '', vb_price: '4', vb_stock: '', vb_img: '', vb_on: '1' }),
    [{ id: 0, color: 'সিলভার', size: '', price: '4', cost: '', stock: '', img: '', on: true, del: false, dl: '', dw: '', dh: '' }]);
  assert.deepEqual(vbRowsFromBody({}), []);
  // a saved row marked 🗑️
  assert.equal(vbRowsFromBody({ vb_id: '7', vb_color: 'লাল', vb_size: 'M', vb_price: '5', vb_on: '1', vb_del: '1' })[0].del, true);
});

test('variant table: a box\'s measure (দৈর্ঘ্য × প্রস্থ × উচ্চতা)', () => {
  const [r] = vbRowsFromBody({ vb_color: 'বাদামি', vb_size: '৩ নং', vb_price: '12', vb_on: '1', vb_dl: '৩০', vb_dw: '20.5 cm', vb_dh: '' });
  assert.deepEqual([r.dl, r.dw, r.dh], ['30', '20.5', '']);
  assert.equal(dimsText(r.dl, r.dw, r.dh, 'সেমি'), '30 × 20.5 × - সেমি');
  assert.equal(dimsText('', '', '', 'ইঞ্চি'), ''); // nothing given → no measure
  assert.equal(dimsText('4', '4', '2', 'ইঞ্চি'), '4 × 4 × 2 ইঞ্চি');
  assert.equal(dimsText('4', '4', '2', 'furlong'), '4 × 4 × 2 সেমি'); // unknown unit → সেমি
});

// 🙋 Help button (owner, 2026-11-18): suggested answers come from the shop's own settings, the owner's saved list wins,
// typed questions find the right answer (Bangla and English, Bangla digits, word endings), and the page gets nothing
// while the button is switched off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpConfig, helpRows, suggestedItems, cleanRow, HELP_MAX_ITEMS } from '../lib/models/helpbot';
import { bestMatches, normalise, words } from '../client/shop/helpmatch';
import type { Settings } from '../lib/types';

const S = (x: Record<string, string>) => ({ store_name: 'সবমিলবে', session_secret: 'x', ...x }) as Settings;

test('help: off by default in a bare settings object, on when switched on', () => {
  assert.equal(helpConfig(S({})), null);
  const c = helpConfig(S({ help_on: '1', whatsapp: '01712345678', chat_whatsapp_button: '1', chat_tawk_property: 'abc' }));
  assert.ok(c);
  assert.equal(c.wa, '8801712345678');
  assert.equal(c.tawk, true);
  assert.equal(c.track, true);
  assert.ok(c.items.length >= 4);
  assert.equal(helpConfig(S({ help_on: '1', whatsapp: '01712345678', chat_whatsapp_button: '0' }))?.wa, '');
});

test('help: suggested answers follow the settings (delivery charges, minimum order, payment)', () => {
  const rows = suggestedItems(S({ delivery_dhaka: '70', delivery_outside: '130', min_order: '10', pay_cod: '1' }));
  const charge = rows.find((r) => r.q.includes('ডেলিভারি চার্জ'));
  assert.ok(charge && charge.a.includes('৳৭০') && charge.a.includes('৳১৩০'));
  assert.ok(rows.some((r) => r.a.includes('৳১০')));
  assert.equal(suggestedItems(S({ min_order: '0' })).some((r) => r.q.includes('সর্বনিম্ন')), false);
  assert.equal(suggestedItems(S({ pay_cod: '0' })).some((r) => r.q.includes('টাকা কিভাবে')), false);
});

test('help: the owner\'s saved list wins; hidden rows never reach the page; broken JSON falls back', () => {
  const saved = JSON.stringify([{ q: 'প্রশ্ন ১', a: 'উত্তর ১', k: '', on: true }, { q: 'প্রশ্ন ২', a: 'উত্তর ২', k: '', on: false }, { q: '', a: 'no question' }]);
  assert.equal(helpRows(S({ help_items: saved })).length, 2);
  const c = helpConfig(S({ help_on: '1', help_items: saved }));
  assert.deepEqual(c?.items.map((i) => i.q), ['প্রশ্ন ১']);
  assert.ok(helpRows(S({ help_items: '{oops' })).length >= 4);
  assert.deepEqual(helpRows(S({ help_items: '[]' })), []);
  const many = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ q: `q${i}`, a: 'a', k: '' })));
  assert.equal(helpRows(S({ help_items: many })).length, HELP_MAX_ITEMS);
});

test('help: a row is tidied and limited', () => {
  assert.equal(cleanRow({ q: '  x  ', a: '' }), null);
  const r = cleanRow({ q: 'a\n  b', a: 'y'.repeat(5000), k: 'k', on: '0' });
  assert.ok(r);
  assert.equal(r.q, 'a b');
  assert.equal(r.a.length, 700);
  assert.equal(r.on, false);
});

test('help: typed questions find the right ready answer', () => {
  const items = suggestedItems(S({ min_order: '10', pay_cod: '1', pay_bkash: '1' })).map(({ q, a, k }) => ({ q, a, k }));
  const first = (typed: string) => bestMatches(items, typed)[0]?.q || '';
  assert.match(first('ঢাকার বাইরে ডেলিভারি চার্জ কত টাকা?'), /ডেলিভারি চার্জ/);
  assert.match(first('delivery charge koto'), /ডেলিভারি চার্জ/);
  assert.match(first('বিকাশে পেমেন্ট করা যাবে?'), /টাকা কিভাবে/);
  assert.match(first('পণ্য ভাঙা আসলে রিটার্ন হবে?'), /সমস্যা/);
  assert.match(first('আমার অর্ডার বাতিল করতে চাই'), /বাতিল/);
  assert.deepEqual(bestMatches(items, 'হ্যালো'), []);
  assert.deepEqual(bestMatches(items, '   '), []);
  assert.ok(bestMatches(items, 'অর্ডার', 2).length <= 2);
});

test('help: words are normalised (digits, punctuation, filler words)', () => {
  assert.equal(normalise('ডেলিভারি চার্জ ১২০?!'), 'ডেলিভারি চার্জ 120');
  assert.deepEqual(words('আমার অর্ডার কি?'), ['অর্ডার']);
});

// 👟 Pairs → one pair (owner, 2026-11-23): "2/3 pairs in one listing" becomes one pair, the name says "(1 Pair)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPairs, cleanPairText } from '../lib/models/pairsingle-parse';

test('pairsingle: pairs read and the name made one pair', () => {
  assert.deepEqual(readPairs('2 Pairs 4mm Banana Plug Red Black'), { pairs: 2, name: '4mm Banana Plug Red Black (1 Pair)', bn: '' });
  assert.deepEqual(readPairs('Alligator Clip Test Lead (5 Pair)', '৫ জোড়া অ্যালিগেটর ক্লিপ'), { pairs: 5, name: 'Alligator Clip Test Lead (1 Pair)', bn: 'অ্যালিগেটর ক্লিপ (১ জোড়া)' });
  assert.deepEqual(readPairs('10Pcs (5 Pairs) JST 2Pin Male Female Connector'), { pairs: 5, name: 'JST 2Pin Male Female Connector (1 Pair)', bn: '' });
  assert.deepEqual(readPairs('XT60 Connector Male Female Pair - 3 Pairs'), { pairs: 3, name: 'XT60 Connector Male Female Pair', bn: '' });
  assert.equal((readPairs('Earring Stud', '৩ জোড়া কানের দুল') as { pairs: number }).pairs, 3);
  assert.equal((readPairs('Socks', '২ পেয়ার মোজা') as { bn: string }).bn, 'মোজা (১ জোড়া)');
  assert.equal((readPairs('2-Pair Fate Type Clips', '2-জোড়া ফাট টাইপ ক্লিপ') as { bn: string }).bn, 'ফাট টাইপ ক্লিপ (১ জোড়া)');
  assert.equal((readPairs('5Pair - Black JST Connector 2 Pin Kit JST Male Female') as { pairs: number }).pairs, 5);
  assert.equal((readPairs('2Pair Multimeter Probe Test Lead Wire') as { pairs: number }).pairs, 2);
});

test('pairsingle: one pair, cables, extras and mixed sets are left alone', () => {
  for (const [n, b] of [['1 Pair Banana Plug', ''], ['Banana Plug Pair', ''], ['4 Pair Cat6 UTP Cable 1m', ''], ['Earphone With 3 Pairs Ear Tips', ''],
    ['3 Pair Socks Combo Different Colors', ''], ['10Pcs 3 Pairs Connector', ''], ['Arduino Uno R3', '']]) assert.ok('skip' in readPairs(n, b), n);
});

test('pairsingle: texts', () => {
  assert.equal(cleanPairText('Package: 2 Pairs banana plug (4 pcs)', 2), 'Package: 1 Pair banana plug ');
  assert.equal(cleanPairText('Pack of 3 Pairs XT60', 3), '1 Pair XT60');
  assert.equal(cleanPairText('২ জোড়া প্লাগ', 2), '১ জোড়া প্লাগ');
});

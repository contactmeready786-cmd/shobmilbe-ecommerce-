// 📊 গুগলে চাহিদা (lib/services/gtrends.ts): Google Trends' answers are read correctly, the numbers (this month against
// last month, against the year, the high months) are right, and the day's advice says the right thing — no network here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleJson, readSeries, readRelated, stats, advise, cleanTerm, termWords, type Week } from '../lib/services/gtrends';

/** 52 weeks from mid-November 2025: February 80, December 70, the last 4 weeks 40, otherwise 20 */
function year(): Week[] {
  const start = Date.UTC(2025, 10, 16);
  return Array.from({ length: 52 }, (_, i) => {
    const t = start + i * 7 * 864e5;
    const m = new Date(t + 6 * 3600e3).getUTCMonth();
    return { t, v: i >= 48 ? 40 : m === 1 ? 80 : m === 11 ? 70 : 20 };
  });
}

test('gtrends: Google\'s guarded JSON is read, the unfinished week is left out', () => {
  assert.deepEqual(parseGoogleJson(")]}',\n{\"a\":1}"), { a: 1 });
  assert.throws(() => parseGoogleJson('<html>sorry</html>'));
  const text = ")]}',\n" + JSON.stringify({ default: { timelineData: [
    { time: '1763251200', value: [16] }, { time: '1763856000', value: [18] }, { time: '1764460800', value: [9], isPartial: true },
  ] } });
  const s = readSeries(text);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.v), [16, 18]);
  assert.equal(s[0].t, 1763251200 * 1000);
});

test('gtrends: related searches — top and rising, cleaned', () => {
  const text = ")]}',\n" + JSON.stringify({ default: { rankedList: [
    { rankedKeyword: [{ query: 'TV Remote Price', value: 100, formattedValue: '100' }, { query: 'smart tv remote', value: 48 }] },
    { rankedKeyword: [{ query: 'mi tv stick remote', value: 5000, formattedValue: 'Breakout' }, { query: 'how to program tv remote', value: 250, formattedValue: '+250%' }] },
  ] } });
  const r = readRelated(text);
  assert.deepEqual(r.top.map((x) => x.query), ['tv remote price', 'smart tv remote']);
  assert.equal(r.rising[0].value, 'Breakout');
  assert.equal(r.rising[1].value, '+250%');
  assert.deepEqual(readRelated(")]}',\n{}"), { top: [], rising: [] });
});

test('gtrends: this month against last month, against the year, and the high months', () => {
  const s = stats(year());
  assert.equal(s.month, 40);
  assert.equal(s.prev, 20);
  assert.equal(s.change, 100);
  assert.ok(s.vsYear! > 0);
  assert.ok(!s.low);
  assert.ok(s.peaks.includes(1), 'February is a high month');
  assert.ok(s.peaks.includes(11), 'December is a high month');
  assert.ok(!s.peaks.includes(10), 'November is not');
  // a word hardly anyone searches: no percentages, no high months
  const few = stats(year().map((p, i) => ({ ...p, v: i % 3 ? 0 : 2 })));
  assert.ok(few.low);
  assert.deepEqual(few.peaks, []);
  assert.equal(stats([]).change, null);
});

test('gtrends: words are cleaned; "price in bd" is not a product word', () => {
  assert.equal(cleanTerm('  TV   Remote!! '), 'tv remote');
  assert.equal(cleanTerm('টিভি রিমোট'), 'টিভি রিমোট');
  assert.deepEqual(termWords('soldering iron price in bd'), ['soldering', 'iron']);
  assert.deepEqual(termWords('price'), ['price']);
});

test('gtrends: the day\'s advice — bring it in, push it, stock before the season, slow down, check the price, new searches', () => {
  const base = { ok_at: new Date(), low: false, peakList: [] as number[], fresh: [] as { query: string; value: string; first_seen: Date }[], vs_year: 0, month_v: 40 };
  const none = { n: 0, stock: 0, price: null, cost: null, id: null, name: '' };
  const list = [
    { ...base, id: 1, term: 'tv remote', change: 100, peakList: [1, 11], ours: none, market: { shops: 3, min: 150, median: 220 } },
    { ...base, id: 2, term: 'multimeter', change: 60, ours: { n: 2, stock: 5, price: 450, cost: 300, id: 9, name: 'DT830B' }, market: { shops: 0, min: null, median: null } },
    { ...base, id: 3, term: 'room heater', change: -50, ours: { n: 1, stock: 20, price: 1500, cost: 1100, id: 8, name: 'Heater' }, market: { shops: 0, min: null, median: null } },
    { ...base, id: 4, term: 'glue gun', change: 0, ours: { n: 1, stock: 3, price: 300, cost: 150, id: 7, name: 'Glue gun' }, market: { shops: 2, min: 180, median: 200 } },
    { ...base, id: 5, term: 'arduino', change: 5, ours: { n: 3, stock: 9, price: 900, cost: 600, id: 6, name: 'Uno' }, market: { shops: 0, min: null, median: null },
      fresh: [{ query: 'arduino nano v3', value: 'Breakout', first_seen: new Date() }, { query: 'arduino ide', value: '+40%', first_seen: new Date() }] },
    { ...base, id: 6, term: 'rare thing', change: 300, low: true, ours: none, market: { shops: 0, min: null, median: null } },
    { ...base, id: 7, term: 'not read yet', change: 300, ok_at: null, ours: none, market: { shops: 0, min: null, median: null } },
  ];
  const a = advise(list, 10); // November
  const kinds = (term: string) => a.filter((x) => x.term === term).map((x) => x.kind).sort();
  assert.deepEqual(kinds('tv remote'), ['season', 'stock']);
  assert.deepEqual(kinds('multimeter'), ['push']);
  assert.deepEqual(kinds('room heater'), ['slow']);
  assert.deepEqual(kinds('glue gun'), ['price']);
  assert.deepEqual(kinds('arduino'), ['new'], 'only a sudden ("Breakout") new search, not a small rise');
  assert.deepEqual(kinds('rare thing'), [], 'too few searches to say anything');
  assert.deepEqual(kinds('not read yet'), []);
  assert.equal(a[0].term, 'tv remote', 'not having a wanted product comes first');
  const stock = a.find((x) => x.kind === 'stock')!;
  assert.match(stock.title, /\+১০০%/);
  assert.match(stock.why, /৳/);
  assert.equal(stock.source, 'tv remote', 'where to buy it is shown');
  const push = a.find((x) => x.kind === 'push')!;
  assert.match(push.why, /কেনা/, 'the buying price and profit are shown');
  assert.equal(push.link, '/admin/products/9');
  // an old "Breakout" (seen weeks ago) is no longer news
  const old = advise([{ ...list[4], fresh: [{ query: 'x', value: 'Breakout', first_seen: new Date(Date.now() - 20 * 864e5) }] }], 10);
  assert.equal(old.length, 0);
});

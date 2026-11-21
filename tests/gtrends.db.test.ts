// 📊 গুগলে চাহিদা with a database: a word is read from (a pretend) Google Trends, saved with its numbers and its rising
// searches, joined with our own product and stock; when Google says "too many" (429) everything waits and nothing is
// lost. No real network: Google's answers are given. Run locally: TEST_DATABASE_URL=postgres://… npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as G from '../lib/services/gtrends';
import * as R from '../lib/services/research';
import type { Fetched } from '../lib/services/safefetch';

const answer = (status: number, text: string, headers: Record<string, string | string[]> = {}): Fetched =>
  ({ status, ok: status >= 200 && status < 300, headers, body: Buffer.from(text), contentType: 'application/json', finalUrl: '' });
let googleStatus = 200;
const asked: string[] = [];
function google(url: string): Fetched {
  asked.push(url);
  if (url.endsWith('/robots.txt')) return answer(200, 'User-agent: *\nDisallow: /explore?\nDisallow: /trends/explore?\n');
  if (googleStatus !== 200) return answer(googleStatus, 'slow down');
  if (url.includes('/trends/?geo')) return answer(200, '<html></html>', { 'set-cookie': ['NID=abc; Path=/', 'OTHER=x'] });
  if (url.includes('/api/explore')) return answer(200, ")]}'\n" + JSON.stringify({ widgets: [
    { id: 'TIMESERIES', token: 't1', request: { a: 1 } }, { id: 'RELATED_QUERIES', token: 't2', request: { b: 2 } }] }));
  if (url.includes('/multiline')) {
    const start = Date.UTC(2025, 10, 16);
    const timelineData = Array.from({ length: 52 }, (_, i) => ({ time: String((start + i * 7 * 864e5) / 1000), value: [i >= 48 ? 60 : 20] }));
    return answer(200, ")]}',\n" + JSON.stringify({ default: { timelineData } }));
  }
  if (url.includes('/relatedsearches')) return answer(200, ")]}',\n" + JSON.stringify({ default: { rankedList: [
    { rankedKeyword: [{ query: 'walton tv remote', value: 100 }] }, { rankedKeyword: [{ query: 'mi tv stick remote', value: 5000, formattedValue: 'Breakout' }] }] } }));
  return answer(404, '');
}

let pid = 0;
before(async () => {
  if (skip) return;
  await db.ensureReady();
  R.setFetch(async (u) => google(u));
  G.setFetch(async (u) => google(u));
  G.setGap(0);
  pid = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, cost_price, stock, active) VALUES('Zqx TV Remote Gtest', $1, 250, 150, 0, true) RETURNING id", [`gt-${Date.now()}`]))!.id;
});
after(async () => {
  if (!skip) await db.q(`DELETE FROM settings WHERE key IN ('gtrends_wait', 'gtrends_backoff')`);
  R.setFetch(null); G.setFetch(null);
  await closeConnection();
});

test('a word is read, saved, matched with our product, and advised', { skip }, async () => {
  const t = await G.addTerm('  ZQX TV Remote ');
  assert.equal(t.term, 'zqx tv remote');
  const r = await G.refresh(t.id);
  assert.ok(r.ok, r.error);
  assert.ok(asked.some((u) => u.includes('/api/explore') && u.includes(encodeURIComponent('"keyword":"zqx tv remote"'))));
  const row = await db.one<{ change: number; month_v: number; low: boolean; ok_at: Date | null }>('SELECT change, month_v, low, ok_at FROM trend_terms WHERE id=$1', [t.id]);
  assert.equal(row!.change, 200);
  assert.equal(row!.month_v, 60);
  assert.ok(row!.ok_at && !row!.low);
  const v = (await G.views({ search: 'zqx' })).find((x) => x.id === t.id)!;
  assert.equal(v.ours.n, 1);
  assert.equal(v.ours.stock, 0);
  assert.equal(v.ours.id, pid);
  assert.ok(v.fresh.some((f) => f.query === 'mi tv stick remote'), 'the rising search is kept with its date');
  // a rising search can also be searched for
  assert.ok((await G.views({ search: 'stick' })).some((x) => x.id === t.id));
  const advice = G.advise([v], 10);
  assert.ok(advice.some((a) => a.kind === 'stock' && /স্টক শেষ/.test(a.title)), 'wanted but out of stock');
  assert.ok(advice.some((a) => a.kind === 'new'));
  // adding the same word again does not make a second one
  assert.equal((await G.addTerm('zqx tv remote')).id, t.id);
});

test('a hidden word stays hidden; the owner can bring it back', { skip }, async () => {
  const t = await G.addTerm('glue gun gtest');
  await G.setHidden(t.id, true);
  assert.ok(!(await G.views()).some((x) => x.id === t.id));
  assert.ok((await G.views({ hidden: true })).some((x) => x.id === t.id));
  await G.syncTerms({ force: true });
  assert.equal((await db.one<{ hidden: boolean }>('SELECT hidden FROM trend_terms WHERE id=$1', [t.id]))!.hidden, true, 'the daily list never brings it back');
  await G.setHidden(t.id, false);
  assert.ok((await G.views()).some((x) => x.id === t.id));
});

test('Google says "too many": everything waits, the saved numbers stay', { skip }, async () => {
  const t = await G.addTerm('multimeter gtest');
  googleStatus = 429;
  G.setFetch(async (u) => google(u)); // (a new cookie is asked for)
  const r = await G.refresh(t.id);
  assert.equal(r.ok, false);
  assert.ok((await G.blockedUntil()) > Date.now() + 3600e3, 'waits at least an hour');
  const before = asked.length;
  const tv = await db.one<{ id: number }>(`SELECT id FROM trend_terms WHERE term='zqx tv remote'`);
  assert.equal((await G.refresh(tv!.id)).ok, false);
  assert.equal(asked.length, before, 'Google is not asked again while waiting');
  assert.equal((await db.one<{ change: number }>('SELECT change FROM trend_terms WHERE id=$1', [tv!.id]))!.change, 200, 'the last good numbers stay');
  googleStatus = 200;
  await db.q(`DELETE FROM settings WHERE key IN ('gtrends_wait', 'gtrends_backoff')`);
  assert.ok((await G.refresh(t.id)).ok);
});

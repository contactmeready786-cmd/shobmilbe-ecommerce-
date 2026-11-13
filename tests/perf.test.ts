// ⚡ সার্ভারের চাপ (lib/services/perf.ts): programs are named in the owner's words, jobs are timed, and a job that can
// wait skips its turn while the server is busy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../lib/services/perf';

test('programs get plain names', () => {
  assert.match(P.label('node', 'node /home/shop/app-new/node_modules/.bin/next build'), /আপডেট/);
  assert.match(P.label('next-server', 'next-server (v16.4.2)'), /ওয়েবসাইট/);
  assert.match(P.label('postgres', 'postgres: 16/main: shop shop 127.0.0.1(5432) idle'), /ডাটাবেস/);
});

test('jobs are timed; an optional job waits while the server is busy', async () => {
  let ran = 0;
  await P.timeJob('test-job', async () => { ran++; });
  assert.equal(ran, 1);
  const j = P.jobStats().find((x) => x.name === 'test-job');
  assert.ok(j && j.runs === 1);
  await P.timeJob('test-job', async () => { throw new Error('x'); }); // never throws
  assert.equal(P.busy(Infinity), false);
});

// ☁️ ব্যাকগ্রাউন্ড সাদা: the AI's waiting list must never fill up with pictures that are already finished (owner,
// 2026-11-19: finished jobs stayed 'queued', took all 40 places, and a new picture showed "being made" for over an
// hour), and a picture too old for the list is reported, never left "being made" for ever.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as catalog from '../lib/models/catalog';
import * as cloud from '../lib/models/whitencloud';

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`wait-${n}-${Date.now()}-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
const realFetch = globalThis.fetch;
let finished: Record<string, { ok: boolean; error?: string }> = {};

before(async () => {
  if (skip) return;
  await db.ensureReady();
  await db.q(`UPDATE whiten_jobs SET status='kept' WHERE status='queued'`);
  // the results list on GitHub, as the cloud AI leaves it
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) =>
    String(u).includes('results/index.json') ? new Response(JSON.stringify(finished), { status: 200 }) : realFetch(u, init)) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; return closeConnection(); });

test('finished pictures leave the list, so the 41st picture is reached; old ones are reported', { skip }, async () => {
  const ids: number[] = [];
  for (let i = 0; i < 45; i++) ids.push(await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(i), ownerType: 'product', ownerId: 1 }));
  const jobs = await cloud.queue(ids, {});
  const rows = await db.q<{ id: number; token: string }>('SELECT id, token FROM whiten_jobs WHERE id = ANY($1::int[]) ORDER BY id', [Object.values(jobs)]);
  finished = Object.fromEntries(rows.slice(0, 42).map((r, i) => [r.token, i === 0 ? { ok: false, error: 'no product' } : { ok: true }]));
  const old = rows[44];
  await db.q(`UPDATE whiten_jobs SET created_at = now() - interval '3 days' WHERE id=$1`, [old.id]);

  const list = await cloud.waiting('https://shop.test');
  assert.deepEqual(list.map((j) => j.id), [rows[42].id, rows[43].id]);
  const st = await db.q<{ id: number; status: string }>('SELECT id, status FROM whiten_jobs WHERE id = ANY($1::int[]) ORDER BY id', [rows.map((r) => r.id)]);
  assert.equal(st[0].status, 'failed');
  assert.equal(st[1].status, 'done');
  assert.equal(st[44].status, 'failed');
});

// 📤 নিজের ছবি সাদা: a person's own pictures are theirs only — claimed only when nobody owns them yet, queued only by
// their owner, deleted only by their owner, and gone by themselves after 7 days. A product's picture can't be taken.
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

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`mine-${n}-${Date.now()}-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
const ME = 900001, OTHER = 900002;
let a = 0, b = 0, prodPic = 0;

before(async () => {
  if (skip) return;
  await db.ensureReady();
  a = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(1), keepPrivate: true });
  b = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(2), keepPrivate: true });
  prodPic = await catalog.saveMedia({ mime: 'image/jpeg', data: JPEG(3), ownerType: 'product', ownerId: 1 });
});
after(() => closeConnection());

test('only unowned pictures can be claimed; a product picture never', { skip }, async () => {
  assert.deepEqual((await cloud.claimMine([a, prodPic], ME)).sort(), [a]);
  assert.deepEqual(await cloud.claimMine([a], OTHER), []); // already mine
  const p = await db.one<{ owner_type: string }>('SELECT owner_type FROM media WHERE id=$1', [prodPic]);
  assert.equal(p!.owner_type, 'product');
});

test('only the owner queues and sees them; delete is the owner\'s only', { skip }, async () => {
  assert.deepEqual(await cloud.queue([a], {}, OTHER, 'mine'), {});
  const jobs = await cloud.queue([a], { bright: true }, ME, 'mine');
  assert.ok(jobs[a] > 0);
  assert.deepEqual((await cloud.listMine(ME)).map((x) => x.media_id), [a]);
  assert.deepEqual(await cloud.listMine(OTHER), []);
  assert.equal(await cloud.deleteMine(a, OTHER), false);
  assert.equal(await cloud.deleteMine(a, ME), true);
  assert.equal(await db.one('SELECT id FROM media WHERE id=$1', [a]), null);
  await assert.rejects(cloud.resultFile(jobs[a], ME)); // the job went with the picture
});

test('pictures older than 7 days go by themselves', { skip }, async () => {
  await cloud.claimMine([b], ME);
  await cloud.queue([b], {}, ME, 'mine');
  await db.q(`UPDATE media SET created_at = now() - interval '8 days' WHERE id=$1`, [b]);
  assert.deepEqual(await cloud.listMine(ME), []);
  assert.equal(await db.one('SELECT id FROM media WHERE id=$1', [b]), null);
});

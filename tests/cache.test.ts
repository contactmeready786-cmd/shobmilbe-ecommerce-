// The 15-second memory (lib/cache.ts): shop pages share copies, admin pages and changes never see old data.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { memo, clearAll, scoped, runFresh } from '../lib/cache';

let loads = 0;
const load = async () => { loads++; return { name: 'সবমিলবে', list: [1, 2, 3] }; };
beforeEach(() => { clearAll(); loads = 0; delete process.env.SHOP_CACHE; });

test('shop reads share one database read within 15 seconds', async () => {
  await memo('k', load); await memo('k', load); await memo('k', load);
  assert.equal(loads, 1);
});

test('each caller gets its own copy', async () => {
  const a = await memo('k', load);
  a.name = 'changed'; a.list.push(99);
  const b = await memo('k', load);
  assert.equal(b.name, 'সবমিলবে');
  assert.deepEqual(b.list, [1, 2, 3]);
});

test('expired entries are read again', async () => {
  await memo('k', load, 1);
  await new Promise((r) => setTimeout(r, 5));
  await memo('k', load, 1);
  assert.equal(loads, 2);
});

test('fresh scope always reads the database', async () => {
  await memo('k', load);
  await runFresh(() => memo('k', load));
  assert.equal(loads, 2);
});

test('a failed read is not remembered', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error('db down'); return 'ok'; };
  await assert.rejects(memo('f', flaky));
  assert.equal(await memo('f', flaky), 'ok');
});

test('SHOP_CACHE=0 switches it off', async () => {
  process.env.SHOP_CACHE = '0';
  await memo('k', load); await memo('k', load);
  assert.equal(loads, 2);
});

// the wrapper around the request handler
const handler = scoped(async (req: { method?: string; url?: string }) => memo('k', load));

test('shop GET pages use the memory', async () => {
  await handler({ method: 'GET', url: '/' }); await handler({ method: 'GET', url: '/p/x' });
  assert.equal(loads, 1);
});

test('admin pages always read fresh', async () => {
  await handler({ method: 'GET', url: '/' });
  await handler({ method: 'GET', url: '/admin/settings' });
  await handler({ method: 'GET', url: '/admin' });
  assert.equal(loads, 3);
});

test('a change (POST) reads fresh and empties the memory for the next shop page', async () => {
  await handler({ method: 'GET', url: '/' });          // 1: fills memory
  await handler({ method: 'POST', url: '/api/orders' }); // 2: fresh
  await handler({ method: 'GET', url: '/' });           // 3: memory was emptied
  assert.equal(loads, 3);
});

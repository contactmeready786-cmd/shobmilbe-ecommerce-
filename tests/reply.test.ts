// 📮 lib/reply.ts: how a form / admin file / fallback answer becomes a Web Response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reply } from '../lib/reply';

test('headers given with the answer replace the same header set earlier (a page\'s own cookie wins)', async () => {
  const r = new Reply();
  r.header('Set-Cookie', 'ref=AB12; Path=/');
  r.header('Cache-Control', 'no-store');
  r.answer(303, { Location: '/order/X1', 'Set-Cookie': ['sm_orders=1; HttpOnly', 'b=2'] });
  const res = r.toResponse();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/order/X1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(res.headers.getSetCookie(), ['sm_orders=1; HttpOnly', 'b=2']);
});

test('a header set before the answer stays when the answer does not set it', () => {
  const r = new Reply();
  r.header('Set-Cookie', 'ref=AB12; Path=/');
  r.answer(200, { 'Content-Type': 'text/html; charset=utf-8' }, '<p>হ্যালো</p>');
  assert.deepEqual(r.toResponse().headers.getSetCookie(), ['ref=AB12; Path=/']);
});

test('only the first answer counts', async () => {
  const r = new Reply();
  r.answer(200, { 'Content-Type': 'text/plain' }, 'first');
  r.answer(500, { 'Content-Type': 'text/html' }, 'second');
  const res = r.toResponse();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain');
  assert.equal(await res.text(), 'first');
});

test('bodies: text as UTF-8, files as bytes, nothing for 204 / 304', async () => {
  const t = new Reply(); t.answer(200, {}, 'বাংলা');
  assert.equal(await t.toResponse().text(), 'বাংলা');
  const f = new Reply(); f.answer(200, { 'Content-Type': 'image/png' }, Buffer.from([1, 2, 3]));
  assert.deepEqual([...new Uint8Array(await f.toResponse().arrayBuffer())], [1, 2, 3]);
  const n = new Reply(); n.answer(204, {}, 'ignored');
  assert.equal(n.toResponse().body, null);
  const e = new Reply(); e.answer(303, { Location: '/' });
  assert.equal(await e.toResponse().text(), '');
});

test('done settles when the answer is given', async () => {
  const r = new Reply();
  let settled = false;
  r.done.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  r.answer(200, {}, 'x');
  await r.done;
  assert.equal(settled, true);
  assert.equal(r.answered, true);
});

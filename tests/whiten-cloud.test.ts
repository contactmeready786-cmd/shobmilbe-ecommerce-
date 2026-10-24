// ☁️ ব্যাকগ্রাউন্ড সাদা — অনলাইনে: GitHub's computers (any country) must be able to read the waiting list even when the
// shop's country lock is on (owner, 2026-10-24: 11 pictures waited for hours because the list answered {"error":"region"}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PATHS } from '../lib/services/geolock';

test('the cloud worker passes the country lock', () => {
  assert.ok(OPEN_PATHS.test('/api/whiten-jobs'));
  assert.ok(OPEN_PATHS.test('/media/12'));
  assert.ok(!OPEN_PATHS.test('/api/whiten-jobs/x'));
  assert.ok(!OPEN_PATHS.test('/api/products'));
});

test('⚡ fast start: nothing without the owner\'s key; with it, one call to GitHub, at most once a minute', async () => {
  const cloud = await import('../lib/models/whitencloud');
  const calls: { url: string; auth: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization) });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await cloud.kick({ store_name: 'x', session_secret: 's' }), { ok: false, message: 'none' });
    assert.equal(calls.length, 0);
    const s = { store_name: 'x', session_secret: 's', whiten_gh_token: 'github_pat_TESTTESTTESTTESTTESTTEST' };
    assert.equal((await cloud.kick(s, true)).message, 'started');
    assert.equal((await cloud.kick(s)).message, 'recent'); // within a minute: no second call
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/actions\/workflows\/whiten-cloud\.yml\/dispatches$/);
    assert.equal(calls[0].auth, 'Bearer github_pat_TESTTESTTESTTESTTESTTEST');
  } finally { globalThis.fetch = real; }
});

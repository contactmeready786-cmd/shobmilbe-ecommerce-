// 🔒 Private repository (owner, 2026-11-13): with the owner's GitHub key the workers' files are read through GitHub's API
// (works when the repository is private); without a key the public address is tried, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gh from '../lib/services/ghfile';

test('with a key: GitHub API + the key; without: the public address', async () => {
  const calls: { url: string; auth?: string; accept?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const h = (init.headers || {}) as Record<string, string>;
    calls.push({ url: String(url), auth: h.Authorization, accept: h.Accept });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await gh.repoFile('social-videos', 'videos/12.mp4', { token: 'github_pat_TESTTESTTESTTESTTESTTEST' });
    assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/videos\/12\.mp4\?ref=social-videos$/);
    assert.equal(calls[0].auth, 'Bearer github_pat_TESTTESTTESTTESTTESTTEST');
    assert.match(String(calls[0].accept), /raw/);
    await gh.repoFile('whiten-results', 'results/index.json', { token: '' });
    assert.match(calls[1].url, /^https:\/\/raw\.githubusercontent\.com\/.+\/whiten-results\/results\/index\.json\?t=\d+$/);
    assert.equal(calls[1].auth, undefined);
    assert.equal(await gh.canRead('github_pat_TESTTESTTESTTESTTESTTEST'), true);
    assert.equal(await gh.dispatch('social-video.yml', ''), 0, 'no key: nothing is called');
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = real; }
});

// ⏱️ The shop's own timer (lib/scheduler.ts) starts only on the real server — never in CI, tests, a build or on Vercel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStart, start, status } from '../lib/scheduler';

test('only the real server starts the timer', () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  assert.equal(shouldStart(env({ NODE_ENV: 'production' })), true);
  assert.equal(shouldStart(env({ NODE_ENV: 'production', CI: 'true' })), false);
  assert.equal(shouldStart(env({ NODE_ENV: 'production', VERCEL: '1' })), false);
  assert.equal(shouldStart(env({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' })), false);
  assert.equal(shouldStart(env({ NODE_ENV: 'production', SHOP_SCHEDULER: '0' })), false);
  assert.equal(shouldStart(env({ NODE_ENV: 'test' })), false);
  assert.equal(start(), false); // in the tests nothing starts
  assert.equal(status().on, false);
});

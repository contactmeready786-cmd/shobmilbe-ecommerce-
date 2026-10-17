// Sentry key from the admin (lib/services/errors.ts): started once, changed or stopped when the saved key changes.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as errors from '../lib/services/errors';

const DSN = 'https://abc123def456@o12345.ingest.sentry.io/67890';
const DSN2 = 'https://ffff0000ffff@o12345.ingest.us.sentry.io/11111';
let started: string[] = [];
let sent: unknown[] = [];
let flushed = 0;
beforeEach(() => {
  started = []; sent = []; flushed = 0;
  delete process.env.SENTRY_DSN;
  errors.setReporter(null);
  errors.setStarter((dsn) => { started.push(dsn); return dsn ? (e) => { sent.push(e); } : null; });
  errors.setFlusher(async () => { flushed++; });
});

test('valid and invalid keys', () => {
  assert.ok(errors.validDsn(DSN));
  assert.ok(errors.validDsn(DSN2));
  for (const bad of ['', 'abc', 'http://abc123def456@o1.ingest.sentry.io/1', 'https://abc123def456@evil.example.com/1', DSN + '<script>']) assert.ok(!errors.validDsn(bad), bad);
});

test('no key: nothing starts, errors only logged', () => {
  errors.ensure({});
  assert.deepEqual(started, []);
  assert.ok(!errors.isOn());
});

test('key saved in admin starts Sentry once, not on every request', () => {
  errors.ensure({ sentry_dsn: DSN }); errors.ensure({ sentry_dsn: DSN }); errors.ensure({ sentry_dsn: DSN });
  assert.deepEqual(started, [DSN]);
  assert.ok(errors.isOn());
});

test('changing and clearing the key', () => {
  errors.ensure({ sentry_dsn: DSN });
  errors.ensure({ sentry_dsn: DSN2 });
  errors.ensure({ sentry_dsn: '' });
  assert.deepEqual(started, [DSN, DSN2, '']);
  assert.ok(!errors.isOn());
});

test('a broken saved key is ignored', () => {
  errors.ensure({ sentry_dsn: 'not a dsn' });
  assert.deepEqual(started, []);
});

test('SENTRY_DSN in Vercel wins over the admin key', () => {
  process.env.SENTRY_DSN = DSN2;
  errors.ensure({ sentry_dsn: DSN });
  assert.deepEqual(started, [DSN2]);
});

test('reports go out, and are flushed only when something was reported', async () => {
  await errors.flush();
  assert.equal(flushed, 0);
  errors.ensure({ sentry_dsn: DSN });
  errors.report(new Error('boom'));
  assert.equal(sent.length, 1);
  await errors.flush();
  await errors.flush();
  assert.equal(flushed, 1);
});

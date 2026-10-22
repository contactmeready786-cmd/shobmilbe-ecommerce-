// 📱 The app card's rules (owner, 2026-10-22: Admin → মেসেজ → অ্যাপের কার্ড): the shop and the browser share the same
// built-in rules, the owner's switches decide who sees it and where, "✕" keeps it away only for the days chosen, and
// the page hands nothing new to the browser until the owner has saved the rules once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVITE_DEFAULTS, inviteRules, inviteConfig } from '../lib/app-invite';
import * as client from '../client/app-release';
import type { Settings } from '../lib/types';

const S = (x: Record<string, string>) => ({ store_name: 'সবমিলবে', session_secret: 'x', ...x }) as Settings;

test('app card: the shop and the browser have the same built-in rules', () => {
  assert.deepEqual(client.INVITE_DEFAULTS, INVITE_DEFAULTS);
  assert.deepEqual(inviteRules(S({})), INVITE_DEFAULTS);
});

test('app card: nothing is handed to the browser until the owner saves', () => {
  assert.equal(inviteConfig(S({ app_invite_on: '0' })), null);
  assert.equal(inviteConfig(S({ app_invite_saved: '1', app_invite_on: '0' }))!.on, false);
});

test('app card: owner values are kept within limits, empty texts keep the old text', () => {
  const r = inviteRules(S({ app_invite_delay: '999', app_invite_hide_days: '-4', app_invite_a_title: '  ', app_invite_c_btn: 'নিন' }));
  assert.equal(r.delay, 120);
  assert.equal(r.hideDays, 0);
  assert.equal(r.texts.android.title, INVITE_DEFAULTS.texts.android.title);
  assert.equal(r.texts.computer.btn, 'নিন');
  assert.equal(inviteRules(S({ app_invite_delay: '0' })).delay, 0);
});

test('app card: who sees it and where', () => {
  const D = client.INVITE_DEFAULTS;
  const now = 1_000_000;
  assert.equal(client.inviteAllowed(D, 'android', '/', now, 0), true);
  assert.equal(client.inviteAllowed({ ...D, on: false }, 'android', '/', now, 0), false);
  assert.equal(client.inviteAllowed({ ...D, computer: false }, 'computer', '/', now, 0), false);
  assert.equal(client.inviteAllowed({ ...D, update: false }, 'update', '/', now, 0), false);
  assert.equal(client.inviteAllowed(D, null, '/', now, 0), false);
  for (const p of ['/cart', '/checkout', '/order/AB12', '/app', '/admin']) assert.equal(client.inviteAllowed(D, 'android', p, now, 0), false, p);
  assert.equal(client.inviteAllowed({ ...D, product: false }, 'android', '/p/soldering-iron', now, 0), false);
  assert.equal(client.inviteAllowed(D, 'android', '/p/soldering-iron', now, 0), true);
  // ✕ with "only this page" never hides it later; with days it stays away until then
  assert.equal(client.inviteAllowed(D, 'android', '/', now, now + 5000), true);
  assert.equal(client.inviteAllowed({ ...D, hideDays: 3 }, 'android', '/', now, now + 5000), false);
  assert.equal(client.inviteAllowed({ ...D, hideDays: 3 }, 'android', '/', now, now - 1), true);
});
